/**
 * The sidebar's browser code.
 *
 * It cannot run under Node -- it needs a DOM and google.script.run -- but
 * compiling it catches the syntax and early reference errors that would
 * otherwise show up only as a blank sidebar with nothing in any log. The
 * rest of this file checks the two things that silently break a sidebar:
 * a template that stops including its partials, and code reaching for an
 * element id that no longer exists.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

module.exports = ({ suite, test }) => {
  const sidebar = read('Sidebar.html');
  const clientJs = read('JavaScript.html');

  suite('Sidebar code compiles');

  ['JavaScript.html', 'Sidebar.html', 'Stylesheet.html'].forEach((f) => {
    const blocks = [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (f === 'JavaScript.html') {
      test(f + ' has script blocks at all', (t) => t.ok(blocks.length > 0));
    }
    blocks.forEach((code, i) => {
      test(f + ' block ' + (i + 1) + ' compiles', (t) => {
        t.ok(new vm.Script(code, { filename: f + ' block ' + (i + 1) }));
      });
    });
  });

  suite('Sidebar template');

  [['Stylesheet', /include\('Stylesheet'\)/], ['JavaScript', /include\('JavaScript'\)/]]
    .forEach(([name, re]) => {
      test('the template includes ' + name, (t) => t.match(sidebar, re));
    });

  const dynamic = new Set(['configJson']);   // created by the code itself
  const ids = new Set([...clientJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
  for (const id of ids) {
    if (dynamic.has(id)) continue;
    test('#' + id + ' exists in the template', (t) => {
      t.match(sidebar, new RegExp('id="' + id + '"'));
    });
  }

  // Panel and tab ids are built by string concatenation at runtime, so the
  // scan above cannot see them. Check the seven names explicitly.
  ['page', 'styles', 'lists', 'tables', 'sections', 'notes', 'presets'].forEach((n) => {
    ['panel-' + n, 'tab-' + n].forEach((id) => {
      test('#' + id + ' exists in the template', (t) => {
        t.match(sidebar, new RegExp('id="' + id + '"'));
      });
    });
  });

  suite('Units');

  // The sidebar's script block is function declarations plus one
  // DOMContentLoaded hook, so it runs in a bare context given a stub document.
  // That gives the real fromPt to test against, rather than a copy of it.
  const client = (() => {
    const code = /<script>([\s\S]*?)<\/script>/.exec(clientJs)[1];
    const ctx = { document: { addEventListener() {} } };
    vm.createContext(ctx);
    new vm.Script(code).runInContext(ctx);
    return ctx;
  })();

  test('points and millimetres round to a tenth', (t) => {
    t.equal(client.fromPt(12.34, 'PT'), 12.3);
    t.equal(client.fromPt(12.36, 'PT'), 12.4);
    t.equal(client.fromPt(28.3465, 'MM'), 10);       // exactly 10mm
    t.equal(client.fromPt(1, 'MM'), 0.4);            // 0.3527mm
  });

  test('inches and centimetres round to three decimals', (t) => {
    t.equal(client.fromPt(100, 'IN'), 1.389);        // 1.38888...
    t.equal(client.fromPt(100, 'CM'), 3.528);        // 3.52777...
  });

  test('a value near a tenth or an eighth snaps to it', (t) => {
    t.equal(client.fromPt(36, 'IN'), 0.5);           // half an inch, not 0.5000001
    t.equal(client.fromPt(72, 'IN'), 1);
    t.equal(client.fromPt(9, 'IN'), 0.125);          // an eighth
    t.equal(client.fromPt(0.125 * 72 + 0.00003, 'IN'), 0.125);
    t.equal(client.fromPt(0.1 * 72 + 0.00003, 'IN'), 0.1);
  });

  test('a value that is near neither grid keeps three decimals', (t) => {
    t.equal(client.fromPt(0.1234 * 72, 'IN'), 0.123);
  });

  test('negative values round the same way', (t) => {
    t.equal(client.fromPt(-36, 'IN'), -0.5);
    t.equal(client.fromPt(-12.34, 'PT'), -12.3);
  });

  suite('Tab scope');

  test('a write covers the tab you are looking at, not every tab', (t) => {
    t.equal(client.S.scope, 'current');
  });

  test('reaching every tab is a choice the top bar offers', (t) => {
    t.match(sidebar, /id="scope"/, 'the selector is in the top bar');
    t.match(sidebar, /value="current">This tab/, 'and names the local choice first');
    t.match(clientJs, /getElementById\('scope'\)\.addEventListener/, 'the client reads it');
  });

  test('a one-tab document is offered no choice of tabs', (t) => {
    // Both rows are revealed by the same >1 branch, so neither shows up alone.
    t.match(clientJs,
      /tabs\.length > 1[^]{0,400}?getElementById\('scopeRow'\)\.style\.display = 'flex'/,
      'the scope row appears only beside the tab picker');
    t.match(sidebar, /id="scopeRow" style="display:none"/, 'and starts hidden');
  });

  test('switching units re-renders, so summary lines convert too', (t) => {
    t.match(clientJs, /if \(S\.data\) renderAll\(\);/);
  });

  suite('Expanders');

  const css = read('Stylesheet.html');

  test('the open and closed states are animated', (t) => {
    t.match(css, /transition:\s*grid-template-rows/);
    t.match(css, /\.item\.open\s*\{[^}]*grid-template-rows:\s*auto 1fr/);
  });

  test('the collapsed row has no leftover padding or divider', (t) => {
    t.match(css, /\.item > \.body \{[^}]*padding: 0 8px/);
    t.match(css, /\.item > \.body \{[^}]*border-top: 0 solid/);
  });

  test('nothing toggles an expander with display, which cannot animate', (t) => {
    t.notOk(/\.item[^{]*>\s*\.body\s*\{[^}]*display:\s*none/.test(css));
    t.notOk(/body\.style\.display = 'block'/.test(clientJs));
  });

  test('reduced motion turns the animation off', (t) => {
    t.match(css, /prefers-reduced-motion: reduce/);
  });

  test('every clickable expander head carries a turnstile arrow', (t) => {
    // Arrows are built in the client for the generated rows and written into
    // the markup for the fixed one, so both files count.
    const twisties = (clientJs.match(/appendChild\(el\('span', 'tw'\)\)/g) || []).length +
                     (sidebar.match(/class="tw"/g) || []).length;
    const togglers = (clientJs.match(/classList\.toggle\('open'\)/g) || []).length;
    t.ok(togglers.length !== 0);
    t.equal(twisties, togglers, 'one arrow per head that actually toggles');
  });

  test('the arrow points right when closed and down when open', (t) => {
    t.match(css, /\.tw \{[^}]*border-left: 6px solid/, 'a right-pointing triangle');
    t.match(css, /\.item\.open > \.head \.tw \{[^}]*transform: rotate\(90deg\)/);
    t.match(css, /\.tw \{[^}]*transition: transform/);
  });

  suite('Inherited and default values');

  test('an empty box says where its value comes from', (t) => {
    // Both dimension builders -- the one with a unit menu and the plain point
    // box -- say "inherit"; the unitless numbers say "default".
    const inherited = clientJs.match(/placeholder = opts\.placeholder \|\| 'inherit'/g) || [];
    t.equal(inherited.length, 2);
    t.match(clientJs, /placeholder = opts\.placeholder \|\| 'default'/);
    // The font picker is a menu, which has no placeholder; its first option
    // is the one that says where the value comes from.
    t.match(clientJs, /var blank = el\('option', null, 'inherit'\)/);
  });

  test('emptying a box that can inherit writes that through to the document', (t) => {
    // Every builder used by the style editor offers the same escape hatch,
    // and the fields that can be inherited ask for it.
    t.match(clientJs, /if \(opts\.clearable\) return \{ value: null \};/,
      'an empty box on a clearable field commits null');
    const routed = clientJs.match(/numeric\(i\.value\.trim\(\), opts/g) || [];
    t.equal(routed.length, 3, 'numUnit, numPt and numPlain all validate through it');
    ['Size', 'Line spacing', 'Space above', 'Space below',
     'Indent left', 'Indent right', 'First line'].forEach((label) => {
      const row = new RegExp("fieldRow\\('" + label + "'[^]*?clearable: true");
      t.match(clientJs, row, label + ' can be cleared');
    });
    t.match(clientJs, /\{ value: i\.value \|\| null \}/, 'and so can the font');
  });

  /* numeric() is the one place a typed value is judged, so it is pulled out
     and run rather than read. */
  const judge = () => evalFromClient(['numeric'], 'return numeric;');

  test('a field with nowhere to inherit from falls back to its default', (t) => {
    const n = judge();
    t.deepEqual(n('', { def: 72 }, 72), { value: 72, show: true },
      'emptying a page margin means one inch, and the box says so');
    t.deepEqual(n('', { clearable: true }, undefined), { value: null },
      'where inheriting is a real answer, empty still means inherit');
    t.deepEqual(n('', {}, undefined), { skip: true },
      'and a field with neither is left alone');
  });

  test('something that is not a number becomes the default, and is marked', (t) => {
    const n = judge();
    const v = n('one inch', { def: 72 }, 72);
    t.equal(v.value, 72, 'the document gets the default rather than nothing');
    t.equal(v.show, true, 'and the box is rewritten to show it');
    t.match(v.bad, /is not a number/, 'with the reason on the field');
    t.ok(!v.error, 'it is not a refusal: the write goes out');
    t.match(n('one inch', {}, undefined).error, /is not a number/,
      'without a default there is nothing to fall back to, so it is refused');
  });

  test('a number that is merely out of range is refused, not replaced', (t) => {
    const n = judge();
    t.match(n('-3', { min: 0, def: 72 }, 72).error, /at least 0/);
    t.match(n('9', { max: 3, def: 1 }, 1).error, /at most 3/);
    t.match(n('1.5', { integer: true, def: 1 }, 1).error, /whole number/);
    t.deepEqual(n('2.5', { min: 0, def: 72 }, 72), { value: 2.5 }, 'a usable number passes through');
  });

  test('the defaults are the ones a new document has', (t) => {
    t.match(clientJs, /pageMarginPt: 72/, 'one inch margins');
    t.match(clientJs, /headerFooterMarginPt: 36/, 'half an inch of header and footer');
    t.match(clientJs, /pageNumberStart: 1/);
    t.match(clientJs, /cellPaddingPt: 5/);
    t.match(clientJs, /def: DEFAULTS\.pageMarginPt/, 'and the page margins ask for theirs');
    t.match(clientJs, /def: DEFAULTS\.cellPaddingPt/);
    t.match(clientJs, /def: textWidthPt\(null, null\) \/ Math\.max\(1, t\.columnWidths\.length\)/,
      'a column width has no fixed default, so it is the even split of the text area');
  });

  test('the box is rewritten and marked by the commit itself', (t) => {
    const fn = /function bindCommit\([^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(v\.show !== undefined\) input\.value = v\.show;/);
    t.match(fn, /if \(v\.bad\) \{[^]*?input\.classList\.add\('invalid'\)/);
    t.match(clientJs, /input\.addEventListener\('input', function \(\) \{[^]*?remove\('invalid'\)/,
      'and typing again clears the mark');
  });

  test('the server turns that null into "put it back to inherited"', (t) => {
    const model = fs.readFileSync(path.join(SRC, 'DocModel.js'), 'utf8');
    // The API is told to reset a property by naming it in the field mask and
    // sending no value for it, which is what pushing without setting does.
    [/if \(ui\.fontSizePt === null\) \{\s*fields\.push\('fontSize'\)/,
     /if \(ui\.fontFamily === null\) \{\s*fields\.push\('weightedFontFamily'\)/,
     /if \(ui\.lineSpacing === null\) \{\s*fields\.push\('lineSpacing'\)/,
     /if \(v === null\) \{ fields\.push\(k\); return; \}/].forEach((re) => {
      t.match(model, re);
    });
  });

  test('the placeholder is grey, not mistakable for a value', (t) => {
    t.match(css, /::placeholder \{[^}]*color:/);
  });

  test('style selects offer Inherit first', (t) => {
    t.match(clientJs, /var INHERIT = \{ id: '', label: 'Inherit' \}/);
    ['ALIGNMENTS', 'SPACING_MODES', 'DIRECTIONS', 'BASELINES'].forEach((e) => {
      t.match(clientJs, new RegExp('\\[INHERIT\\]\\.concat\\(' + e + '\\)'), e);
    });
  });

  test('choosing it clears the value rather than writing one', (t) => {
    const sets = clientJs.match(/set[TP]\('\w+', v \|\| null\)/g) || [];
    t.equal(sets.length, 4, 'alignment, spacing mode, direction, offset');
  });

  test('nothing pretends an unset value is Left, or Normal, any more', (t) => {
    t.notOk(/alignment \|\| 'START'/.test(clientJs));
    t.notOk(/spacingMode \|\| 'COLLAPSE_LISTS'/.test(clientJs));
    t.notOk(/direction \|\| 'LEFT_TO_RIGHT'/.test(clientJs));
    t.notOk(/baselineOffset \|\| 'NONE'/.test(clientJs));
  });

  test('the scrollbar is always there, so the layout never jumps', (t) => {
    t.match(css, /html \{[^}]*overflow-y: scroll/);
  });

  test('the sidebar fills the viewport all the way to the bottom', (t) => {
    t.match(css, /html \{[^}]*height: 100%/, 'the root element is full height');
    t.match(css, /body \{[^}]*min-height: 100%/, 'and the body fills it');
  });

  suite('What you can do here');

  test('no panel opens with a box explaining itself', (t) => {
    t.notOk(/intro\(/.test(clientJs), 'the intro helper and its six call sites are gone');
    t.notOk(/\.intro\b/.test(css), 'and the rule that styled them');
  });

  test('what survives is the hint that tells you where to put the cursor', (t) => {
    const body = /function renderTables\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(body, /Click inside a table in the document to edit it here/);
  });

  test('the footnote wall of API limitations is gone', (t) => {
    t.notOk(/Footnote placement and pagination/.test(clientJs));
    t.notOk(/capabilities/.test(clientJs), 'and the server-supplied caveat list with it');
  });

  suite('Tables');

  test('a panel with nothing to show says where to put the cursor', (t) => {
    // Not "this document has no tables": whether there is one is something
    // the reader can see, and what to do about it is not.
    ['list', 'table', 'section'].forEach((what) => {
      t.match(clientJs,
        new RegExp('Click inside a ' + what + ' in the document to edit it here'),
        what);
    });
    t.notOk(/has no tables/.test(clientJs));
    t.notOk(/has no lists/.test(clientJs));
    t.notOk(/No section breaks/.test(clientJs));
  });

  test('the table under the cursor is the one shown, and it starts open', (t) => {
    const fn = /function renderTables\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /S\.data\.activeTableIndex/);
    t.match(fn, /classList\.contains\('open'\)[^]*?\.head'\)\.click\(\)/);
  });

  test('with no table under the cursor, the panel says to click into one', (t) => {
    const fn = /function renderTables\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /Click inside a table in the document to edit it here/);
  });

  suite('Grouped controls');

  test('a group is a fieldset with its heading in the top edge', (t) => {
    t.match(clientJs, /function group\(title, extra\)[^]*?el\('fieldset', 'group'/);
    t.match(clientJs, /appendChild\(el\('legend', null, title\)\)/);
  });

  test('character and paragraph settings each fold out of their own row', (t) => {
    t.match(clientJs, /var cFold = styleFold\(what, 'character style'/);
    t.match(clientJs, /var pFold = styleFold\(what, 'paragraph style'/);
    t.match(clientJs, /var gChar = cFold\.body/, 'the fields go inside the fold');
    t.match(clientJs, /var gPara = pFold\.body/);
    t.match(clientJs, /gChar\.appendChild\(fieldRow\('Font'/);
    t.match(clientJs, /gPara\.appendChild\(fieldRow\('Alignment'/);
  });

  test('a fold arrives shut, and says what it is a style of', (t) => {
    const fn = /function styleFold\(what, half, key\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /el\('span', 'name', \(what \? what \+ ' ' : ''\) \+ half\)/,
      '"Heading 1 character style", not a bare "Character"');
    t.notOk(/classList\.add\('open'\);\s*$/.test(fn.split('\n')[3] || ''),
      'nothing opens it on the way in');
    t.match(fn, /if \(S\.open\[key\]\) item\.classList\.add\('open'\)/,
      'except a fold you had open before the poll rebuilt the panel');
  });

  test('every editor names what it is styling', (t) => {
    ['what: st.label', 'what: p.name', "what: 'Level ' + (lv.level + 1)",
     'what: seg.role', 'what: label'].forEach((s) => {
      t.ok(clientJs.includes(s), s);
    });
  });

  test('every heading inside a panel is a group heading now', (t) => {
    t.notOk(/el\('h3'/.test(clientJs), 'no bare sub-headings left');
    const groups = clientJs.match(/group\('[^']+'[,)]/g) || [];
    const folds = clientJs.match(/styleFold\(/g) || [];
    t.ok(groups.length + folds.length >= 8,
      'grouped everywhere, not just the style editor: ' +
      groups.length + ' groups, ' + folds.length + ' folds');
  });

  test('the box is rounded and can shrink to the sidebar', (t) => {
    t.match(css, /fieldset\.group \{[^}]*border-radius: 6px/);
    t.match(css, /fieldset\.group \{[^}]*min-width: 0/,
      'a fieldset that cannot shrink gives the sidebar a horizontal scrollbar');
    t.match(css, /fieldset\.group > legend \{/);
  });

  suite('Headers and footers have their own panel');

  const hfEval = (tail) => evalFromClient(
    ['HF_SECTION_SCOPES', 'HF_PAGE_SCOPES', 'hfSegments', 'hfAlsoUsedBy',
     'humanSections', 'hfDescription', 'combineSegmentStyles'], tail);

  /**
   * Three sections. The first two share a header, the third broke away and
   * has its own; all three share the footers. Which is what inheritance
   * produces: an id set on one section runs on until another sets it.
   */
  const threeSections = `[
    { kind: 'header', segmentId: 'h.default', parity: 'right', sections: [0, 1] },
    { kind: 'header', segmentId: 'h.even',    parity: 'left',  sections: [0, 1] },
    { kind: 'header', segmentId: 'h.s2',      parity: 'right', sections: [2] },
    { kind: 'footer', segmentId: 'f.default', parity: 'right', sections: [0, 1, 2] },
    { kind: 'footer', segmentId: 'f.even',    parity: 'left',  sections: [0, 1, 2] }
  ]`;
  const world = (scope, at, count) =>
    `var all = ${threeSections};
     var S = { hfScope: '${scope}', ctx: {},
       data: { activeSectionIndex: ${at || 0}, sectionCount: ${count === undefined ? 3 : count},
         segments: {
           headers: all.filter(function (s) { return s.kind === 'header'; }),
           footers: all.filter(function (s) { return s.kind === 'footer'; }) } } };`;
  const pick = (scope, at, count) => hfEval(
    `${world(scope, at, count)}
     return hfSegments().map(function (s) { return s.segmentId; });`);

  test('the tab is in the strip, and the panel it opens is empty for the client to fill', (t) => {
    t.match(sidebar, /<button id="tab-hf">/);
    t.match(sidebar, /<div id="panel-hf"\s+class="panel"><\/div>/);
    t.match(clientJs, /\['page', 'styles', 'lists', 'tables', 'sections', 'hf', 'notes', 'presets'\]/);
  });

  test('the header and footer settings left the page panel', (t) => {
    const page = /function renderPage\(\)[^]*?\n}/.exec(clientJs)[0];
    ['marginHeaderPt', 'marginFooterPt', 'useFirstPageHeaderFooter',
     'useEvenPageHeaderFooter'].forEach((k) => {
      t.notOk(page.indexOf(k) !== -1, k + ' belongs to the headers panel now');
    });
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    ['marginHeaderPt', 'marginFooterPt', 'useEvenPageHeaderFooter']
      .forEach((k) => t.ok(hf.indexOf(k) !== -1, k + ' arrived'));
  });

  test('"different first page" is set per section, so only the sections panel offers it', (t) => {
    // The Docs API keeps useEvenPageHeaderFooter on the document but
    // useFirstPageHeaderFooter on each section, so one control cannot stand
    // for both and the per-section one belongs where a section is chosen.
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.notOk(hf.indexOf('useFirstPageHeaderFooter') !== -1,
      'the headers panel no longer writes the document-wide one');
    t.match(hf, /set one section at a time, on the Sections tab/,
      'and says where it went');
    const sec = /function sectionBody\([^]*?\n}/.exec(clientJs)[0];
    t.match(sec, /useFirstPageHeaderFooter/, 'the sections panel still has it');
  });

  test('the two axes get a menu each, so a closed menu still reads', (t) => {
    // One menu crossing both axes made every entry a sentence, and the
    // control is half a narrow sidebar wide, so the chosen entry was cut off.
    const labels = (name) =>
      hfEval('return ' + name + '.map(function (s) { return s.label; });');
    t.deepEqual(labels('HF_SECTION_SCOPES'), ['This section', 'All sections']);
    t.deepEqual(labels('HF_PAGE_SCOPES'), ['L pages only', 'R pages only', 'L+R pages']);
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /var scope = fieldRow\('Apply to', menus\);/, 'both sit on one row');
    t.notOk(hf.indexOf('HF_SCOPES') !== -1, 'and the crossed list is gone');
  });

  test('"all sections" covers both kinds, wherever the cursor is', (t) => {
    t.deepEqual(pick('all:both', 2),
      ['h.default', 'h.even', 'h.s2', 'f.default', 'f.even']);
    t.deepEqual(pick('all:left', 0), ['h.even', 'f.even'],
      'left-hand pages are the even-page ones');
    t.deepEqual(pick('all:right', 0), ['h.default', 'h.s2', 'f.default']);
  });

  test('"this section" narrows to the ones that section actually uses', (t) => {
    t.deepEqual(pick('sec:both', 2), ['h.s2', 'f.default', 'f.even'],
      'the third section has its own header but shares the footers');
    t.deepEqual(pick('sec:both', 0), ['h.default', 'h.even', 'f.default', 'f.even']);
    t.deepEqual(pick('sec:right', 2), ['h.s2', 'f.default'],
      'and the side narrows it further');
  });

  test('one section means nothing to narrow, so the cursor does not come into it', (t) => {
    // Which is most documents: "this section" and "all sections" name the
    // same set, and neither waits for the cursor to be anywhere.
    t.deepEqual(pick('sec:both', 0, 1), pick('all:both', 0, 1));
    t.deepEqual(pick('sec:both', 0, 0), pick('all:both', 0, 0),
      'and a tab with no section break at all is the same case');
  });

  test('a shared header is named as shared before it is written to', (t) => {
    const shared = hfEval(
      `${world('sec:both', 0)}
       return hfAlsoUsedBy(hfSegments());`);
    t.deepEqual(shared, [1, 2], 'the footers of section 1 run on into 2 and 3');
    t.deepEqual(hfEval(`${world('sec:both', 2)}
       return hfAlsoUsedBy(hfSegments());`), [0, 1]);
    const say = hfEval('return humanSections;');
    t.equal(say([1]), '2', 'counted the way the document numbers them');
    t.equal(say([1, 2]), '2 and 3');
    t.equal(say([0, 2, 3]), '1, 3 and 4');
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /hfAlsoUsedBy\(segs\)/);
    t.match(hf, /Shared with[^]*?which this will change too/,
      'named, and no lecture about how inheritance works');
  });

  test('a section can take its own header, or hand it back', (t) => {
    const fn = /function hfLinkBox\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /\['header', 'footer'\]\.forEach/,
      'the two link independently, so they get a row each');
    t.match(fn, /Give it its own ' \+ kind/);
    t.match(fn, /Continue from section ' \+ \(here - 1\) \+ ' \(deletes this one\)/,
      'the button says what it destroys');
    t.match(fn, /Add a ' \+ kind/, 'and a document with none can get one');
    const set = /function setLink\([^]*?\n}/.exec(clientJs)[0];
    t.match(set, /'setSegmentLink'/);
    t.match(set, /sectionIndex: \(S\.data\.hfLink \|\| \{\}\)\.sectionIndex/);
  });

  test('the first section is offered nothing, rather than an explanation', (t) => {
    // Its header is the document's and there is no section before it to hand
    // one back to, so the row would be a sentence with no button on it.
    const fn = /function hfLinkBox\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /} else if \(L\.isFirst\) \{[^]*?return;/,
      'that row is skipped');
    t.notOk(/Later sections\s*\n?\s*'?\s*continue it/.test(clientJs),
      'and the explanation it used to carry is gone');
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /if \(link && link\.childNodes\.length\)/,
      'so an empty box takes no heading with it');
  });

  test('"all sections" is a state to put the whole tab into', (t) => {
    const fn = /function hfLinkBox\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var all = hfScopePart\(0\) === 'all' && links\.length > 1;/);
    t.match(fn, /Give each its own ' \+ kind/);
    t.match(fn, /Share one ' \+ kind \+ ' \(deletes the rest\)/);
    t.match(fn, /setLink\(kind, 'own', true\)/, 'and both go out as one request');
    t.match(fn, /setLink\(kind, 'previous', true\)/);
    const set = /function setLink\([^]*?\n}/.exec(clientJs)[0];
    t.match(set, /applyAll: !!applyAll/);
  });

  test('the margins and the per-segment list obey the same choice', (t) => {
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.notOk(hf.indexOf('applyPage({ marginHeaderPt') !== -1,
      'the margins are no longer written document-wide behind the choice');
    t.match(hf, /applyHfMargin\(\{ marginHeaderPt: v \}\)/);
    t.match(hf, /applyHfMargin\(\{ marginFooterPt: v \}\)/);
    const apply = /function applyHfMargin\([^]*?\n}/.exec(clientJs)[0];
    t.match(apply, /patch\.applyAll = hfScopePart\(0\) === 'all';/,
      'this section or all of them, the same as the styling');
    t.match(apply, /'writeSection'/, 'which means a section write, not a document one');
    t.match(hf, /'One at a time'\)\);\s*\n\s*segs\.forEach/,
      'and the list below names the same segments the editor above writes to');
  });

  test('a lone section is offered no choice of sections', (t) => {
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /if \(manySections\) \{\s*\n\s*menus\.push\(selectField\(HF_SECTION_SCOPES/,
      'the headers panel leaves the menu out');
    t.match(hf, /if \(menus\.length > 1\) scope\.className = 'field tightlabel';/,
      'and the one menu left gets the whole row');
    const sec = /function renderSections\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(sec, /if \(total > 1\) \{\s*\n\s*host\.appendChild\(applyAllSwitch\('sections'/,
      'and the sections panel drops "apply to all" with nothing to apply to');
    const suffix = /function hfSectionSuffix\([^]*?\n}/.exec(clientJs)[0];
    t.match(suffix, /if \(!manySections\) return heading;/,
      'headings stop naming sections too');
  });

  test('the editor says how many things it is about to write to', (t) => {
    const say = hfEval('return hfDescription;');
    t.equal(say([{ kind: 'header' }]), '1 header');
    t.equal(say([{ kind: 'header' }, { kind: 'header' }, { kind: 'footer' }]),
      '2 headers and 1 footer');
  });

  test('values seeded from a set are the ones the whole set agrees on', (t) => {
    const combine = hfEval('return combineSegmentStyles;');
    const seg = (fontSize, mixed) => ({
      empty: false,
      style: { textStyle: { fontSize: fontSize, bold: true }, paragraphStyle: {},
               mixed: mixed || [] }
    });
    t.deepEqual(combine([seg(9), seg(9)]).textStyle, { fontSize: 9, bold: true });
    const differ = combine([seg(9), seg(10)]);
    t.deepEqual(differ.textStyle, { bold: true }, 'the field they disagree on drops out');
    t.deepEqual(differ.mixed, ['fontSize'], 'and is named as disagreed');
    t.deepEqual(combine([seg(9), seg(9, ['bold'])]).mixed, ['bold'],
      "one segment's own disagreement is the whole set's");
    t.deepEqual(combine([{ empty: true, style: { textStyle: { fontSize: 30 } } }, seg(9)]).textStyle,
      { fontSize: 9, bold: true }, 'an empty segment has no text, so no style to count');
  });

  test('the panel writes to exactly the segments it named', (t) => {
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /target: 'segments', segmentIds: ids/);
    t.match(hf, /var ids = segs\.map\(function \(s\) \{ return s\.segmentId; \}\);/);
  });

  test('the panel follows the cursor, and re-draws when it crosses into a header', (t) => {
    t.match(clientJs, /sections: 'context', hf: 'context'/);
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(activePanel === 'hf' && S\.ctx\.segmentKind !== kindBefore\) ctxRedraw = true;/,
      'a read would come back identical, so the probe alone has to trigger the re-draw');
    t.match(fn, /if \(changed \|\| ctxRedraw\) renderKeepingEdits\(\);/);
  });

  suite('Footnotes');

  test('footnotes are styled as one set, with no row per footnote', (t) => {
    const notes = /function renderNotes\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(notes, /segmentEditor\('footnotes'/, 'the style-them-all editor stays');
    t.notOk(/segments\.footnotes/.test(notes),
      'no per-footnote row: footnotes are one set, not a list');
    t.notOk(/segments\.headers/.test(notes),
      'headers and footers moved out to their own panel');
  });

  test('the panel no longer lectures about what a change touches', (t) => {
    t.notOk(/Only the settings you actually change are/.test(clientJs));
    t.notOk(/No style governs callouts/.test(clientJs));
    t.notOk(/Emulated, because neither Docs/.test(clientJs));
  });

  test('converting to endnotes is still offered', (t) => {
    t.match(clientJs, /convertFootnotesToEndnotes/);
    t.match(clientJs, /Append copy \(keep footnotes\)/);
    t.match(clientJs, /Convert \(delete footnotes\)/);
  });

  suite('Tipping the author');

  test('the tip section sits below the panels, not inside one', (t) => {
    t.match(sidebar, /id="tipItem"/);
    const tipAt = sidebar.indexOf('id="tipItem"');
    const lastPanel = sidebar.lastIndexOf('class="panel"');
    t.ok(tipAt > lastPanel, 'it comes after every panel');
    // Every panel is an empty div the client fills in, so being after the
    // last of them is enough to be outside all of them.
    const panels = sidebar.match(/<div id="panel-[^"]*"[^>]*>[^]*?<\/div>/g) || [];
    t.equal(panels.length, 8);
    panels.forEach(p => t.notOk(/id="tipItem"/.test(p), 'not nested in ' + p.slice(0, 24)));
  });

  test('it opens and closes like the other expanders', (t) => {
    t.match(clientJs, /getElementById\('tipHead'\)/);
    t.match(clientJs, /tipItem\.classList\.toggle\('open'\)/);
  });

  test('the closed row offers the heart and the invitation', (t) => {
    t.match(sidebar, /&#10084;&#65039; Love Stylist\? Tip the author!/);
  });

  test('the open row credits the author and links the licence', (t) => {
    t.match(sidebar, /Stylist was written by Luke Hutchison and is available as/);
    t.match(sidebar, /under the MIT license/);
    t.match(sidebar, /<a href="https:\/\/github\.com\/lukehutch\/stylist"[^>]*>\s*open source\s*<\/a>/);
  });

  test('both the heading and the QR code lead to Venmo', (t) => {
    const links = sidebar.match(/https:\/\/venmo\.com\/code\?user_id=1472553554018304287/g) || [];
    t.equal(links.length, 2, 'the "Tip the author" heading and the image');
    t.match(sidebar, /class="tiplink"[^>]*>Tip the author</);
  });

  test('links leave the sidebar rather than replacing the document', (t) => {
    const venmoTags = sidebar.match(/<a[^>]*venmo\.com[^>]*>/g) || [];
    venmoTags.forEach(tag => t.match(tag, /target="_blank"/));
    venmoTags.forEach(tag => t.match(tag, /rel="noopener"/));
  });

  test('the QR image is carried in the page, since Apps Script serves no files', (t) => {
    t.match(sidebar, /include\('TipImage'\)/);
    const img = read('TipImage.html');
    t.match(img, /^<!--[^]*assets\/venmo\.png/, 'it says where it came from');
    t.match(img, /src="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}"/);
  });

  test('the QR code is 80% of the sidebar width', (t) => {
    t.match(css, /\.tipqr \{[^}]*width: 80vw/);
  });

  test('the tip heading is centred and bold', (t) => {
    t.match(css, /\.tiplink \{[^}]*text-align: center/);
    t.match(css, /\.tiplink \{[^}]*font-weight: 700/);
  });

  suite('Staying in step with the document');

  test('the sidebar polls the document instead of waiting to be asked', (t) => {
    t.match(clientJs, /startPolling\(\);/);
    t.notOk(/setInterval/.test(clientJs), 'a fixed interval cannot adapt to the read cost');
  });

  test('returning to the sidebar re-reads the document at once', (t) => {
    const fn = /window\.addEventListener\('focus', function \(\) \{[^]*?\n  \}\);/.exec(clientJs)[0];
    t.match(fn, /lastCtx = null;/,
      'one read is spent even with the cursor unmoved: text edited elsewhere in ' +
      'the same list or table would not show otherwise');
    t.match(fn, /setTimeout\(poll, 0\)/);
  });

  test('the poll stands aside while a write is in flight', (t) => {
    t.match(clientJs, /if \(!S\.data \|\| S\.busy \|\| document\.hidden\) return Promise\.resolve\(\);/);
  });

  test('the wait between reads is twenty times the last read, within bounds', (t) => {
    t.match(clientJs, /var POLL_MIN_MS = 1000;/);
    t.match(clientJs, /var POLL_MAX_MS = 5000;/);
    t.match(clientJs, /var POLL_DUTY = 20;/);
    t.match(clientJs,
      /Math\.max\(POLL_MIN_MS, Math\.min\(POLL_MAX_MS, lastFetchMs \* POLL_DUTY\)\)/);
  });

  test('the read is timed, so the next wait can follow it', (t) => {
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var t0 = Date\.now\(\)/);
    t.match(fn, /lastFetchMs = Date\.now\(\) - t0/);
  });

  test('the next read is scheduled only once the last one has finished', (t) => {
    t.match(clientJs, /function tick\(\) \{ poll\(\)\.then\(schedule\); \}/);
  });

  /* The two pieces above that are plain functions are pulled out and run, so
     these are the real arithmetic rather than another look at the source. */
  const evalFromClient = (names, tail) => {
    const src = names.map((n) => {
      const m = new RegExp('(?:function ' + n + '\\([^]*?\\n\\}|var ' + n + ' = [^;]*;)')
        .exec(clientJs);
      if (!m) throw new Error('could not find ' + n + ' in the client');
      return m[0];
    }).join('\n');
    return eval('(function () {\n' + src + '\n' + tail + '\n})()');   // eslint-disable-line no-eval
  };

  test('the wait is the read cost times twenty, clamped to one and five seconds', (t) => {
    const delay = evalFromClient(
      ['POLL_MIN_MS', 'POLL_MAX_MS', 'POLL_DUTY', 'lastFetchMs', 'nextPollDelay'],
      'return function (ms) { lastFetchMs = ms; return nextPollDelay(); };');

    t.equal(delay(0), 1000, 'an instant read still waits a second');
    t.equal(delay(20), 1000, '400ms of duty is below the floor');
    t.equal(delay(50), 1000, 'exactly at the floor');
    t.equal(delay(100), 2000, 'a tenth of a second read waits two');
    t.equal(delay(200), 4000);
    t.equal(delay(250), 5000, 'exactly at the ceiling');
    t.equal(delay(4000), 5000, 'a read that takes four seconds still waits only five');
  });

  test('the context panels run on their own fast clock', (t) => {
    const delay = evalFromClient(
      ['POLL_MIN_MS', 'POLL_MAX_MS', 'POLL_DUTY', 'CONTEXT_TICK_MS',
       'lastFetchMs', 'probeWaitUntil', 'activePanel', 'PANEL_SYNC',
       'nextPollDelay', 'tickDelay'],
      'return function (panel, backedOff) { activePanel = panel;' +
      ' probeWaitUntil = backedOff ? Date.now() + 60000 : 0;' +
      ' lastFetchMs = 4000; return tickDelay(); };');

    t.ok(delay('lists', false) <= 150,
      'clicking into a list is noticed in about a tenth of a second, got ' +
      delay('lists', false) + 'ms');
    t.equal(delay('sections', false), delay('lists', false),
      'every cursor-scoped panel ticks at the same rate');
    t.equal(delay('lists', true), 1000,
      'a failed probe backs off to the slow floor rather than hammering at the fast tick');
    t.equal(delay('page', false), 5000, 'a meta panel still waits out its read cost');
    t.equal(delay('presets', false), 5000, 'and a static panel inherits that too');
  });

  test('the probe reads no content until its answer changes', (t) => {
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(probing\) return Promise\.resolve\(\);/,
      'one probe in flight at a time: two answers could land out of order');
    t.match(fn, /callRead\('cursorContext'\)/);
    t.match(fn, /if \(now === lastCtx\) return null;/);
    t.ok(fn.indexOf("JSON.stringify(ctx || {})") < fn.indexOf("callRead('refresh'"),
      'the content read only follows a changed answer');
  });

  test('a checkbox is dirty on its checked state, a text box on its text', (t) => {
    const shown = evalFromClient(['shownValue'], 'return shownValue;');
    t.equal(shown({ type: 'checkbox', checked: true, value: 'on' }), true);
    t.equal(shown({ type: 'checkbox', checked: false, value: 'on' }), false);
    t.equal(shown({ type: 'text', checked: false, value: '12' }), '12');
    t.equal(shown({ type: 'text', checked: false, value: '' }), '',
      'an emptied box is a value, not an absence');
  });

  suite('Polling off the main thread');

  test('the schedule runs in a worker, built from a blob for want of a file', (t) => {
    t.match(clientJs, /new Worker\(URL\.createObjectURL\(new Blob\(/);
  });

  test('a content security policy that refuses the worker is not fatal', (t) => {
    const fn = /function startPolling\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /catch \(e\) \{\s*pollWorker = null;/, 'construction is guarded');
    t.match(fn, /pollWorker\.onerror = function \(\) \{ pollWorker = null; setTimeout\(tick, POLL_MIN_MS\); \}/,
      'a worker that dies later restarts the chain rather than freezing it');
    t.match(fn, /else setTimeout\(tick, ms\)/, 'setTimeout takes over');
  });

  test('the first read is timed and logged to the browser console', (t) => {
    t.match(clientJs, /var firstReadT0 = Date\.now\(\);/);
    t.match(clientJs, /console\.log\('Stylist: first load took ' \+ firstReadMs/);
    t.match(clientJs, /JSON\.stringify\(data\.timings\)/,
      'the server breakdown comes back with it, so the total can be split up');
  });

  test('that measurement paces the first wait too', (t) => {
    t.match(clientJs, /lastFetchMs = firstReadMs;/);
  });

  suite('Stopping when the sidebar is not there');

  test('every way back into the loop goes through one flag', (t) => {
    t.match(clientJs, /function schedule\(\) \{ if \(polling\) scheduleNext\(tickDelay\(\)\); \}/);
    t.match(clientJs, /function tick\(\) \{ poll\(\)\.then\(schedule\); \}/,
      'a fired timer still lands on schedule, which then does nothing');
  });

  test('hiding the sidebar pauses it, showing it again resumes', (t) => {
    t.match(clientJs,
      /visibilitychange[^]*?if \(document\.hidden\) pausePolling\(\); else resumePolling\(\);/);
    t.match(clientJs, /function pausePolling\(\) \{ polling = false; \}/);
  });

  test('resuming twice does not start two loops', (t) => {
    const fn = /function resumePolling\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(polling \|\| !scheduleNext\) return;/);
  });

  test('the frame going away terminates the worker', (t) => {
    const fn = /function stopPolling\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /polling = false;/);
    t.match(fn, /pollWorker\.terminate\(\)/);
    t.match(clientJs, /window\.addEventListener\('pagehide', stopPolling\)/);
    t.match(clientJs, /window\.addEventListener\('unload', stopPolling\)/);
  });

  suite('Editing while the poll runs');

  test('dirty is a comparison, not a flag raised by the first keystroke', (t) => {
    t.match(clientJs, /input\.isDirty = function \(\) \{ return shownValue\(input\) !== input\.__live; \}/);
    t.notOk(/__dirty/.test(clientJs), 'the sticky flag is gone');
  });

  test('a checkbox reports its checked state, not its value', (t) => {
    t.match(clientJs, /function shownValue\(input\) \{\s*return input\.type === 'checkbox' \? input\.checked : input\.value;/);
  });

  test('only a field that is focused and dirty keeps its contents', (t) => {
    const fn = /function renderKeepingEdits\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /dirty: a\.isDirty\(\)/, 'dirtiness is read before the rebuild');
    t.match(fn, /if \(keep\.dirty\) \{\s*node\.value = keep\.value;/,
      'and the contents go back only if it was');
    t.match(fn, /renderAll\(\)/, 'everything else is rebuilt from the document');
  });

  test('the focused field keeps the focus even when it is clean', (t) => {
    // Otherwise the caret jumps out of the box every time the document changes.
    const fn = /function renderKeepingEdits\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /document\.hasFocus\(\) && a && a\.isDirty\b(?! &&)/);
    t.match(fn, /\}\s*\n\s*\/\/ Losing the focus[^]*?node\.focus\(\);/);
  });

  test('a write that lands after more typing does not call the field clean', (t) => {
    const fn = /function bindCommit\([^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var sent = shownValue\(input\);/);
    t.match(fn, /input\.__live = sent;/);
    t.notOk(/__live = shownValue\(input\);\s*\/\/ the document/.test(fn));
  });

  test('the caret goes back where it was', (t) => {
    const fn = /function renderKeepingEdits\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /node\.focus\(\)/);
    t.match(fn, /setSelectionRange\(keep\.start, keep\.end\)/);
  });

  test('an edit whose field moved is dropped, not pasted somewhere else', (t) => {
    const fn = /function renderKeepingEdits\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(!node \|\| node\.tagName !== keep\.tag \|\| !node\.isDirty\) return;/);
  });

  test('the re-render cannot itself commit a half-typed value', (t) => {
    // Removing a focused input can fire change on the way out.
    t.match(clientJs, /function attempt\(\) \{[^]*?if \(rerendering\) return;/);
    t.match(clientJs, /rerendering = true;\s*try \{ renderAll\(\); \} finally \{ rerendering = false; \}/);
  });

  test('nothing is left of the button the poll replaced', (t) => {
    t.notOk(/resync/i.test(sidebar + clientJs), 'the Re-sync control should be gone');
  });

  suite('Bullet levels');

  const glyph = (lv) => evalFromClient(['GLYPH_SAMPLES', 'glyphExample'],
    'return glyphExample(' + JSON.stringify(lv) + ');');

  test('a level is described by the marker itself, not by the API enum', (t) => {
    t.equal(glyph({ glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '●', glyphFormat: '%0' }), '●');
    t.equal(glyph({ glyphType: 'DECIMAL', glyphSymbol: '', glyphFormat: '%0.' }), '1.');
    t.equal(glyph({ glyphType: 'ALPHA', glyphSymbol: '', glyphFormat: '%0)' }), 'a)');
    t.equal(glyph({ glyphType: 'UPPER_ROMAN', glyphSymbol: '', glyphFormat: '%0.' }), 'I.');
    t.equal(glyph({ glyphType: 'DECIMAL', glyphSymbol: '', glyphFormat: '%0.%1.' }), '1.1.',
      'a nested format keeps its shape');
  });

  test('a level with no marker yields nothing, not a stray character', (t) => {
    t.equal(glyph({ glyphType: 'NONE', glyphSymbol: '', glyphFormat: '' }), '');
  });

  test('no API enum reaches the panel', (t) => {
    t.notOk(/Read-only from the API/.test(clientJs), 'the old line is gone');
    t.notOk(/levelMarkerNote/.test(clientJs), 'and the paragraph that replaced it');
    t.equal(glyph({ glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '●', glyphFormat: '%0' }),
      '●', 'an unspecified type falls back to the symbol, never to its own name');
  });

  suite('Custom styles');

  test('the built-in list gets a heading matching the custom one', (t) => {
    const fn = /function renderStyles\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /el\('h2', null, 'Built-in styles'\)/);
    t.ok(fn.indexOf("'Built-in styles'") < fn.indexOf('S.data.namedStyles.forEach'),
      'it comes above the styles it heads');
    t.match(clientJs, /el\('h2', null, 'Custom styles'\)/, 'the two headings still match');
  });

  test('a new custom style can be started from scratch', (t) => {
    const fn = /function renderCustomStyles\(host\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /el\('button', 'act', 'New custom style…'\)/);
    t.ok(fn.indexOf('New custom style…') > fn.indexOf('presets.forEach'),
      'the button sits below the list');
    t.match(fn, /call\('saveStylePreset'/);
  });

  test('the button is there even when there are no custom styles yet', (t) => {
    const fn = /function renderCustomStyles\(host\)[^]*?\n}/.exec(clientJs)[0];
    // An early return in the empty branch would take the button with it, which
    // is exactly the case where it is most needed.
    t.notOk(/No custom styles yet[^]*?\n    return;/.test(fn),
      'the empty case must fall through to the button');
  });

  test('a new custom style names itself, and the name is edited in place', (t) => {
    const fn = /function renderCustomStyles\(host\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /uniqueName\('Custom style'/,
      'the count increments until the name is free, so nothing asks');
    t.match(fn, /S\.open\['cstyle:' \+ name\] = true/,
      'and the new row starts open, ready to be edited');
  });

  test('each custom style folds out from a head that carries its controls', (t) => {
    const fn = /function customStyleRow\(p\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /el\('input', 'name'\)/,
      'the name is an input on the row itself, not something to prompt for');
    t.match(fn, /el\('button', 'act iconbtn', '✓'\)/);
    t.ok(fn.includes("el('button', 'act danger iconbtn trash', '\\uD83D\\uDDD1\\uFE0E')"),
      'a trash can, in its text form rather than as a colour emoji');
    t.match(fn, /apply\.title = 'Apply "/, 'the unlabelled buttons carry tooltips');
    t.match(fn, /del\.title = 'Delete this custom style'/);
    t.match(fn, /nameIn\.title = 'Rename this custom style'/);
    t.match(fn, /buildStyleEditor/, 'the folded body holds the editable values');
    t.match(fn, /applyStylePresetToSelection/, 'apply acts on the selection');
  });

  test('no dialog ever interrupts -- naming and confirming happen inline', (t) => {
    t.notOk(/prompt\(/.test(clientJs), 'window.prompt is gone from the client');
    t.notOk(/confirm\(/.test(clientJs), 'window.confirm is gone too');
    t.notOk(/\balert\(/.test(clientJs), 'and window.alert with it');
    const rename = evalFromClient(['uniqueName'],
      'return uniqueName;');
    t.equal(rename('Preset', []), 'Preset 1', 'the first taken slot appends a number');
    t.equal(rename('Preset', ['Preset 1', 'Preset 2']), 'Preset 3',
      'the count walks past every name already in use');
    t.equal(rename('Source code copy', ['Source code copy']), 'Source code copy 1',
      'a base that is itself taken gets the suffix, never silently reused');
  });

  test('a new custom style starts as a copy of Normal text', (t) => {
    const picked = evalFromClient(['normalTextStyle'],
      'var S = { data: { namedStyles: [' +
      "{ namedStyleType: 'HEADING_1', textStyle: { fontSizePt: 20 } }," +
      "{ namedStyleType: 'NORMAL_TEXT', textStyle: { fontFamily: 'Georgia' }," +
      '  paragraphStyle: { lineSpacing: 1.5 } }] } };' +
      'return normalTextStyle();');
    t.deepEqual(picked.textStyle, { fontFamily: 'Georgia' });
    t.deepEqual(picked.paragraphStyle, { lineSpacing: 1.5 });
  });

  test('an empty style would apply nothing, so it is not the starting point', (t) => {
    const picked = evalFromClient(['normalTextStyle'],
      "var S = { data: { namedStyles: [{ namedStyleType: 'HEADING_1', textStyle: { bold: true } }] } };" +
      'return normalTextStyle();');
    t.deepEqual(picked.textStyle, { bold: true }, 'it falls back to the first style listed');
  });

  suite('The list marker picker');

  /* markerPicker built for real against a stand-in DOM, so what is asserted
     here is what the panel would draw. */
  const buildPicker = (list, presets) => evalFromClient(
    ['markerPicker', 'glyphExample', 'GLYPH_SAMPLES', 'listTarget'],
    'var made = [];\n' +
    'var el = function (tag, cls, text) {\n' +
    '  var n = { tag: tag, cls: cls || "", text: text || "", kids: [], title: "",\n' +
    '            classList: { add: function (c) { n.cls += " " + c; },\n' +
    '                         contains: function (c) { return n.cls.split(" ").indexOf(c) >= 0; } },\n' +
    '            appendChild: function (k) { n.kids.push(k); return k; },\n' +
    '            addEventListener: function (_, f) { n.click = f; } };\n' +
    '  made.push(n); return n;\n' +
    '};\n' +
    'var calls = [];\n' +
    'var call = function (fn, args) { calls.push([fn, args[0]]); return { then: function () {} }; };\n' +
    'var reload = function () {};\n' +
    'var S = { tabId: "t.0", data: { constants: { bulletPresets: ' + JSON.stringify(presets) + ' } } };\n' +
    'var root = markerPicker(' + JSON.stringify(list) + ');\n' +
    'return { made: made, calls: calls, root: root };');

  const PRESETS = [
    { id: 'BULLET_DISC_CIRCLE_SQUARE', numbered: false, glyphs: ['\u25cf', '\u25cb', '\u25a0'] },
    { id: 'BULLET_CHECKBOX', numbered: false, glyphs: ['\u2751', '\u2751', '\u2751'] },
    { id: 'NUMBERED_DECIMAL_ALPHA_ROMAN', numbered: true, glyphs: ['1.', 'a.', 'i.'] }
  ];
  const glyphButtons = (r) => r.made.filter((n) => /\bglyph\b/.test(n.cls));

  test('a marker is offered as the character it is, not as the name of an enum', (t) => {
    const r = buildPicker({ listId: 'list.1', levels: [{}] }, PRESETS);
    t.deepEqual(glyphButtons(r).map((n) => n.text), ['\u25cf', '\u2751', '1.']);
    t.notOk(/BULLET_|NUMBERED_/.test(r.made.map((n) => n.text).join(' ')),
      'no API enum reaches the button faces');
  });

  test('bullets and numbering are separated, each under its own heading', (t) => {
    const r = buildPicker({ listId: 'list.1', levels: [{}] }, PRESETS);
    t.deepEqual(r.made.filter((n) => n.tag === 'h2').map((n) => n.text), ['Bullets', 'Numbering']);
  });

  test("the list's current marker is the one marked", (t) => {
    const r = buildPicker(
      { listId: 'list.1', levels: [{ glyphSymbol: '\u2751', glyphFormat: '%0' }] }, PRESETS);
    const on = glyphButtons(r).filter((n) => n.classList.contains('on'));
    t.equal(on.length, 1);
    t.equal(on[0].text, '\u2751');
  });

  test('nothing is marked when the marker is one Docs itself set', (t) => {
    // Format > Bullets & numbering > More bullets can put any character
    // there, and no preset produces it.
    const r = buildPicker(
      { listId: 'list.1', levels: [{ glyphSymbol: '\u2600', glyphFormat: '%0' }] }, PRESETS);
    t.equal(glyphButtons(r).filter((n) => n.classList.contains('on')).length, 0);
  });

  test('the deeper levels of a preset are shown on hover, not lost', (t) => {
    const r = buildPicker({ listId: 'list.1', levels: [{}] }, PRESETS);
    t.match(glyphButtons(r)[0].title, /\u25cf.*\u25cb.*\u25a0/);
  });

  test('clicking a marker applies that preset to that one list', (t) => {
    const r = buildPicker({ listId: 'list.7', levels: [{}] }, PRESETS);
    glyphButtons(r)[1].click();
    t.deepEqual(r.calls, [['applyBulletPreset',
      { tabId: 't.0', listId: 'list.7', bulletPreset: 'BULLET_CHECKBOX' }]]);
  });

  test('with no list in hand the same click goes to every list', (t) => {
    const r = buildPicker(null, PRESETS);
    glyphButtons(r)[2].click();
    t.deepEqual(r.calls, [['applyBulletPreset',
      { tabId: 't.0', allLists: true, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' }]]);
  });

  suite('Apply to all');

  test('ticking it settles the document first, then keeps writing to everything', (t) => {
    t.match(clientJs, /var args = copy\(unifyArgs \|\| \{\}\);\s*\n\s*args\.tabId = S\.tabId;\s*\n\s*return call\(unifyFn, \[args\]\)/,
      'the tick brings them into line, carrying whatever identifies the source');
    t.match(clientJs, /S\.all\[kind\] = on;/);
    t.match(clientJs, /patch\.allTables = true;/, 'a table write then covers all of them');
    t.match(clientJs, /allLists: true/, 'and a list write likewise');
    t.match(clientJs, /patch\.applyAll = !!S\.all\.sections;/,
      'and a section write covers every section');
  });

  test('every panel that has one offers it, however few things there are', (t) => {
    // With one table in the document the tick is not about unifying anything:
    // it is what lets the panel edit that table without the cursor being in it.
    // Sections are the exception: there the tick only means "and the others",
    // so a lone section gets no tick. A lone list or table still does, because
    // the tick is also what lets the panel edit one the cursor is not in.
    ['lists', 'tables'].forEach((kind) => {
      t.match(clientJs, new RegExp(`host\\.appendChild\\(applyAllSwitch\\('${kind}'`),
        `the ${kind} panel appends it unconditionally`);
    });
    t.notOk(/length > 1[^]{0,80}?applyAllSwitch/.test(clientJs),
      'no count of the things themselves gates it');
  });

  test('unticking changes nothing in the document', (t) => {
    t.match(clientJs, /if \(!on\) \{ renderAll\(\); return; \}/);
  });

  suite('Writing only what changed');

  test('a menu entry that is not a choice leaves no trace', (t) => {
    // "Custom..." on the page size names what the dimensions already are.
    // Committing it would make the menu forget what the document last got,
    // and picking the original entry back would then write it out again.
    t.match(clientJs, /if \(opts\.skipBlank && !i\.value\) return \{ skip: true \};/);
    t.match(clientJs, /selectField\(presets, match,[^]*?\{ skipBlank: true \}/,
      'the page size menu asks for it');
    t.notOk(/if \(!v\) return;\s*\n\s*var p = S\.data\.constants\.pageSizePresets/.test(clientJs),
      'so the commit no longer has to guard against the blank itself');
  });

  test('one veil covers a write and the read that follows it', (t) => {
    const fn = /function call\(fn, args\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(S\.busy <= 0\) setTimeout\(function \(\) \{ if \(S\.busy <= 0\) disarmBusy\(\); \}, 0\);/,
      'the veil is dropped a tick later, by which time a chained call has claimed it');
    t.notOk(/if \(S\.busy <= 0\) disarmBusy\(\);   \/\//.test(fn),
      'and never straight away, which is what made one change look like two');
  });

  suite('The status line');

  /* status() is run for real against a stand-in element, so these are its
     actual behaviour rather than another look at the source. */
  const runStatus = (tail) => evalFromClient(
    ['status'],
    'var el = { style: {} };\n' +
    'var document = { getElementById: function () { return el; } };\n' + tail);

  test('the bar is absent until something needs saying', (t) => {
    t.match(sidebar, /<div id="status" style="display:none"><\/div>/,
      'it starts hidden and empty');
    t.notOk(/status\('Ready'/.test(clientJs), 'nothing reports a permanent Ready');
  });

  test('nothing that worked is announced', (t) => {
    // Every remaining call is an error, a "working on it", or the clear that
    // takes one of those away again.
    const calls = clientJs.match(/status\((?!msg)[^;]*\);/g) || [];
    const allowed = /'err'\)|status\('', ''\)|Loading|Converting|Bringing|Adding|Removing/;
    calls.forEach((c) => t.match(c, allowed, c.trim()));
    t.ok(calls.length > 4, 'the errors are still reported');
    t.notOk(/status\([^;]*✓/.test(clientJs), 'no tick-mark confirmations survive');
  });

  test('a write reports nothing anywhere -- the document is the report', (t) => {
    t.notOk(/reportResult|showNotes|globalNotes/.test(clientJs + sidebar + css),
      'the notes box, its writer and its styling are all gone');
  });

  test('an error is shown and stays', (t) => {
    const r = runStatus(
      "status('boom', 'err');\n" +
      'return { text: el.textContent, display: el.style.display, kind: el.className };');
    t.equal(r.text, 'boom');
    t.equal(r.display, 'block');
    t.equal(r.kind, 'err');
  });

  test('an empty message hides the bar', (t) => {
    const r = runStatus("status('working…', '');\nvar was = el.style.display;\n" +
      "status('', '');\nreturn { was: was, now: el.style.display, text: el.textContent };");
    t.equal(r.was, 'block', 'progress is shown while it runs');
    t.equal(r.now, 'none');
    t.equal(r.text, '');
  });

  test('every slow operation clears its own message when it finishes', (t) => {
    ['runConvert', 'boot'].forEach((n) => {
      const fn = new RegExp('function ' + n + '\\([^]*?\\n}').exec(clientJs)[0];
      t.match(fn, /status\('', ''\)/, n + ' must take its message away again');
    });
  });

  suite('The footer');

  test('the status line and the tip row are outside the scrolling area', (t) => {
    const wrap = /<div class="wrap">[^]*?\n    <\/div>/.exec(sidebar);
    t.ok(wrap, 'the scrolling area is still .wrap');
    t.notOk(/id="tipItem"/.test(wrap[0]), 'the tip row is not inside it');
    t.notOk(/id="status"/.test(wrap[0]), 'the status line is not inside it');
    const footer = /<div class="footer">[^]*?\n    <\/div>/.exec(sidebar);
    t.ok(footer, 'they live in a footer of their own');
    t.match(footer[0], /id="status"/);
    t.match(footer[0], /id="tipItem"/);
  });

  test('the footer is pinned to the bottom on every tab', (t) => {
    t.match(css, /\.footer \{[^}]*position: fixed/);
    t.match(css, /\.footer \{[^}]*bottom: 0/);
    t.match(css, /\.wrap \{ padding:[^}]*\}/, 'the panels still clear it');
  });

  test('the tip heading sits on top of the panel it opens', (t) => {
    t.notOk(/\.tip > \.head \{[^}]*order:/.test(css), 'nothing reorders it below the body');
    t.notOk(/\.tip > \.body \{[^}]*order:/.test(css), 'and nothing reorders the body above it');
  });

  test('a bar across the top of the tip heading separates it from the add-on', (t) => {
    t.match(css, /\.tip > \.head \{[^}]*border-top: 5px solid var\(--line\)/);
  });

  test('an opened tip row cannot grow taller than the sidebar', (t) => {
    t.match(css, /\.footer \{[^}]*max-height: 100vh/);
    t.match(css, /\.tip\.open > \.body \{[^}]*overflow-y: auto/);
  });

  suite('The heading');

  test('the icon is larger than the text it sits beside', (t) => {
    t.match(css, /\.applogo \{ width: calc\(var\(--fs\) \* 3\)/);
    t.match(css, /\.topbar \.title \{[^}]*font-size: calc\(var\(--fs\) \* 1\.3\)/);
  });

  test('a long document title wraps to two lines and then ellipsizes', (t) => {
    t.match(css, /\.topbar \.title > span \{[^}]*-webkit-line-clamp: 2/);
    t.match(css, /\.topbar \.title > span \{[^}]*overflow: hidden/);
    t.notOk(/\.topbar \.title \{[^}]*white-space: nowrap/.test(css),
      'the old single-line rule would stop it wrapping');
  });

  test('the heading names the add-on, not the document', (t) => {
    t.match(sidebar, /<span>Configure Styles<\/span>/);
    t.notOk(/docTitle/.test(sidebar + clientJs), 'nothing writes the document name there');
    t.notOk(/data\.documentTitle/.test(clientJs), 'the client no longer reads it');
  });

  test('a one-line title is centred against the icon', (t) => {
    t.match(css, /\.topbar \.title \{[^}]*display: flex/);
    t.match(css, /\.topbar \.title \{[^}]*align-items: center/);
  });

  test('the banner is not crowded against the Units row', (t) => {
    const m = /\.topbar \.title \{[^}]*margin-bottom: (\d+)px/.exec(css);
    t.ok(m, 'the title still sets its own bottom margin');
    t.ok(Number(m[1]) >= 10, 'and leaves real space below it, got ' + m[1] + 'px');
  });

  suite('Colour fields');

  test('an unset swatch shows the colour the document will actually render', (t) => {
    const fn = /function colorField\(hex, commit, opts\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var blank = opts\.blank \|\| '#000000';/);
    t.match(fn, /input\.value = hex \|\| blank;/);
  });

  test('"none" repaints the swatch instead of leaving the old colour on it', (t) => {
    const fn = /function colorField\(hex, commit, opts\)[^]*?\n}/.exec(clientJs)[0];
    const clear = /clear\.addEventListener[^]*?\}\);/.exec(fn)[0];
    t.match(clear, /input\.value = blank;/, 'the swatch changes, not only the model');
    t.match(clear, /commit\(''\)/, 'and the write still clears the colour');
  });

  test('"none" writes nothing when there is no colour to clear', (t) => {
    const fn = /function colorField\(hex, commit, opts\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var none = !hex;/, 'it knows whether the document holds a colour');
    t.match(fn, /if \(none\) return;/, 'and a second press does nothing');
    t.match(fn, /none = false;\s*\n\s*return commit\(v\);/,
      'picking a colour puts it back in play');
  });

  test('a pick is judged against the document, not against the swatch', (t) => {
    // With nothing set the swatch still has to show a colour. Choosing that
    // same colour on purpose is a change -- from no colour to that one.
    const fn = /function colorField\(hex, commit, opts\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /input\.setLive\(hex \|\| null\);/);
  });

  test('the page background offers white, because a page cannot be transparent', (t) => {
    const fn = /function renderPage\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /colorField\(pf\.backgroundColor,[^]*?blank: '#ffffff'/);
  });

  suite('Polling and open pickers');

  /* Replacing a <select> closes the dropdown the browser drew for it, and
     nothing can reopen it -- so the poll has to stand aside entirely. */
  test('a poll is skipped while a picker has focus, not merely re-rendered', (t) => {
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(pickerOpen\(\)\) \{ pollDeferred = true; return Promise\.resolve\(\); \}/);
    t.ok(fn.indexOf('pickerOpen()') < fn.indexOf("callRead("),
      'the check comes before the read, so the fingerprint cannot move on without a render');
  });

  test('a dropdown, a colour swatch and a font box all count as open', (t) => {
    const open = (a, hasFocus) => evalFromClient(['pickerOpen'],
      'var document = { activeElement: ' + JSON.stringify(a) + ',' +
      ' hasFocus: function () { return ' + (hasFocus === false ? 'false' : 'true') + '; } };\n' +
      'if (document.activeElement) document.activeElement.hasAttribute =' +
      ' function (n) { return this._attrs.indexOf(n) >= 0; };\n' +
      'return pickerOpen();');
    t.equal(open({ tagName: 'SELECT', _attrs: [] }), true);
    t.equal(open({ tagName: 'INPUT', type: 'color', _attrs: [] }), true);
    t.equal(open({ tagName: 'INPUT', type: 'text', _attrs: ['list'] }), true, 'the font box');
    t.equal(open({ tagName: 'INPUT', type: 'number', _attrs: [] }), false,
      'a plain number field is kept fresh -- renderKeepingEdits covers it');
    t.equal(open({ tagName: 'SELECT', _attrs: [] }, false), false,
      'and a select in a window that lost focus cannot have a dropdown open');
    t.equal(open(null), false);
  });

  test('the deferred read happens as soon as the picker is done with', (t) => {
    t.match(clientJs, /document\.addEventListener\('blur', function \(\) \{[^]*?pollDeferred = false;[^]*?\}, true\);/,
      'on capture, because blur does not bubble');
  });

  suite('One setting changed, one property written');

  const payload = evalFromClient(['stylePayload'], 'return stylePayload;');

  test('changing one field sends that field and nothing else', (t) => {
    const model = { textStyle: { bold: true, italic: false, fontSizePt: 12 },
                    paragraphStyle: { alignment: 'START', lineSpacing: 115 } };
    t.deepEqual(payload(model, 'textStyle', 'bold'),
      { textStyle: { bold: true }, paragraphStyle: {} });
    t.deepEqual(payload(model, 'paragraphStyle', 'alignment'),
      { textStyle: {}, paragraphStyle: { alignment: 'START' } });
  });

  test('a field already touched earlier is not sent again', (t) => {
    const model = { textStyle: { bold: true, italic: true }, paragraphStyle: {} };
    const second = payload(model, 'textStyle', 'italic');
    t.equal(second.textStyle.bold, undefined,
      'the earlier change is already in the document; re-sending it would rewrite it');
  });

  test('a value cleared back to inherit still travels, because null is the instruction', (t) => {
    const model = { textStyle: { baselineOffset: null }, paragraphStyle: {} };
    const p = payload(model, 'textStyle', 'baselineOffset');
    t.ok('baselineOffset' in p.textStyle, 'the key is present');
    t.equal(p.textStyle.baselineOffset, null);
  });

  test('family and weight are one message to the API, so neither goes alone', (t) => {
    const model = { textStyle: { fontFamily: 'Lato', fontWeight: 700 }, paragraphStyle: {} };
    t.deepEqual(payload(model, 'textStyle', 'fontFamily').textStyle,
      { fontFamily: 'Lato', fontWeight: 700 });
    t.deepEqual(payload(model, 'textStyle', 'fontWeight').textStyle,
      { fontFamily: 'Lato', fontWeight: 700 });
  });

  test('a weight nobody set defaults rather than travelling as undefined', (t) => {
    const model = { textStyle: { fontFamily: 'Lato' }, paragraphStyle: {} };
    t.equal(payload(model, 'textStyle', 'fontFamily').textStyle.fontWeight, 400);
  });

  test('a border is one field, so the whole side travels together', (t) => {
    t.match(clientJs, /return fire\('paragraphStyle', side\.key\);/);
  });

  suite('A click does not wait for a poll');

  test('reads are not in the write queue', (t) => {
    t.match(clientJs, /function callRead\(fn, args\) \{\s*return rawCall\(fn, args\);\s*\}/,
      'a read goes straight out');
    const call = /function call\(fn, args\)[^]*?\n}/.exec(clientJs)[0];
    t.match(call, /chain = p/, 'writes are still serialised against each other');
    t.match(call, /writes\+\+;/, 'and each one is counted');
  });

  test('a read that was overtaken by a write is thrown away, not drawn', (t) => {
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /var at = writes;/);
    t.match(fn, /if \(at !== writes\) return null;/);
    t.ok(fn.indexOf('if (at !== writes) return null;') < fn.indexOf('Object.keys(slice)'),
      'the check comes before anything is merged into the state');
  });

  suite('Undo and redo reach the document');

  test('clicking the sidebar never takes the keyboard from the document', (t) => {
    t.match(clientJs,
      /document\.addEventListener\('mousedown', function \(e\) \{\s*\n\s*if \(e\.target\.closest && e\.target\.closest\('button, \.item > \.head'\)\) e\.preventDefault\(\);/,
      'buttons and fold heads are stopped at mousedown, before focus can move');
  });

  test('a ctrl/cmd Z outside a field is handed back to the document', (t) => {
    t.match(clientJs,
      /window\.addEventListener\('keydown', function \(e\) \{[^]*?\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && \(e\.key === 'z' \|\| e\.key === 'Z'\)/);
    const fn = /window\.addEventListener\('keydown', function \(e\) \{[^]*?\n  \}\);/.exec(clientJs)[0];
    t.match(fn, /a\.tagName === 'TEXTAREA' \|\| a\.isContentEditable \|\|\s*\n\s*\(a\.tagName === 'INPUT' && a\.type !== 'checkbox'\)/,
      'typing in a field keeps the browser undo of your typing');
    t.match(fn, /window\.parent\.focus\(\)/,
      'focus returns to the frame holding the document, so the next keystroke lands there');
  });

  suite('A write re-reads only what it can have changed');

  test('the panel-shaped writes ask for one slice', (t) => {
    [['applyBulletPreset', 'lists'], ['removeBullets', 'lists'],
     ['setSegmentLink', 'hf'], ['applyStylePresetToNamedStyle', 'styles']
    ].forEach(([fn, slice]) => {
      const at = clientJs.indexOf(fn);
      t.ok(at > 0, fn + ' is called');
      t.match(clientJs.slice(at, at + 400), new RegExp("refreshSlice\\('" + slice + "'\\)"),
        fn + ' re-reads only ' + slice);
    });
  });

  test('saving, renaming and deleting a preset never reads the document', (t) => {
    ['saveStylePreset', 'deleteStylePreset', 'savePreset', 'deletePreset'].forEach((fn) => {
      const at = clientJs.indexOf(fn);
      const after = clientJs.slice(at, at + 400);
      t.notOk(/\.then\(reload\)/.test(after), fn + ' does not reload everything');
    });
    t.match(clientJs, /refreshSlice\('presets'\)/, 'they ask for the preset lists alone');
  });

  test('the writes that really do change everything still reload', (t) => {
    ['convertFootnotesToEndnotes', 'applyPreset', 'importConfig'].forEach((fn) => {
      const at = clientJs.indexOf(fn + "', [");
      t.match(clientJs.slice(at, at + 300), /\.then\(reload\)|return reload\(\)/,
        fn + ' reloads');
    });
  });

  test('the constants are asked for once and carried forward', (t) => {
    t.match(clientJs, /call\('loadAll', \[S\.tabId, have\]\)/, 'the client says what it holds');
    t.match(clientJs, /if \(!data\.constants\) data\.constants = S\.data\.constants;/,
      'and keeps what it was given the first time');
  });

  suite('Sync reads only what the open panel needs');

  test('page and styles poll on metadata alone; notes and presets never read', (t) => {
    const map = /var PANEL_SYNC = \{[^}]*\}/.exec(clientJs)[0];
    t.match(map, /page: 'meta'/);
    t.match(map, /styles: 'meta'/);
    t.match(map, /lists: 'context'/);
    t.match(map, /tables: 'context'/);
    t.match(map, /sections: 'context'/, 'the sections panel follows the cursor too');
    t.match(map, /notes: 'static'/);
    t.match(map, /presets: 'static'/);
  });

  test('lists and tables re-read only when the cursor moves between things', (t) => {
    const fn = /function poll\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /callRead\('cursorContext'\)/, 'the cheap probe goes first');
    t.match(fn, /if \(now === lastCtx\) return null;/,
      'an unchanged answer reads nothing at all');
    t.ok(fn.indexOf("JSON.stringify(ctx || {})") < fn.indexOf("callRead('refresh'"),
      'and only a changed answer spends the content read');
    t.match(fn, /callRead\('refresh', \[S\.tabId, what, ctxArg\]\)/,
      'the read is one slice, not the whole loadAll');
    t.notOk(/callRead\('loadAll'/.test(fn), 'no poll ever loads everything again');
  });

  test('switching panels refreshes immediately and distrusts an old cursor answer', (t) => {
    // Matched as one contiguous source pattern rather than inside a captured
    // span: brace-counting these template-built panels is how a mutant hides.
    t.match(clientJs,
      /activePanel = name;\s*\n\s*lastCtx = null;\s*\n\s*lastCtxObj = null;\s*\n\s*setTimeout\(poll, 0\);/,
      'the panel is recorded, the old cursor answer discarded, and a read prompted');
  });

  test('a write carries the tab list the sidebar already has', (t) => {
    t.match(clientJs, /function knownTabIds\(\)/);
    t.match(clientJs, /patch\.tabIds = knownTabIds\(\);/, 'page format');
    t.match(clientJs, /tabId: S\.tabId, scope: S\.scope, tabIds: knownTabIds\(\),/, 'named styles');
  });

  suite('Effects wear the effect they name');

  test('each effect checkbox labels itself in its own face', (t) => {
    t.match(clientJs, /function checkField\(labelText, value, commit, face\)/);
    t.match(clientJs, /el\('span', 'face ' \+ face\)/);
    ['bold', 'italic', 'underline', 'strikethrough', 'smallCaps'].forEach((k) => {
      t.match(css, new RegExp('\\.face\\.' + k + ' \\{'), k + ' has a face rule');
    });
    t.match(css, /\.face\.bold \{ font-weight: 700; \}/);
    t.match(css, /\.face\.smallCaps \{ font-variant: small-caps; \}/);
  });

  test('superscript and subscript sit with the other effects', (t) => {
    t.match(clientJs, /\['SUPERSCRIPT', 'Superscript', 'sup'\], \['SUBSCRIPT', 'Subscript', 'sub'\]/);
    t.match(css, /\.face\.sup \{ vertical-align: super;/);
    t.match(css, /\.face\.sub \{ vertical-align: sub;/);
  });

  test('they are one property, so the two boxes and the Offset select move together', (t) => {
    const fn = /function setOffset\(v\)[^]*?\n    \}/.exec(clientJs)[0];
    t.match(fn, /offsetSel\.value = v \|\| '';/, 'the select follows');
    t.match(fn, /b\.checked = \(k === v\);/, 'and only the chosen box stays ticked');
    t.match(fn, /return setT\('baselineOffset', v \|\| null\);/, 'one property is written');
  });

  suite('Lists are a stack of levels');

  test('the levels are the view, with the marker style above them', (t) => {
    const fn = /function listBody\(list\)[^]*?\n}/.exec(clientJs)[0];
    t.ok(fn.indexOf("'Marker style'") < fn.indexOf('levels.forEach'),
      'the marker style comes first, then the levels themselves');
    t.notOk(/Remove markers from every list/.test(clientJs),
      'the blunt whole-document button is gone');
  });

  test('a level can drop its own markers, and says so with a symbol not a word', (t) => {
    const fn = /function levelMarker\(list, lv\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /el\('button', 'glyph none', '\\u2298'\)/, 'a circle with a cross through it');
    t.match(fn, /t\.level = lv\.level;/, 'the write names the level');
    t.match(fn, /call\('removeBullets', \[t\]\)/);
  });

  test('a level shows the marker it gets, but cannot be given a different one', (t) => {
    const fn = /function levelMarker\(list, lv\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /shown\.disabled = true;/,
      'the API has no per-level glyph write, so it is shown rather than offered');
  });

  test('each level heading is set in by its own depth', (t) => {
    t.match(clientJs, /name\.style\.marginLeft = lv\.level \+ 'ex';/);
  });

  suite('Nothing internal reaches the screen');

  test('a section says where it starts in words, not as an enum', (t) => {
    const fn = /function sectionMeta\(sec\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /'starts a new page' : 'same page'/);
    t.notOk(/CONTINUOUS/.test(fn), 'no enum constant reaches the label');
    t.match(fn, /n === 1 \? ' column' : ' columns'/, 'and the count reads as English');
    t.notOk(/\(first\)/.test(clientJs), '"Section 1" already says it is the first');
  });

  test('a header with no text does not fall back to its internal id', (t) => {
    t.notOk(/seg\.preview \|\| seg\.segmentId/.test(clientJs));
    t.match(clientJs, /seg\.preview \|\| \(seg\.empty \? 'empty' : ''\)/);
  });

  suite('Sizes that follow their neighbours');

  test('the colour swatch matches the button beside it at any scale', (t) => {
    t.match(css, /input\[type=color\] \{[^}]*align-self: stretch/);
    t.notOk(/input\[type=color\] \{[^}]*[^-]height: 24px/.test(css),
      'no fixed height to fall out of step with the "none" button');
  });

  test('a unit label is as wide as the unit it shows', (t) => {
    t.match(css, /\.unit \{ flex: 0 0 auto;/);
  });

  test('every label that names a setting is muted, checkboxes included', (t) => {
    t.match(css, /\.checks label \{[^}]*color: var\(--muted\)/);
    t.match(css, /\.field > label \{[^}]*color: var\(--muted\)/);
    t.match(css, /\.row > label \{ color: var\(--muted\)/);
    t.match(css, /\.checks\.applyall label \{[^}]*color: var\(--fg\)/,
      'except the one that governs a whole panel');
  });

  suite('A slow write takes the panel with it');

  test('past half a second, a veil and a spinning hourglass appear', (t) => {
    t.match(clientJs, /var BUSY_AFTER_MS = 500;/);
    t.match(sidebar, /<div id="busy"[^]*?<div class="veil"><\/div>\s*<div class="glass">/);
    t.match(css, /#busy \{ position: fixed;[^}]*display: none/);
    t.match(css, /#busy\.on \{ display: block; \}/);
    t.match(css, /#busy \.veil \{[^}]*background: rgba\(255, 255, 255, 0\.66\)/);
    t.match(css, /#busy \.glass \{[^}]*top: 50%; left: 50%;/, 'centred in the viewport');
    t.match(css, /@keyframes busy-spin \{[^]*?rotate\(360deg\)/, 'it spins');
    t.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*#busy \.glass \{ animation: none/, 'unless motion is reduced');
  });

  test('only writes arm it, and only while something is still in flight', (t) => {
    const call = /function call\(fn, args\)[^]*?\n}/.exec(clientJs)[0];
    // Anchored to its own line: a bare /armBusy\(\);/ would also match inside
    // disarmBusy(); and pass with the call site deleted.
    t.match(call, /(^|\n)\s*armBusy\(\);/, 'writes arm it');
    t.match(call, /if \(S\.busy <= 0\) disarmBusy\(\);/, 'the last write to settle disarms it');
    const arm = /function armBusy\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(arm, /busyTimer = setTimeout/, 'not at once -- after the threshold');
    t.notOk(/callRead[\s\S]{0,80}armBusy/.test(clientJs), 'reads never arm it');
  });

  suite('Panels show only what is at the cursor');

  test('with no list under the cursor, the panel says so and lists nothing', (t) => {
    const fn = /function renderLists\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /Click inside a list in the document to edit it here\./);
    t.notOk(/Bulleted lists/.test(fn), 'no enumeration of every list');
    t.notOk(/listMeta\(l\)/.test(fn), 'no row per list');
  });

  test('with no table under the cursor, the panel says so and lists nothing', (t) => {
    const fn = /function renderTables\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /Click inside a table in the document to edit it here\./);
    t.notOk(/S\.data\.tables\.forEach/.test(fn), 'no row per table');
  });

  test('apply-to-all survives the scoping -- it is the whole-document path', (t) => {
    t.match(clientJs, /applyAllSwitch\('lists', 'Apply to all lists', 'unifyLists'\)/);
    t.match(clientJs, /applyAllSwitch\('tables', 'Apply to all tables', 'unifyTables'\)/);
  });

  test('the sections panel shows one section -- the one the cursor is in', (t) => {
    const fn = /function renderSections\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /Click inside a section in the document to edit it here/);
    t.notOk(/secs\.forEach/.test(fn), 'no row per section');
    t.match(fn, /section ' \+ \(at \+ 1\) \+ ' of '/,
      'it says which of the sections is being edited');
    t.match(fn, /sectionBody\(secs\[0\]\)/,
      'the slice already holds only the current section');
    t.match(fn, /if \(S\.all\.sections\) \{[^]*?sectionBody\(secs\[0\]\)/,
      'apply-to-all swaps the cursor scope for every-section-at-once');
  });

  test('one header margin, edited in one place', (t) => {
    const fn = /function sectionBody\(sec\)[^]*?\n}/.exec(clientJs)[0];
    t.notOk(/marginHeaderPt|marginFooterPt/.test(fn),
      'the sections panel does not offer them a second time');
    const hf = /function renderHeaders\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(hf, /marginHeaderPt/, 'the headers panel is where they live');
  });

  test('the sections editor moved off the page panel entirely', (t) => {
    const fn = /function renderPage\(\)[^]*?\n}/.exec(clientJs)[0];
    t.notOk(/sectionBody|writeSection|listItem/.test(fn),
      'nothing edits a section from renderPage');
    // It may still say the word, because a sectioned document has to be told
    // that these margins are only the default.
    t.match(fn, /Default margins/, 'and says so when there is more than one');
  });
};

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
  // scan above cannot see them. Check the six names explicitly.
  ['page', 'styles', 'bullets', 'notes', 'tables', 'presets'].forEach((n) => {
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

  test('every write covers all tabs', (t) => {
    t.equal(client.S.scope, 'all');
  });

  test('there is no Apply-to control to get out of step with that', (t) => {
    t.notOk(/id="scope"/.test(sidebar), 'the scope selector should be gone');
    t.notOk(/getElementById\('scope'\)/.test(clientJs), 'nothing should read it');
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
    // box -- say "inherited"; the unitless numbers say "default".
    const inherited = clientJs.match(/placeholder = opts\.placeholder \|\| 'inherited'/g) || [];
    t.equal(inherited.length, 2);
    t.match(clientJs, /placeholder = opts\.placeholder \|\| 'default'/);
    t.match(clientJs, /fontInput\.placeholder = 'inherited'/);
  });

  test('the placeholder is grey, not mistakable for a value', (t) => {
    t.match(css, /::placeholder \{[^}]*color:/);
  });

  test('style selects offer Inherited first', (t) => {
    t.match(clientJs, /var INHERIT = \{ id: '', label: 'Inherited' \}/);
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
    t.match(css, /html \{ overflow-y: scroll; \}/);
  });

  suite('Staying in step with the document');

  test('a field the user has left behind does not count as editing', (t) => {
    // activeElement outlives the focus, so hasFocus decides.
    t.match(clientJs, /function editingNow\(\)[^]*?document\.hasFocus\(\)/);
  });

  test('returning to the sidebar re-reads the document at once', (t) => {
    t.match(clientJs, /window\.addEventListener\('focus', function \(\) \{ setTimeout\(poll, 0\); \}\)/);
  });

  suite('What you can do here');

  test('every panel opens with a short list of what it does', (t) => {
    ['renderPage', 'renderStyles', 'renderBullets', 'renderNotes', 'renderTables',
     'renderPresets'].forEach((fn) => {
      const body = new RegExp('function ' + fn + '\\(\\)[^]*?\\n}').exec(clientJs)[0];
      t.match(body, /appendChild\(intro\(\[/, fn);
    });
  });

  test('the tables list says to click into a table first', (t) => {
    const body = /function renderTables\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(body, /intro\(\[\s*'Click inside a table in the document/);
  });

  test('the footnote wall of API limitations is gone', (t) => {
    t.notOk(/Footnote placement and pagination/.test(clientJs));
    t.notOk(/capabilities/.test(clientJs), 'and the server-supplied caveat list with it');
  });

  test('the panel intro is styled apart from the yellow warning box', (t) => {
    t.match(css, /\.intro \{/);
    t.match(css, /\.intro li \{/);
  });

  suite('Tables');

  test('a document with no tables says so, not "this tab"', (t) => {
    t.match(clientJs, /This document has no tables\./);
    t.notOk(/This tab has no tables/.test(clientJs));
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
    t.match(clientJs, /function group\(title\)[^]*?el\('fieldset', 'group'\)/);
    t.match(clientJs, /appendChild\(el\('legend', null, title\)\)/);
  });

  test('character and paragraph settings each get their own box', (t) => {
    t.match(clientJs, /var gChar = group\('Character'\)/);
    t.match(clientJs, /var gPara = group\('Paragraph'\)/);
    t.match(clientJs, /gChar\.appendChild\(fieldRow\('Font'/, 'the font row goes in the box');
    t.match(clientJs, /gPara\.appendChild\(fieldRow\('Alignment'/);
  });

  test('every heading inside a panel is a group heading now', (t) => {
    t.notOk(/el\('h3'/.test(clientJs), 'no bare sub-headings left');
    const groups = clientJs.match(/group\('[^']+'\)/g) || [];
    t.ok(groups.length >= 8, 'grouped everywhere, not just the style editor: ' + groups.length);
  });

  test('the box is rounded and can shrink to the sidebar', (t) => {
    t.match(css, /fieldset\.group \{[^}]*border-radius: 6px/);
    t.match(css, /fieldset\.group \{[^}]*min-width: 0/,
      'a fieldset that cannot shrink gives the sidebar a horizontal scrollbar');
    t.match(css, /fieldset\.group > legend \{/);
  });

  suite('Footnotes');

  test('footnotes are styled as one set, with no row per footnote', (t) => {
    const notes = /function renderNotes\(\)[^]*?\n}/.exec(clientJs)[0];
    t.match(notes, /segmentEditor\('footnotes'/, 'the style-them-all editor stays');
    t.notOk(/segments\.footnotes/.test(notes),
      'no per-footnote row: the individual list is headers and footers only');
    t.match(notes, /Individual headers and footers/);
  });

  test('the panel says what a change will and will not touch', (t) => {
    t.match(clientJs, /Only the settings you actually change are/);
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
    t.equal(panels.length, 6);
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
    t.match(clientJs, /setInterval\(poll, POLL_MS\)/);
    t.match(clientJs, /var POLL_MS = \d+;/);
  });

  test('a field being edited is never overwritten by the poll', (t) => {
    t.match(clientJs, /if \(editingNow\(\)\)/, 'the poll must check for an active field');
    t.match(clientJs, /input\.__dirty = true/, 'typing must mark the field dirty');
  });

  test('the poll stands aside while a write is in flight', (t) => {
    t.match(clientJs, /if \(!S\.data \|\| S\.busy \|\| document\.hidden\) return;/);
  });

  test('nothing is left of the button the poll replaced', (t) => {
    t.notOk(/resync/i.test(sidebar + clientJs), 'the Re-sync control should be gone');
  });
};

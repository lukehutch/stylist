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
  ['page', 'styles', 'lists', 'notes', 'tables', 'presets'].forEach((n) => {
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
    t.match(clientJs, /startPolling\(\);/);
    t.notOk(/setInterval/.test(clientJs), 'a fixed interval cannot adapt to the read cost');
  });

  test('returning to the sidebar re-reads the document at once', (t) => {
    t.match(clientJs, /window\.addEventListener\('focus', function \(\) \{ setTimeout\(poll, 0\); \}\)/);
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
    t.match(clientJs,
      /console\.log\('Stylist: first document read took ' \+ firstReadMs \+ ' ms'\)/);
  });

  test('that measurement paces the first wait too', (t) => {
    t.match(clientJs, /lastFetchMs = firstReadMs;/);
  });

  suite('Stopping when the sidebar is not there');

  test('every way back into the loop goes through one flag', (t) => {
    t.match(clientJs, /function schedule\(\) \{ if \(polling\) scheduleNext\(nextPollDelay\(\)\); \}/);
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

  test('an unnamed style is refused and a clash is confirmed first', (t) => {
    const fn = /function renderCustomStyles\(host\)[^]*?\n}/.exec(clientJs)[0];
    t.match(fn, /if \(name === null\) return;/, 'cancelling the prompt does nothing');
    t.match(fn, /if \(!name\) \{ status\('Give the style a name\.', 'err'\); return; \}/);
    t.match(fn, /already exists\. Replace it\?/);
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
    t.match(clientJs, /call\(unifyFn, \[\{ tabId: S\.tabId \}\]\)/,
      'the tick brings them into line');
    t.match(clientJs, /S\.all\[kind\] = on;/);
    t.match(clientJs, /patch\.allTables = true;/, 'a table write then covers all of them');
    t.match(clientJs, /allLists: true/, 'and a list write likewise');
  });

  test('the switch is only offered when there is more than one thing to unify', (t) => {
    t.match(clientJs, /S\.data\.tables\.length > 1[^]*?applyAllSwitch\('tables'/);
    t.match(clientJs, /lists\.length > 1[^]*?applyAllSwitch\('lists'/);
  });

  test('unticking changes nothing in the document', (t) => {
    t.match(clientJs, /if \(!on\) \{ renderAll\(\); return; \}/);
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
    const allowed = /'err'\)|status\('', ''\)|Loading|Converting|Bringing/;
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

  test('the tip row opens upwards, into the space above its heading', (t) => {
    t.match(css, /\.tip > \.head \{ order: 2; \}/, 'the heading is ordered last');
    t.match(css, /\.tip > \.body \{ order: 1;/, 'the panel is ordered first');
    t.match(css, /\.tip \{[^}]*grid-template-rows: 0fr auto/);
    t.match(css, /\.tip\.open \{ grid-template-rows: 1fr auto; \}/);
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
    t.ok(fn.indexOf('pickerOpen()') < fn.indexOf("call('loadAll'"),
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
};

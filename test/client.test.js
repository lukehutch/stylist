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

/**
 * Run the local suite in a different order, and fail if that changes anything.
 *
 * The sandbox's document is mutable -- a style write really does change what
 * the next read sees -- and the preset store lives as long as the sandbox
 * does. Both are what make the offline tests realistic, and both make it easy
 * to write a test that passes only because of what ran before it. Those are
 * the worst kind: they go green today and fail bewilderingly the day someone
 * inserts a test above them.
 *
 * Three were found here the first time this was run. Each was asserting
 * something true only in file order -- a preset count that assumed an empty
 * store, a preset another test happened to have saved, a font a later test
 * overwrote. All three now make their own sandbox.
 *
 *   npm run test:shuffle          eight orders
 *   node test/shuffle.js 3        just seed 3
 *
 * The seeds are deterministic, so a failure can be repeated exactly.
 */
const path = require('path');
const core = require('../node_modules/gapp-tester/gas/GappTester.js');
const { sandbox } = require('../node_modules/gapp-tester/lib/sandbox');
const { load, localSuiteFiles } = require('../node_modules/gapp-tester/lib/config');

const dir = path.resolve(__dirname, '..');

function runShuffled(seed) {
  const cfg = load(dir);
  core.gappReset();
  const api = {
    suite: core.suite,
    test: core.test,
    sandbox: (opts) => sandbox(Object.assign(
      { dir: cfg.dir, src: cfg.src, files: cfg.serverFiles, quiet: true }, opts)),
    config: cfg
  };
  // Required fresh every time: a suite file builds its sandboxes as it loads,
  // so reusing the module cache would hand the second order the first order's
  // already-written documents.
  localSuiteFiles(cfg).forEach((f) => {
    delete require.cache[path.resolve(f)];
    core.suite('');
    require(path.resolve(f))(api);
  });

  const tests = core.tests();
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = tests.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const swap = tests[i]; tests[i] = tests[j]; tests[j] = swap;
  }
  return core.gappRun();
}

const seeds = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [1, 2, 3, 4, 5, 6, 7, 8];

let bad = 0;
seeds.forEach((seed) => {
  const run = runShuffled(seed);
  console.log('seed ' + seed + ': ' + run.passed + ' passed, ' + run.failed + ' failed');
  run.results.filter((r) => !r.ok).forEach((r) => {
    bad++;
    console.log('  FAIL ' + (r.suite ? r.suite + ' / ' : '') + r.name +
      ': ' + String(r.error).split('\n')[0]);
  });
});

if (bad) {
  console.log('\n' + bad + ' failure(s) that the usual order hides. A test that ' +
    'passes only\nafter another one has run needs its own sandbox.');
  process.exit(1);
}
console.log('\nSame result in every order.');

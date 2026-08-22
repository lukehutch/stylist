# Developing, testing and publishing

## Layout

```
src/                Apps Script project (everything here is pushed by clasp)
test/               Node test suite; never pushed
assets/             icon sources and the raster sizes the Marketplace needs
```

`clasp` pushes only `src/`, because `.clasp.json` sets `"rootDir": "src"`.
Keep test and asset files out of `src/` or they get uploaded too — with two
deliberate exceptions: `src/LiveTests.js` and `src/GappTester.js` have to be
pushed, because they are the suite that runs inside Apps Script and the runtime
that runs it.

## Setting up your own copy

**Use `create-script`, not `clone-script`.**

```bash
clasp login
clasp create-script --type standalone --title "Stylist" --rootDir src
clasp push --force
```

`clone-script` adopts a script that already exists, and it *downloads* that
project's files into `rootDir` — pointed at this repository it would overwrite
`src/` with whatever is on the server. It is the right command only if you
already have a Stylist script in your account and want to reconnect
to it; then `clasp clone-script <SCRIPT_ID> --rootDir src` in an empty
directory, or write `.clasp.json` by hand:

```json
{ "scriptId": "1a2B3c...", "rootDir": "src" }
```

Four notes on that first push:

- **`create-script` leaves a stray `src/src/`.** It applies `rootDir` twice
  when downloading the new project's stub manifest, writing it to
  `src/src/appsscript.json`. Both that and the real `src/appsscript.json` map
  to the manifest name, so the push refuses with *"A file with this name
  already exists in the current project: appsscript"*. `rm -rf src/src` and
  push again. Observed with clasp 3.4.0.

- **`--force` on the first push.** `create-script` leaves a default
  `appsscript.json` on the server, so the first push changes the manifest and
  clasp asks before overwriting it. Declining skips the *whole* push, not just
  the manifest, which looks like nothing happened.
- **`--type standalone`, not `--type docs`.** An editor add-on is not bound to
  one document: a test deployment makes you pick the document to try it in, and
  a published add-on runs in whichever document the user opens it from. A bound
  script would tie this code's life to one Doc in your Drive. Google's
  documentation does not state a requirement either way — I looked, on four
  pages — so this is the practical choice rather than a rule.
- **`.clasp.json` is gitignored**, because the script id is specific to your
  copy. `.clasp.json.example` is the template.

### What each goal actually needs

|  | Test deployment (use it yourself) | `npm run test:live` | Publish to the Marketplace |
|---|---|---|---|
| A script project and `.clasp.json` | yes | yes | yes |
| Apps Script API on for your account | — | yes | — |
| A **standard** Cloud project attached | — | yes | yes |
| Your own OAuth client in that project | — | yes | — |
| OAuth consent screen configured | — | — | yes |
| Marketplace SDK enabled in that project | — | — | yes |
| An API Executable deployment | — | yes | — |
| A versioned add-on deployment | — | — | yes |

The row that matters: **the standard Cloud project is the same one for both**
`test:live` and publishing. Create it once. If you intend to publish, do that
step first and the live-test setup gets shorter.

If you only want to *use* the add-on yourself, the first column is the whole
list — `clasp push`, then Deploy → Test deployments → Install.

## Running the tests

```bash
npm test              # every local suite: 120 tests, no network
npm run test:live     # push, then run the live suite inside Apps Script
npm run test:all      # local first; live only if local passed
```

The runner is [gapp-tester](https://github.com/lukehutch/gapp-tester), which
was written for this project and then split out. `gapp.config.json` names the
script files and where the suites live. It is installed from GitHub; to work
against a local checkout instead, `npm install ../gapp-tester`.

```
test/format.test.js   what the add-on does: every Docs API request it builds
test/client.test.js   the sidebar's browser code and template
test/harness.js       the sandbox: hand-written DocumentApp and Docs mocks
test/fixture.js       the documents the tests run against
src/LiveTests.js      the suite that runs inside Apps Script
src/GappTester.js     gapp-tester's runtime core; pushed, not hand-edited
```

### How the local suite works

Apps Script code cannot be `require`d — it has no modules, and it calls global
services that only exist inside Google's runtime. gapp-tester evaluates every
file named in `gapp.config.json` into one `vm` context, which is exactly how
Apps Script loads a project: one shared global scope, no imports.

Two services are hand-written in `test/harness.js`, because these tests turn
on their behaviour:

| Global | Stand-in |
|---|---|
| `Docs.Documents.get` | returns the fixture document from `test/fixture.js` |
| `Docs.Documents.batchUpdate` | **captures** the request array instead of sending it |
| `DocumentApp` | a document id, the add-on menu, a settable selection/cursor, and the `Attribute`/`ElementType`/`HorizontalAlignment`/`VerticalAlignment` enums |

Everything else — `PropertiesService`, `CacheService`, `Logger`,
`HtmlService`, and auto-mocks for every other Google service — comes from
gapp-tester. Its `HtmlService` reads the real `src/*.html` files and expands
`include()`, which is why a local test can assert on what the sidebar renders.

Because `batchUpdate` is captured, a test asserts on the exact JSON the add-on
would have sent — field masks included. That is the part most likely to be
wrong, and the part Google's docs are least explicit about.

The fixture covers the awkward cases on purpose: a document with tabs *and* a
nested child tab, a legacy pre-tabs document, an empty footer (segments with no
content must be skipped, not sent as a zero-length range), footnotes at known
indices, a two-level list, and a table.

### Writing a test

```js
test('describe the behaviour, not the function name', (t) => {
  S.__reset();
  S.writeSegmentStyle({ tabId: 't.0', target: 'footnotes',
                        paragraphStyle: { spaceAbovePt: 6 } });
  const reqs = allRequests(S);
  t.equal(reqs[0].updateParagraphStyle.fields, 'spaceAbove');
});
```

Use `t.deepEqual`, not `assert.deepStrictEqual`. Objects built inside the `vm`
context carry that realm's prototypes, which `deepStrictEqual` rejects with
"Values have same structure but are not reference-equal". `t.deepEqual`
compares the data, ignoring key order but not array order.

A test that makes no assertion is reported as a failure, not a pass.

### Check that a test can fail

A test that cannot fail is worse than no test. After adding one, break the code
it covers and confirm it goes red. Known-good mutations:

| Mutation | Expected |
|---|---|
| Drop the parent path from the named-style field mask | 1 fail |
| Reverse the order of the footnote→endnote rewrite | 1 fail |
| Change the cm→pt factor | 3 fails |
| Disable the `pageBreakBefore` strip in `writeSegmentStyle` | 1 fail |
| Make `styleSummary_` never report a field as mixed | 2 fails |
| Let `styleSummary_` show the first value of a disagreeing field | 1 fail |
| Set `input.__dirty = false` where the sidebar marks a field edited | 1 fail |
| Drop `S.busy` from the poll's guard | 1 fail |

### What the local suite does not cover

It exercises logic, not Google's runtime. It cannot tell you whether the Docs
API accepts a request, whether a scope is sufficient, or whether the sidebar
renders in Docs. That is what `src/LiveTests.js` is for, and beyond it, a test
deployment you drive by hand.

## Testing inside Apps Script

```bash
npm run test:live
```

which is `gapp-test live`: `clasp push`, then `clasp run-function
gappRunInGas --json`, then the TAP report printed here. `gapp-test live
--dry-run` prints the commands without running them.

**The simpler route is the editor.** Open it, pick `gappRunInGas` from the
function list, press Run, and read the report in the execution log. That needs
no setup at all beyond `clasp push`, and it is the recommended way to run these
the first time.

`gapp-test live` is worth the setup only if you want the result in your
terminal or in CI, because Google's Execution API asks for a fair amount
([its prerequisites](https://developers.google.com/apps-script/api/how-tos/execute)):

1. Turn on the Apps Script API at
   [script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Create a **standard** Cloud project and attach it to the script (Project
   Settings → Google Cloud Platform (GCP) Project). The default project Apps
   Script makes for you is explicitly not enough.
3. In *that same* Cloud project (clasp's own OAuth client will not do), create
   an OAuth client of type **Desktop App**, download it as
   `client_secret.json` — `.gitignore` already covers it — and:

   ```bash
   clasp login --user gapp-tests --creds client_secret.json \
               --use-project-scopes --include-clasp-scopes
   ```

   `--use-project-scopes` is needed because the token must cover every scope in
   `appsscript.json`, not just the ones `gappRunInGas` touches.
   `--include-clasp-scopes` is needed because `--use-project-scopes` alone
   *replaces* clasp's own scopes rather than adding to them, which drops
   `script.projects` and breaks the `clasp push` that runs first. Then put
   `{"live": {"user": "gapp-tests"}}` in `gapp.config.json`.
4. Deploy once as an **API Executable** (Deploy → New deployment → API
   Executable). `devMode` runs the code you just pushed rather than the deployed
   version, but a deployment still has to exist.
5. Add `"executionApi": {"access": "ANYONE"}` to `src/appsscript.json`.

Step 5 is deliberately **not** committed. `executionApi` is a permanent
execution surface on the add-on, and shipping one for the sake of a test suite
is the wrong trade for something published to the Marketplace. Add it while
testing, take it out before publishing.

What `src/LiveTests.js` checks, in order: the Docs advanced service is actually
enabled; `Docs.Documents.get` returns this document; tab resolution works on it
(tabbed or legacy); `loadAll` fills every panel; the fields come back populated
rather than blank; the page size round-trips through the unit conversion;
**`updateNamedStyle` is accepted with the field mask this add-on builds**;
footnote segment styling is accepted; styling every footnote callout is
accepted; and the sidebar template renders.

The field-mask check is the reason the file exists. Docs wants `namedStyleType`
plus *both* the parent (`textStyle`) and leaf (`textStyle.bold`) paths, which
the local suite can only assert against my own reading of the discovery
document. Only a real call settles it.

**Every write it performs re-asserts values the document already has**, so a
passing run leaves formatting untouched. A failing run is the point, and
Ctrl+Z in the document undoes anything it did. Run it on a scratch copy the
first time anyway.

The local suite loads `src/LiveTests.js` too and runs it against the mocked
services. That does not prove Google accepts anything, but it does catch the
failures that would otherwise waste a push: a parse error, a renamed function,
a field read from the wrong place. It caught one while being written — the
previous version of this file read `pf.pageSize.widthPt`, and `readPageFormat`
returns `pageWidthPt`.

### The sidebar, by hand

```bash
clasp push
clasp open-script
```

In the editor, **Deploy → Test deployments → Install**, then open a document
and use **Extensions → Stylist**. A test deployment runs the code at
`HEAD`, so `clasp push` and reload the sidebar to pick up changes — no
redeploy needed.

`console.log` from server functions goes to **Executions** in the editor.
Errors thrown inside a `google.script.run` call surface in the sidebar's status
line and, with more detail, in Executions.

## Testing inside Apps Script: the options, scored

The Stack Overflow thread [How to unit test Google Apps
Scripts](https://stackoverflow.com/questions/15682346/how-to-unit-test-google-apps-scripts)
lists eight approaches across its answers. All eight, checked for what they are
today (August 2026) rather than what they were when posted:

| # | Option | State today | Can it prove the Docs API accepts a request? | Score | Why |
|---|---|---|---|---|---|
| 1 | **`clasp run-function`** ([clasp](https://github.com/google/clasp), 5.8k★, active) | Current. Note the name: older answers say `clasp run`; the command on master is `clasp run-function [function]`. | **Yes** — executes a named function in the real project and returns its value to your terminal | **9** | Closes the exact gap the Node suite leaves, adds no dependency, and reuses the assertions already written. Needs the Apps Script API enabled and, for scoped calls, `--use-project-scopes`. |
| 2 | **Plain QUnit 2.x pasted into a `.gs` file**, console reporter → execution log (the Oct-2024 answer) | Works. No library key, nothing to go stale. | Yes, if the assertions call the API | **8** | Simplest honest in-editor runner. Caveats from the answer, both real: the file must sort above anything referencing `QUnit`, and `assert.async()`/`assert.timeout()` do not work on the Apps Script V8 runtime. Loading it also makes the debugger hang on "waiting for a breakpoint". |
| 3 | **[QUnitGS2](https://github.com/artofthesmart/QUnitGS2)** (28★, last pushed 2020) | Usable but unmaintained for six years. | Yes | **6** | A tidier wrapper on the same idea as #2 — QUnit 2.x plus a `doGet` that serves results as a web page. The web-page output is nicer than the execution log; the dependency on an abandoned library is the cost. |
| 4 | **[GasT](https://github.com/huan/gast)** (113★, last pushed 2021) | Usable, unmaintained. | Yes | **5** | TAP output, which is a good fit here. But the documented install is `eval(UrlFetchApp.fetch(rawGithubUrl).getContentText())` — running whatever that URL serves, at test time, with the add-on's scopes. Not acceptable for a project that requests the `documents` scope. |
| 5 | **[Aside](https://github.com/google/aside)** (436★, active) | Current, unofficial-Google. | Only via `clasp run-function`, per its own author | **5** | TypeScript + ESLint + Prettier + Jest scaffolding. Genuinely good if you are starting a TypeScript project. Adopting it here would mean converting ten ES5 files to TypeScript for a Jest runner that still cannot reach the Docs API on its own. Wrong trade for this codebase. |
| 6 | **QUnit-for-GAS library**, project key `MxL38OxqIK-B73jyDTvCe-OBao7QLBR4j` (the 2013 answer) | Dead end. QUnit 1.x, and the answer's own caveat is a Caja bug in Firefox 20 — Caja was retired years ago. | — | **1** | Superseded by #3 and #2. Listed for completeness. |
| 7 | **gas-unit** (`code.google.com/p/gas-unit`) | Gone. Redirects to the read-only Google Code Archive. | — | **0** | Google Code shut down in 2016. Its own author's answer says the future is a QUnit or Jasmine port. |
| 8 | **gasunit** (unhyphenated, `code.google.com/p/gasunit`) | Gone, same archive. Also spreadsheet-bound, which this add-on is not. | — | **0** | Same. |

Also mentioned in the thread and worth recording: `node-google-apps-script` is
deprecated in favour of clasp, and the answer suggesting "rename the files to
`.ts` and test with ava" predates `clasp run-function` — it tests the pure
functions only, which is what the local suite already does, in Node, with no
build step.

**Conclusion: take #1 and #2, refuse everyone's dependencies, and write the
ninth option.** That is
[gapp-tester](https://github.com/lukehutch/gapp-tester): one test format that
runs both locally against mocked services and inside Apps Script through
`clasp run-function`, with TAP as the wire format. It took the assertion shape
from QUnit, TAP from GasT (but not GasT's `eval` of a remote script, which runs
whatever that URL serves with this add-on's `documents` scope), the
results-must-escape-the-sandbox insight from QUnitGS2 (but not its web-app
deployment — the function you already call can just return the string), and
the fast local loop from Aside (but not a TypeScript conversion of ten ES5
files). It has no dependencies.

Google's own guidance for add-on test deployments and unlisted-release testing
is at [Testing Workspace add-ons](https://developers.google.com/workspace/add-ons/how-tos/testing-workspace-addons).

## The icon

`assets/icon.svg` is the source: a gear on a blueprint ground with a dimension
measurement beside it — a tick above, a tick below, and a double-ended arrow
between them. Regenerate the rasters after editing it:

```bash
inkscape assets/icon.svg -w 128 -h 128 -o assets/icon-128.png
inkscape assets/icon.svg -w  32 -h  32 -o assets/icon-32.png
inkscape assets/banner.svg -w 220 -h 140 -o assets/banner-220x140.png
```

**Where the icon is specified.** Not in `appsscript.json`. That file's
`addOns.common.logoUrl` belongs to CardService-based Google Workspace Add-ons;
adding an `addOns` block to an Editor Add-on manifest changes what kind of
add-on it is and would require a `docs.homepageTrigger` and a CardService UI,
which this add-on does not use. An Editor Add-on's icons live in the **Google
Workspace Marketplace SDK**, uploaded as part of the store listing:

| Asset | Size | Where |
|---|---|---|
| `assets/icon-32.png` | 32×32 PNG | Marketplace SDK → App Configuration → Application icon |
| `assets/icon-128.png` | 128×128 PNG | Marketplace SDK → Store Listing → Application icon |
| `assets/banner-220x140.png` | 220×140 PNG | Marketplace SDK → Store Listing → Card banner |

There is no naming requirement — the files are uploaded, not referenced by
path. The sidebar draws the same artwork inline as SVG in `src/Sidebar.html`,
so the header icon needs no hosting.

Screenshots (1280×800 or 640×400) are also required by the listing; take them
from a real document with the sidebar open.

## Publishing

Publishing is only needed to share the add-on beyond your own account. For
personal use, a test deployment is enough and nothing below applies.

1. **Attach a standard Cloud project.** Apps Script → Project Settings →
   Change project, and paste a GCP project **number**. The default per-script
   project cannot be published. This is the same Cloud project `npm run
   test:live` needs — see the table under
   [Setting up your own copy](#what-each-goal-actually-needs) — so if you set
   that up already, you are done with this step.
2. **Configure the OAuth consent screen** in that Cloud project. The scopes
   this add-on requests are in `src/appsscript.json`:
   `https://www.googleapis.com/auth/documents` and
   `https://www.googleapis.com/auth/script.container.ui`. `documents` is a
   sensitive scope, so an external, public listing needs Google's OAuth
   verification — a security assessment and, typically, several weeks. An
   internal listing within one Workspace domain does not.
3. **Create a versioned deployment**: Apps Script → Deploy → New deployment →
   Add-on. A version is a frozen snapshot of the code; the published add-on
   runs that snapshot, not your latest push, so every release means a new
   version here.
4. **Enable the Google Workspace Marketplace SDK** in the Cloud project, then
   fill in App Configuration: add-on type *Editor Add-on*, plus two values
   Google's SDK asks for by name —
   - the **script id**, from Apps Script → Project Settings → IDs;
   - the **version number**, from Apps Script → Deploy → Manage deployments,
     under "Configuration".

   Editor add-ons are configured by version number. The *deployment id* you may
   see alongside it is what Google Workspace add-ons use; this is not one.
5. **Fill in the Store Listing**: name, descriptions, category, the icon and
   banner, screenshots, a terms-of-service URL and a privacy-policy URL. Both
   URLs are mandatory and must resolve.
6. **Choose visibility** — private to your domain, unlisted (link only, good
   for beta testing), or public. Unlisted is the sensible first step.
7. **Submit for review.** Public listings are reviewed; domain-internal ones
   publish immediately.

Apps Script code is not code-signed — there is no signing step. Trust comes
from the OAuth consent screen and the Marketplace review, which is why the
scope list in `src/appsscript.json` should stay as narrow as it is.

## Conventions in this codebase

- **ES5-flavoured V8.** The runtime is V8, so `let`/arrow functions work, but
  the existing files use `var` and `function` throughout; match that.
- **Trailing underscore means private.** `segmentRange_`, `uiToTextStyle_` and
  friends are helpers; names without it are called from the sidebar by
  `google.script.run` and must stay stable.
- **Every write needs a matching read.** A field the sidebar can set is a field
  the sidebar must show the current value of, or the panel lies about the
  document. New editors get their current values from `styleSummary_`
  (paragraph content) or `cellStyleSummary_` (table cells), both of which also
  return the list of fields that disagree across the content being edited.
- **Points are the storage unit, always.** `Dimension.unit` in the Docs API
  accepts only `PT`; inches, cm and mm exist solely in the sidebar. Anything
  crossing to the server is already in points and carries a `Pt` suffix.
- **State an API limit where it bites.** When the API refuses something, say so
  in a comment *and* in the sidebar, and quote the discovery document. Several
  limits here look like bugs otherwise.
- **Check the discovery document, not the prose docs**, before claiming the API
  can or cannot do something:
  ```bash
  curl -s 'https://docs.googleapis.com/$discovery/rest?version=v1' > /tmp/docs-v1.json
  ```
  The prose pages lag, and summarisers invent request types that do not exist.

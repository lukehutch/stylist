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

Three notes on that first push:

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

## Updating the script in your test document

Once the test deployment exists (below, [the sidebar by hand](#the-sidebar-by-hand)),
getting a code change into the document you test in is:

```bash
npm test                  # local gate first; a red suite is not worth pushing
clasp push --force
```

Then, **in the test document**, do the smallest of these that covers what you
changed:

| What you changed | What the document needs |
|---|---|
| `src/*.js` — server code only | nothing; the next `google.script.run` call from the open sidebar already runs the new code |
| `src/Sidebar.html`, `src/JavaScript.html`, `src/Stylesheet.html` | **close and reopen the sidebar** (Extensions → Stylist → Open format editor) |
| `onOpen` — the menu's name or items | **reload the document** (F5) |
| `src/appsscript.json` — scopes or advanced services | **reload the document**, then re-authorise when Docs asks |

The reason for the middle two rows: the sidebar's HTML is produced *once*, by
the `showSidebar` call that opened it. `HtmlService.createTemplateFromFile`
runs then and never again, so an already-open sidebar keeps serving the markup,
CSS and browser JavaScript from the moment it opened — reloading the document
around it does not help, because that does not re-run `showSidebar`. Closing
and reopening the panel does. The add-on menu is likewise built by `onOpen`,
which Docs runs when the document loads, so a renamed or added menu item only
appears after a reload.

**There is no redeploy step.** The test deployment is pinned to code version
**Latest Code**, so what `clasp push` just uploaded is what the document runs.
Cutting a version (Deploy → New deployment) is only for publishing.

`--force` is on `clasp push` here for the same reason as on the first push: any
change to `src/appsscript.json` makes clasp stop and ask before overwriting the
manifest, and declining skips the entire push rather than just that file.

Two things to check when a change appears not to have landed:

- **Are you pushing to the script the document actually runs?** `clasp push`
  goes to the `scriptId` in `.clasp.json`; the test deployment belongs to a
  script id you can read in the editor under Project Settings → IDs. If you
  have more than one copy in your Drive, these can drift apart.
- **Did the push really succeed?** clasp prints the file list and a count.
  A file that never appears in that list is not in `src/`, and nothing outside
  `src/` is ever uploaded.

Server-side errors go to the editor's **Executions** view (`clasp open-script`),
not to the browser. Errors in the sidebar's own JavaScript go to the browser
console — the sidebar is an iframe, so pick its frame in the console's frame
selector to see them.

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
   clasp login --user live --creds client_secret.json \
               --use-project-scopes --include-clasp-scopes
   ```

   Both switches are needed, and neither is enough alone.
   `--use-project-scopes` makes the token cover every scope in
   `appsscript.json`, not just the ones `gappRunInGas` touches.
   `--include-clasp-scopes` is needed because `--use-project-scopes` alone
   *replaces* clasp's own scopes rather than adding to them: clasp's source
   reads `scopes = manifestScopes ? [...manifestScopes] : scopes`, so the token
   comes back holding only the two manifest scopes, `script.projects` is gone,
   and both the `clasp push` that runs first and `clasp list-deployments` fail
   with *"Request had insufficient authentication scopes."* The user name must
   match the one in `gapp.config.json`, which is `{"live": {"user": "live"}}`;
   name a user that has no token and the runner silently falls back to your
   everyday `default` credential, which cannot run the function.

   With both switches the consent screen lists nine scopes rather than two —
   Drive metadata, `drive.file`, Docs, service management, cloud-platform,
   webapp deploy, logging, script deployments, script projects. That is clasp
   the command-line tool asking for permission to manage *your own* script
   projects on *your own* account, through the Desktop-App OAuth client you
   just made. It is not what Stylist asks for. Users of the add-on authorise
   `src/appsscript.json`, which is two scopes and nothing else; nothing you do
   at this login changes their consent screen.
4. Add `"executionApi": {"access": "MYSELF"}` to `src/appsscript.json` and
   `clasp push --force`. The manifest has to declare it before a deployment can
   be an API Executable.
5. Deploy once as an **API Executable**: `clasp create-deployment`, or Deploy →
   New deployment → API Executable. `devMode` runs the code you just pushed
   rather than the deployed version, but a deployment still has to exist.
   Without one, `run-function` fails with *"a server error occurred while
   reading from storage. Error code NOT_FOUND"* — confirmed by adding the
   deployment and watching that error change.

Step 4 **is** committed, and should not stay that way. `executionApi` is a
permanent execution surface on the add-on, and shipping one for the sake of a
test suite is the wrong trade for something published to the Marketplace.
Take it out of `src/appsscript.json` before publishing.

The other error worth recognising is *"Unable to run script function. Please
make sure you have permission to run the script function."* That is step 3: the
token was minted by an OAuth client that does not live in the script's Cloud
project, or does not carry the script's scopes.

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

Then set up a test deployment once, as in the [README](README.md#2-install-it-into-a-document):
**Deploy → Test deployments**, enable the **Editor add-on** type, **Create new
test**, code version **Latest Code**, pick a test document, **Save test**,
**Execute**. After that there is no redeploy step per change — a test
deployment runs the latest code, so `clasp push` is the whole update, plus
whatever the document itself needs to notice it: see [Updating the script in
your test document](#updating-the-script-in-your-test-document).

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
inkscape assets/icon.svg -w 120 -h 120 -o assets/icon-120.png
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
| `assets/icon-120.png` | 120×120 PNG | Google Auth Platform → Branding → App logo |
| `assets/icon-32.png` | 32×32 PNG | Marketplace SDK → App Configuration → Application icon |
| `assets/icon-128.png` | 128×128 PNG | Marketplace SDK → Store Listing → Application icon |
| `assets/banner-220x140.png` | 220×140 PNG | Marketplace SDK → Store Listing → Card banner |

`icon-120.png` is the odd one out: it is not a Marketplace asset at all but the
logo on the OAuth consent screen, uploaded under Branding in the Cloud console,
and it is what makes verification possible — Google will not review an app
without one. The other three belong to the store listing.

There is no naming requirement — the files are uploaded, not referenced by
path. The sidebar draws the same artwork inline as SVG in `src/Sidebar.html`,
so the header icon needs no hosting.

Screenshots (1280×800 or 640×400) are also required by the listing; take them
from a real document with the sidebar open.

## Publishing

Only needed to share the add-on beyond your own account. For personal use a
test deployment is enough and none of this applies.

Budget weeks, not days: a public listing that requests a sensitive scope goes
through Google's OAuth verification, and Stylist requests
`https://www.googleapis.com/auth/documents`, which is sensitive. A listing
restricted to your own Workspace domain skips that entirely.

### 1. Cloud project and consent screen

The add-on must belong to a standard Cloud project — the per-script default
cannot be published. This is the same project step 3 of the README sets up, and
the same one `npm run test:live` needs, so do it once.

In that project's **OAuth consent screen**, publish the app and list exactly
the scopes from `src/appsscript.json`:

- `https://www.googleapis.com/auth/documents` — sensitive; needs verification
- `https://www.googleapis.com/auth/script.container.ui`

Keep this list identical to the manifest and to the Marketplace SDK's scope
list. A mismatch is the most common reason a submission bounces.

### 2. Cut a version

The published add-on runs a frozen snapshot, not your latest push. In the Apps
Script editor: **Deploy → New deployment → Add-on**, and note the **version
number**. Every release means a new version and an updated listing.

### 3. Marketplace SDK app configuration

Enable the **Google Workspace Marketplace SDK** in the Cloud project, then open
**App Configuration**:

| Field | Value |
|---|---|
| App integration | **Editor add-on**, with **Docs** ticked |
| Project script id | Apps Script → **Project Settings → IDs → Script ID** |
| Version | the version number from step 2 |
| OAuth scopes | the two scopes above |
| App visibility | **Public**, **Unlisted**, or **Private** |

Two traps. Editor add-ons are identified by **script id plus version number** —
the *deployment id* sitting next to them belongs to Google Workspace add-ons
and is not what this field wants. And visibility **cannot be changed after you
save this page**; unlisted is the safe first choice, since it is installable by
link for beta testers but absent from search.

### 4. Store listing

Required fields, with Google's limits:

| Field | Requirement |
|---|---|
| Application name | ≤ 50 characters, must match the OAuth consent screen, cannot contain "Google" |
| Short description | ≤ 200 characters |
| Detailed description | < 16,000 characters |
| Category, language | pick one each |
| Icons | 32×32 and 128×128 |
| Card banner | 220×140 |
| Screenshots | at least one, up to ten; 1280×800 preferred, square corners, full bleed |
| Terms of service URL | must resolve |
| Privacy policy URL | must resolve |
| Support URL | must resolve |

`assets/` already holds the two icon sizes and the banner at the exact required
dimensions (`icon-32.png`, `icon-128.png`, `banner-220x140.png`), and
[PRIVACY.md](PRIVACY.md) is the privacy policy's text. Screenshots and the
three URLs are the work left. The URLs are mandatory and must resolve to
hosted pages, so `PRIVACY.md` needs somewhere to live that is not a GitHub blob
URL if Google objects to one — GitHub Pages off this repository is the cheapest
answer, and it covers the support and terms URLs too.

### 5. Submit

Submit from the SDK once every required field is saved. A domain-internal
listing goes live immediately; a public one waits on review, plus OAuth
verification for the `documents` scope.

There is no code-signing step — Apps Script code is not signed. What users see
is the consent screen, which is why the scope list should stay as narrow as it
is.

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

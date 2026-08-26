# Stylist

<img src="assets/icon-128.png" alt="" width="72" align="right">

Fine-grained format configuration for Google Docs.

A Google Docs editor add-on that opens a sidebar exposing, in one place, every
formatting control the Google Docs API actually offers: page geometry and
margins in pt/in/cm/mm, the full definitions of all nine named text styles, list
and bullet configuration, header/footer/footnote styling, table formatting, and
saveable/exportable style presets.

Edits apply live. Any field commits as soon as it loses focus or you press Tab
or Enter, provided the value is valid; an invalid value is highlighted and never
sent.

It reads as well as writes. Every field is filled from the document's actual
formatting each time the sidebar opens, so what you see is what the document
currently is, not a blank form. Where an editor covers content that is not
uniform — "all footnotes" when the footnotes differ, or every cell of a table
when the cells differ — the fields that disagree are left blank and named
above the editor, rather than one value being picked arbitrarily.

It stays in step with the document. Change formatting in Docs while the sidebar
is open and the fields follow within a few seconds, without disturbing whatever
you are editing, and without losing your scroll position or expanded rows.

## Install

Stylist is not on the Marketplace yet, so you install it into your own Google
account. Fifteen minutes, and you need [Node.js](https://nodejs.org).

### 1. Get the code onto Google's servers

```bash
npm i -g @google/clasp
git clone https://github.com/lukehutch/stylist.git
cd stylist
clasp login
clasp create-script --type standalone --title "Stylist" --rootDir src
clasp push --force
```

`clasp login` opens a browser to authorise clasp against your Google account.
`create-script` makes the script project and writes `.clasp.json`, which every
later `clasp` command reads. `push` uploads `src/`.

To use a script project you already have, skip `create-script`: copy
`.clasp.json.example` to `.clasp.json` and paste in its script id, from
**Project Settings (⚙) → IDs → Script ID** in the Apps Script editor.

### 2. Install it into a document

```bash
clasp open-script
```

That opens the Apps Script editor in your browser. In it:

1. **Deploy → Test deployments**.
2. Next to **Select type**, click the gear (**Enable deployment types**) and
   tick **Editor add-on**.
3. Click **Create new test**.
4. Leave the code version as **Latest Code**.
5. Under **Config**, choose the authorisation state — **Installed and enabled**.
6. Under **Test document**, click **No document selected**, pick a Google Doc
   to try it in, and click **Insert**.
7. Click **Save test**, select the test's radio button, and click **Execute**.

Your document opens in a new tab. Choose **Extensions → Stylist → Open format
editor** and click **OK** at *Authorization required*.

Google then shows **"Google hasn't verified this app"**, naming your own email
as the developer. That is expected and it is not a refusal: the app is your own
script, and Google only verifies apps that are distributed to other people.
Click **Show advanced**. That reveals *"Continue only if you understand the
risks and trust the developer"* — naming your own address — and a **Go to
Stylist (unsafe)** link. Click it, then **Allow**.

Stylist asks to see and edit the documents you open it in, and to show a
sidebar. Nothing else, and the consent screen should list exactly the two
scopes in `src/appsscript.json`; if it asks for more, something other than this
code got pushed.

You will see that screen once. If you would rather not see it at all, that
means publishing the add-on and passing Google's OAuth review, which is
[DEV.md](DEV.md#publishing) territory and takes weeks.

The test deployment runs the latest code you pushed, so after any later
`clasp push` just reload the document.

### 3. Use your own Cloud project (optional)

Skip this unless you intend to run `npm run test:live` or publish the add-on;
everything above works without it. **The switch cannot be undone**, and it
forces everyone who has authorised the script to authorise it again.

The consent screen has to exist before anything else will accept the project:
the Cloud console refuses to create an OAuth client without one, and Apps
Script refuses to link to it. So it comes second, and everything that depends
on it comes after.

1. In the [Cloud console](https://console.cloud.google.com/cloud-resource-manager),
   open or create a project, then **More (⋮) → Project settings**, and copy the
   **Project number** (digits only — not the Project ID).
2. Fill in the **OAuth consent screen** for that project, adding yourself under
   **Audience → Test users**. Both of the steps below are refused until this
   is done, as is creating the OAuth client the live suite needs.
3. Enable the **Google Docs API** in that project — advanced services do not
   carry over from the default project, and Stylist will not run without it.
4. In the Apps Script editor: **Project Settings (⚙) → Google Cloud Project →
   Change project**, paste the number, **Set project**.

On a personal Google account **External** is the only user type on offer —
**Internal** needs a Workspace domain — and an External app starts in
**Testing**, which carries two limits worth knowing before you get caught by
them. It admits at most 100 named test users. And it has Google revoke its
refresh tokens after **seven days**, so the `clasp login` the live suite runs
on has to be repeated about weekly; the symptom is `npm run test:live` failing
with `invalid_grant: Token has been expired or revoked`, which says nothing
about your script and means only that the token aged out.

Until the app is verified, everyone authorising it sees the *"Google hasn't
verified this app"* screen described above. Verification is a real requirement
if you ever distribute it: `.../auth/documents` is a **sensitive** scope, so
Google asks for a written justification per scope and a video of the consent
flow and the data being used. It is not a **restricted** scope — those are the
wide Drive and Gmail ones — so the annual third-party security assessment that
restricted scopes carry does not apply here.

### If a command fails

| Message | Fix |
|---|---|
| `Script ID not set, unable to open IDE.` | No `.clasp.json` — run `create-script`, or copy `.clasp.json.example` and paste your script id in. |
| `A file with this name already exists in the current project: appsscript` | `create-script` left a stub at `src/src/appsscript.json`. `rm -rf src/src`, push again. |
| `We're sorry, a server error occurred while reading from storage.` | Reload the document; if it persists, the script and its Cloud project are out of step — re-check that the Google Docs API is enabled in that project. |
| `Access blocked: Stylist has not completed the Google verification process` — with no **Advanced** link | Different from the warning above, and a real block. Your Cloud project's OAuth consent screen is in **Testing** but your account is not on its test-user list. Add yourself under **Audience → Test users**. |

## The eight tabs

| Tab | What it configures |
|---|---|
| **Page** | Page size (10 presets or custom W×H), a button to switch between portrait and landscape, and the page margins — one box while all four agree, four when they do not (and a default rather than the last word, in a document whose sections set their own). Page-number start, paged/pageless mode, page background. |
| **Text** | All nine named styles — Normal text, Title, Subtitle, Heading 1–6. Each opens a full editor: font family, weight 100–900, size, bold/italic/underline/strikethrough/small-caps, superscript/subscript, text and highlight colour; alignment, line spacing, space above/below, spacing mode, left/right/first-line indents, direction, keep-lines-together, keep-with-next, widow/orphan control, page-break-before, shading, and all five paragraph borders (width, padding, colour, dash). Below them, a second list of your own custom styles, applied to whatever you have selected. |
| **Lists** | The list your cursor is in, bulleted or numbered, or all of them grouped by kind when the cursor is elsewhere. Each nesting level shows its own marker; click it for the 15 presets, offered as the characters they are, or for "no marker" — which takes the markers off that one level. Style each level's indentation, spacing and text. Set **Apply to → All lists** to send every later change to all of them; a separate button brings every list into line with the one on screen. |
| **Sections** | The section your cursor is in: section margins and orientation, offered exactly as the Page tab offers them, plus column count/width/gap, column separators and section page numbering. **Apply to** works the same way it does for lists. Header and footer margins and "different first page" live on the Headers & footers tab instead, beside the headers they govern. |
| **Headers & footers** | A style editor over whichever headers and footers you name. Two menus set that: which sections (only shown when the tab has more than one) and which side of the spread -- L pages, R pages or both. Everything below follows the same choice: the shared-with warning, the header and footer margins (written to that section or to all of them), the buttons that give a section its own header or footer or hand it back, and the list of individual headers and footers underneath. "Different first page" is here too, set one section at a time; "Different L/R pages" beside it is the one document-wide switch. |
| **Footnotes** | Style all footnote text at once, restyle every footnote callout mark in the document in one pass. Also converts footnotes to an emulated endnote section. |
| **Tables** | The table your cursor is in, or all of them listed: cell padding, borders, fill and vertical alignment (all cells or header row); row minimum height, header row, prevent-overflow; column width and sizing mode; pinned header rows. **Apply to** works the same way it does for lists. |
| **Presets** | Save the whole configuration under a name and re-apply it to any document. Save individual style presets and bind them to a named style. **Download** the lot as a JSON file — this tab's page setup and named styles together with every saved preset and style preset — for version control or to hand to someone else, and **Upload** one back: its presets merge into yours by name and its formatting is applied here. |

Units are chosen once in the top bar and every dimension field re-renders in
that unit immediately, with no server round trip. Values are always stored as
points, because `Dimension.unit` in the Docs API accepts only `PT`.

Documents with tabs are fully supported: pick the tab in the top bar, or set
**Apply to → All tabs** to write every tab at once, nested child tabs included.

## What the Docs API cannot do

Verified against the live v1 discovery document
(`https://docs.googleapis.com/$discovery/rest?version=v1`), not from memory.
These are product/API limits, not gaps in this add-on, and the sidebar states
each one where you would otherwise expect the control:

- **No custom named styles, and no way to add one to the Docs Styles menu.**
  `NamedStyleType` is a closed enum of nine values, there is no request to
  define a new one, and the Docs toolbar is not an add-on extension point, so
  no add-on can put a tenth entry beside Normal text / Title / Heading 1.
  Two things are possible instead, and both are implemented:
  - A **second style list inside the sidebar**, under the nine official styles.
    Save any style, then select text and click the style to apply it. This
    route goes through Apps Script's `DocumentApp`, which is the only API that
    can address the user's selection, and it carries font, size, bold, italic,
    underline, strikethrough, colours, super/subscript, alignment, line
    spacing, space above/below and all three indents. Weight, small caps,
    shading, borders and the keep/widow settings have no `DocumentApp`
    equivalent; the sidebar says so when a style contains one.
  - **Binding a saved style to one of the nine named styles**, which does put
    it on the real Docs Styles menu, and carries every attribute. Use a
    heading level you are not otherwise using.
- **No endnotes.** Nothing in the API model — checked field by field across every
  schema — refers to endnotes or footnote placement. Footnotes always render at
  the foot of the page holding their reference. The Notes tab therefore offers an
  emulated conversion that appends the footnote text as a numbered section.
- **No control over a footnote splitting across pages.** No such field exists.
  `keepLinesTogether` on footnote paragraphs is the only pagination hint that
  reaches footnote content, and it is a hint, not a guarantee. (`preventOverflow`
  on `TableRowStyle` is the one genuine page-break control in the whole API, and
  it applies only to table rows.)
- **No footnote numbering format** or per-section restart.
- **The number printed at the start of a footnote is not addressable.** It is
  drawn by the renderer and is not part of the footnote's content: no
  `ParagraphElement` type represents it, and `footnoteNumber` exists only on
  the inline `FootnoteReference` and is output-only. So the footnote-block
  number cannot be made non-superscript, cannot be given its own font or size,
  and cannot be followed by a configured `". "` or a fixed gap. Only the inline
  callout mark can be styled. Footnote paragraph spacing and hanging indents
  *are* fully settable — see below.
- **No style governs footnote callout marks.** `FootnoteReference` carries its
  own `TextStyle` and nothing in the API binds it to a `NamedStyleType`, so
  there is no style to edit once and have every callout follow. The Notes tab
  therefore offers the only thing that works: a one-off pass that rewrites the
  text style of every callout in the document — font family, weight, size,
  bold/italic/underline/strikethrough, small caps, super/subscript, colours.
  Character settings only; a callout is an inline element with no paragraph of
  its own. Footnotes you add later take the style of the text they are inserted
  into, so re-apply after adding some.
- **`pageBreakBefore` is rejected outside the document body.** The add-on
  strips it from header, footer and footnote writes rather than letting the
  whole batch fail, and tells you it did.
- **Tab stops are read-only.** `ParagraphStyle.tabStops` can be read but never
  written, so the gap between a footnote number and its text cannot be set with
  a tab stop.
- **Bullet glyphs are preset-only.** `NestingLevel` exposes `glyphSymbol`,
  `glyphFormat`, `startNumber` and `bulletAlignment` for reading, but there is no
  `updateListProperties` request. The only glyph write path is
  `createParagraphBullets` with one of 15 presets. Custom glyph characters and
  per-level number formats cannot be set programmatically. Indentation, spacing
  and text styling of each level *are* writable, and the add-on exposes them.
- **`useCustomHeaderFooterMargins` is read-only.** When a document has it off,
  `marginHeader`/`marginFooter` are accepted by the API but ignored by the
  renderer, and the API cannot switch it on. Set a header or footer margin once
  by hand (Format > Headers & footers) to enable it. The Headers & footers tab
  detects this and says so.
- **The cursor can say it is in a header, but not in which header.**
  DocumentApp models a document as having at most one header section, so the
  cursor probe reports header/footer/footnote and nothing finer -- the default,
  first-page and even-page headers are indistinguishable from it. That is why
  the Headers & footers tab asks which side of the spread you mean rather than
  working it out, and why it picks the section from the body paragraph the
  cursor is in rather than from the header itself.
- **Which header a section uses is read-only; whether it has its own is not.**
  Every `defaultHeaderId` and its first-page and even-page siblings, on both
  `DocumentStyle` and each `SectionStyle`, is documented read-only, so no
  request can point a section at an existing header. What *can* be done is
  `CreateHeader` with a `sectionBreakLocation`, which gives that section a
  header of its own, and `DeleteHeader`, which -- quoting the reference --
  means "the header of that type is now continued from the previous section".
  Those two are Docs' "link to previous", and they are what the two buttons on
  the Headers & footers tab do. `HeaderFooterType` has only `DEFAULT`, so
  breaking away gets a default header; a section that needs its own first-page
  or even-page one still has to get it from the Docs UI.
- **Header and footer margins are per section, but not per side.**
  `SectionStyle` carries `marginHeader` and `marginFooter`, so the tab can write
  them to one section or to all of them, exactly as it writes styling. There is
  no separate margin for left-hand and right-hand pages, so the L/R menu does
  not reach them.
- **Headers and footers link independently, but their variants do not.**
  A section can have its own header while its footer still continues the
  previous section's -- separate ids, separate requests. Within one kind the
  default, first-page and even-page ids belong to the section together, so
  handing the header back gives up all three at once.
- **"Different first page" is per section; "different even pages" is not.**
  `SectionStyle` carries `useFirstPageHeaderFooter`, but `useEvenPageHeaderFooter`
  exists only on `DocumentStyle`. Both switches sit on the Headers & footers
  tab: the first follows that tab's section menu, the second is labelled
  "Different L/R pages" to match the side menu beside it and covers the
  whole document.

## Footnote recipes

What the Notes tab can and cannot give you, concretely:

| Want | Possible? | How |
|---|---|---|
| Space above/below footnote paragraphs | Yes | Notes → All footnotes → Space above / Space below. Line spacing and spacing mode too. |
| Hanging indent, number outdented and wrapped lines aligned | Yes | Notes → All footnotes → set **Indent start** to the hanging width (e.g. 18pt) and **Indent first line** to the negative of it (−18pt). The auto number sits on the outdented first line; wrapped lines align at the indent. |
| A configurable gap between the number and the text | No | Tab stops are read-only and the number is not part of the content, so nothing sits between them to size. Approximating it by choosing the indent width is the only lever. |
| Footnote-block number in regular (non-superscript) type | No | It is renderer-drawn chrome, not content. |
| `". "` after the footnote number | No | Same reason. You can type it into each footnote by hand, but it lands *after* the auto number, giving `¹1. text`. |
| Callout mark superscript but small | Yes | Notes → Footnote reference marks. That styles the inline mark only, independently of the footnote text. |
| Keep a footnote from splitting across pages | Only as a hint | Notes → All footnotes → Keep lines together. Not a guarantee; no API field controls it. |

## Tests

```bash
npm test              # 120 tests, local, no network
npm run test:live     # push and run the suite inside Apps Script
```

The runner is [gapp-tester](https://github.com/lukehutch/gapp-tester), a
dependency-free test framework for Apps Script projects that was written for
this add-on and then split out. The same test format runs in both places.

The local suite loads the server files into a Node VM with `DocumentApp`,
`Docs`, `PropertiesService` and `HtmlService` mocked, and captures
`Docs.Documents.batchUpdate` instead of sending it — so each test asserts on the
exact request the add-on would issue. It covers unit conversion, colour mapping,
field-mask construction, tab and legacy-document resolution, segment range
arithmetic, list range merging, table request shapes, the back-to-front ordering
of the endnote conversion, custom-style application to a selection, the read-back
that fills the fields (including how disagreeing values are reported as mixed),
preset export/import round-tripping, and the sidebar's browser JavaScript —
every element id it reaches for must exist in the template.

The suite is mutation-checked: breaking the named-style field mask, reversing
the endnote rewrite order, corrupting the cm conversion factor, or removing the
sidebar's guard against refreshing a field you are typing in each turn it red.

**These tests cover logic, not Google's runtime.** They cannot prove the Docs
API accepts a given request. That is what `src/LiveTests.js` is for: pick
`gappRunInGas` in the Apps Script editor and press Run. It executes against the
open document, exercising the real API —
including the named-style field mask, the likeliest thing to be wrong — and
prints a TAP report. Every write it makes re-asserts values the document
already has, so a passing run changes nothing. DEV.md scores this approach
against every other option in
[How to unit test Google Apps Scripts](https://stackoverflow.com/questions/15682346/how-to-unit-test-google-apps-scripts),
and links to Google's own
[Testing Workspace add-ons](https://developers.google.com/workspace/add-ons/how-tos/testing-workspace-addons)
guidance.

## Layout

```
src/appsscript.json   manifest: Docs advanced service + OAuth scopes
src/Code.js           entry points, aggregate load for the sidebar
src/Units.js          pt/in/cm/mm conversion, colour mapping
src/DocModel.js       document fetch, tab resolution, style <-> UI conversion
src/PageFormat.js     document style and section style
src/NamedStyles.js    the nine named styles
src/Segments.js       headers, footers, footnotes
src/Bullets.js        lists and bullet presets
src/Tables.js         table, row, column and cell formatting
src/Footnotes.js      footnote capabilities and endnote emulation
src/Presets.js        saved presets, JSON export/import
src/CustomStyles.js   custom styles applied to the current selection
src/LiveTests.js      the suite that runs inside Apps Script, against the API
src/GappTester.js     gapp-tester's runtime core (copied in, not hand-edited)
src/Sidebar.html      sidebar template
src/Stylesheet.html   sidebar styles
src/JavaScript.html   sidebar behaviour, live apply, all six panels
assets/               add-on icon (see DEV.md for where each size goes)
test/                 the local suites and their mocks
gapp.config.json      which files load, and where the suites are
```

`DEV.md` covers running the tests, the Apps Script test deployment, and
publishing to the Google Workspace Marketplace.

## Design note

This is an Editor Add-on (menu plus `HtmlService` sidebar) rather than a
CardService Google Workspace Add-on. The editor needs tabbed navigation, dozens
of numeric fields with live unit switching, colour inputs and per-field live
apply, which CardService cannot express. The trade-off is that it runs in Docs
only — which is the whole scope of the tool.

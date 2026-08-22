# gdoc-format-config

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

It stays in step with the document. Apps Script has no edit trigger for Docs,
so the sidebar polls every five seconds: if you change formatting in Docs while
it is open, the fields follow. A refresh never takes text out from under you —
while the focus is in any field, the refresh is held (the status line says so)
and applied the moment you leave it. Expanded rows and scroll position survive
a refresh.

## Install

Requires [clasp](https://github.com/google/clasp) (`npm i -g @google/clasp`).

```bash
clasp login
clasp create-script --type standalone --title "Doc Format Config" --rootDir src
clasp push
clasp open-script
```

`--type standalone`, not `--type docs`: an editor add-on is not bound to one
document, and a test deployment makes you pick the document to try it in. A
bound script would leave you with a stray Doc you never open.

`create-script` writes `.clasp.json` in the project root, holding the script id
it just created and `"rootDir": "src"`. That file is what every later `clasp`
command reads — without it you get *"Script ID not set"*. It is gitignored,
because the id is specific to your copy.

To attach to a script project you already have, skip `create-script`: copy
`.clasp.json.example` to `.clasp.json`, paste in its script id, then
`clasp push`. The id is in the Apps Script editor under **Project Settings (⚙)
→ IDs → Script ID**, or in the editor URL between `/projects/` and `/edit`.

In the Apps Script editor: **Deploy > Test deployments > Install**, then open any
Google Doc and choose **Extensions > Doc Format Config > Open format editor**.

The Docs advanced service and the required OAuth scopes are already declared in
`src/appsscript.json`; the first run prompts for authorisation.

## The six tabs

| Tab | What it configures |
|---|---|
| **Page** | Page size (10 presets or custom W×H), landscape, all four page margins, header and footer margins, page-number start, paged/pageless mode, page background. Plus a per-section editor: section margins, column count/width/gap, column separators, section page numbering, per-section first-page header/footer. |
| **Text** | All nine named styles — Normal text, Title, Subtitle, Heading 1–6. Each opens a full editor: font family, weight 100–900, size, bold/italic/underline/strikethrough/small-caps, superscript/subscript, text and highlight colour; alignment, line spacing, space above/below, spacing mode, left/right/first-line indents, direction, keep-lines-together, keep-with-next, widow/orphan control, page-break-before, shading, and all five paragraph borders (width, padding, colour, dash). Below them, a second list of your own custom styles, applied to whatever you have selected. |
| **Bullets** | Every list in the document with its per-nesting-level detail. Apply any of the 15 glyph presets, remove bullets, and style each nesting level's indentation, spacing and text. |
| **Notes** | Style all footnote text at once, restyle every footnote callout mark in the document in one pass, style all headers and all footers, or drill into any individual segment. Also converts footnotes to an emulated endnote section. |
| **Tables** | Per table: cell padding, borders, fill and vertical alignment (all cells or header row); row minimum height, header row, prevent-overflow; column width and sizing mode; pinned header rows. |
| **Presets** | Save the whole configuration under a name and re-apply it to any document. Save individual style presets and bind them to a named style. Export/import the configuration as JSON for version control. |

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
  by hand (Format > Headers & footers) to enable it. The Page tab detects this
  and says so.

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

/**
 * What the add-on does, checked locally.
 *
 * Every test here asserts on the exact Docs API request the add-on would
 * issue: batchUpdate is captured rather than sent, so a field mask, a
 * range or an ordering can be checked without a document, a network or a
 * quota. What it cannot check is whether Google accepts those requests --
 * that is src/LiveTests.js, run with `gapp-test live`.
 */
const assert = require('assert');
const { makeSandbox, allRequests } = require('./harness');
const { makeDoc, makeLegacyDoc } = require('./fixture');

module.exports = ({ suite, test }) => {

const S = makeSandbox(makeDoc());
const L = makeSandbox(makeLegacyDoc());

/* ------------------------------------------------------------------ */
suite('Unit conversion');

test('inch/cm/mm to points', (t) => {
  t.near(S.toPt_(1, 'IN'), 72);
  t.near(S.toPt_(1, 'CM'), 28.346456692913385);
  t.near(S.toPt_(1, 'MM'), 2.8346456692913385);
  t.near(S.toPt_(1, 'PT'), 1);
});

test('points back to each unit', (t) => {
  t.near(S.fromPt_(72, 'IN'), 1);
  t.near(S.fromPt_(28.346456692913385, 'CM'), 1, 1e-4);
  t.near(S.fromPt_(2.8346456692913385, 'MM'), 1, 1e-4);
});

test('round trip survives all four units', (t) => {
  ['PT', 'IN', 'CM', 'MM'].forEach(u => {
    t.near(S.fromPt_(S.toPt_(3.75, u), u), 3.75, 1e-4, u);
  });
});

test('unknown unit is rejected rather than silently treated as points', (t) => {
  t.throws(() => S.toPt_(1, 'PARSEC'), /Unsupported unit/);
});

test('empty and null magnitudes stay empty', (t) => {
  t.equal(S.toPt_('', 'IN'), null);
  t.equal(S.toPt_(null, 'IN'), null);
});

test('Dimension always carries unit PT, the only unit the API accepts', (t) => {
  t.deepEqual(S.ptDim_(42), { magnitude: 42, unit: 'PT' });
});

/* ------------------------------------------------------------------ */
suite('Colour mapping');

test('hex to rgb and back', (t) => {
  const c = S.hexToColor_('#336699');
  t.near(c.color.rgbColor.red, 0x33 / 255);
  t.equal(S.colorToHex_(c), '#336699');
});

test('omitted proto3 channels read as zero, not as unset', (t) => {
  // The API omits channels equal to 0, so {blue: 1} means pure blue.
  t.equal(S.colorToHex_({ color: { rgbColor: { blue: 1 } } }), '#0000ff');
});

test('empty colour means transparent, distinct from black', (t) => {
  t.deepEqual(S.hexToColor_(''), {});
  t.equal(S.colorToHex_({}), null);
});

test('malformed hex is rejected', (t) => {
  t.throws(() => S.hexToColor_('nope'), /Not a #rrggbb/);
});

/* ------------------------------------------------------------------ */
suite('Style conversion');

test('sparse text style emits only the touched fields', (t) => {
  const r = S.uiToTextStyle_({ bold: true });
  t.deepEqual(r.fields, ['bold']);
  t.deepEqual(r.style, { bold: true });
});

test('font weight snaps to a legal multiple of 100 within 100-900', (t) => {
  t.equal(S.uiToTextStyle_({ fontFamily: 'Arial', fontWeight: 437 }).style.weightedFontFamily.weight, 400);
  t.equal(S.uiToTextStyle_({ fontFamily: 'Arial', fontWeight: 5000 }).style.weightedFontFamily.weight, 900);
  t.equal(S.uiToTextStyle_({ fontFamily: 'Arial', fontWeight: 1 }).style.weightedFontFamily.weight, 100);
});

test('paragraph dimensions are converted to PT Dimensions', (t) => {
  const r = S.uiToParagraphStyle_({ spaceAbovePt: 18, indentStartPt: 36 });
  t.deepEqual(r.style.spaceAbove, { magnitude: 18, unit: 'PT' });
  t.deepEqual(r.fields.sort(), ['indentStart', 'spaceAbove']);
});

test('reading a named style round-trips through the UI shape', (t) => {
  const styles = S.readNamedStyles(null).styles;
  const h1 = styles.filter(s => s.namedStyleType === 'HEADING_1')[0];
  t.equal(h1.textStyle.fontFamily, 'Georgia');
  t.equal(h1.textStyle.fontSizePt, 20);
  t.equal(h1.textStyle.bold, true);
  t.equal(h1.paragraphStyle.spaceAbovePt, 18);
  t.equal(h1.paragraphStyle.keepWithNext, true);
});

/* ------------------------------------------------------------------ */
suite('Named style field mask');

test('mask carries namedStyleType plus BOTH parent and leaf paths', (t) => {
  // The API reference is explicit: updating bold needs "text_style" AND
  // "text_style.bold". Leaf-only masks silently no-op.
  const m = S.namedStyleFieldMask_(['bold'], ['alignment']);
  const parts = m.split(',');
  t.ok(parts.indexOf('namedStyleType') >= 0, 'namedStyleType required');
  t.ok(parts.indexOf('textStyle') >= 0, 'parent textStyle required');
  t.ok(parts.indexOf('textStyle.bold') >= 0);
  t.ok(parts.indexOf('paragraphStyle') >= 0);
  t.ok(parts.indexOf('paragraphStyle.alignment') >= 0);
});

test('a group with no fields contributes no path', (t) => {
  const m = S.namedStyleFieldMask_(['bold'], []);
  t.ok(m.indexOf('paragraphStyle') === -1);
});

test('writeNamedStyle emits one updateNamedStyle carrying the tab id', (t) => {
  S.__reset();
  S.writeNamedStyle({ tabId: 't.0', namedStyleType: 'HEADING_1', textStyle: { bold: false } });
  const reqs = allRequests(S);
  t.equal(reqs.length, 1);
  t.equal(reqs[0].updateNamedStyle.namedStyle.namedStyleType, 'HEADING_1');
  t.equal(reqs[0].updateNamedStyle.tabId, 't.0');
  t.equal(reqs[0].updateNamedStyle.namedStyle.textStyle.bold, false);
});

test('scope "all" writes every tab including nested child tabs', (t) => {
  S.__reset();
  S.writeNamedStyle({ scope: 'all', namedStyleType: 'NORMAL_TEXT', textStyle: { italic: true } });
  const ids = allRequests(S).map(r => r.updateNamedStyle.tabId).sort();
  t.deepEqual(ids, ['t.0', 't.1']);
});

/* ------------------------------------------------------------------ */
suite('Page format');

test('margins are read back as points', (t) => {
  const pf = S.readPageFormat(null);
  t.equal(pf.marginTopPt, 72);
  t.equal(pf.pageWidthPt, 612);
});

test('a 1-inch margin typed by the user becomes 72pt in the request', (t) => {
  S.__reset();
  S.writePageFormat({ marginTopPt: S.toPt_(1, 'IN') });
  const r = allRequests(S)[0].updateDocumentStyle;
  t.deepEqual(r.documentStyle.marginTop, { magnitude: 72, unit: 'PT' });
  t.ok(r.fields.split(',').indexOf('marginTop') >= 0);
});

test('a 2.54cm margin equals the same 72pt', (t) => {
  S.__reset();
  S.writePageFormat({ marginLeftPt: S.toPt_(2.54, 'CM') });
  t.near(allRequests(S)[0].updateDocumentStyle.documentStyle.marginLeft.magnitude, 72, 1e-6);
});

test('header margin write warns while useCustomHeaderFooterMargins is off', (t) => {
  S.__reset();
  const res = S.writePageFormat({ marginHeaderPt: 24 });
  t.ok(res.warnings.some(w => /read-only/.test(w)),
    'expected a warning that the flag is read-only, got: ' + JSON.stringify(res.warnings));
});

test('pageless mode warns that page geometry stops rendering', (t) => {
  S.__reset();
  const res = S.writePageFormat({ documentMode: 'PAGELESS' });
  t.ok(res.warnings.some(w => /pageless/i.test(w)));
});

test('no fields set produces no request at all', (t) => {
  S.__reset();
  const res = S.writePageFormat({});
  t.equal(res.applied, 0);
  t.equal(allRequests(S).length, 0);
});

/* ------------------------------------------------------------------ */
suite('Legacy (pre-tabs) documents');

test('a document without tabs still resolves its body and styles', (t) => {
  const pf = L.readPageFormat(null);
  t.equal(pf.tabId, null);
  t.equal(pf.marginTopPt, 72);
});

test('requests for a legacy document omit tabId entirely', (t) => {
  L.__reset();
  L.writeNamedStyle({ namedStyleType: 'NORMAL_TEXT', textStyle: { bold: true } });
  const req = allRequests(L)[0].updateNamedStyle;
  t.ok(!('tabId' in req), 'legacy requests must not carry a tabId');
});

/* ------------------------------------------------------------------ */
suite('Segments: headers, footers, footnotes');

test('segment enumeration finds every segment and its role', (t) => {
  const s = S.readSegments(null);
  t.equal(s.headers.length, 1);
  t.equal(s.headers[0].role, 'Default header');
  t.equal(s.footnotes.length, 2);
  t.equal(s.footnoteReferenceCount, 2);
});

test('an empty segment is flagged rather than styled', (t) => {
  const s = S.readSegments(null);
  t.equal(s.footers[0].empty, true, 'the fixture footer is a single empty paragraph');
});

test('segment range stops short of the untouchable trailing newline', (t) => {
  const r = S.segmentRange_([{ startIndex: 0, endIndex: 15 }]);
  t.deepEqual(r, { startIndex: 0, endIndex: 14 });
});

test('empty segment yields no range', (t) => {
  t.equal(S.segmentRange_([{ startIndex: 0, endIndex: 1 }]), null);
});

test('styling all footnotes targets each footnote by segmentId', (t) => {
  S.__reset();
  const res = S.writeSegmentStyle({ target: 'footnotes', textStyle: { fontSizePt: 9 } });
  const reqs = allRequests(S);
  t.equal(res.segments, 2);
  const ids = reqs.map(r => r.updateTextStyle.range.segmentId).sort();
  t.deepEqual(ids, ['fn.1', 'fn.2']);
  t.equal(reqs[0].updateTextStyle.textStyle.fontSize.magnitude, 9);
});

test('choosing "Inherited" resets a property instead of writing a value', (t) => {
  const r = S.uiToParagraphStyle_({ alignment: null, spacingMode: null, direction: null });
  t.deepEqual(r.fields.sort(), ['alignment', 'direction', 'spacingMode']);
  t.deepEqual(r.style, {}, 'the mask names the fields, the message leaves them unset');

  const rt = S.uiToTextStyle_({ baselineOffset: null });
  t.deepEqual(rt.fields, ['baselineOffset']);
  t.deepEqual(rt.style, {});
});

test('a property nobody touched is still left out of the mask entirely', (t) => {
  const r = S.uiToParagraphStyle_({ alignment: 'CENTER' });
  t.deepEqual(r.fields, ['alignment']);
  t.equal(r.style.alignment, 'CENTER');
});

test('a reset reaches the document as a real request', (t) => {
  S.__reset();
  S.writeSegmentStyle({ target: 'footnotes', paragraphStyle: { alignment: null } });
  const reqs = allRequests(S).filter(r => r.updateParagraphStyle);
  t.ok(reqs.length > 0);
  t.equal(reqs[0].updateParagraphStyle.fields, 'alignment');
  t.notOk('alignment' in reqs[0].updateParagraphStyle.paragraphStyle);
});

test('styling all footnotes writes only the settings that were changed', (t) => {
  S.__reset();
  S.writeSegmentStyle({ target: 'footnotes', textStyle: { fontSizePt: 9 } });
  const reqs = allRequests(S);
  t.ok(reqs.length > 0);
  reqs.forEach((r) => {
    t.equal(r.updateTextStyle.fields, 'fontSize',
      'the mask names fontSize alone, so an italic run inside a footnote stays italic');
    t.deepEqual(Object.keys(r.updateTextStyle.textStyle), ['fontSize']);
    t.notOk(r.updateParagraphStyle, 'and nothing is written at paragraph level');
  });
});

test('keepLinesTogether reaches footnote paragraphs', (t) => {
  S.__reset();
  S.writeSegmentStyle({ target: 'footnotes', paragraphStyle: { keepLinesTogether: true } });
  const reqs = allRequests(S).filter(r => r.updateParagraphStyle);
  t.equal(reqs.length, 2);
  t.equal(reqs[0].updateParagraphStyle.paragraphStyle.keepLinesTogether, true);
});

test('footnote reference marks are styled inline, and paragraph input is refused', (t) => {
  S.__reset();
  const res = S.writeSegmentStyle({
    target: 'footnoteRefs',
    textStyle: { baselineOffset: 'SUPERSCRIPT' },
    paragraphStyle: { alignment: 'CENTER' }
  });
  const reqs = allRequests(S);
  t.ok(reqs.every(r => !!r.updateTextStyle), 'only text style applies to inline marks');
  t.equal(reqs.length, 2);
  t.ok(res.warnings.some(w => /inline text/.test(w)));
});

test('an empty style change issues nothing', (t) => {
  S.__reset();
  const res = S.writeSegmentStyle({ target: 'footnotes' });
  t.equal(res.applied, 0);
  t.equal(allRequests(S).length, 0);
});

/* ------------------------------------------------------------------ */
suite('Lists and bullets');

test('every nesting level is read, including read-only glyph detail', (t) => {
  const l = S.readLists(null).lists[0];
  t.equal(l.listId, 'list.1');
  t.equal(l.itemCount, 2);
  t.equal(l.levels[0].glyphSymbol, '●');
  t.equal(l.levels[0].indentStartPt, 36);
  t.equal(l.levels[0].inUse, true);
});

test('adjacent list paragraphs merge into one range', (t) => {
  const merged = S.mergeRanges_([
    { startIndex: 30, endIndex: 40 }, { startIndex: 40, endIndex: 50 }
  ]);
  t.deepEqual(merged, [{ startIndex: 30, endIndex: 50 }]);
});

test('non-adjacent paragraphs stay separate ranges', (t) => {
  const merged = S.mergeRanges_([
    { startIndex: 0, endIndex: 10 }, { startIndex: 20, endIndex: 30 }
  ]);
  t.equal(merged.length, 2);
});

test('applying a preset issues createParagraphBullets over the list range', (t) => {
  S.__reset();
  S.applyBulletPreset({ listId: 'list.1', bulletPreset: 'BULLET_CHECKBOX' });
  const r = allRequests(S)[0].createParagraphBullets;
  t.equal(r.bulletPreset, 'BULLET_CHECKBOX');
  t.deepEqual({ s: r.range.startIndex, e: r.range.endIndex }, { s: 30, e: 50 });
});

test('styling one nesting level only touches that level', (t) => {
  S.__reset();
  S.writeListLevelStyle({ listId: 'list.1', level: 1, textStyle: { italic: true } });
  const r = allRequests(S)[0].updateTextStyle;
  t.deepEqual({ s: r.range.startIndex, e: r.range.endIndex }, { s: 40, e: 50 });
});

test('a level with no items reports rather than issuing a request', (t) => {
  S.__reset();
  const res = S.writeListLevelStyle({ listId: 'list.1', level: 5, textStyle: { italic: true } });
  t.equal(res.applied, 0);
  t.ok(res.warnings.some(w => /No list items/.test(w)));
});

/* ------------------------------------------------------------------ */
suite('Tables');

test('tables are found with their geometry and header row', (t) => {
  const tbl = S.readTables(null).tables[0];
  t.equal(tbl.rows, 2);
  t.equal(tbl.columns, 3);
  t.equal(tbl.headerRow, true);
  t.equal(tbl.startIndex, 70);
});

/* A body whose children are the given types, with a working getChildIndex. */
function fakeBody(types) {
  const children = types.map((type, i) => {
    const node = {
      getType: () => type,
      getParent: () => body,
      __i: i
    };
    return node;
  });
  const body = {
    getType: () => 'BODY_SECTION',
    getParent: () => null,
    getNumChildren: () => children.length,
    getChild: (i) => children[i],
    getChildIndex: (c) => c.__i
  };
  body.__children = children;
  return body;
}

test('the table the cursor sits in is reported by its position in the body', (t) => {
  S.__reset();
  const body = fakeBody(['PARAGRAPH', 'TABLE', 'PARAGRAPH']);
  S.__body = body;
  const cell = { getType: () => 'TABLE_CELL', getParent: () => body.__children[1] };
  S.__cursor = { getElement: () => cell };

  t.equal(S.readTables(null).activeIndex, 0, 'the fixture has exactly one table');
});

test('a cursor outside any table selects none', (t) => {
  S.__reset();
  const body = fakeBody(['PARAGRAPH', 'TABLE', 'PARAGRAPH']);
  S.__body = body;
  S.__cursor = { getElement: () => body.__children[0] };
  t.equal(S.readTables(null).activeIndex, null);
});

test('a body that disagrees about how many tables there are is not trusted', (t) => {
  // DocumentApp reads the document's own active tab, which need not be the tab
  // the sidebar is showing. A differing count means they have diverged.
  S.__reset();
  const body = fakeBody(['TABLE', 'TABLE']);
  S.__body = body;
  S.__cursor = { getElement: () => body.__children[0] };
  t.equal(S.readTables(null).activeIndex, null);
});

test('no cursor at all is not an error', (t) => {
  S.__reset();
  S.__body = null;
  S.__cursor = null;
  t.equal(S.readTables(null).activeIndex, null);
});

test('cell styling without a range targets every cell in the table', (t) => {
  S.__reset();
  S.writeTableFormat({ startIndex: 70, cell: { paddingTopPt: 5 }, applyCellsTo: 'all' });
  const r = allRequests(S)[0].updateTableCellStyle;
  t.equal(r.tableStartLocation.index, 70);
  t.ok(!r.tableRange, 'omitting tableRange is what selects all cells');
});

test('header-row styling uses a tableRange spanning the columns', (t) => {
  S.__reset();
  S.writeTableFormat({ startIndex: 70, columnCount: 3, cell: { paddingTopPt: 5 }, applyCellsTo: 'headerRow' });
  const r = allRequests(S)[0].updateTableCellStyle;
  t.equal(r.tableRange.rowSpan, 1);
  t.equal(r.tableRange.columnSpan, 3);
});

test('a fixed column width implies FIXED_WIDTH sizing', (t) => {
  S.__reset();
  S.writeTableFormat({ startIndex: 70, columns: { widthPt: 120 } });
  const r = allRequests(S)[0].updateTableColumnProperties;
  t.equal(r.tableColumnProperties.widthType, 'FIXED_WIDTH');
});

test('preventOverflow, the only page-break control in the API, is wired', (t) => {
  S.__reset();
  S.writeTableFormat({ startIndex: 70, rows: { preventOverflow: true } });
  const r = allRequests(S)[0].updateTableRowStyle;
  t.equal(r.tableRowStyle.preventOverflow, true);
  t.ok(r.fields.indexOf('preventOverflow') >= 0);
});

/* ------------------------------------------------------------------ */
suite('Footnotes and emulated endnotes');

test('capabilities report the real API limits, not wishful ones', (t) => {
  const c = S.footnoteCapabilities();
  t.equal(c.endnotesSupported, false);
  t.equal(c.pageBreakControlSupported, false);
});

test('footnotes are listed in body order with their text', (t) => {
  const f = S.readFootnotes(null);
  t.deepEqual(f.footnotes.map(x => x.footnoteId), ['fn.1', 'fn.2']);
  t.equal(f.footnotes[0].preview, 'First footnote');
});

test('copy mode appends a Notes section and deletes nothing', (t) => {
  S.__reset();
  const res = S.convertFootnotesToEndnotes({ mode: 'copy', heading: 'Notes' });
  const reqs = allRequests(S);
  t.ok(reqs.every(r => !r.deleteContentRange), 'copy mode must not delete');
  const text = reqs[0].insertText.text;
  t.ok(/Notes/.test(text) && /First footnote/.test(text) && /Second footnote/.test(text));
  t.equal(res.converted, 2);
});

test('convert mode rewrites references back-to-front so indices stay valid', (t) => {
  S.__reset();
  S.convertFootnotesToEndnotes({ mode: 'convert', heading: 'Notes' });
  const deletes = allRequests(S).filter(r => r.deleteContentRange)
    .map(r => r.deleteContentRange.range.startIndex);
  // fn.2 is at index 60, fn.1 at 20: the later one must be edited first,
  // otherwise the first edit shifts the second reference's indices.
  t.deepEqual(deletes, [60, 20]);
});

test('convert mode leaves a superscript marker where each reference was', (t) => {
  S.__reset();
  S.convertFootnotesToEndnotes({ mode: 'convert' });
  const reqs = allRequests(S);
  const ins = reqs.filter(r => r.insertText && r.insertText.location);
  t.equal(ins.length, 2);
  const sup = reqs.filter(r => r.updateTextStyle &&
    r.updateTextStyle.textStyle.baselineOffset === 'SUPERSCRIPT');
  t.equal(sup.length, 2);
});

test('a document with no footnotes is reported, not crashed', (t) => {
  const empty = makeSandbox({ title: 'x', body: { content: [] }, footnotes: {} });
  const res = empty.convertFootnotesToEndnotes({ mode: 'copy' });
  t.equal(res.applied, 0);
  t.ok(res.warnings.some(w => /no footnotes/i.test(w)));
});

/* ------------------------------------------------------------------ */
suite('Presets and round-tripping a configuration');

test('export captures page setup and all nine named styles', (t) => {
  const cfg = S.exportConfig(null);
  t.equal(cfg.namedStyles.length, 9);
  t.equal(cfg.pageFormat.marginTopPt, 72);
});

test('export then import reproduces the same values', (t) => {
  const cfg = S.exportConfig(null);
  S.__reset();
  S.importConfig({ config: cfg });
  const ds = allRequests(S).filter(r => r.updateDocumentStyle)[0].updateDocumentStyle;
  t.deepEqual(ds.documentStyle.marginTop, { magnitude: 72, unit: 'PT' });
});

test('import never echoes the read-only useCustomHeaderFooterMargins back', (t) => {
  const cfg = S.exportConfig(null);
  t.equal(cfg.pageFormat.useCustomHeaderFooterMargins, false);
  S.__reset();
  S.importConfig({ config: cfg });
  allRequests(S).filter(r => r.updateDocumentStyle).forEach(r => {
    t.ok(r.updateDocumentStyle.fields.indexOf('useCustomHeaderFooterMargins') === -1,
      'sending a read-only field would make the API reject the batch');
    t.ok(!('useCustomHeaderFooterMargins' in r.updateDocumentStyle.documentStyle));
  });
});

test('import accepts a JSON string as well as an object', (t) => {
  const cfg = JSON.stringify(S.exportConfig(null));
  S.__reset();
  const res = S.importConfig({ config: cfg });
  t.ok(res.applied > 0);
});

test('invalid JSON produces a clear message', (t) => {
  t.throws(() => S.importConfig({ config: '{ nope' }), /not valid JSON/);
});

test('style presets save, list and bind to a named style', (t) => {
  S.saveStylePreset({ name: 'Callout', textStyle: { bold: true, fontSizePt: 12 } });
  const list = S.listStylePresets();
  t.equal(list.length, 1);
  t.equal(list[0].name, 'Callout');

  S.__reset();
  S.applyStylePresetToNamedStyle({ name: 'Callout', namedStyleType: 'HEADING_6' });
  const r = allRequests(S)[0].updateNamedStyle;
  t.equal(r.namedStyle.namedStyleType, 'HEADING_6');
  t.equal(r.namedStyle.textStyle.bold, true);
});

test('a new user gets default custom styles', (t) => {
  const N = makeSandbox(makeDoc());
  const names = N.listStylePresets().map(p => p.name);
  t.ok(names.indexOf('Source code') >= 0, 'Source code is there: ' + names.join(', '));
  t.ok(names.length >= 3);
  const code = N.listStylePresets().filter(p => p.name === 'Source code')[0];
  t.equal(code.textStyle.fontFamily, 'Courier New');
  t.equal(code.paragraphStyle.shadingColor, '#f1f3f4');
});

test('defaults are real stored styles, not a display-only list', (t) => {
  const N = makeSandbox(makeDoc());
  N.listStylePresets();
  N.applyStylePresetToNamedStyle({ name: 'Source code', namedStyleType: 'HEADING_6' });
  const r = allRequests(N)[0].updateNamedStyle;
  t.equal(r.namedStyle.textStyle.weightedFontFamily.fontFamily, 'Courier New');
  t.ok(r.namedStyle.paragraphStyle.shading, 'the grey box travels too');
});

test('a user who already has styles is not given the defaults', (t) => {
  const N = makeSandbox(makeDoc());
  N.saveStylePreset({ name: 'Mine', textStyle: { bold: true } });
  const names = N.listStylePresets().map(p => p.name);
  t.deepEqual(names, ['Mine']);
});

test('deleting a default keeps it deleted', (t) => {
  const N = makeSandbox(makeDoc());
  N.listStylePresets();
  N.deleteStylePreset({ name: 'Source code' });
  t.ok(N.listStylePresets().every(p => p.name !== 'Source code'));
});

test('deleting every default does not bring them back', (t) => {
  const N = makeSandbox(makeDoc());
  N.listStylePresets().forEach(p => N.deleteStylePreset({ name: p.name }));
  t.equal(N.listStylePresets().length, 0);
});

test('an unnamed preset is refused', (t) => {
  t.throws(() => S.saveStylePreset({ name: '  ' }), /Give the style a name/);
});

test('whole-document presets save and apply', (t) => {
  S.savePreset({ name: 'House style' });
  t.ok(S.listPresets().some(p => p.name === 'House style'));
  S.__reset();
  const res = S.applyPreset({ name: 'House style' });
  t.ok(res.applied > 0);
});

test('applying an unknown preset says so', (t) => {
  t.throws(() => S.applyPreset({ name: 'nope' }), /No preset named/);
});

/* ------------------------------------------------------------------ */
suite('Sidebar aggregate load');

test('loadAll returns every panel\'s data plus the constants in one call', (t) => {
  const d = S.loadAll(null);
  t.equal(d.documentTitle, 'Fixture Doc');
  t.deepEqual(d.tabs.map((tab) => tab.tabId), ['t.0', 't.1']);
  t.equal(d.namedStyles.length, 9);
  t.ok(d.sections.length >= 1);
  t.ok(d.lists.lists.length >= 1);
  t.ok(d.tables.length >= 1);
  t.equal(d.constants.units.length, 4);
  t.equal(d.constants.bulletPresets.length, 15);
  t.ok(d.constants.fonts.length > 20);
});


/* ------------------------------------------------------------------ */
suite('Read-only fields are never written');

test('tabStops are read from a style but never sent back', (t) => {
  const ui = S.paragraphStyleToUi_({
    alignment: 'START',
    tabStops: [{ offset: { magnitude: 36, unit: 'PT' }, alignment: 'START' }]
  });
  t.ok(ui.tabStops, 'tab stops should still be readable for display');
  const out = S.uiToParagraphStyle_(ui);
  t.equal(out.fields.indexOf('tabStops'), -1,
    'tabStops is read-only in the Docs API and must never appear in a field mask');
  t.equal(out.style.tabStops, undefined);
});

test('page-break-before is stripped from footnote, header and footer writes', (t) => {
  // The fixture's footer is deliberately empty, so it produces no request at
  // all; footnotes and headers are the targets with content to style.
  ['footnotes', 'headers'].forEach((target) => {
    S.__reset();
    const res = S.writeSegmentStyle({
      tabId: 't.0', target: target,
      paragraphStyle: { pageBreakBefore: true, spaceAbovePt: 6 }
    });
    const reqs = allRequests(S);
    t.ok(reqs.length, target + ': expected a request');
    reqs.forEach((r) => {
      const f = r.updateParagraphStyle.fields;
      t.equal(f.indexOf('pageBreakBefore'), -1,
        target + ': the API 400s on page_break_before outside the body');
      t.ok(f.indexOf('spaceAbove') !== -1, target + ': other fields must survive');
      t.equal(r.updateParagraphStyle.paragraphStyle.pageBreakBefore, undefined);
    });
    t.ok(res.warnings.some((w) => /page-break-before/i.test(w)),
      target + ': the user should be told it was dropped');
  });
});

test('page-break-before survives a body write', (t) => {
  S.__reset();
  S.writeSegmentStyle({ tabId: 't.0', target: 'body', paragraphStyle: { pageBreakBefore: true } });
  const reqs = allRequests(S);
  t.ok(reqs.some((r) => r.updateParagraphStyle.fields.indexOf('pageBreakBefore') !== -1),
    'the body is a supported region for page_break_before');
});

/* ------------------------------------------------------------------ */
suite('Custom styles applied to the selection');

function fakeText(text, parent) {
  const el = {
    _attrs: null, _ranges: [],
    getType: () => 'TEXT',
    asText: () => el,
    setAttributes: function (a, b, c) {
      if (c === undefined) { el._attrs = a; } else { el._ranges.push({ start: a, end: b, attrs: c }); }
      return el;
    },
    getParent: () => parent || null,
    getText: () => text
  };
  return el;
}

function fakeParagraph(text, childIndex) {
  const para = {
    _attrs: null,
    getType: () => 'PARAGRAPH',
    setAttributes: function (a) { para._attrs = a; return para; },
    getText: () => text,
    getParent: () => ({ getChildIndex: () => childIndex })
  };
  para.child = fakeText(text, para);
  return para;
}

test('a saved style maps onto DocumentApp attributes', (t) => {
  const built = S.uiToDocAttributes_(
    { fontFamily: 'Georgia', fontSizePt: 11, bold: true, baselineOffset: 'SUPERSCRIPT',
      foregroundColor: '#112233' },
    { alignment: 'JUSTIFIED', lineSpacing: 150, spaceAbovePt: 6, indentStartPt: 18,
      indentFirstLinePt: -18 });
  t.deepEqual(built.attributes, {
    FONT_FAMILY: 'Georgia', FONT_SIZE: 11, BOLD: true,
    VERTICAL_ALIGNMENT: 'SUPERSCRIPT', FOREGROUND_COLOR: '#112233',
    HORIZONTAL_ALIGNMENT: 'JUSTIFY',
    LINE_SPACING: 1.5,          // Docs stores 150%; DocumentApp wants the multiplier
    SPACING_BEFORE: 6, INDENT_START: 18, INDENT_FIRST_LINE: -18
  });
  t.deepEqual(built.dropped, []);
});

test('attributes DocumentApp cannot set are reported, not silently lost', (t) => {
  const built = S.uiToDocAttributes_(
    { bold: true, fontWeight: 700, smallCaps: true },
    { keepWithNext: true, shadingColor: '#ff0000' });
  t.equal(built.attributes.BOLD, true);
  ['font weight', 'small caps', 'keep with next', 'paragraph shading'].forEach((d) => {
    t.ok(built.dropped.indexOf(d) !== -1, 'should report "' + d + '" as not applied');
  });
});

test('applying a custom style styles a partial selection through its offsets', (t) => {
  S.saveStylePreset({ name: 'Lead-in', textStyle: { bold: true, fontSizePt: 13 }, paragraphStyle: {} });
  const para = fakeParagraph('Hello there', 3);
  S.__selection = {
    getRangeElements: () => [{
      getElement: () => para.child, isPartial: () => true,
      getStartOffset: () => 0, getEndOffsetInclusive: () => 4
    }]
  };
  const res = S.applyStylePresetToSelection({ name: 'Lead-in' });
  t.equal(res.applied, 1);
  t.deepEqual(para.child._ranges, [{ start: 0, end: 4, attrs: { BOLD: true, FONT_SIZE: 13 } }]);
  t.equal(para.child._attrs, null, 'a partial selection must not restyle the whole run');
  S.__selection = null;
});

test('a bare cursor styles the paragraph it sits in', (t) => {
  S.saveStylePreset({ name: 'Quote', textStyle: {}, paragraphStyle: { indentStartPt: 36 } });
  const para = fakeParagraph('Some text', 1);
  S.__selection = null;
  S.__cursor = { getElement: () => para.child };
  const res = S.applyStylePresetToSelection({ name: 'Quote' });
  t.equal(res.applied, 1);
  t.deepEqual(para._attrs, { INDENT_START: 36 });
  S.__cursor = null;
});

test('applying with nothing selected explains what to do instead of failing silently', (t) => {
  S.__selection = null;
  S.__cursor = null;
  t.throws(() => S.applyStylePresetToSelection({ name: 'Quote' }), /cursor in the document/);
});

test('applying an unknown custom style names it', (t) => {
  S.__cursor = { getElement: () => fakeParagraph('x', 0).child };
  t.throws(() => S.applyStylePresetToSelection({ name: 'Nope' }), /No style preset named "Nope"/);
  S.__cursor = null;
});


/* ------------------------------------------------------------------ */
suite('Reading current values back for the sidebar fields');

function paras(list) {
  return list.map((p) => ({
    paragraphStyle: p.para || {},
    elements: (p.runs || []).map((ts) => ({ textRun: { content: 'x', textStyle: ts } }))
  }));
}

test('a uniform set of paragraphs reports every value', (t) => {
  const sum = S.styleSummary_(paras([
    { para: { alignment: 'CENTER', spaceAbove: { magnitude: 6, unit: 'PT' } },
      runs: [{ bold: true, fontSize: { magnitude: 10, unit: 'PT' } }] },
    { para: { alignment: 'CENTER', spaceAbove: { magnitude: 6, unit: 'PT' } },
      runs: [{ bold: true, fontSize: { magnitude: 10, unit: 'PT' } }] }
  ]));
  t.deepEqual(sum.mixed, []);
  t.equal(sum.paragraphStyle.alignment, 'CENTER');
  t.equal(sum.paragraphStyle.spaceAbovePt, 6);
  t.equal(sum.textStyle.bold, true);
  t.equal(sum.textStyle.fontSizePt, 10);
});

test('a field with two different values is reported as mixed, not guessed', (t) => {
  const sum = S.styleSummary_(paras([
    { para: { alignment: 'CENTER' }, runs: [{ fontSize: { magnitude: 10, unit: 'PT' } }] },
    { para: { alignment: 'START' }, runs: [{ fontSize: { magnitude: 12, unit: 'PT' } }] }
  ]));
  t.ok(sum.mixed.indexOf('alignment') !== -1);
  t.ok(sum.mixed.indexOf('fontSizePt') !== -1);
  t.equal(sum.paragraphStyle.alignment, undefined,
    'a disagreeing field must not be shown as if it had a value');
  t.equal(sum.textStyle.fontSizePt, undefined);
});

test('a field set on only some paragraphs is mixed too', (t) => {
  const sum = S.styleSummary_(paras([
    { para: { alignment: 'CENTER' }, runs: [{ bold: true }] },
    { para: {}, runs: [{ bold: true }] }
  ]));
  t.ok(sum.mixed.indexOf('alignment') !== -1);
  t.equal(sum.textStyle.bold, true, 'fields that do agree still come through');
});

test('the newline-only run at the end of a paragraph is ignored', (t) => {
  const sum = S.styleSummary_([{
    paragraphStyle: {},
    elements: [
      { textRun: { content: 'real text', textStyle: { bold: true } } },
      { textRun: { content: '\n', textStyle: {} } }
    ]
  }]);
  t.equal(sum.textStyle.bold, true,
    'the terminating newline must not make every field look mixed');
  t.deepEqual(sum.mixed, []);
});

test('paragraphs inside table cells are included', (t) => {
  const found = S.collectParagraphs_([
    { paragraph: { elements: [] } },
    { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [] } }] }] }] } }
  ]);
  t.equal(found.length, 2);
});

test('readSegments reports the current style of each segment and of all of them', (t) => {
  const seg = S.readSegments('t.0');
  t.ok(seg.footnotes.length, 'fixture should have footnotes');
  seg.footnotes.forEach((f) => {
    t.ok(f.style, 'every footnote needs its current style for the sidebar fields');
    t.ok(Array.isArray(f.style.mixed));
  });
  ['allFootnotesStyle', 'allHeadersStyle', 'allFootersStyle'].forEach((k) => {
    t.ok(seg[k], k + ' is what the "style them all" editor fills its fields from');
    t.ok(Array.isArray(seg[k].mixed));
  });
  t.ok(seg.footnoteRefStyle, 'the reference-mark editor needs current values too');
});

test('readLists reports the current style of each nesting level', (t) => {
  const lists = S.readLists('t.0').lists;
  t.ok(lists.length, 'fixture should have a list');
  lists[0].levels.forEach((lv) => {
    t.ok(lv.style, 'level ' + lv.level + ' needs a current style');
    t.ok(Array.isArray(lv.style.mixed));
  });
});

test('readTables reports current cell values, header-row values and pinned rows', (t) => {
  const tbl = S.readTables('t.0').tables[0];
  t.ok(tbl.cellStyle, 'the cell fields need current values');
  t.ok(tbl.headerCellStyle, 'switching to "first row only" needs its own values');
  t.equal(typeof tbl.pinnedHeaderRows, 'number');
  t.ok(Array.isArray(tbl.cellStyle.mixed));
});

test('cell values that differ between cells are reported as mixed', (t) => {
  const sum = S.cellStyleSummary_([
    { tableCellStyle: { paddingTop: { magnitude: 5, unit: 'PT' }, contentAlignment: 'TOP' } },
    { tableCellStyle: { paddingTop: { magnitude: 9, unit: 'PT' }, contentAlignment: 'TOP' } }
  ]);
  t.ok(sum.mixed.indexOf('paddingTopPt') !== -1);
  t.equal(sum.style.paddingTopPt, undefined);
  t.equal(sum.style.contentAlignment, 'TOP');
});

test('opening the sidebar delivers current values for every panel in one call', (t) => {
  const d = S.loadAll(null);
  t.ok(d.namedStyles[0].textStyle, 'text styles');
  t.ok(d.segments.allFootnotesStyle, 'footnote styles');
  t.ok(d.lists.lists[0].levels[0].style, 'list level styles');
  t.ok(d.tables[0].cellStyle, 'table cell styles');
  t.ok(d.pageFormat, 'page format');
});



/* ------------------------------------------------------------------ */
suite('The live suite, exercised locally');

/**
 * src/LiveTests.js only runs for real inside Apps Script. Loading it into
 * the sandbox at least proves it parses, registers, and that every function
 * it calls exists -- the failure modes that would otherwise waste a push.
 */
test('the live suite registers its tests against the fixture document', (t) => {
  const registered = S.GAPP_TESTS;
  t.ok(registered.length >= 8, 'expected the live suite to register its tests');
  t.ok(registered.some((r) => /field mask/.test(r.name)), 'the field-mask check must be there');
});

test('the live suite passes against the mocked services', (t) => {
  const run = S.gappRun();
  const failed = run.results.filter((r) => !r.ok).map((r) => r.name + ': ' + r.error);
  t.deepEqual(failed, [], 'live tests failing locally');
  t.equal(run.failed, 0);
});

test('its report is TAP, so live mode can read it back', (t) => {
  const tap = S.gappTap(S.gappRun());
  t.match(tap.split('\n')[0], /^TAP version 13$/);
  t.match(tap, /# pass \d+/);
});

};

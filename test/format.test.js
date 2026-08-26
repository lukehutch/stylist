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
const { makeDoc, makeLegacyDoc, makeMultiDoc, makeSectionedDoc,
        makeLiveLikeDoc } = require('./fixture');

module.exports = ({ suite, test }) => {

const S = makeSandbox(makeDoc());
const L = makeSandbox(makeLegacyDoc());
/** Three lists and two tables; rebuilt per test, since these tests write. */
const multi = () => makeSandbox(makeMultiDoc());

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

/**
 * Dimension is proto3, so a magnitude of zero is not in the JSON at all.
 * Reading a present-but-empty Dimension as null made a real zero look like an
 * absent value, and null means "put this back to what it inherits" by the
 * time it reaches a request -- so re-asserting a style with a zero in it
 * cleared the field, and a zero-width border went out as a null Dimension,
 * which Google rejects as UNIT_UNSPECIFIED.
 */
test('a Dimension that is there but has no magnitude is zero', (t) => {
  t.equal(S.dimPt_({ unit: 'PT' }), 0, 'a zero margin, as the API sends it');
  t.equal(S.dimPt_({}), 0, 'a zero border width, as the API sends it');
  t.equal(S.dimPt_({ magnitude: 0, unit: 'PT' }), 0, 'and when it is spelled out');
});

test('a Dimension that is not there at all is still unset', (t) => {
  t.equal(S.dimPt_(null), null);
  t.equal(S.dimPt_(undefined), null);
});

test('a zero-width border goes out as a Dimension, never as null', (t) => {
  ['widthPt', 'paddingPt'].forEach((k) => {
    [undefined, null, ''].forEach((blank) => {
      const b = S.uiToBorder_({ color: '#000000', widthPt: 1, paddingPt: 1 });
      const u = { color: '#000000', widthPt: 1, paddingPt: 1 };
      u[k] = blank;
      const got = S.uiToBorder_(u);
      const dim = got[k === 'widthPt' ? 'width' : 'padding'];
      t.deepEqual(dim, { magnitude: 0, unit: 'PT' },
        k + ' = ' + JSON.stringify(blank) + ' becomes a zero Dimension');
      t.ok(b, 'and an ordinary border still builds');
    });
  });
});

test('re-asserting a style that holds a zero leaves the zero alone', (t) => {
  // What the live suite does: read a named style, write the same back.
  const ps = { indentStart: { unit: 'PT' }, spaceAbove: { magnitude: 6, unit: 'PT' } };
  const ui = S.paragraphStyleToUi_(ps);
  t.equal(ui.indentStartPt, 0, 'the zero survives the round to the UI');
  const built = S.uiToParagraphStyle_(ui);
  t.deepEqual(built.style.indentStart, { magnitude: 0, unit: 'PT' },
    'and comes back as an explicit zero, not a request to clear the field');
  t.ok(built.fields.indexOf('indentStart') >= 0, 'still named in the mask');
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

// Its own sandbox: writes land on the document now, so reading the fixture's
// own values back has to be done somewhere nothing else has written.
test('reading a named style round-trips through the UI shape', (t) => {
  const styles = makeSandbox(makeDoc()).readNamedStyles(null).styles;
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

test('presets can be re-read without touching the document', (t) => {
  const M = makeSandbox(makeDoc());
  M.loadAll('t.0');
  M.__reset();
  const slice = M.refresh('t.0', 'presets');
  t.ok(Array.isArray(slice.presets), 'the whole-document presets come back');
  t.ok(Array.isArray(slice.stylePresets), 'and the custom styles');
  t.notOk(slice.pageFormat, 'nothing document-shaped rides along');
  t.equal(allRequests(M).length, 0, 'and no request went out');
});

test('the second load leaves the constants behind', (t) => {
  const M = makeSandbox(makeDoc());
  const first = M.loadAll('t.0');
  t.ok(first.constants.fonts.length, 'the first load carries them');
  const again = M.loadAll('t.0', true);
  t.notOk(again.constants, 'a sidebar that already has them is not sent them twice');
  t.ok(again.pageFormat, 'everything else still comes back');
});

test('the first load says how many sections there are, not what they hold', (t) => {
  const one = makeSandbox(makeDoc()).loadAll('t.0');
  t.equal(one.sectionCount, 1, 'a plain document has the one implicit section');
  t.notOk(one.sections, 'and no section bodies ride along with it');
  const many = makeSandbox(makeSectionedDoc()).loadAll(null);
  t.equal(many.sectionCount, 3, 'a sectioned one counts its breaks');
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

test('a page background colour is sent as an opaque OptionalColor', (t) => {
  S.__reset();
  S.writePageFormat({ backgroundColor: '#ff0000' });
  const r = allRequests(S)[0].updateDocumentStyle;
  t.deepEqual(r.documentStyle.background,
    { color: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } } });
  t.equal(r.fields, 'background');
});

/* "Documents cannot have a transparent background color" -- the Docs API
   discovery document says exactly that, so sending an empty OptionalColor is
   a write Google accepts and then ignores, which is what made the "none"
   button look broken. Naming the field with no value resets it instead. */
/**
 * This used to expect a reset -- the field named in the mask with no value
 * behind it -- because that is how every other property is put back. Google
 * refuses it for this one field, in as many words: "A value for background
 * color must be specified in order to update it." So clearing has to write
 * the white a document without a background already renders.
 */
test('clearing the page background writes white, because it cannot be reset', (t) => {
  S.__reset();
  S.writePageFormat({ backgroundColor: '' });
  const r = allRequests(S)[0].updateDocumentStyle;
  t.equal(r.fields, 'background', 'the field is still named');
  t.deepEqual(r.documentStyle.background,
    { color: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
    'and now carries an explicit white');
});

/**
 * The bug this pair was written for: reading a document that has no
 * background gives null, exportConfig carries the null, and importConfig
 * handed it straight back to writePageFormat -- which named the field with
 * nothing behind it and took the whole batch down with a 400. Applying any
 * whole-document preset did this, on any document nobody had ever set a
 * background on, which is most of them.
 */
test('a background nobody ever set is left alone, not reset', (t) => {
  // Its own sandbox: writes land on the document now, and the margin below
  // is read back by later tests sharing S.
  const B = makeSandbox(makeDoc());
  B.writePageFormat({ backgroundColor: null, marginTopPt: 50 });
  const r = allRequests(B)[0].updateDocumentStyle;
  t.equal(r.fields.indexOf('background'), -1,
    'background must not be named: ' + r.fields);
  t.ok(r.fields.indexOf('marginTop') !== -1, 'and the rest of the write still happens');
});

test('a background that is only a null asks for nothing at all', (t) => {
  S.__reset();
  S.writePageFormat({ backgroundColor: null });
  t.deepEqual(allRequests(S), [], 'there was nothing to send');
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

test('the load reports where its own time went', (t) => {
  // A sandbox of its own: loadAll seeds a new user's default styles, which
  // the preset tests below count.
  const d = makeSandbox(makeDoc()).loadAll('t.0');
  // The browser can only see the total. Splitting it is what tells the
  // difference between a slow Docs API read and a slow cursor lookup, which
  // are fixed in completely different places.
  t.ok(d.timings, 'a breakdown comes back with the payload');
  ['docsGet', 'page', 'styles', 'lists', 'tables', 'serverTotal']
    .forEach((k) => t.equal(typeof d.timings[k], 'number', k + ' is timed'));
});

test('the cursor lookups are timed apart from the read they accompany', (t) => {
  const d = makeSandbox(makeDoc()).loadAll('t.0');
  t.equal(typeof d.timings.cursorList, 'number');
  t.equal(typeof d.timings.cursorTable, 'number');
});

test('the body walk asks for the child count once, not once per child', (t) => {
  // Every DocumentApp accessor is a call across the service boundary, so a
  // getNumChildren() in the loop condition is one extra round trip per child.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'Bullets.js'), 'utf8') +
    require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'Tables.js'), 'utf8');
  t.notOk(/for \([^)]*getNumChildren\(\)/.test(src),
    'the child count must be hoisted out of the loop');
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

test('a list whose paragraphs are all gone is not offered', (t) => {
  // No Docs request deletes a list definition, so an emptied list stays in
  // document.lists for ever. It has nothing to style, so it is not listed.
  const doc = makeDoc();
  doc.tabs[0].documentTab.lists['list.dead'] = { listProperties: { nestingLevels: [{}] } };
  const lists = makeSandbox(doc).readLists('t.0').lists;
  t.equal(lists.length, 1);
  t.equal(lists[0].listId, 'list.1');
});

test('numbering is told apart from bullets by its glyph type', (t) => {
  const kinds = {};
  multi().readLists('t.0').lists.forEach((l) => { kinds[l.listId] = l.kind; });
  t.deepEqual(kinds, { 'list.1': 'bulleted', 'list.2': 'bulleted', 'list.3': 'numbered' });
});

test('lists come back in body order, which is what the cursor is matched on', (t) => {
  const ids = multi().readLists('t.0').lists.map((l) => l.listId);
  t.deepEqual(ids, ['list.1', 'list.2', 'list.3']);
});

test('applying a preset to all lists covers every one of them', (t) => {
  const M = multi();
  M.applyBulletPreset({ tabId: 't.0', allLists: true, bulletPreset: 'BULLET_CHECKBOX' });
  const ranges = allRequests(M).map((r) => r.createParagraphBullets.range.startIndex);
  t.deepEqual(ranges.sort((a, b) => a - b), [30, 200, 220]);
});

test('removing markers from all lists covers every one of them', (t) => {
  const M = multi();
  M.removeBullets({ tabId: 't.0', allLists: true });
  t.equal(allRequests(M).filter((r) => r.deleteParagraphBullets).length, 3);
});

test('styling a level across all lists reaches that level in each', (t) => {
  const M = multi();
  M.writeListLevelStyle({ tabId: 't.0', allLists: true, level: 1, textStyle: { italic: true } });
  const starts = allRequests(M).map((r) => r.updateTextStyle.range.startIndex);
  t.deepEqual(starts.sort((a, b) => a - b), [40, 210]);
});

test('unifying lists settles each field by majority, not by the first list', (t) => {
  // Two of the three lists indent level one by 36pt and centre it; the first
  // indents by 90pt and does not centre. The majority is what everything ends
  // up with -- deliberately not what the first list does.
  const M = multi();
  M.unifyLists({ tabId: 't.0' });
  const lvl0 = allRequests(M)
    .filter((r) => r.updateParagraphStyle && r.updateParagraphStyle.range.startIndex !== 40 &&
                   r.updateParagraphStyle.range.startIndex !== 210)
    .map((r) => r.updateParagraphStyle);
  t.equal(lvl0.length, 3, 'every list gets its first level written');
  lvl0.forEach((r) => {
    t.equal(r.paragraphStyle.alignment, 'CENTER');
    t.equal(r.paragraphStyle.indentStart.magnitude, 36);
  });
});

test('unifying lists leaves the markers alone', (t) => {
  // A majority vote across bulleted and numbered lists would turn the
  // numbering of the minority into bullets.
  const M = multi();
  M.unifyLists({ tabId: 't.0' });
  t.notOk(allRequests(M).some((r) => r.createParagraphBullets || r.deleteParagraphBullets));
});

test('unifying is a no-op when there is nothing to agree with', (t) => {
  S.__reset();
  t.equal(S.unifyLists({ tabId: 't.0' }).applied, 0);
  t.equal(allRequests(S).length, 0);
});

/* ------------------------------------------------------------------ */
/* A list inside a table cell is an ordinary list: it has a listId, its
   paragraphs carry ordinary document indexes, and clicking into it should show
   it in the panel. Both halves have to see it -- the Docs API read and the
   DocumentApp walk that says which list the cursor is in -- because they are
   joined on nothing but the order lists appear in. */
function docWithListInACell() {
  const doc = makeDoc();
  const tab = doc.tabs[0].documentTab;
  tab.body.content.push({
    startIndex: 900,
    endIndex: 960,
    table: {
      rows: 1,
      columns: 1,
      tableRows: [{ tableCells: [{ startIndex: 902, content: [
        { startIndex: 903, endIndex: 920,
          paragraph: { bullet: { listId: 'kx.cell', nestingLevel: 0 },
                       elements: [{ textRun: { content: 'in a cell\n' } }] } },
        { startIndex: 920, endIndex: 940,
          paragraph: { bullet: { listId: 'kx.cell', nestingLevel: 1 },
                       elements: [{ textRun: { content: 'deeper\n' } }] } }
      ] }] }]
    }
  });
  tab.lists['kx.cell'] = { listProperties: { nestingLevels: [
    { glyphSymbol: '\u25cf', indentStart: { magnitude: 36, unit: 'PT' } },
    { glyphSymbol: '\u25cb' }
  ] } };
  return doc;
}

test('a list living in a table cell is a list the panel can see', (t) => {
  const M = makeSandbox(docWithListInACell());
  const cell = M.readLists(null).lists.filter((l) => l.listId === 'kx.cell')[0];
  t.ok(cell, 'the cell list is offered alongside the body ones');
  t.equal(cell.itemCount, 2);
  t.equal(cell.levels[1].inUse, true, 'and the level the cell item sits on');
});

test('its paragraphs are written like any other list', (t) => {
  const M = makeSandbox(docWithListInACell());
  M.__reset();
  M.applyBulletPreset({ listId: 'kx.cell', bulletPreset: 'BULLET_CHECKBOX' });
  const r = allRequests(M)[0].createParagraphBullets;
  t.deepEqual({ s: r.range.startIndex, e: r.range.endIndex }, { s: 903, e: 940 },
    'the cell paragraphs carry ordinary document indexes');
});

test('the cursor in a cell list finds that list, not the one above it', (t) => {
  const M = makeSandbox(docWithListInACell());
  // The body as DocumentApp sees it: one body list, then the table whose one
  // cell holds the second. The join is this order and nothing else.
  const cellItem = { getType: () => 'LIST_ITEM', getListId: () => 'kx.cell',
                     getParent: () => tcell };
  const tcell = { getType: () => 'TABLE_CELL', getParent: () => trow,
                  getNumChildren: () => 1, getChild: () => cellItem };
  const trow = { getType: () => 'TABLE_ROW', getParent: () => table,
                 getNumChildren: () => 1, getChild: () => tcell };
  const table = { getType: () => 'TABLE', getParent: () => body,
                  getNumChildren: () => 1, getChild: () => trow };
  const bodyItem = { getType: () => 'LIST_ITEM', getListId: () => 'list.1',
                     getParent: () => body };
  const kids = [bodyItem, table];
  const body = { getType: () => 'BODY_SECTION', getParent: () => null,
                 getNumChildren: () => kids.length, getChild: (i) => kids[i] };

  M.__body = body;
  M.__cursor = { getElement: () => cellItem };
  t.equal(M.readLists(null).activeListId, 'kx.cell');

  M.__cursor = { getElement: () => bodyItem };
  t.equal(M.readLists(null).activeListId, 'list.1', 'and the body one from the body');
});

suite('Tables');

test('tables are found with their geometry and header row', (t) => {
  const tbl = S.readTables(null).tables[0];
  t.equal(tbl.rows, 2);
  t.equal(tbl.columns, 3);
  t.equal(tbl.headerRow, true);
  t.equal(tbl.startIndex, 70);
});

test('writing to all tables reaches every table from one read', (t) => {
  const M = multi();
  M.writeTableFormat({ tabId: 't.0', allTables: true, cell: { paddingTopPt: 5 }, applyCellsTo: 'all' });
  const at = allRequests(M).map((r) => r.updateTableCellStyle.tableStartLocation.index);
  t.deepEqual(at.sort((a, b) => a - b), [70, 300]);
});

test('unifying tables writes the settled values to every table', (t) => {
  const M = multi();
  t.equal(M.unifyTables({ tabId: 't.0' }).applied > 0, true);
  const pads = allRequests(M).filter((r) => r.updateTableCellStyle);
  t.equal(pads.length, 2);
  pads.forEach((r) => t.equal(r.updateTableCellStyle.tableCellStyle.paddingTop.magnitude, 9));
});

test('a settled column width is dropped unless the sizing is fixed', (t) => {
  // The two votes are taken separately, so they can disagree: one table is
  // evenly distributed with no width, the other fixed at 100pt. Sending
  // EVENLY_DISTRIBUTED together with a width is a contradiction.
  const M = multi();
  M.unifyTables({ tabId: 't.0' });
  allRequests(M).filter((r) => r.updateTableColumnProperties).forEach((r) => {
    const p = r.updateTableColumnProperties.tableColumnProperties;
    t.equal(p.widthType, 'EVENLY_DISTRIBUTED');
    t.equal(p.width, undefined, 'no width alongside EVENLY_DISTRIBUTED');
  });
});

test('unifying tables is a no-op with only one table', (t) => {
  S.__reset();
  t.equal(S.unifyTables({ tabId: 't.0' }).applied, 0);
  t.equal(allRequests(S).length, 0);
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

// Own sandbox: loadAll seeds the default custom styles, which the shared one's
// preset tests count.
test('one sidebar refresh downloads the document once, not once per section', (t) => {
  const N = makeSandbox(makeDoc());
  N.loadAll(null);
  t.equal(N.__fetches, 1,
    'loadAll runs seven readers, and each of them used to fetch the whole document');
});

test('a write invalidates the cached document', (t) => {
  const N = makeSandbox(makeDoc());
  N.loadAll(null);
  N.writeSegmentStyle({ target: 'footnotes', textStyle: { fontSizePt: 9 } });
  const before = N.__fetches;
  N.readTables(null);
  t.ok(N.__fetches > before, 'the next read sees the document as it now is');
});

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

// Its own sandbox: the preset store is shared for the life of one, and
// counting what is in it only works while nothing else has saved anything.
test('style presets save, list and bind to a named style', (t) => {
  const P = makeSandbox(makeDoc());
  P.saveStylePreset({ name: 'Callout', textStyle: { bold: true, fontSizePt: 12 } });
  const list = P.listStylePresets();
  t.equal(list.length, 1);
  t.equal(list[0].name, 'Callout');

  P.applyStylePresetToNamedStyle({ name: 'Callout', namedStyleType: 'HEADING_6' });
  const r = allRequests(P)[0].updateNamedStyle;
  t.equal(r.namedStyle.namedStyleType, 'HEADING_6');
  t.equal(r.namedStyle.textStyle.bold, true);
});

/* ---- the whole configuration as one downloadable file ---- */

test('the downloaded file carries the presets, not just the document', (t) => {
  const N = makeSandbox(makeDoc());
  N.savePreset({ name: 'House style' });
  N.saveStylePreset({ name: 'Callout', textStyle: { bold: true } });
  const all = N.exportAll(null);
  t.equal(all.version, 2);
  t.equal(all.document.namedStyles.length, 9, "this tab's formatting is still in there");
  t.ok(all.presets['House style'], 'and the saved presets, which live in the user profile');
  t.ok(all.stylePresets.Callout, 'and the style presets');
});

test('saving a preset stores one document, never the whole bundle', (t) => {
  // Otherwise each save would fold in a copy of every earlier save.
  const N = makeSandbox(makeDoc());
  N.savePreset({ name: 'One' });
  N.savePreset({ name: 'Two' });
  const inner = N.exportAll(null).presets.Two;
  t.notOk(inner.presets, 'a saved preset holds no preset store of its own');
  t.equal(inner.version, 1);
});

test('a file from one profile lands in another', (t) => {
  const from = makeSandbox(makeDoc());
  from.savePreset({ name: 'House style' });
  from.saveStylePreset({ name: 'Callout', textStyle: { bold: true } });
  const file = JSON.stringify(from.exportAll(null));

  const to = makeSandbox(makeDoc());
  const res = to.importAll({ config: file });
  t.ok(to.listPresets().some((p) => p.name === 'House style'), 'the preset came across');
  t.ok(to.listStylePresets().some((p) => p.name === 'Callout'));
  t.ok(res.applied > 0, 'and the formatting was applied to the open document');
  t.ok(to.listStylePresets().some((p) => p.name === 'Source code'),
    'the built-in styles are still there beside it');
});

test('an uploaded name that clashes is taken from the file, and said so', (t) => {
  const to = makeSandbox(makeDoc());
  to.saveStylePreset({ name: 'Callout', textStyle: { bold: false } });
  const res = to.importAll({ config: {
    stylePresets: { Callout: { textStyle: { bold: true } },
                    Fresh: { textStyle: { italic: true } } }
  } });
  t.deepEqual(res.replaced, ['Callout']);
  t.equal(res.added, 1);
  t.ok(res.warnings.some((w) => /Replaced what you had under Callout/.test(w)));
  const c = to.listStylePresets().filter((p) => p.name === 'Callout')[0];
  t.equal(c.textStyle.bold, true, "the file's version won");
});

test('a file written before there were bundles still uploads', (t) => {
  // Version 1 is a bare configuration: pageFormat and namedStyles at the top.
  const N = makeSandbox(makeDoc());
  const v1 = N.exportConfig(null);
  t.equal(v1.version, 1);
  N.__reset();
  const res = N.importAll({ config: JSON.stringify(v1) });
  t.ok(res.applied > 0);
});

test('a file that is not JSON says so rather than failing silently', (t) => {
  t.throws(() => S.importAll({ config: '{ nope' }), /not valid JSON/);
  t.throws(() => S.importAll({ config: '' }), /Empty configuration/);
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
  t.equal(d.sections, undefined,
    'sections are read when their panel opens, not at boot');
  t.ok(d.lists.lists.length >= 1);
  t.ok(d.tables.length >= 1);
  t.equal(d.constants.units.length, 4);
  t.equal(d.constants.bulletPresets.length, 15);
  t.ok(d.constants.fonts.length > 20);
});

/* ------------------------------------------------------------------ */
suite('Sections: finding and writing the one under the cursor');

const SEC = makeSectionedDoc();
const secTab = SEC.tabs[0].documentTab;
const secContent = secTab.body.content;

test('the section breaks read back with the styles that start them', (t) => {
  const M = makeSandbox(SEC);
  const secs = M.readSections('t.0').sections;
  t.equal(secs.length, 3);
  t.equal(secs[0].marginTopPt, 72);
  t.equal(secs[1].marginTopPt, 90);
  t.equal(secs[1].sectionType, 'NEXT_PAGE');
  t.equal(secs[2].marginTopPt, 108);
});

test('a paragraph picks the section it sits inside', (t) => {
  const M = makeSandbox(SEC);
  const scan = M.sectionsScan_(M.resolveTab_(M.fetchDoc_(), 't.0'));
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: 'First page text' }), 0);
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: 'Shared heading' }), 1);
  // A paragraph inside a table belongs to the section holding the table.
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: 'Cell words' }), 2);
});

test('twin paragraphs across sections stay with the one already showing', (t) => {
  const M = makeSandbox(SEC);
  const scan = M.sectionsScan_(M.resolveTab_(M.fetchDoc_(), 't.0'));
  // Both empty paragraphs match an empty head; the panel stays put...
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: '', preferred: 2 }), 2);
  // ...or moves to whichever twin is nearest where it was.
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: '', preferred: 0 }), 1);
  // A list item is not a candidate for a plain-paragraph handle.
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { paraKind: 'p', paraHead: 'Item one', preferred: 0 }), 0);
});

test('no usable handle falls back to the section already showing', (t) => {
  const M = makeSandbox(SEC);
  const scan = M.sectionsScan_(M.resolveTab_(M.fetchDoc_(), 't.0'));
  t.equal(M.pickSection_(scan.sections, scan.elements, {}), 0);
  t.equal(M.pickSection_(scan.sections, scan.elements,
    { preferred: 2 }), 2);
  t.equal(M.pickSection_([], [], {}), -1);
});

test('refresh("sections") serves just the current slice', (t) => {
  const M = makeSandbox(SEC);
  const out = M.refresh('t.0', 'sections',
    { paraKind: 'p', paraHead: 'Shared heading', preferred: 0 });
  t.deepEqual(Object.keys(out).sort(),
    ['activeSectionIndex', 'sectionCount', 'sections']);
  t.equal(out.sectionCount, 3);
  t.equal(out.activeSectionIndex, 1);
  t.equal(out.sections.length, 1);
  t.equal(out.sections[0].startIndex, 17);
});

test('a write goes to exactly the section it names', (t) => {
  const M = makeSandbox(SEC);
  M.__reset();
  M.writeSection({ tabId: 't.0', startIndex: 17, marginTopPt: 20 });
  const reqs = allRequests(M);
  t.equal(reqs.length, 1);
  t.equal(reqs[0].updateSectionStyle.range.startIndex, 17);
  t.equal(reqs[0].updateSectionStyle.range.endIndex, 17);
});

test('"apply to all" writes every section in one batch', (t) => {
  const M = makeSandbox(SEC);
  M.__reset();
  M.writeSection({ tabId: 't.0', startIndex: 17, marginTopPt: 20, applyAll: true });
  const reqs = allRequests(M);
  t.equal(reqs.length, 3, 'one request per section');
  t.deepEqual(reqs.map((r) => r.updateSectionStyle.range.startIndex), [0, 17, 32]);
  t.ok(reqs.every((r) => r.updateSectionStyle.sectionStyle.marginTop.magnitude === 20));
  t.ok(reqs.every((r) => r.updateSectionStyle.fields === 'marginTop'));
});

test('unify copies the shown section\'s layout onto all the others', (t) => {
  const M = makeSandbox(SEC);
  M.__reset();
  M.unifySections({ tabId: 't.0', fromStartIndex: 17 });
  const reqs = allRequests(M);
  t.equal(reqs.length, 2, 'every section but the source');
  t.deepEqual(reqs.map((r) => r.updateSectionStyle.range.startIndex), [0, 32]);
  reqs.forEach((r) => {
    t.equal(r.updateSectionStyle.sectionStyle.marginTop.magnitude, 90,
      'the source section\'s margin travels');
    t.equal(r.updateSectionStyle.sectionStyle.marginTop.unit, 'PT');
  });
});

test('nothing to unify when there is only one section', (t) => {
  const M = makeSandbox(makeDoc());
  M.__reset();
  const res = M.unifySections({ tabId: 't.0', fromStartIndex: 0 });
  t.equal(res.applied, 0);
  t.equal(allRequests(M).length, 0);
});

test('the fixture still holds the twin paragraphs the tests above lean on', (t) => {
  t.equal(secContent.filter((e) => e.paragraph &&
        e.paragraph.elements[0].textRun &&
        e.paragraph.elements[0].textRun.content === '').length, 2,
    'two empty paragraphs for the twin tests');
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
  // Saved here rather than borrowed from the test above: the preset name is
  // looked up before the selection is, so without one of its own this test
  // fails on "no such preset" and never reaches what it is asking about.
  S.saveStylePreset({ name: 'Quote', textStyle: {}, paragraphStyle: { indentStartPt: 36 } });
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
  // Its own sandbox, deliberately. Writes now land on the document rather
  // than only being recorded, so S carries whatever every test above it
  // wrote, and a live test that reads the document back would be reading
  // their leavings rather than the fixture.
  const run = makeSandbox(makeLiveLikeDoc()).gappRun();
  // All but the first suite, which builds the scratch document. Its whole
  // subject is a write having landed, and this sandbox's batchUpdate records
  // requests without applying them, so there is nothing here it could pass
  // against. What it does issue is checked below instead.
  const failed = run.results
    .filter((r) => !r.ok && r.suite !== 'The document under test')
    .map((r) => r.name + ': ' + r.error);
  t.deepEqual(failed, [], 'live tests failing locally');
  t.equal(run.failed, 1, 'and only the fixture build, for want of a real document');
});

/**
 * The fixture builder, as far as a sandbox can take it. It stops where it
 * asks the document to read back the text it just wrote -- which a recording
 * mock never will -- so what is checkable is everything before that: that it
 * empties the document, puts the page setup back, and writes the fixture.
 */
test('the fixture builder empties the document before it refills it', (t) => {
  const sb = makeSandbox(makeDoc());
  t.throws(() => sb.resetLiveFixture_(), /no paragraph starting/,
    'it stops rather than half-building a fixture it cannot read back');

  const reqs = allRequests(sb);
  const kinds = reqs.map((r) => Object.keys(r)[0]);
  t.ok(kinds.indexOf('deleteContentRange') === 0, 'the body goes first');
  ['deleteHeader', 'deleteFooter', 'updateDocumentStyle', 'insertText']
    .forEach((k) => t.ok(kinds.indexOf(k) > 0, 'it also issues ' + k));

  const wipe = reqs[0].deleteContentRange.range;
  t.equal(wipe.startIndex, 1, 'from the top');
  t.ok(wipe.endIndex >= 1, "and short of the document's own last newline");

  const setup = reqs[kinds.indexOf('updateDocumentStyle')].updateDocumentStyle;
  t.equal(setup.documentStyle.marginTop.magnitude, 72, 'one-inch margins every run');
  t.equal(setup.documentStyle.useFirstPageHeaderFooter, false,
    'and no first-page variant left over from a previous run');

  const text = reqs[kinds.indexOf('insertText')].insertText;
  t.equal(text.location.index, 1);
  ['Stylist live tests', 'First bullet', 'First step', 'After the break']
    .forEach((line) => t.match(text.text, new RegExp(line),
      'the fixture text carries "' + line + '"'));
});

test('the scratch document is made only when there is not one already', (t) => {
  const sb = makeSandbox(makeDoc());
  try { sb.resetLiveFixture_(); } catch (e) { /* stops at the read-back, as above */ }
  t.equal(sb.__created.length, 1, 'nothing was stored, so one was made');
  t.match(sb.__created[0].title, /Stylist live tests/, 'and named for what it is for');

  const again = makeSandbox(makeDoc());
  again.PropertiesService.getScriptProperties().setProperty(
    again.LIVE_TEST_DOC_PROP_, 'AN_EXISTING_DOC');
  try { again.resetLiveFixture_(); } catch (e) { /* same */ }
  t.equal(again.__created.length, 0, 'the one from last time is reused');
});

test('its report is TAP, so live mode can read it back', (t) => {
  const tap = S.gappTap(S.gappRun());
  t.match(tap.split('\n')[0], /^TAP version 13$/);
  t.match(tap, /# pass \d+/);
});

/* ------------------------------------------------------------------ */
suite('The smallest edit that says what you meant');

test('a write targets the tabs the sidebar already knows, without reading the document', (t) => {
  const M = multi();
  M.docCache_ = null;
  M.writeNamedStyle({
    tabId: 't.0', tabIds: ['t.0'], namedStyleType: 'NORMAL_TEXT', textStyle: { bold: true }
  });
  t.equal(M.timings_.docsGet, undefined, 'no document read was paid for');
  const reqs = allRequests(M).filter((r) => r.updateNamedStyle);
  t.equal(reqs.length, 1);
  // The parent path is there because the API requires it alongside the leaf;
  // what matters for minimality is that no other leaf is named.
  t.equal(reqs[0].updateNamedStyle.fields, 'namedStyleType,textStyle,textStyle.bold',
    'and it names only the one property it changed');
  t.deepEqual(reqs[0].updateNamedStyle.namedStyle.textStyle, { bold: true });
});

test('a caller that knows nothing still gets the right tabs, by reading', (t) => {
  const M = multi();
  M.writeNamedStyle({ tabId: 't.0', namedStyleType: 'NORMAL_TEXT', textStyle: { bold: true } });
  t.equal(allRequests(M).filter((r) => r.updateNamedStyle).length, 1);
});

test('scope "all" reaches every known tab; anything unrecognised falls back to the first', (t) => {
  const M = multi();
  t.deepEqual(M.knownTargetTabIds_(['a', 'b'], 'b', 'all'), ['a', 'b']);
  t.deepEqual(M.knownTargetTabIds_(['a', 'b'], 'b'), ['b']);
  t.deepEqual(M.knownTargetTabIds_(['a', 'b'], 'nope'), ['a'], 'a tab id we do not have is not trusted');
  t.equal(M.knownTargetTabIds_([], 't.0'), null, 'knowing nothing says so, rather than guessing');
  t.equal(M.knownTargetTabIds_(undefined, 't.0'), null);
});

/* ------------------------------------------------------------------ */
suite('Taking markers off one nesting level');

test('only the paragraphs at that depth lose their markers', (t) => {
  const M = multi();
  M.removeBullets({ tabId: 't.0', listId: 'list.2', level: 1 });
  const reqs = allRequests(M).filter((r) => r.deleteParagraphBullets);
  t.equal(reqs.length, 1, 'one range, not the whole list');
  t.equal(reqs[0].deleteParagraphBullets.range.startIndex, 210, 'the level-1 item');
  t.equal(reqs[0].deleteParagraphBullets.range.endIndex, 220);
});

test('level 0 of the same list is a different range', (t) => {
  const M = multi();
  M.removeBullets({ tabId: 't.0', listId: 'list.2', level: 0 });
  const reqs = allRequests(M).filter((r) => r.deleteParagraphBullets);
  t.equal(reqs.length, 1);
  t.equal(reqs[0].deleteParagraphBullets.range.startIndex, 200);
});

test('no level named means the whole list, as before', (t) => {
  const M = multi();
  M.removeBullets({ tabId: 't.0', listId: 'list.2' });
  const reqs = allRequests(M).filter((r) => r.deleteParagraphBullets);
  t.equal(reqs.length, 1, 'the two items are adjacent, so they merge into one range');
  t.equal(reqs[0].deleteParagraphBullets.range.startIndex, 200);
  t.equal(reqs[0].deleteParagraphBullets.range.endIndex, 220);
});

test('a level with no paragraphs in it asks for nothing', (t) => {
  const M = multi();
  M.removeBullets({ tabId: 't.0', listId: 'list.2', level: 5 });
  t.equal(allRequests(M).filter((r) => r.deleteParagraphBullets).length, 0);
});

test('a marker write answers with the lists as they now are', (t) => {
  // The sidebar used to ask for that reading in a second call, and the round
  // trip to Apps Script -- not the read inside it -- is most of the wait.
  const M = multi();
  const out = M.removeBullets({ tabId: 't.0', listId: 'list.2', level: 1 });
  t.ok(out.lists, 'the write carries the slice back with it');
  t.ok(Array.isArray(out.lists.lists), 'shaped exactly like readLists');
  t.equal(out.lists.tabId, 't.0');

  const M2 = multi();
  const out2 = M2.applyBulletPreset(
    { tabId: 't.0', listId: 'list.2', bulletPreset: 'BULLET_CHECKBOX' });
  t.ok(out2.lists, 'and so does setting a marker');
});

/* ------------------------------------------------------------------ */
suite('Metadata reads that never touch the body');

test('the meta read asks for page setup, named styles and tabs, and nothing else', (t) => {
  const seen = [];
  const M = makeSandbox(makeDoc(), {
    docsGet: (id, opts) => { seen.push(opts); return fullMeta(makeDoc()); }
  });
  M.readDocMeta('t.0');
  t.equal(seen.length, 1);
  for (const want of ['documentStyle', 'namedStyles', 'tabs.tabProperties',
                      'tabs.documentTab.documentStyle']) {
    t.ok(seen[0].fields.indexOf(want) !== -1, want + ' is asked for');
  }
  for (const banned of ['body', 'headers', 'footers', 'footnotes', 'lists', 'inlineObjects']) {
    t.ok(seen[0].fields.indexOf(banned) === -1, banned + ' is not asked for');
  }
});

test('a masked response serves the panels without a second read', (t) => {
  let calls = 0;
  const M = makeSandbox(makeDoc(), {
    docsGet: () => { calls++; return fullMeta(makeDoc(), 't.0'); }
  });
  const meta = M.readDocMeta('t.0');
  t.equal(calls, 1);
  t.equal(meta.activeTabId, 't.0');
  t.deepEqual(meta.tabs, [
    { tabId: 't.0', title: 'Main', depth: 0 },
    { tabId: 't.1', title: 'Appendix', depth: 1 }
  ]);
  t.equal(meta.pageFormat.pageWidthPt, 612);
  t.equal(meta.namedStyles.length, 9);
});

test('an ignored mask comes back as a complete response, and is cached as one', (t) => {
  const doc = makeDoc();
  let calls = 0;
  const M = makeSandbox(doc, { docsGet: () => { calls++; return doc; } });
  const meta = M.readDocMeta('t.0');
  t.equal(calls, 1, 'no second read to make up for it');
  t.ok(M.docCache_, 'the full response became the execution\'s document');
  t.equal(meta.namedStyles.length, 9);
  t.equal(meta.pageFormat.pageWidthPt, 612,
    'values come out of the same response either way');
});

test('refresh("meta") returns the slice the poll merges', (t) => {
  const M = makeSandbox(makeDoc(), { docsGet: () => fullMeta(makeDoc(), 't.0') });
  const slice = M.refresh('t.0', 'meta');
  t.deepEqual(Object.keys(slice).sort(), ['activeTabId', 'namedStyles', 'pageFormat', 'tabs']);
});

test('footnotes are no longer part of any default load', (t) => {
  const d = S.loadAll(null);
  t.equal(d.footnotes, undefined, 'not in loadAll');
  const r = S.refresh('t.0');
  t.equal(r.footnotes, undefined, 'and not in refresh');
});

/** A response shaped like a honored field mask: metadata only, no body.
    Child tabs stay nested, exactly as the API returns them. */
function fullMeta(doc) {
  const strip = (t) => ({
    tabProperties: t.tabProperties,
    documentTab: { documentStyle: t.documentTab.documentStyle, namedStyles: t.documentTab.namedStyles },
    childTabs: (t.childTabs || []).map(strip)
  });
  return {
    title: doc.title,
    documentStyle: doc.tabs[0].documentTab.documentStyle,
    namedStyles: doc.tabs[0].documentTab.namedStyles,
    tabs: doc.tabs.map(strip)
  };
}

/* ------------------------------------------------------------------ */
suite('The cursor probe that gates content reads');

/** A fake element chain, shaped like DocumentApp's object model. */
function chainOf(...types) {
  // innermost first; each wraps the next
  const TEXT_OF = { LIST_ITEM: 'Item one', PARAGRAPH: 'Body text', TABLE_CELL: 'Cell text' };
  return types.reduce((child, type) => {
    if (type === 'LIST_ITEM') {
      return { getType: () => type, getParent: () => child, getListId: () => 'list.X',
               getText: () => TEXT_OF[type] };
    }
    return { getType: () => type, getParent: () => child, getText: () => TEXT_OF[type] || '' };
  }, null);
}
/** What DocumentApp hands back from getSelection(): null, or range elements. */
function selectionOf(el) {
  return el ? { getRangeElements: () => [{ getElement: () => el }] } : null;
}

test('the cursor in a list names that list, and the paragraph it sits in', (t) => {
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(chainOf('LIST_ITEM', 'BODY_SECTION'));
  t.deepEqual(M.cursorContext(),
    { listId: 'list.X', paraKind: 'li', paraHead: 'Item one' });
});

test('the cursor in a table reports presence -- tables have no id here', (t) => {
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(chainOf('TABLE_CELL', 'TABLE_ROW', 'TABLE', 'BODY_SECTION'));
  t.deepEqual(M.cursorContext(), { inTable: true });
});

test('a paragraph inside a table cell is reported along with the table', (t) => {
  // The climb records the first paragraph-shaped element on the way up and
  // keeps going, so a cell paragraph still ends up reporting the table.
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(
    chainOf('BODY_SECTION', 'TABLE', 'TABLE_ROW', 'TABLE_CELL', 'PARAGRAPH'));
  t.deepEqual(M.cursorContext(),
    { paraKind: 'p', paraHead: 'Body text', inTable: true });
});

test('the probe climbs through a partial selection to the thing that holds it', (t) => {
  // A character-level selection hands back a Text element; identity belongs
  // to the paragraph above it.
  const textEl = { getType: () => 'TEXT', getParent: () => chainOf('LIST_ITEM') };
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(textEl);
  t.deepEqual(M.cursorContext(),
    { listId: 'list.X', paraKind: 'li', paraHead: 'Item one' });
});

test('with no selection, the bare cursor decides', (t) => {
  const M = makeSandbox(makeDoc());
  M.__selection = null;
  M.__cursor = { getElement: () => chainOf('LIST_ITEM') };
  t.deepEqual(M.cursorContext(),
    { listId: 'list.X', paraKind: 'li', paraHead: 'Item one' });
});

test('plain paragraphs report their text; no selection at all reports nothing', (t) => {
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(chainOf('PARAGRAPH', 'BODY_SECTION'));
  t.deepEqual(M.cursorContext(), { paraKind: 'p', paraHead: 'Body text' });
  M.__selection = selectionOf(null);
  t.deepEqual(M.cursorContext(), {}, 'no selection at all');
});

test('whatever goes wrong up there, the answer stays an object', (t) => {
  const M = makeSandbox(makeDoc());
  M.__selection = { getRangeElements: () => { throw new Error('no ui'); } };
  t.deepEqual(M.cursorContext(), {});
});

test('the climb says when the cursor is in a header, a footer or a note', (t) => {
  const M = makeSandbox(makeDoc());
  ['HEADER_SECTION', 'FOOTER_SECTION', 'FOOTNOTE_SECTION'].forEach((top, i) => {
    M.__selection = selectionOf(chainOf(top, 'PARAGRAPH'));
    t.equal(M.cursorContext().segmentKind,
      ['header', 'footer', 'footnote'][i], top + ' should be recognised');
  });
});

test('the ordinary case -- the body -- is not reported as anything', (t) => {
  // Saying so would only make the probe's answer differ from itself for no
  // reason, and every panel that reads it treats absent as "in the body".
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(chainOf('BODY_SECTION', 'PARAGRAPH'));
  t.equal(M.cursorContext().segmentKind, undefined);
});

test('a list inside a header is still a list, and still in the header', (t) => {
  // The climb used to stop at the first thing it recognised; it has to carry
  // on to the top, or a list item would hide the header holding it.
  const M = makeSandbox(makeDoc());
  M.__selection = selectionOf(chainOf('HEADER_SECTION', 'LIST_ITEM'));
  t.deepEqual(M.cursorContext(),
    { listId: 'list.X', paraKind: 'li', paraHead: 'Item one', segmentKind: 'header' });
});

/* ------------------------------------------------------------------ */
suite('Which headers and footers a change goes to');

/** makeDoc plus an even-page header and footer, i.e. a left-hand spread. */
function withEvenPages() {
  const doc = makeDoc();
  const tab = doc.tabs[0].documentTab;
  tab.documentStyle.evenPageHeaderId = 'h.even';
  tab.documentStyle.evenPageFooterId = 'f.even';
  const para = (text) => [{ startIndex: 0, endIndex: text.length + 1,
    paragraph: { paragraphStyle: {}, elements: [
      { startIndex: 0, endIndex: text.length + 1, textRun: { content: text } }] } }];
  tab.headers['h.even'] = { headerId: 'h.even', content: para('Even header') };
  tab.footers['f.even'] = { footerId: 'f.even', content: para('Even footer') };
  return doc;
}

test('every header and footer says which side of the spread it prints on', (t) => {
  const M = makeSandbox(withEvenPages());
  const seg = M.readSegments(null);
  const side = {};
  seg.headers.concat(seg.footers).forEach((s) => { side[s.segmentId] = s.parity; });
  t.deepEqual(side,
    { 'h.default': 'right', 'f.default': 'right', 'h.even': 'left', 'f.even': 'left' },
    'the default and first-page ones print on right-hand pages, even-page ones on left');
});

test('a header a section break introduces is placed the same way', (t) => {
  const doc = makeDoc();
  const tab = doc.tabs[0].documentTab;
  tab.body.content.unshift({ sectionBreak: { sectionStyle: { evenPageHeaderId: 'h.s2' } } });
  tab.headers['h.s2'] = { headerId: 'h.s2', content: [
    { startIndex: 0, endIndex: 3, paragraph: { paragraphStyle: {}, elements: [
      { startIndex: 0, endIndex: 3, textRun: { content: 'S2' } }] } }] };
  const M = makeSandbox(doc);
  const found = M.readSegments(null).headers.filter((h) => h.segmentId === 'h.s2')[0];
  t.equal(found.parity, 'left');
});

test('the sidebar can name the exact segments to style', (t) => {
  // Which segments "the left-hand pages" means is a question the panel has
  // already answered on screen, so it sends the answer rather than the rule.
  const M = makeSandbox(withEvenPages());
  M.__reset();
  M.writeSegmentStyle({ tabId: null, target: 'segments',
    segmentIds: ['h.even', 'f.even'], textStyle: { bold: true } });
  const ids = allRequests(M).map((r) => r.updateTextStyle.range.segmentId).sort();
  t.deepEqual(ids, ['f.even', 'h.even'], 'and nothing else was touched');
});

test('naming no segments at all writes nothing', (t) => {
  // "L pages" on a document that has none is an empty set, not an error.
  const M = makeSandbox(makeDoc());
  M.__reset();
  const res = M.writeSegmentStyle({ tabId: null, target: 'segments',
    segmentIds: [], textStyle: { bold: true } });
  t.equal(res.applied, 0);
  t.equal(allRequests(M).length, 0);
});

test('a segment id that belongs to another tab is skipped, not fatal', (t) => {
  const M = makeSandbox(withEvenPages());
  M.__reset();
  M.writeSegmentStyle({ tabId: null, target: 'segments',
    segmentIds: ['h.even', 'h.nosuch'], textStyle: { bold: true } });
  const ids = allRequests(M).map((r) => r.updateTextStyle.range.segmentId);
  t.deepEqual(ids, ['h.even']);
});

/**
 * Three sections. The first names the document's header and footer, the
 * second names nothing and so continues them, the third breaks away with a
 * header of its own but keeps continuing the footer.
 */
function withThreeSections() {
  const doc = makeDoc();
  const tab = doc.tabs[0].documentTab;
  const para = (at, text) => ({ startIndex: at, endIndex: at + text.length + 1,
    paragraph: { paragraphStyle: {}, elements: [
      { startIndex: at, endIndex: at + text.length + 1, textRun: { content: text } }] } });
  tab.body.content.push(
    { startIndex: 200, endIndex: 201, sectionBreak: { sectionStyle: {} } },
    para(201, 'Second section'),
    { startIndex: 300, endIndex: 301,
      sectionBreak: { sectionStyle: { defaultHeaderId: 'h.s3' } } },
    para(301, 'Third section'));
  tab.headers['h.s3'] = { headerId: 'h.s3', content: [para(0, 'Third header')] };
  return doc;
}

test('each header and footer says which sections use it', (t) => {
  const M = makeSandbox(withThreeSections());
  const seg = M.readSegments(null);
  t.equal(seg.sectionCount, 3);
  const where = {};
  seg.headers.concat(seg.footers).forEach((s) => { where[s.segmentId] = s.sections; });
  t.deepEqual(where['h.default'], [0, 1],
    'the third section named its own, so the run stops there');
  t.deepEqual(where['h.s3'], [2]);
  t.deepEqual(where['f.default'], [0, 1, 2],
    'nothing ever renamed the footer, so it runs to the end');
});

test('a section that names nothing continues the one before it', (t) => {
  const M = makeSandbox(withThreeSections());
  const secs = M.readSections(null).sections;
  t.deepEqual(secs.map((s) => s.headerId), ['h.default', 'h.default', 'h.s3'],
    'the header in force, inherited where it is not named');
  t.deepEqual(secs.map((s) => s.ownHeaderIds.length > 0), [false, false, true],
    'but only the third one owns it');
  t.deepEqual(secs.map((s) => s.footerId), ['f.default', 'f.default', 'f.default']);
});

test('a section can be given its own header', (t) => {
  const M = makeSandbox(withThreeSections());
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 1, link: 'own' });
  const reqs = allRequests(M);
  t.equal(reqs.length, 1);
  t.equal(reqs[0].createHeader.type, 'DEFAULT');
  t.equal(reqs[0].createHeader.sectionBreakLocation.index, 200,
    'named by the section break that starts it');
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'footer', sectionIndex: 1, link: 'own' });
  t.ok(allRequests(M)[0].createFooter, 'and the footer is a separate request');
});

test('a section that already has its own is left alone', (t) => {
  // Asking twice is a 400 from the API, so the second ask is simply nothing.
  const M = makeSandbox(withThreeSections());
  M.__reset();
  t.equal(M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 2, link: 'own' }).applied, 0);
  t.equal(M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 0, link: 'own' }).applied, 0,
    'and the first section already has the document\u2019s');
  t.equal(allRequests(M).length, 0);
});

test('handing a header back deletes the ones that section named', (t) => {
  const doc = withThreeSections();
  const tab = doc.tabs[0].documentTab;
  // The same section also broke away for its first page, which Docs links and
  // unlinks together with the default one.
  tab.body.content[tab.body.content.length - 2]
    .sectionBreak.sectionStyle.firstPageHeaderId = 'h.s3first';
  tab.headers['h.s3first'] = { headerId: 'h.s3first', content: [] };
  const M = makeSandbox(doc);
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 2, link: 'previous' });
  t.deepEqual(allRequests(M).map((r) => r.deleteHeader.headerId), ['h.s3', 'h.s3first'],
    'all of that section\u2019s headers go, so the whole header continues again');
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'footer', sectionIndex: 2, link: 'previous' });
  t.equal(allRequests(M).length, 0, 'the footer was never its own, so nothing to undo');
});

test('every section can take its own header in one go', (t) => {
  const M = makeSandbox(withThreeSections());
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'header', link: 'own', applyAll: true });
  const made = allRequests(M);
  t.equal(made.length, 1,
    'sections 1 and 3 already have one, so only section 2 is short of it');
  t.equal(made[0].createHeader.sectionBreakLocation.index, 200);
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'footer', link: 'own', applyAll: true });
  t.deepEqual(allRequests(M).map((r) => r.createFooter.sectionBreakLocation.index),
    [200, 300], 'the footer runs on from the document, so both later ones break away');
});

test('and every section can be put back onto one', (t) => {
  const M = makeSandbox(withThreeSections());
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'header', link: 'previous', applyAll: true });
  t.deepEqual(allRequests(M).map((r) => r.deleteHeader.headerId), ['h.s3'],
    'the first section is passed over rather than refused');
  M.__reset();
  const none = M.setSegmentLink({ tabId: null, kind: 'footer', link: 'previous', applyAll: true });
  t.equal(none.applied, 0, 'and nothing is sent when they already share one');
});

test('the first section has nothing before it to continue from', (t) => {
  const M = makeSandbox(withThreeSections());
  t.throws(() => M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 0, link: 'previous' }),
    /nothing before it/);
});

test('a document with no header at all can be given one', (t) => {
  const doc = makeDoc();
  const tab = doc.tabs[0].documentTab;
  delete tab.documentStyle.defaultHeaderId;
  tab.headers = {};
  const M = makeSandbox(doc);
  M.__reset();
  M.setSegmentLink({ tabId: null, kind: 'header', sectionIndex: 0, link: 'own' });
  t.equal(allRequests(M)[0].createHeader.sectionBreakLocation.index, 0,
    'the first section break means the document itself');
});

test('the headers panel gets its segments and its two margins in one read', (t) => {
  const M = makeSandbox(makeDoc());
  const slice = M.refresh(null, 'hf');
  t.ok(slice.segments && slice.segments.headers.length, 'the segments themselves');
  t.equal(slice.pageFormat.marginHeaderPt, 36, 'and the margin that positions them');
  t.equal(slice.lists, undefined, 'and nothing the panel does not show');
  t.equal(slice.sectionCount, 1, 'and which section the cursor is in, for "this section"');
  t.equal(slice.activeSectionIndex, 0);
  t.deepEqual(slice.hfLink,
    { sectionIndex: 0, isFirst: true, ownHeader: false, ownFooter: false,
      hasHeader: true, hasFooter: true },
    'plus whether that section keeps its own, which the link buttons act on');
  t.equal(slice.section.startIndex, 0,
    'and the section itself, whose margins the panel shows and writes');

  const many = makeSandbox(withThreeSections()).refresh(null, 'hf', {});
  t.deepEqual(many.hfLinks.map((L) => L.ownHeader), [false, false, true],
    'every section, because the buttons also offer to do it to all of them');
  t.equal(many.hfLinks.length, 3);
});

suite('Marker presets');

/* The pop-up shows each preset as its first two markers, so any two presets
   sharing both would be two buttons the reader cannot tell apart. */
test('no two presets look the same for the first two levels', (t) => {
  const sb = makeSandbox(makeDoc());
  const seen = {};
  sb.BULLET_PRESETS.forEach((p) => {
    const key = p.glyphs[0] + '\u0000' + p.glyphs[1];
    t.notOk(seen[key], p.id + ' opens like ' + seen[key]);
    seen[key] = p.id;
  });
  t.equal(sb.BULLET_PRESETS.length, 15, 'every preset createParagraphBullets takes');
});
};

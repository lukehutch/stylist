/**
 * Tests that run inside Apps Script, against a real document.
 *
 * The local suite in test/ proves the add-on builds the requests it means
 * to build. It cannot prove Google *accepts* them: the advanced service,
 * the OAuth scopes, the document-tabs shape and above all the field masks
 * only exist at the far end of a real API call. This file is that call.
 *
 * How to run:
 *   gapp-test live            (pushes, runs, prints the report here)
 *   or pick gappRunInGas in the Apps Script editor and press Run.
 *
 * What it runs against is a scratch document of its own -- made on the first
 * run, emptied and refilled with a known fixture at the start of every run
 * after that. See LiveFixture.js. Nothing needs to be open in a browser, and
 * no document of yours is touched.
 *
 * Every write below re-asserts a value the document already has, so the
 * fixture comes out of a passing run exactly as it went in.
 *
 * `suite`, `test` and the assertions come from GappTester.js, which is
 * pushed alongside this file.
 */

suite('The document under test');

/**
 * First, because everything after it reads the document this leaves behind.
 * It is also the one test that changes anything: the rest put back what they
 * find.
 */
test('the scratch document is emptied and refilled with the fixture', function (t) {
  var f = resetLiveFixture_();
  t.ok(f.documentId, 'no scratch document came back');
  t.equal(f.sections, 2, 'the fixture has a second section to test against');
  t.ok(f.footnotes >= 1, 'the fixture has a footnote');
  t.ok(f.headers >= 2, 'a default header and one the second section keeps to itself');
  t.ok(f.footers >= 1, 'and a default footer');
  t.comment('https://docs.google.com/document/d/' + f.documentId + '/edit');
  t.comment(f.sections + ' section(s), ' + f.headers + ' header(s), ' +
            f.footers + ' footer(s), ' + f.footnotes + ' footnote(s)');
});

suite('Runtime');

/**
 * This used to check only that the `Docs` symbol existed, and so passed
 * happily through a whole run in which every real call failed: the advanced
 * service is declared in appsscript.json, so the symbol is there whether or
 * not the Docs API is switched on for the Cloud project behind the script.
 * Thirteen tests failed that day and this one did not, which is the wrong way
 * round -- the first check should be the one that names the cause. So it now
 * makes a call.
 */
test('the Docs advanced service is enabled and answers', function (t) {
  t.ok(typeof Docs !== 'undefined' && Docs.Documents,
    'Docs is undefined — enable the Docs advanced service in the editor.');
  try {
    Docs.Documents.get(activeDocId_());
  } catch (e) {
    t.fail('the Docs API refused the call: ' + e.message +
      '\n  If this says the API is disabled, enable it for the Cloud project' +
      ' the script belongs to (Project Settings shows which) and run again.');
    return;
  }
  t.ok(true, 'a real call went out and came back');
});

test('Docs.Documents.get returns this document', function (t) {
  var doc = fetchDoc_();
  t.ok(doc && doc.documentId, 'No documentId came back.');
  t.comment(doc.title + ' (' + doc.documentId + ')');
});

test('tab resolution works on this document', function (t) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, null);
  t.ok(ctx && ctx.content, 'resolveTab_ returned no content.');
  var flat = flattenTabs_(doc);
  t.comment(flat.length ? flat.length + ' tab(s)' : 'legacy document, no tabs');
});

suite('Reading');

test('every panel gets its data from one loadAll call', function (t) {
  var d = loadAll(null);
  // footnotes are deliberately absent: the notes panel styles them as one
  // set via the segments slice, so loading them separately reads the body
  // for data nothing on screen uses. sections is absent too: that panel
  // reads only the slice under the cursor, via refresh.
  ['pageFormat', 'namedStyles', 'segments', 'lists', 'tables',
   'constants'].forEach(function (k) {
    t.notEqual(d[k], undefined, 'loadAll returned no ' + k);
  });
  t.equal(d.namedStyles.length, 9, 'there should be nine named styles');
  t.comment(d.tables.length + ' table(s), ' + d.lists.lists.length + ' list(s)');
});

test('fields are filled from the document, not left blank', function (t) {
  var normal = namedStyle_('NORMAL_TEXT');
  t.ok(normal, 'NORMAL_TEXT is missing from the named styles.');
  t.ok(normal.textStyle && normal.textStyle.fontFamily,
    'Normal text came back with no font, so the sidebar would show a blank field.');
  t.comment('Normal text: ' + normal.textStyle.fontFamily + ' ' +
    (normal.textStyle.fontSizePt || '?') + 'pt');
});

test('page format reads back in every supported unit', function (t) {
  var pf = readPageFormat(null);
  t.ok(pf.pageWidthPt, 'No page width came back.');
  t.comment(pf.pageWidthPt + 'pt wide = ' + fromPt_(pf.pageWidthPt, 'IN', 2) + 'in');
});

suite('Writing');

/**
 * The field mask is the part most likely to be wrong, and the part the
 * local suite can only check against my own expectations. Re-asserting a
 * style's existing values proves the mask is accepted without changing it.
 */
test('updateNamedStyle is accepted with the field mask we build', function (t) {
  var normal = namedStyle_('NORMAL_TEXT');
  var res = writeNamedStyle({
    namedStyleType: 'NORMAL_TEXT',
    textStyle: normal.textStyle,
    paragraphStyle: normal.paragraphStyle
  });
  t.ok(res && res.applied > 0, 'The request was built but nothing was applied.');
  t.comment(res.applied + ' request(s) accepted, values unchanged');
});

/**
 * Does the write actually land?
 *
 * Acceptance is not the same as effect. The Docs API answers 200 to a
 * request whose field mask does not name what the payload sets, and simply
 * does nothing -- so a mask can be wrong for a long time without anything
 * saying so. These write a value, read the document back, and check the
 * value changed, which is the only way to tell the two apart.
 */
test('a margin written is a margin read back', function (t) {
  var before = readPageFormat(null);
  writePageFormat({ tabId: before.tabId, marginLeftPt: 90 });
  var after = readPageFormat(null);
  t.near(after.marginLeftPt, 90, 0.01, 'the margin did not change');
  writePageFormat({ tabId: before.tabId, marginLeftPt: before.marginLeftPt });
  t.near(readPageFormat(null).marginLeftPt, before.marginLeftPt, 0.01,
    'and it goes back where it was');
});

/**
 * writePageFormat names only "documentFormat.documentMode" in its mask,
 * while NamedStyles has a comment saying the API wants the parent path as
 * well as the leaf. If that is true here too, switching to pageless does
 * nothing at all and says so to nobody.
 */
test('switching to pageless actually switches to pageless', function (t) {
  var before = readPageFormat(null);
  try {
    writePageFormat({ tabId: before.tabId, documentMode: 'PAGELESS' });
    t.equal(readPageFormat(null).documentMode, 'PAGELESS',
      'the mask names documentFormat.documentMode but nothing changed');
  } finally {
    writePageFormat({ tabId: before.tabId, documentMode: before.documentMode || 'PAGES' });
  }
  t.equal(readPageFormat(null).documentMode, before.documentMode || 'PAGES',
    'and it goes back to pages');
});

/**
 * writeSection sends a zero-width range, on the reasoning that a range only
 * has to overlap the section it means. Nothing had ever checked that.
 */
test('a zero-width range picks out the section it sits on', function (t) {
  var secs = readSections(null);
  if (secs.sections.length < 2) {
    t.comment('this document has only one section');
    t.ok(true, 'nothing to tell apart');
    return;
  }
  var last = secs.sections[secs.sections.length - 1];
  var was = last.marginTopPt;
  var want = (was === 90) ? 108 : 90;

  writeSection({ tabId: secs.tabId, startIndex: last.startIndex, marginTopPt: want });
  var now = readSections(null).sections;
  t.near(now[now.length - 1].marginTopPt, want, 0.01,
    'the zero-width range did not reach the section');
  t.notEqual(now[0].marginTopPt, want,
    'and it reached only that one, not the first section too');

  writeSection({ tabId: secs.tabId, startIndex: last.startIndex, marginTopPt: was });
});

test('segment styling is accepted on footnotes', function (t) {
  var segs = readSegments(null);
  if (!segs.footnotes.length) {
    t.comment('this document has no footnotes');
    t.ok(true, 'nothing to style');
    return;
  }
  var cur = segs.allFootnotesStyle;
  var res = writeSegmentStyle({
    target: 'footnotes',
    textStyle: cur.textStyle,
    paragraphStyle: cur.paragraphStyle
  });
  // Every field can legitimately be blank -- that is what a document whose
  // footnotes disagree with each other looks like. Then there is nothing to
  // re-assert, and the point of the check is that the API took what we sent.
  t.equal(res.warnings.length, 0, (res.warnings || []).join('; '));
  t.comment(res.applied + ' request(s) across ' + res.segments + ' footnote(s)');
});

test('styling every footnote callout is accepted', function (t) {
  var segs = readSegments(null);
  if (!segs.footnoteReferenceCount) {
    t.comment('this document has no footnote callouts');
    t.ok(true, 'nothing to style');
    return;
  }
  var res = writeSegmentStyle({
    target: 'footnoteRefs',
    textStyle: segs.footnoteRefStyle.textStyle
  });
  t.equal(res.warnings.length, 0, (res.warnings || []).join('; '));
  t.comment(res.segments + ' callout(s) restyled, values unchanged');
});

suite('Headers and footers');

/**
 * What the probe sees from inside a header, which only a real document can
 * answer. Nothing in the DocumentApp reference says whether a cursor is
 * reachable at all while it sits in one. The panel no longer depends on the
 * answer -- it picks the section from the body paragraph instead -- but the
 * answer decides one sentence of on-screen wording, so this reports it
 * rather than asserting it. Put the cursor in a header and run again.
 */
test('the cursor probe can see into a header or footer', function (t) {
  var ctx = cursorContext();
  t.comment('cursorContext() = ' + JSON.stringify(ctx));
  t.ok(true, ctx.segmentKind
    ? 'the cursor is in a ' + ctx.segmentKind
    : 'cursor is in the body — put it in a header and run again');
});

test('every header and footer knows which sections use it', function (t) {
  var segs = readSegments(null);
  var all = segs.headers.concat(segs.footers);
  t.comment('sections in this tab: ' + segs.sectionCount);
  all.forEach(function (s) {
    t.comment(s.role + ' (' + s.segmentId + ') -> sections ' +
      s.sections.map(function (i) { return i + 1; }).join(', '));
    t.ok(s.sections.length > 0 || segs.sectionCount === 0,
      s.role + ' is used by at least one section');
  });
  if (!all.length) t.ok(true, 'this document has no headers or footers');
});

test('the headers slice says whether this section keeps its own', function (t) {
  var slice = refresh(null, 'hf', cursorContext());
  t.comment('hfLink = ' + JSON.stringify(slice.hfLink));
  t.equal(typeof slice.sectionCount, 'number', 'the section count came back');
  if (slice.hfLink) {
    t.equal(slice.hfLink.sectionIndex, slice.activeSectionIndex,
      'and it describes the section the panel is showing');
    t.equal(slice.hfLinks.length, slice.sectionCount,
      'with one for every section, which is what "all sections" acts on');
    t.equal(typeof slice.section.startIndex, 'number',
      'and the section itself, whose margins the panel writes');
  } else {
    t.ok(true, 'no sections in this tab');
  }
});

test('every header and footer is placed on a side of the spread', function (t) {
  var segs = readSegments(null);
  var all = segs.headers.concat(segs.footers);
  if (!all.length) {
    t.comment('this document has no headers or footers');
    t.ok(true, 'nothing to place');
    return;
  }
  all.forEach(function (s) {
    t.ok(s.parity === 'left' || s.parity === 'right',
      s.role + ' has no side: ' + s.parity);
  });
  t.comment(all.map(function (s) { return s.role + ' -> ' + s.parity; }).join(', '));
});

test('styling a named set of segments is accepted', function (t) {
  var segs = readSegments(null);
  var live = segs.headers.concat(segs.footers).filter(function (s) { return !s.empty; });
  if (!live.length) {
    t.comment('this document has no header or footer with text in it');
    t.ok(true, 'nothing to style');
    return;
  }
  var res = writeSegmentStyle({
    target: 'segments',
    segmentIds: live.map(function (s) { return s.segmentId; }),
    textStyle: live[0].style.textStyle,
    paragraphStyle: live[0].style.paragraphStyle
  });
  t.equal(res.warnings.length, 0, (res.warnings || []).join('; '));
  t.comment(res.applied + ' request(s) across ' + res.segments + ' segment(s)');
});

suite('Lists');

/**
 * Nothing had ever exercised the list writers against Google. They are the
 * part of the add-on furthest from the simple case: the request goes to a
 * range of paragraphs rather than to a style, the paragraphs of one list are
 * not contiguous, and the nesting level has to be matched by hand.
 */
test('the fixture lists are found, with their levels', function (t) {
  var read = readLists(null);
  t.ok(read.lists.length >= 2, 'the fixture has a bulleted and a numbered list');
  read.lists.forEach(function (l) {
    t.ok(l.levels.length > 0, 'a list came back with no levels at all');
    t.equal(typeof l.firstIndex, 'number', 'and it must know where it starts');
  });
  t.comment(read.lists.map(function (l) {
    return l.levels.length + ' level(s) at ' + l.firstIndex;
  }).join(', '));
});

test('an indent written to a list level is read back', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists to indent'); return; }
  var id = read.lists[0].listId;
  var was = read.lists[0].levels[0].style.paragraphStyle.indentStartPt;
  var want = (was === 54) ? 72 : 54;

  try {
    var res = writeListLevelStyle({
      listId: id, level: 0, paragraphStyle: { indentStartPt: want }
    });
    t.ok(res.applied > 0, 'the request was built but nothing was applied');
    var now = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    t.near(now.levels[0].style.paragraphStyle.indentStartPt, want, 0.01,
      'the indent was accepted but did not land');
  } finally {
    if (was !== undefined && was !== null) {
      writeListLevelStyle({ listId: id, level: 0,
        paragraphStyle: { indentStartPt: was } });
    }
  }
});

test('a list level takes a font, and gives it back', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists to style'); return; }
  var id = read.lists[0].listId;
  var was = read.lists[0].levels[0].style.textStyle.fontSizePt;
  var want = (was === 13) ? 14 : 13;

  try {
    writeListLevelStyle({ listId: id, level: 0, textStyle: { fontSizePt: want } });
    var now = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    t.near(now.levels[0].style.textStyle.fontSizePt, want, 0.01,
      'the size was accepted but did not land');
  } finally {
    if (was !== undefined && was !== null) {
      writeListLevelStyle({ listId: id, level: 0, textStyle: { fontSizePt: was } });
    }
  }
});

/**
 * createParagraphBullets is a content request, not a style one -- it is
 * exactly the kind the offline harness records without applying, because
 * working out what it does to every index after it is Google's job. So this
 * is the only place it can be checked at all. The marker it puts back is the
 * one the fixture started with.
 */
test('a bullet preset is accepted and changes the marker', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists to mark'); return; }
  var id = read.lists[0].listId;
  var was = read.lists[0].levels[0].glyphType || read.lists[0].levels[0].glyphSymbol;
  t.comment('level 1 marker starts as ' + was);

  try {
    var res = applyBulletPreset({ listId: id, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' });
    t.ok(res.applied > 0, 'the preset was built but nothing was applied');
    var now = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    t.ok(now && now.levels[0].glyphType,
      'a numbered preset should leave a glyph type behind');
    t.comment('and became ' + now.levels[0].glyphType);
  } finally {
    applyBulletPreset({ listId: id, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' });
  }
});

suite('Tables');

test('the fixture table is found, with its shape', function (t) {
  var read = readTables(null);
  t.ok(read.tables.length >= 1, 'the fixture has a table');
  read.tables.forEach(function (tb) {
    t.equal(typeof tb.startIndex, 'number', 'a table must know where it starts');
    t.ok(tb.rows > 0 && tb.columns > 0, 'and how big it is');
  });
  t.comment(read.tables.map(function (tb) {
    return tb.rows + 'x' + tb.columns + ' at ' + tb.startIndex;
  }).join(', '));
});

/**
 * updateTableCellStyle with a start location and no tableRange is how the
 * add-on styles every cell at once. Whether Google reads an absent tableRange
 * that way is a claim only a real call can settle.
 */
test('cell padding written to every cell is read back', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table to pad'); return; }
  var tb = read.tables[0];
  var was = (tb.cellStyle || {}).style ? tb.cellStyle.style.paddingTopPt : null;
  var want = (was === 6) ? 8 : 6;

  try {
    var res = writeTableFormat({
      startIndex: tb.startIndex, columnCount: tb.columns,
      cell: { paddingTopPt: want }
    });
    t.ok(res.applied > 0, 'the request was built but nothing was applied');
    var now = readTables(null).tables[0];
    t.near((now.cellStyle.style || {}).paddingTopPt, want, 0.01,
      'an absent tableRange did not reach every cell');
  } finally {
    if (was !== undefined && was !== null) {
      writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
        cell: { paddingTopPt: was } });
    }
  }
});

test('styling only the header row is accepted', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table to style'); return; }
  var tb = read.tables[0];
  var res = writeTableFormat({
    startIndex: tb.startIndex, columnCount: tb.columns,
    applyCellsTo: 'headerRow',
    cell: { paddingTopPt: ((tb.cellStyle || {}).style || {}).paddingTopPt || 0 }
  });
  t.ok(res.applied > 0, 'a rowSpan/columnSpan tableRange was refused');
  t.comment(res.applied + ' request(s), values unchanged');
});

test('every table in the tab can be styled from one read', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no tables'); return; }
  var res = writeTableFormat({
    allTables: true,
    cell: { paddingTopPt: ((read.tables[0].cellStyle || {}).style || {}).paddingTopPt || 0 }
  });
  t.ok(res.applied > 0, 'nothing was applied across the tab');
  t.comment(res.applied + ' request(s) across ' + read.tables.length + ' table(s)');
});

suite('Named styles land, not just get accepted');

test('a font size written to a named style is read back', function (t) {
  var was = namedStyle_('HEADING_2').textStyle.fontSizePt;
  var want = (was === 17) ? 18 : 17;
  try {
    writeNamedStyle({ namedStyleType: 'HEADING_2', textStyle: { fontSizePt: want } });
    t.near(namedStyle_('HEADING_2').textStyle.fontSizePt, want, 0.01,
      'the size was accepted but did not land — check the field mask');
  } finally {
    if (was !== undefined && was !== null) {
      writeNamedStyle({ namedStyleType: 'HEADING_2', textStyle: { fontSizePt: was } });
    }
  }
});

/**
 * The mask for a named style needs both the parent path and the leaf, which
 * is the opposite of what updateDocumentStyle wants. Only a real call can say
 * whether that is still so, and a paragraph field is the half of it that
 * nothing else here exercises.
 */
test('a paragraph field written to a named style is read back', function (t) {
  var was = namedStyle_('HEADING_2').paragraphStyle.spaceAbovePt;
  var want = (was === 15) ? 16 : 15;
  try {
    writeNamedStyle({ namedStyleType: 'HEADING_2', paragraphStyle: { spaceAbovePt: want } });
    t.near(namedStyle_('HEADING_2').paragraphStyle.spaceAbovePt, want, 0.01,
      'the spacing was accepted but did not land');
  } finally {
    if (was !== undefined && was !== null) {
      writeNamedStyle({ namedStyleType: 'HEADING_2', paragraphStyle: { spaceAbovePt: was } });
    }
  }
});

/**
 * The bug that took a live run to find: a zero margin comes back from the API
 * as a Dimension with no magnitude in it at all, and reading that as "unset"
 * made re-asserting a style quietly clear the field -- or worse, send a null
 * where a Dimension belongs, which Google refuses outright. The offline suite
 * catches it now. This makes sure the thing it is imitating still behaves the
 * way the imitation assumes.
 */
test('a zero written to a named style survives being re-asserted', function (t) {
  var was = namedStyle_('HEADING_2').paragraphStyle.spaceBelowPt;
  try {
    writeNamedStyle({ namedStyleType: 'HEADING_2', paragraphStyle: { spaceBelowPt: 0 } });
    var zeroed = namedStyle_('HEADING_2');
    t.near(zeroed.paragraphStyle.spaceBelowPt, 0, 0.01, 'the zero did not land');

    // Send the whole style straight back, which is what the sidebar does on
    // every edit to any other field.
    writeNamedStyle({
      namedStyleType: 'HEADING_2',
      textStyle: zeroed.textStyle, paragraphStyle: zeroed.paragraphStyle
    });
    t.near(namedStyle_('HEADING_2').paragraphStyle.spaceBelowPt, 0, 0.01,
      're-asserting the style lost the zero');
  } finally {
    if (was !== undefined && was !== null) {
      writeNamedStyle({ namedStyleType: 'HEADING_2', paragraphStyle: { spaceBelowPt: was } });
    }
  }
});

suite('Presets');

/**
 * These write to the property store of the account running the tests, which
 * is a real side effect outside the scratch document. Each one deletes what
 * it made, under a name nobody would choose by hand.
 */
var LIVE_PRESET_ = '__stylist_live_test__';

test('a preset of this document saves, applies and deletes', function (t) {
  try {
    var saved = savePreset({ name: LIVE_PRESET_, tabId: null });
    t.equal(saved.saved, LIVE_PRESET_, 'the preset did not save');
    t.ok(listPresets().filter(function (p) { return p.name === LIVE_PRESET_; }).length,
      'and it should be in the list');

    var before = readPageFormat(null);
    writePageFormat({ tabId: before.tabId, marginLeftPt: 108 });
    var res = applyPreset({ name: LIVE_PRESET_, tabId: before.tabId });
    t.ok(res && res.applied > 0, 'applying the preset did nothing');
    t.near(readPageFormat(null).marginLeftPt, before.marginLeftPt, 0.01,
      'the preset did not put the margin back');
  } finally {
    deletePreset({ name: LIVE_PRESET_ });
  }
  t.equal(listPresets().filter(function (p) { return p.name === LIVE_PRESET_; }).length,
    0, 'and it should be gone again');
});

/**
 * Export and import are what the Download and Upload buttons do, and the file
 * goes out to the user's disk and comes back. A field the export writes that
 * the import cannot read is a file that silently loses part of itself.
 */
test('a configuration exported and imported comes back the same', function (t) {
  var config = exportConfig(null);
  t.ok(config && config.pageFormat, 'the export carried no page format');
  t.ok(config.namedStyles && config.namedStyles.length,
    'the export carried no named styles');

  var res = importConfig({ config: config, tabId: null });
  t.ok(res.applied > 0, 'importing what was just exported applied nothing');
  // One warning is expected and not a fault: useCustomHeaderFooterMargins is
  // read-only in the API, so a document that has never had those margins
  // turned on in the Docs UI says so every time. Anything else is a fault.
  (res.warnings || []).forEach(function (w) {
    t.match(w, /useCustomHeaderFooterMargins/, 'unexpected warning: ' + w);
  });

  var again = exportConfig(null);
  t.near(again.pageFormat.marginLeftPt, config.pageFormat.marginLeftPt, 0.01,
    'the margin did not survive the round trip');
  t.equal(again.namedStyles.length, config.namedStyles.length,
    'and the styles did not all come back');
});

test('a whole bundle exports and imports', function (t) {
  var all = exportAll(null);
  t.ok(all && all.document, 'exportAll carried no configuration');
  t.equal(all.version, 2, 'a bundle should say which shape it is');
  var res = importAll({ config: all, tabId: null });
  t.ok(res && typeof res === 'object', 'importing the bundle answered nothing');
  t.comment(JSON.stringify(res).slice(0, 200));
});

suite('Custom styles');

var LIVE_STYLE_ = '__stylist_live_style__';

test('a style preset saves, applies to a named style, and deletes', function (t) {
  try {
    saveStylePreset({
      name: LIVE_STYLE_,
      textStyle: { fontFamily: 'Courier New', fontSizePt: 11 },
      paragraphStyle: { alignment: 'START' }
    });
    t.ok(listStylePresets().filter(function (p) { return p.name === LIVE_STYLE_; }).length,
      'the style preset did not save');

    var was = namedStyle_('HEADING_6').textStyle;
    try {
      var res = applyStylePresetToNamedStyle({
        name: LIVE_STYLE_, namedStyleType: 'HEADING_6', tabId: null
      });
      t.ok(res && res.applied > 0, 'applying the style preset did nothing');
      t.equal(namedStyle_('HEADING_6').textStyle.fontFamily, 'Courier New',
        'it was accepted but the font did not change');
    } finally {
      writeNamedStyle({ namedStyleType: 'HEADING_6', textStyle: was });
    }
  } finally {
    deleteStylePreset({ name: LIVE_STYLE_ });
  }
  t.equal(listStylePresets().filter(function (p) { return p.name === LIVE_STYLE_; }).length,
    0, 'and it should be gone again');
});

test('the built-in style presets are there for a new user', function (t) {
  var presets = listStylePresets();
  t.ok(presets.length > 0, 'a new user would see an empty custom-styles panel');
  t.comment(presets.map(function (p) { return p.name; }).join(', '));
});

suite('Sidebar');

test('the sidebar template renders', function (t) {
  var html = HtmlService.createTemplateFromFile('Sidebar').evaluate().getContent();
  t.match(html, /panel-page/, 'the page panel is missing from the output');
  t.match(html, /panel-hf/, 'the headers and footers panel is missing from the output');
  t.match(html, /startPolling\(\)/, 'the document poll is missing');
  t.comment(html.length + ' bytes');
});

/** The named style the tests keep coming back to. */
function namedStyle_(type) {
  var found = null;
  readNamedStyles(null).styles.forEach(function (s) {
    if (s.namedStyleType === type) found = s;
  });
  return found;
}

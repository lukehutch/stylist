/**
 * What happens on documents that are not the tidy fixture.
 *
 * Two things are being asked here, both of which production answers and the
 * old offline suite did not. First: does every read survive a document with
 * everything optional left out? proto3 omission means a real response can be
 * missing any field holding its type's default, so "the fixture has it" is no
 * evidence that a user's document will. A reader that walks into one of those
 * gaps throws, and what the user sees is a sidebar that will not open at all.
 *
 * Second: does every write come out as something the API would actually take?
 * The sandbox runs each batch past test/apicheck.js, so simply calling a
 * writer here is a test that its requests are well formed -- the right units,
 * no nulls, a mask naming everything it sends. That is the class of bug that
 * used to be found only by pushing to Google.
 */
const { makeSandbox, allRequests } = require('./harness');
const { makeDoc, makeBareDoc, makeSectionedDoc, makeLiveLikeDoc } = require('./fixture');

/**
 * gapp-tester has t.throws and no opposite, and "it did not blow up" is the
 * whole assertion for most of what follows. Returns whatever fn returned, so
 * the caller can go on to check it.
 */
function ran(t, fn, msg) {
  try {
    const out = fn();
    t.ok(true, msg || 'ran without throwing');
    return out;
  } catch (e) {
    t.fail((msg || 'threw') + ': ' + e.message);
    return undefined;
  }
}

module.exports = ({ suite, test }) => {

/* ------------------------------------------------------------------ */
suite('A document with everything optional left out');

/** Every read the sidebar performs, by the name the sidebar calls it. */
const READS = [
  'readPageFormat', 'readNamedStyles', 'readSegments', 'readLists',
  'readTables', 'readFootnotes', 'readSections', 'readDocMeta'
];

READS.forEach((name) => {
  test(name + ' survives a document with nothing in it', (t) => {
    const S = makeSandbox(makeBareDoc());
    const out = ran(t, () => S[name]('t.0'), name + ' threw');
    t.ok(out && typeof out === 'object', 'and answered with something');
  });
});

test('the whole sidebar load survives it', (t) => {
  const S = makeSandbox(makeBareDoc());
  const all = ran(t, () => S.loadAll('t.0'), 'the sidebar load threw');
  t.ok(Array.isArray(all.tabs) && all.tabs.length === 1, 'one tab');
  // Not empty: a document whose namedStyles the response left out still has
  // all nine style types, and the sidebar has to be able to offer them. What
  // matters is that each arrives with nothing set rather than not at all.
  t.equal(all.namedStyles.length, 9, 'every style type is still offered');
  t.deepEqual(all.namedStyles[0].textStyle, {}, 'and it carries no values');
  t.deepEqual(all.tables, [], 'no tables');
  t.deepEqual(all.lists.lists, [], 'no lists');
  t.deepEqual(all.segments.headers, [], 'no headers');
});

test('a missing page size reads as unset, not as zero', (t) => {
  const S = makeSandbox(makeBareDoc());
  const pf = S.readPageFormat('t.0');
  // The document inherits Letter; nothing in the response says so. Reporting
  // 0x0 would have the sidebar offer to write a zero-sized page back.
  t.ok(pf.pageWidthPt === null || pf.pageWidthPt === undefined ||
       pf.pageWidthPt > 0, 'width is unset or real, never zero: ' + pf.pageWidthPt);
});

test('a bare document still has exactly one section', (t) => {
  const S = makeSandbox(makeBareDoc());
  t.equal(S.readSections('t.0').sections.length, 1);
});

test('reading a tab that is not there does not crash the sidebar', (t) => {
  const S = makeSandbox(makeBareDoc());
  ran(t, () => S.readPageFormat('t.nonexistent'),
    'a stale tabId from the sidebar must fall back, not throw');
});

/* ------------------------------------------------------------------ */
suite('Every write is a write the API would accept');

/**
 * Each entry calls one writer with a payload covering as much of its surface
 * as it has. Passing means the sandbox's validator found nothing to object to
 * in any request the writer produced -- units, nulls, ranges, field masks.
 */
const WRITES = [
  ['page size and every margin', (S) => S.writePageFormat({
    tabId: 't.0', pageWidthPt: 595, pageHeightPt: 842,
    marginTopPt: 56, marginBottomPt: 56, marginLeftPt: 42, marginRightPt: 42,
    marginHeaderPt: 28, marginFooterPt: 28
  })],
  ['margins of zero', (S) => S.writePageFormat({
    tabId: 't.0', marginTopPt: 0, marginBottomPt: 0,
    marginLeftPt: 0, marginRightPt: 0
  })],
  ['a named style with text and paragraph parts', (S) => S.writeNamedStyle({
    tabId: 't.0', namedStyleType: 'HEADING_1',
    textStyle: { fontFamily: 'Georgia', fontSizePt: 20, bold: true,
                 italic: false, color: '#112233', backgroundColor: '#ffffff' },
    paragraphStyle: { alignment: 'CENTER', lineSpacing: 150,
                      spaceAbovePt: 12, spaceBelowPt: 6, indentStartPt: 0,
                      indentEndPt: 0, indentFirstLinePt: 0,
                      keepWithNext: true, pageBreakBefore: false }
  })],
  ['a named style whose every measure is zero', (S) => S.writeNamedStyle({
    tabId: 't.0', namedStyleType: 'NORMAL_TEXT',
    paragraphStyle: { spaceAbovePt: 0, spaceBelowPt: 0, indentStartPt: 0,
                      indentEndPt: 0, indentFirstLinePt: 0 }
  })],
  ['a named style carrying a zero-width border', (S) => S.writeNamedStyle({
    tabId: 't.0', namedStyleType: 'NORMAL_TEXT',
    paragraphStyle: { borderTop: { color: '#000000', widthPt: 0, paddingPt: 0,
                                   dashStyle: 'SOLID' } }
  })],
  ['many named styles at once, as a preset import does', (S) => S.writeNamedStyles({
    tabId: 't.0', styles: [
      { namedStyleType: 'NORMAL_TEXT', textStyle: { fontSizePt: 11 } },
      { namedStyleType: 'HEADING_1', textStyle: { fontSizePt: 20 } },
      { namedStyleType: 'HEADING_2', textStyle: { fontSizePt: 16 } }
    ]
  })],
  ['a header style', (S) => S.writeSegmentStyle({
    tabId: 't.0', target: 'headers',
    textStyle: { fontFamily: 'Arial', fontSizePt: 9, italic: true },
    paragraphStyle: { alignment: 'END', spaceBelowPt: 0 }
  })],
  ['a footnote style, with the page break silently dropped', (S) =>
    S.writeSegmentStyle({
      tabId: 't.0', target: 'footnotes',
      paragraphStyle: { pageBreakBefore: true, alignment: 'START' }
    })],
  ['a table format', (S) => S.writeTableFormat({
    tabId: 't.0', allTables: true,
    cell: {
      borderTop: { color: '#333333', widthPt: 1, dashStyle: 'SOLID' },
      borderBottom: { color: '#333333', widthPt: 1, dashStyle: 'SOLID' },
      paddingTopPt: 4, paddingBottomPt: 4, paddingLeftPt: 6, paddingRightPt: 6,
      contentAlignment: 'TOP', backgroundColor: '#f5f5f5'
    }
  })],
  ['a table with no padding and no border', (S) => S.writeTableFormat({
    tabId: 't.0', allTables: true,
    cell: {
      paddingTopPt: 0, paddingBottomPt: 0, paddingLeftPt: 0, paddingRightPt: 0,
      borderTop: { color: '#000000', widthPt: 0, dashStyle: 'SOLID' }
    }
  })],
  ['a table header row only', (S) => S.writeTableFormat({
    tabId: 't.0', allTables: true, applyCellsTo: 'headerRow',
    cell: { backgroundColor: '#eeeeee', paddingTopPt: 2 }
  })],
  ['a list level style', (S) => S.writeListLevelStyle({
    tabId: 't.0', allLists: true, level: 0,
    textStyle: { fontFamily: 'Arial', fontSizePt: 11, foregroundColor: '#000000' },
    paragraphStyle: { indentStartPt: 36, indentFirstLinePt: 18 }
  })],
  ['a list level indented to zero', (S) => S.writeListLevelStyle({
    tabId: 't.0', allLists: true, level: 0,
    paragraphStyle: { indentStartPt: 0, indentFirstLinePt: 0 }
  })]
];

WRITES.forEach(([what, run]) => {
  test(what + ' produces requests the API would take', (t) => {
    const S = makeSandbox(makeDoc());
    // The sandbox throws out of batchUpdate when a request breaks a rule the
    // API enforces, so getting a result back at all is most of the test.
    const res = ran(t, () => run(S), 'the batch was rejected');
    t.ok(allRequests(S).length > 0, 'and it actually wrote something');
    t.ok(res && typeof res === 'object', 'and answered the sidebar');
  });
});

test('a section write is accepted, zero-width range and all', (t) => {
  const S = makeSandbox(makeSectionedDoc());
  const secs = S.readSections('t.0');
  t.ok(secs.sections.length >= 2, 'the fixture has more than one section');
  ran(t, () => S.writeSection({
    tabId: 't.0', sectionIndex: secs.sections.length - 1,
    marginTopPt: 90, marginBottomPt: 0, useFirstPageHeaderFooter: false,
    flipPageOrientation: false, pageNumberStart: 1
  }), 'the section write was rejected');
});

test('a writer given nothing writes nothing, rather than an empty batch', (t) => {
  const S = makeSandbox(makeDoc());
  // An empty request list is itself something the API refuses, so a writer
  // that finds nothing to do must not reach batchUpdate at all.
  ran(t, () => S.writePageFormat({ tabId: 't.0' }), 'empty page write');
  ran(t, () => S.writeSection({ tabId: 't.0' }), 'empty section write');
  t.deepEqual(allRequests(S), [], 'and it sent no batch');
});

/* ------------------------------------------------------------------ */
suite('What was written is what is read back');

/**
 * Only possible offline since the sandbox began applying style writes through
 * their field masks. A round trip failing here is a mask that does not name
 * what the payload carries -- which in production is not an error at all: the
 * API answers 200 and quietly changes nothing.
 */
const ROUND_TRIPS = [
  ['every margin', 't.0',
    { marginTopPt: 56, marginBottomPt: 57, marginLeftPt: 58, marginRightPt: 59 },
    (S) => S.readPageFormat('t.0')],
  ['margins set to zero', 't.0',
    { marginTopPt: 0, marginLeftPt: 0 },
    (S) => S.readPageFormat('t.0')],
  ['the page size', 't.0',
    { pageWidthPt: 595, pageHeightPt: 842 },
    (S) => S.readPageFormat('t.0')]
];

ROUND_TRIPS.forEach(([what, tabId, payload, read]) => {
  test(what + ': written, then read back', (t) => {
    const S = makeSandbox(makeDoc());
    S.writePageFormat(Object.assign({ tabId }, payload));
    const got = read(S);
    Object.keys(payload).forEach((k) => {
      t.near(got[k], payload[k], 1e-6, k + ' came back as ' + got[k]);
    });
  });
});

test('a named style survives the round trip', (t) => {
  const S = makeSandbox(makeDoc());
  S.writeNamedStyle({
    tabId: 't.0', namedStyleType: 'HEADING_1',
    textStyle: { fontFamily: 'Georgia', fontSizePt: 22, bold: false },
    paragraphStyle: { alignment: 'CENTER', spaceAbovePt: 18 }
  });
  const h1 = S.readNamedStyles('t.0').styles
    .filter((s) => s.namedStyleType === 'HEADING_1')[0];
  t.equal(h1.textStyle.fontFamily, 'Georgia');
  t.near(h1.textStyle.fontSizePt, 22, 1e-6);
  // Not `=== false`: proto3 leaves a false out of the response altogether, so
  // a named style that is not bold and one that never mentions bold arrive
  // identically. The sidebar draws both as an unchecked box, which is right --
  // a named style's boldness is always resolved, never inherited.
  t.notOk(h1.textStyle.bold, 'and bold was really turned off');
  t.equal(h1.paragraphStyle.alignment, 'CENTER');
  t.near(h1.paragraphStyle.spaceAbovePt, 18, 1e-6);
});

test('a value written twice stays put the second time', (t) => {
  // Re-asserting a style used to clear any field holding a zero, because a
  // zero magnitude arrives with no magnitude at all and was read as unset.
  const S = makeSandbox(makeDoc());
  const style = {
    tabId: 't.0', namedStyleType: 'NORMAL_TEXT',
    paragraphStyle: { spaceAbovePt: 0, spaceBelowPt: 10, indentStartPt: 0 }
  };
  S.writeNamedStyle(style);
  const once = S.readNamedStyles('t.0').styles
    .filter((s) => s.namedStyleType === 'NORMAL_TEXT')[0];
  S.writeNamedStyle(style);
  const twice = S.readNamedStyles('t.0').styles
    .filter((s) => s.namedStyleType === 'NORMAL_TEXT')[0];
  t.deepEqual(twice.paragraphStyle, once.paragraphStyle,
    'writing the same style again changed it');
  t.near(twice.paragraphStyle.spaceAbovePt, 0, 1e-6, 'and the zero is still a zero');
});

test('a whole configuration round-trips through a preset', (t) => {
  const S = makeSandbox(makeLiveLikeDoc());
  S.writePageFormat({ tabId: 't.0', marginTopPt: 90, marginLeftPt: 90 });
  S.savePreset({ name: 'trip', tabId: 't.0' });
  S.writePageFormat({ tabId: 't.0', marginTopPt: 20, marginLeftPt: 20 });
  S.applyPreset({ name: 'trip', tabId: 't.0' });
  const pf = S.readPageFormat('t.0');
  t.near(pf.marginTopPt, 90, 1e-6);
  t.near(pf.marginLeftPt, 90, 1e-6);
});

};

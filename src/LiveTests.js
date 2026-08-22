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
 *   or pick gappRunInGas in the Apps Script editor and press Run, with the
 *   document you want to test open.
 *
 * Every write re-asserts values the document already has, so a passing run
 * leaves the formatting exactly as it found it. A failing run is the
 * interesting case, and Ctrl+Z in the document undoes anything it did.
 *
 * `suite`, `test` and the assertions come from GappTester.js, which is
 * pushed alongside this file.
 */

suite('Runtime');

test('the Docs advanced service is enabled', function (t) {
  t.ok(typeof Docs !== 'undefined' && Docs.Documents,
    'Docs is undefined — enable the Docs advanced service in the editor.');
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

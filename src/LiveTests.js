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
  ['pageFormat', 'sections', 'namedStyles', 'segments', 'lists', 'tables',
   'footnotes', 'constants'].forEach(function (k) {
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

suite('Sidebar');

test('the sidebar template renders', function (t) {
  var html = HtmlService.createTemplateFromFile('Sidebar').evaluate().getContent();
  t.match(html, /panel-page/, 'the page panel is missing from the output');
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

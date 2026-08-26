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

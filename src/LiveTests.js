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
 * Almost every write below puts back what it found, so the fixture comes out
 * of a passing run much as it went in. The exceptions are the last suite,
 * which strips a list's markers and rewrites the footnotes -- neither can be
 * undone through the API -- and the handful of resets Google offers no way to
 * ask for, such as taking a page number back off a section. All of them are
 * harmless here, because the fixture is rebuilt from scratch at the start of
 * every run, but they are why the destructive suite comes last.
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
  t.equal(f.tables, 2, 'two tables, so "every table" and "make them match" mean something');
  t.comment('https://docs.google.com/document/d/' + f.documentId + '/edit');
  t.comment(f.sections + ' section(s), ' + f.headers + ' header(s), ' +
            f.footers + ' footer(s), ' + f.footnotes + ' footnote(s), ' +
            f.tables + ' table(s)');
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

/**
 * The page and styles panels poll on readDocMeta, which asks Docs for a field
 * mask rather than for the whole document. A mask Google will not accept is
 * not an error: the full document comes back instead, silently, and the poll
 * costs what a full read costs on every tick. So this checks both halves --
 * that the answer is right, and that it is the small answer.
 */
test('the metadata read is smaller than the document and still agrees with it', function (t) {
  var meta = readDocMeta(null);
  var full = readPageFormat(null);
  t.near(meta.pageFormat.pageWidthPt, full.pageWidthPt, 0.01,
    'the masked read and the full read disagree about the page width');
  t.equal(meta.namedStyles.length, 9, 'all nine named styles should come back');
  if (meta.tabs.length) {
    t.ok(meta.activeTabId, 'the tab list came back but none of them is the active one');
  } else {
    t.ok(true, 'legacy document, no tabs');
  }

  // The mask asks for no body, so a body coming back means it did not take.
  var raw = Docs.Documents.get(activeDocId_(), {
    includeTabsContent: true,
    fields: 'title,tabs.tabProperties,' +
            'tabs.documentTab.documentStyle,tabs.documentTab.namedStyles'
  });
  var carriesBody = !!(raw.body || (raw.tabs || []).some(function (tb) {
    return !!((tb.documentTab || {}).body);
  }));
  t.notOk(carriesBody, 'the field mask did not take: the poll is reading whole documents');
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

/**
 * Each panel refreshes on its own and asks for the one slice it draws. A slice
 * that comes back without its data is a panel that redraws itself empty, which
 * is what the user sees after every write.
 */
test('every panel gets the slice it asks for', function (t) {
  var ctx = cursorContext();
  [['page', ['pageFormat']],
   ['styles', ['namedStyles']],
   ['lists', ['lists']],
   ['tables', ['tables']],
   ['segments', ['segments']],
   ['sections', ['sections', 'sectionCount', 'activeSectionIndex']],
   ['hf', ['segments', 'pageFormat', 'hfLinks', 'sectionCount']]].forEach(function (pair) {
    var slice = refresh(null, pair[0], ctx);
    pair[1].forEach(function (k) {
      t.notEqual(slice[k], undefined, 'refresh("' + pair[0] + '") came back with no ' + k);
    });
  });
});

test('the presets slice reads the user, and not the document at all', function (t) {
  var slice = refresh(null, 'presets', {});
  t.notEqual(slice.presets, undefined, 'the presets panel would draw empty');
  t.notEqual(slice.stylePresets, undefined, 'and so would the custom styles panel');
  t.equal(slice.pageFormat, undefined,
    'presets live in the user properties; reading the document for them is wasted time');
});

test('a refresh naming no panel brings back everything', function (t) {
  var all = refresh(null, null, {});
  ['pageFormat', 'namedStyles', 'sections', 'lists', 'segments', 'tables']
    .forEach(function (k) { t.notEqual(all[k], undefined, 'a full refresh has no ' + k); });
});

/**
 * A tab id goes stale when the tab it named is deleted while the sidebar is
 * open. Falling back to the first tab is what keeps the panel showing
 * something rather than throwing where the user cannot see it.
 */
test('a tab id that no longer exists falls back instead of failing', function (t) {
  var pf = readPageFormat('t.nosuchtab');
  t.ok(pf, 'reading with a stale tab id came back with nothing');
  t.near(pf.pageWidthPt, readPageFormat(null).pageWidthPt, 0.01,
    'and it should be the tab the sidebar would have got anyway');
});

test('the style in force at the top of a header can be read', function (t) {
  var segs = readSegments(null);
  var head = segs.headers.filter(function (h) { return !h.empty; })[0];
  if (!head) { t.ok(true, 'no header with text in it'); return; }
  var st = readSegmentStyle(null, 'header', head.segmentId);
  t.ok(st.textStyle, 'the header editor would be seeded with nothing');
  t.equal(typeof st.paragraphStyle, 'object', 'and with no paragraph settings either');
  t.comment(head.role + ': ' + JSON.stringify(st.textStyle).slice(0, 140));
});

test('asking for a segment that is not there answers blanks, not an error', function (t) {
  t.deepEqual(readSegmentStyle(null, 'header', 'kix.nosuchsegment'),
    { textStyle: {}, paragraphStyle: {} },
    'a stale segment id should read as empty rather than throw');
});

test('the footnotes read finds the fixture footnote and numbers it', function (t) {
  var read = readFootnotes(null);
  t.ok(read.footnotes.length >= 1, 'the fixture has a footnote and it was not found');
  read.footnotes.forEach(function (f) {
    t.ok(f.footnoteId, 'a footnote came back with no id');
    t.ok(String(f.number).length, 'and with no number to print beside it');
  });
  t.comment(read.footnotes.map(function (f) {
    return f.number + ': ' + (f.preview || '(empty)');
  }).join(' | '));
});

test('what the notes panel promises about footnotes is what the API offers', function (t) {
  var caps = footnoteCapabilities();
  t.notOk(caps.endnotesSupported, 'nothing in the Docs schema mentions endnotes');
  t.notOk(caps.pageBreakControlSupported, 'nor footnote pagination');
  t.notOk(caps.numberingFormatSupported, 'nor numbering format');
  t.ok(caps.notes.length >= 4, 'the panel prints these, so they have to be there');
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

suite('Page setup');

test('a page size written is a page size read back', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, pageWidthPt: 595.28, pageHeightPt: 841.89 });
    var now = readPageFormat(null);
    t.near(now.pageWidthPt, 595.28, 0.5, 'the width did not land');
    t.near(now.pageHeightPt, 841.89, 0.5, 'the height did not land');
  } finally {
    writePageFormat({ tabId: was.tabId,
      pageWidthPt: was.pageWidthPt, pageHeightPt: was.pageHeightPt });
  }
  t.near(readPageFormat(null).pageWidthPt, was.pageWidthPt, 0.5, 'and it goes back');
});

/**
 * pageSize is one message and the mask names the whole of it, so a caller
 * that sets only the width is not asking to leave the height alone -- it is
 * sending a null where a Dimension belongs, and Google refuses the batch. The
 * add-on fills the missing side in from the document; this is the call that
 * proves what it builds is taken.
 */
test('a width on its own is completed from the document, not refused', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, pageWidthPt: 500 });
    var now = readPageFormat(null);
    t.near(now.pageWidthPt, 500, 0.5, 'the width did not land');
    t.near(now.pageHeightPt, was.pageHeightPt, 0.5, 'and the height should be untouched');
  } finally {
    writePageFormat({ tabId: was.tabId,
      pageWidthPt: was.pageWidthPt, pageHeightPt: was.pageHeightPt });
  }
});

test('the orientation flag flips, and flips back', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, flipPageOrientation: !was.flipPageOrientation });
    t.equal(readPageFormat(null).flipPageOrientation, !was.flipPageOrientation,
      'the flip did not land');
  } finally {
    writePageFormat({ tabId: was.tabId, flipPageOrientation: was.flipPageOrientation });
  }
  t.equal(readPageFormat(null).flipPageOrientation, was.flipPageOrientation, 'and it goes back');
});

/** The sidebar hands over whatever is in the text box, which is a string. */
test('a page number typed as text lands as a number', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, pageNumberStart: '4' });
    t.equal(readPageFormat(null).pageNumberStart, 4, 'the string "4" did not land as 4');
  } finally {
    writePageFormat({ tabId: was.tabId, pageNumberStart: was.pageNumberStart });
  }
});

test('the first-page and even-page header switches land', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId,
      useFirstPageHeaderFooter: true, useEvenPageHeaderFooter: true });
    var now = readPageFormat(null);
    t.ok(now.useFirstPageHeaderFooter, 'the first-page switch did not land');
    t.ok(now.useEvenPageHeaderFooter, 'the even-page switch did not land');
  } finally {
    writePageFormat({ tabId: was.tabId,
      useFirstPageHeaderFooter: was.useFirstPageHeaderFooter,
      useEvenPageHeaderFooter: was.useEvenPageHeaderFooter });
  }
  t.equal(readPageFormat(null).useFirstPageHeaderFooter, was.useFirstPageHeaderFooter,
    'and they go back');
});

/**
 * useCustomHeaderFooterMargins is read-only in the API, so the two margins it
 * governs can be written all day and change nothing until it is switched on
 * from the Docs UI. The add-on cannot switch it on, so it says so; writing in
 * silence would leave the user believing a number that never took effect.
 */
test('header and footer margins are written with the warning they need', function (t) {
  var was = readPageFormat(null);
  var res = writePageFormat({ tabId: was.tabId, marginHeaderPt: was.marginHeaderPt || 36 });
  t.ok(res.applied > 0, 'the write itself should still go out');
  if (was.useCustomHeaderFooterMargins) {
    t.equal(res.warnings.length, 0, 'custom margins are on, so there is nothing to warn about');
  } else {
    t.equal(res.warnings.length, 1, 'the user was not told the value cannot take effect');
    t.match(res.warnings[0], /useCustomHeaderFooterMargins/, res.warnings[0]);
  }
  if (was.marginHeaderPt !== null && was.marginHeaderPt !== undefined) {
    writePageFormat({ tabId: was.tabId, marginHeaderPt: was.marginHeaderPt });
  }
});

test('an empty payload never reaches Google', function (t) {
  var res = writePageFormat({ tabId: readPageFormat(null).tabId });
  t.equal(res.applied, 0, 'a write with nothing in it should send no batch at all');
});

/**
 * The background is the one property Google will not reset: naming it in a
 * mask with no value behind it fails the whole batch, in as many words --
 * "A value for background color must be specified in order to update it."
 * A page cannot be transparent either, so clearing has to mean writing the
 * white that a document with no background already renders.
 */
test('clearing the page background writes white, and Google keeps it', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, backgroundColor: '' });
    t.equal(readPageFormat(null).backgroundColor, '#ffffff',
      'clearing the background left something other than white behind');
  } finally {
    if (was.backgroundColor) {
      writePageFormat({ tabId: was.tabId, backgroundColor: was.backgroundColor });
    }
  }
});

test('a colour written to the page background is read back', function (t) {
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, backgroundColor: '#fff2cc' });
    t.equal(readPageFormat(null).backgroundColor, '#fff2cc', 'the background did not land');
  } finally {
    writePageFormat({ tabId: was.tabId, backgroundColor: was.backgroundColor || '' });
  }
});

/**
 * And the bug that came of the two being confused. A document nobody ever set
 * a background on reads back a null, that null went into the mask as a reset,
 * and Google refused the whole batch -- so applying any whole-document preset,
 * or uploading a file, failed outright on most documents. Sending the null
 * explicitly reproduces it whatever state this document happens to be in.
 */
test('a configuration carrying no background imports instead of failing', function (t) {
  var was = readPageFormat(null);
  var res = writePageFormat({ tabId: was.tabId, backgroundColor: null,
                              marginRightPt: was.marginRightPt });
  t.ok(res.applied > 0, 'the rest of the page setup should still have been written');
  t.near(readPageFormat(null).marginRightPt, was.marginRightPt, 0.01, 'and it should have landed');
});

suite('Sections');

test('every section says where it starts and which is first', function (t) {
  var secs = readSections(null).sections;
  t.ok(secs.length >= 1, 'a document always has at least one section');
  secs.forEach(function (sec, i) {
    t.equal(typeof sec.startIndex, 'number', 'section ' + (i + 1) + ' has no start index');
    t.equal(sec.isFirst, i === 0, 'only the first section is the first one');
  });
  t.comment(secs.map(function (sec) {
    return sec.sectionType + '@' + sec.startIndex;
  }).join(', '));
});

/**
 * A section can carry a page number of its own, which is how a document
 * restarts numbering after a break. Nothing had checked that the field
 * reaches SectionStyle rather than DocumentStyle.
 */
test('a section takes a page number of its own', function (t) {
  var secs = readSections(null);
  var last = secs.sections[secs.sections.length - 1];
  var was = last.pageNumberStart;
  try {
    writeSection({ tabId: secs.tabId, startIndex: last.startIndex, pageNumberStart: 7 });
    var now = readSections(null).sections;
    t.equal(now[now.length - 1].pageNumberStart, 7,
      'the page number did not land on the section');
  } finally {
    // A section that never had one cannot be given it back: writeSection has
    // no way to say "reset". The fixture is rebuilt at the start of each run,
    // so the 7 goes no further than this one.
    if (was !== undefined && was !== null) {
      writeSection({ tabId: secs.tabId, startIndex: last.startIndex, pageNumberStart: was });
    }
  }
});

test('apply-to-all-sections reaches every section in one batch', function (t) {
  var secs = readSections(null);
  if (secs.sections.length < 2) { t.ok(true, 'this document has only one section'); return; }
  var was = secs.sections.map(function (sec) { return sec.marginLeftPt; });
  var want = (was[0] === 90) ? 108 : 90;
  try {
    var res = writeSection({ tabId: secs.tabId, applyAll: true, marginLeftPt: want });
    t.equal(res.applied, secs.sections.length, 'one request per section should have gone out');
    readSections(null).sections.forEach(function (sec, i) {
      t.near(sec.marginLeftPt, want, 0.01, 'section ' + (i + 1) + ' was left behind');
    });
  } finally {
    readSections(null).sections.forEach(function (sec, i) {
      if (was[i] !== null && was[i] !== undefined) {
        writeSection({ tabId: secs.tabId, startIndex: sec.startIndex, marginLeftPt: was[i] });
      }
    });
  }
});

/**
 * The other half of "apply to all": unify copies the section the panel is
 * showing over the rest, field by field. Both sections are set to known and
 * different values first, so the check is that the difference is gone
 * afterwards rather than that two nulls match.
 */
test('unify copies the section the panel is showing over the rest', function (t) {
  var secs = readSections(null);
  if (secs.sections.length < 2) { t.ok(true, 'this document has only one section'); return; }
  var first = secs.sections[0];
  var last = secs.sections[secs.sections.length - 1];
  var wasFirst = first.marginTopPt;
  var wasLast = last.marginTopPt;
  try {
    writeSection({ tabId: secs.tabId, startIndex: first.startIndex, marginTopPt: 96 });
    writeSection({ tabId: secs.tabId, startIndex: last.startIndex, marginTopPt: 123 });
    var res = unifySections({ tabId: secs.tabId, fromStartIndex: first.startIndex });
    t.ok(res.applied > 0, 'unify sent nothing');
    var now = readSections(null).sections;
    t.near(now[now.length - 1].marginTopPt, 96,
      0.01, 'the last section did not come into line with the first');
  } finally {
    [[first.startIndex, wasFirst], [last.startIndex, wasLast]].forEach(function (pair) {
      if (pair[1] !== null && pair[1] !== undefined) {
        writeSection({ tabId: secs.tabId, startIndex: pair[0], marginTopPt: pair[1] });
      }
    });
  }
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

/**
 * The other half of the headers panel: not just that a write is accepted,
 * but that the style comes back out of a header the way it went in.
 */
test('styling every header lands, and reads back from one', function (t) {
  var segs = readSegments(null);
  var live = segs.headers.filter(function (s) { return !s.empty; });
  if (!live.length) { t.ok(true, 'this document has no header with text in it'); return; }
  var id = live[0].segmentId;
  var was = readSegmentStyle(null, 'header', id).textStyle.fontSizePt;
  var want = (was === 10) ? 11 : 10;
  try {
    var res = writeSegmentStyle({ target: 'headers', textStyle: { fontSizePt: want } });
    t.ok(res.applied > 0, 'nothing was applied to any header');
    t.near(readSegmentStyle(null, 'header', id).textStyle.fontSizePt, want, 0.01,
      'the size was accepted but did not land in the header');
  } finally {
    if (was !== undefined && was !== null) {
      writeSegmentStyle({ target: 'headers', textStyle: { fontSizePt: was } });
    }
  }
});

/**
 * page_break_before is the one paragraph field the API refuses outside the
 * body, in as many words, so the add-on strips it before sending. In the body
 * it must go through untouched and warn about nothing.
 */
test('a page break asked for in the body is sent, not stripped', function (t) {
  var res = writeSegmentStyle({ target: 'body', paragraphStyle: { pageBreakBefore: false } });
  t.ok(res.applied > 0, 'the body write went nowhere');
  // This fixture has tables in it, so the write is broken up around them and
  // says so. What must not happen is the whole field being dropped.
  (res.warnings || []).forEach(function (w) {
    t.match(w, /inside tables/i, 'unexpected warning: ' + w);
  });
});

/**
 * The API refuses page_break_before inside a table, and refuses the whole
 * batch with it -- so before the body write was broken up around the tables,
 * asking for it anywhere in the body of a document with a table in it failed
 * outright with "Cannot update page-break-before when the range contains
 * paragraphs in a table".
 */
test('a body page break survives the tables in the way', function (t) {
  if (!readTables(null).tables.length) { t.ok(true, 'no tables in this document'); return; }
  var res = writeSegmentStyle({
    target: 'body',
    paragraphStyle: { pageBreakBefore: false, alignment: 'START' }
  });
  t.ok(res.applied > 1, 'the write should have gone out in pieces, not as one range');
  t.equal(res.warnings.length, 1, 'the user was not told the break skipped the tables');
  t.match(res.warnings[0], /inside tables/i, res.warnings[0]);
});

/**
 * And the case that used to say nothing at all: a header write whose only
 * field was the page break comes out empty after the strip, so no batch goes
 * out -- and without the warning the user would watch a setting they asked
 * for do nothing, for a reason they were never given.
 */
test('a header write that was only a page break still says it was dropped', function (t) {
  var res = writeSegmentStyle({ target: 'headers', paragraphStyle: { pageBreakBefore: true } });
  t.equal(res.applied, 0, 'nothing should have been sent to Google');
  t.equal(res.warnings.length, 1, 'the user was told nothing about the field being dropped');
  t.match(res.warnings[0], /page-break-before/i, res.warnings[0]);
});

/**
 * Link-to-previous, which creates and deletes real headers. The second
 * section is given its own header and then handed back, which deletes it
 * again -- so this ends where it started as long as the second section did
 * not have one to begin with, and is skipped if it did.
 */
test('a section can be given its own header and handed back', function (t) {
  var slice = refresh(null, 'hf', cursorContext());
  if (slice.sectionCount < 2) { t.ok(true, 'this document has only one section'); return; }
  if (slice.hfLinks[1].ownHeader) {
    t.ok(true, 'section 2 already keeps its own header; leaving it alone');
    return;
  }
  var res = setSegmentLink({ kind: 'header', sectionIndex: 1, link: 'own' });
  t.ok(res.applied > 0, 'createHeader was refused for a section break location');
  t.ok(refresh(null, 'hf', cursorContext()).hfLinks[1].ownHeader,
    'the section did not end up with its own header');

  res = setSegmentLink({ kind: 'header', sectionIndex: 1, link: 'previous' });
  t.ok(res.applied > 0, 'deleteHeader was refused');
  t.notOk(refresh(null, 'hf', cursorContext()).hfLinks[1].ownHeader,
    'the section did not go back to continuing the previous one');
});

/** The first section has nothing before it, so there is nothing to continue. */
test('the first section refuses to continue from what is not there', function (t) {
  t.throws(function () {
    setSegmentLink({ kind: 'header', sectionIndex: 0, link: 'previous' });
  }, /nothing before it/, 'the first section should have refused');
});

/**
 * "Every section" is the same request with the first one passed over rather
 * than refused: asking for all of them is not the same mistake as asking for
 * the first one by name.
 */
test('asking every section to continue passes the first one over', function (t) {
  var slice = refresh(null, 'hf', cursorContext());
  if (slice.sectionCount < 2) { t.ok(true, 'this document has only one section'); return; }
  var res = setSegmentLink({ kind: 'footer', applyAll: true, link: 'previous' });
  t.ok(res.applied >= 0, 'the batch should not have thrown');
  t.comment(res.applied + ' footer(s) deleted across ' + slice.sectionCount + ' section(s)');
});

/* ------------------------------------------------------------------ *
 * Clearing a colour
 *
 * Every colour in the add-on is cleared the same way: an empty string
 * becomes an empty OptionalColor, which Google reads as "no colour" and
 * the document renders as transparent. The page background is the one
 * exception -- it is the only field Google refuses to reset, which is
 * covered under Page setup -- so each of the others is checked here
 * rather than assumed to behave like its neighbours.
 * ------------------------------------------------------------------ */

suite('Clearing a colour');

/**
 * A header rather than the body, because a header's styling can be read back
 * whole -- readSegmentStyle answers with the text and paragraph style in
 * force at its start -- while nothing in the add-on reads a body-wide
 * summary. The conversion under test is the same one either way.
 */
function firstLiveHeaderId_() {
  var live = readSegments(null).headers.filter(function (s) { return !s.empty; });
  return live.length ? live[0].segmentId : null;
}

test('a text highlight can be set and then cleared away', function (t) {
  var id = firstLiveHeaderId_();
  if (!id) { t.ok(true, 'no header with text in it'); return; }
  var was = readSegmentStyle(null, 'header', id).textStyle.backgroundColor;
  try {
    writeSegmentStyle({ target: 'headers', textStyle: { backgroundColor: '#fff2cc' } });
    t.equal(readSegmentStyle(null, 'header', id).textStyle.backgroundColor, '#fff2cc',
      'the highlight did not land');
    writeSegmentStyle({ target: 'headers', textStyle: { backgroundColor: '' } });
    t.notOk(readSegmentStyle(null, 'header', id).textStyle.backgroundColor,
      'an empty OptionalColor left a highlight behind');
  } finally {
    writeSegmentStyle({ target: 'headers', textStyle: { backgroundColor: was || '' } });
  }
});

/**
 * Text always ends up some colour, so the check here is that the colour that
 * was written is gone -- not that the field comes back empty, which is
 * Google's choice to make and not one the add-on depends on.
 */
test('a text colour can be set and then cleared away', function (t) {
  var id = firstLiveHeaderId_();
  if (!id) { t.ok(true, 'no header with text in it'); return; }
  var was = readSegmentStyle(null, 'header', id).textStyle.foregroundColor;
  try {
    writeSegmentStyle({ target: 'headers', textStyle: { foregroundColor: '#b31412' } });
    t.equal(readSegmentStyle(null, 'header', id).textStyle.foregroundColor, '#b31412',
      'the colour did not land');
    writeSegmentStyle({ target: 'headers', textStyle: { foregroundColor: '' } });
    var now = readSegmentStyle(null, 'header', id).textStyle.foregroundColor;
    t.notEqual(now, '#b31412', 'clearing the text colour left it in place');
    t.comment('cleared text colour reads back as ' + JSON.stringify(now));
  } finally {
    writeSegmentStyle({ target: 'headers', textStyle: { foregroundColor: was || '' } });
  }
});

test('paragraph shading can be set and then cleared away', function (t) {
  var id = firstLiveHeaderId_();
  if (!id) { t.ok(true, 'no header with text in it'); return; }
  var was = readSegmentStyle(null, 'header', id).paragraphStyle.shadingColor;
  try {
    writeSegmentStyle({ target: 'headers', paragraphStyle: { shadingColor: '#f1f3f4' } });
    t.equal(readSegmentStyle(null, 'header', id).paragraphStyle.shadingColor, '#f1f3f4',
      'the shading did not land');
    writeSegmentStyle({ target: 'headers', paragraphStyle: { shadingColor: '' } });
    t.notOk(readSegmentStyle(null, 'header', id).paragraphStyle.shadingColor,
      'clearing the shading left it behind');
  } finally {
    writeSegmentStyle({ target: 'headers', paragraphStyle: { shadingColor: was || '' } });
  }
});

test('a table cell fill can be set and then cleared away', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table to fill'); return; }
  var tb = read.tables[0];
  writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
    cell: { backgroundColor: '#d9ead3' } });
  t.equal(((readTables(null).tables[0].cellStyle || {}).style || {}).backgroundColor,
    '#d9ead3', 'the cell fill did not land');
  writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
    cell: { backgroundColor: '' } });
  t.notOk(((readTables(null).tables[0].cellStyle || {}).style || {}).backgroundColor,
    'clearing the cell fill left it behind');
});

test('a named style colour can be set and then cleared away', function (t) {
  var was = namedStyle_('HEADING_3').textStyle.foregroundColor;
  try {
    writeNamedStyle({ namedStyleType: 'HEADING_3', textStyle: { foregroundColor: '#1155cc' } });
    t.equal(namedStyle_('HEADING_3').textStyle.foregroundColor, '#1155cc',
      'the colour did not land on the named style');
    writeNamedStyle({ namedStyleType: 'HEADING_3', textStyle: { foregroundColor: '' } });
    t.notOk(namedStyle_('HEADING_3').textStyle.foregroundColor,
      'clearing a named style colour left it behind');
  } finally {
    writeNamedStyle({ namedStyleType: 'HEADING_3',
      textStyle: { foregroundColor: was || '' } });
  }
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

/**
 * A level is not something the API can address, so "every level" is really
 * "every paragraph of this list, whatever depth it sits at". Passing null is
 * how the panel says that, and the check is that each level in use comes back
 * carrying the value.
 */
test('a null level reaches every level of the list', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists'); return; }
  var id = read.lists[0].listId;
  var was = read.lists[0].levels.map(function (l) { return l.style.textStyle.fontSizePt; });
  // Not 12, which is what Normal text is: writing a run the size it already
  // inherits leaves no override behind for the read to find, so the size
  // asked for has to be one the paragraph does not already have.
  var want = (was[0] === 14) ? 15 : 14;
  try {
    var res = writeListLevelStyle({ listId: id, level: null, textStyle: { fontSizePt: want } });
    t.ok(res.applied > 0, 'nothing was applied');
    var now = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    now.levels.forEach(function (l, i) {
      if (!l.inUse) return;
      t.near(l.style.textStyle.fontSizePt, want, 0.01,
        'level ' + (i + 1) + ' was left behind by a null level');
    });
  } finally {
    var back = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    back.levels.forEach(function (l, i) {
      if (was[i] === undefined || was[i] === null) return;
      writeListLevelStyle({ listId: id, level: i, textStyle: { fontSizePt: was[i] } });
    });
  }
});

/**
 * Why the test above is careful never to ask for 12pt.
 *
 * Google Docs keeps only what a run overrides. Writing a size that matches
 * what the paragraph already inherits from its named style does not store an
 * override at all -- it takes away whatever override was there -- so the run
 * comes back with no size on it rather than with the size that was asked for.
 * Nothing is wrong when that happens, but a test that reads the value back
 * and expects to find it will fail, and it cost an afternoon to work out why.
 */
test('a size matching the one inherited leaves no override behind', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists'); return; }
  var id = read.lists[0].listId;
  var base = (namedStyle_('NORMAL_TEXT').textStyle || {}).fontSizePt;
  if (!base) { t.ok(true, 'Normal text has no size of its own to inherit'); return; }
  var was = read.lists[0].levels.map(function (l) { return l.style.textStyle.fontSizePt; });
  try {
    writeListLevelStyle({ listId: id, level: 0, textStyle: { fontSizePt: base } });
    var now = readLists(null).lists.filter(function (l) { return l.listId === id; })[0];
    t.equal(now.levels[0].style.textStyle.fontSizePt, undefined,
      'Docs kept an override for a size the text already inherits');
    t.comment('Normal text is ' + base + 'pt, and writing ' + base +
      'pt to the list left no size on the runs');
  } finally {
    if (was[0] !== undefined && was[0] !== null) {
      writeListLevelStyle({ listId: id, level: 0, textStyle: { fontSizePt: was[0] } });
    }
  }
});

test('apply-to-all-lists reaches lists it was never told about', function (t) {
  var read = readLists(null);
  if (read.lists.length < 2) { t.ok(true, 'this document has fewer than two lists'); return; }
  var was = read.lists.map(function (l) { return l.levels[0].style.paragraphStyle.indentFirstLinePt; });
  var want = (was[0] === 18) ? 24 : 18;
  try {
    var res = writeListLevelStyle({ allLists: true, level: 0,
      paragraphStyle: { indentFirstLinePt: want } });
    t.ok(res.applied > 0, 'nothing was applied across the tab');
    readLists(null).lists.forEach(function (l, i) {
      t.near(l.levels[0].style.paragraphStyle.indentFirstLinePt, want, 0.01,
        'list ' + (i + 1) + ' was left behind');
    });
  } finally {
    readLists(null).lists.forEach(function (l, i) {
      if (was[i] === undefined || was[i] === null) return;
      writeListLevelStyle({ listId: l.listId, level: 0,
        paragraphStyle: { indentFirstLinePt: was[i] } });
    });
  }
});

/**
 * Unify settles each field by majority, and a tie falls to the first value
 * seen -- so with exactly two lists disagreeing, the first list wins. That is
 * the rule the panel's wording rests on, and it is worth pinning down against
 * the real thing rather than against the mock alone.
 */
test('unify settles a two-list disagreement in favour of the first', function (t) {
  var read = readLists(null);
  if (read.lists.length < 2) { t.ok(true, 'this document has fewer than two lists'); return; }
  var ids = read.lists.map(function (l) { return l.listId; });
  var was = read.lists.map(function (l) { return l.levels[0].style.paragraphStyle.indentStartPt; });
  try {
    writeListLevelStyle({ listId: ids[0], level: 0, paragraphStyle: { indentStartPt: 11 } });
    writeListLevelStyle({ listId: ids[1], level: 0, paragraphStyle: { indentStartPt: 15 } });
    var res = unifyLists({});
    t.ok(res.applied > 0, 'unify sent nothing');
    var now = readLists(null).lists;
    now.forEach(function (l, i) {
      t.near(l.levels[0].style.paragraphStyle.indentStartPt, 11, 0.01,
        'list ' + (i + 1) + ' did not come into line with the first');
    });
  } finally {
    readLists(null).lists.forEach(function (l, i) {
      if (was[i] === undefined || was[i] === null) return;
      writeListLevelStyle({ listId: l.listId, level: 0,
        paragraphStyle: { indentStartPt: was[i] } });
    });
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

test('a cell fill and alignment land together', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table'); return; }
  var tb = read.tables[0];
  var was = ((tb.cellStyle || {}).style || {}).contentAlignment;
  var want = (was === 'MIDDLE') ? 'TOP' : 'MIDDLE';
  try {
    var res = writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
      cell: { contentAlignment: want } });
    t.ok(res.applied > 0, 'nothing was applied');
    t.equal(((readTables(null).tables[0].cellStyle || {}).style || {}).contentAlignment, want,
      'the alignment did not reach every cell');
  } finally {
    if (was) {
      writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
        cell: { contentAlignment: was } });
    }
  }
});

test('a minimum row height and a pinned header row land', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table'); return; }
  var tb = read.tables[0];
  var wasHeight = ((tb.rowStyles || [])[0] || {}).minRowHeightPt;
  var wasPinned = tb.pinnedHeaderRows;
  var want = (wasHeight === 24) ? 30 : 24;
  try {
    var res = writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
      rows: { minRowHeightPt: want }, pinnedHeaderRowsCount: 1 });
    t.ok(res.applied > 0, 'nothing was applied');
    var now = readTables(null).tables[0];
    t.near((now.rowStyles[0] || {}).minRowHeightPt, want, 0.01, 'the row height did not land');
    t.equal(now.pinnedHeaderRows, 1, 'the pinned header row count did not land');
  } finally {
    writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
      rows: { minRowHeightPt: (wasHeight === null || wasHeight === undefined) ? 0 : wasHeight },
      pinnedHeaderRowsCount: wasPinned || 0 });
  }
});

/**
 * A width only means anything alongside FIXED_WIDTH, so the two are always
 * sent as a pair. This is also the only place the column request is exercised
 * against a real table.
 */
test('a fixed column width lands on every column', function (t) {
  var read = readTables(null);
  if (!read.tables.length) { t.ok(true, 'no table'); return; }
  var tb = read.tables[0];
  var was = (tb.columnWidths || []).map(function (c) { return c; });
  var want = 96;
  try {
    var res = writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
      columns: { widthType: 'FIXED_WIDTH', widthPt: want } });
    t.ok(res.applied > 0, 'nothing was applied');
    var now = readTables(null).tables[0];
    now.columnWidths.forEach(function (c, i) {
      t.near(c.widthPt, want, 0.5, 'column ' + (i + 1) + ' did not take the width');
    });
  } finally {
    // EVENLY_DISTRIBUTED takes no width, which is how a table goes back to
    // letting Docs share the page out between its columns.
    var first = was[0] || {};
    if (first.widthType === 'FIXED_WIDTH' && first.widthPt) {
      writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
        columns: { widthType: 'FIXED_WIDTH', widthPt: first.widthPt } });
    } else {
      writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
        columns: { widthType: 'EVENLY_DISTRIBUTED' } });
    }
  }
});

/** The same majority-with-a-tie rule as unifyLists, on the fixture's two tables. */
test('unify settles a two-table disagreement in favour of the first', function (t) {
  var read = readTables(null);
  if (read.tables.length < 2) { t.ok(true, 'this document has fewer than two tables'); return; }
  var was = read.tables.map(function (tb) {
    return ((tb.cellStyle || {}).style || {}).paddingLeftPt;
  });
  try {
    writeTableFormat({ startIndex: read.tables[0].startIndex,
      columnCount: read.tables[0].columns, cell: { paddingLeftPt: 4 } });
    writeTableFormat({ startIndex: read.tables[1].startIndex,
      columnCount: read.tables[1].columns, cell: { paddingLeftPt: 9 } });
    var res = unifyTables({});
    t.ok(res.applied > 0, 'unify sent nothing');
    readTables(null).tables.forEach(function (tb, i) {
      t.near(((tb.cellStyle || {}).style || {}).paddingLeftPt, 4, 0.01,
        'table ' + (i + 1) + ' did not come into line with the first');
    });
  } finally {
    readTables(null).tables.forEach(function (tb, i) {
      if (was[i] === undefined || was[i] === null) return;
      writeTableFormat({ startIndex: tb.startIndex, columnCount: tb.columns,
        cell: { paddingLeftPt: was[i] } });
    });
  }
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

/** A rename is a re-key, and re-keying onto an occupied name is refused. */
test('a preset renames, and will not rename onto another one', function (t) {
  savePreset({ name: '__live A' });
  savePreset({ name: '__live B' });
  try {
    renamePreset({ from: '__live A', to: '__live C' });
    var names = listPresets().map(function (p) { return p.name; });
    t.ok(names.indexOf('__live C') !== -1, 'the new name is not there');
    t.ok(names.indexOf('__live A') === -1, 'the old name is still there');
    t.throws(function () { renamePreset({ from: '__live C', to: '__live B' }); },
      /already exists/, 'renaming onto an occupied name should have been refused');
    t.throws(function () { renamePreset({ from: '__live nothing', to: '__live D' }); },
      /No preset named/, 'renaming something that is not there should have been refused');
  } finally {
    deletePreset({ name: '__live C' });
    deletePreset({ name: '__live A' });
    deletePreset({ name: '__live B' });
  }
});

test('a preset that is not there refuses to be applied', function (t) {
  t.throws(function () { applyPreset({ name: '__live nothing' }); },
    /No preset named/, 'an unknown preset should have been refused');
});

test('a preset with no name refuses to be saved', function (t) {
  t.throws(function () { savePreset({ name: '   ' }); },
    /Give the preset a name/, 'a blank name should have been refused');
});

/**
 * The two tick-boxes on the import: a configuration can bring the page setup
 * without the styles, or the styles without the page setup. The check is that
 * the half that was excluded really was left alone.
 */
test('an import can bring the page setup without the styles', function (t) {
  var config = exportConfig(null);
  var wasSize = namedStyle_('HEADING_4').textStyle.fontSizePt;
  try {
    writeNamedStyle({ namedStyleType: 'HEADING_4',
      textStyle: { fontSizePt: (wasSize === 13) ? 15 : 13 } });
    var changed = namedStyle_('HEADING_4').textStyle.fontSizePt;
    var res = importConfig({ config: config, includeStyles: false });
    t.ok(res.applied > 0, 'the page half of the import went nowhere');
    t.near(namedStyle_('HEADING_4').textStyle.fontSizePt, changed, 0.01,
      'includeStyles:false still wrote the named styles');
  } finally {
    if (wasSize !== undefined && wasSize !== null) {
      writeNamedStyle({ namedStyleType: 'HEADING_4', textStyle: { fontSizePt: wasSize } });
    }
  }
});

test('an import can bring the styles without the page setup', function (t) {
  var config = exportConfig(null);
  var was = readPageFormat(null);
  try {
    writePageFormat({ tabId: was.tabId, marginLeftPt: (was.marginLeftPt === 90) ? 108 : 90 });
    var changed = readPageFormat(null).marginLeftPt;
    var res = importConfig({ config: config, includePage: false });
    t.ok(res.applied > 0, 'the styles half of the import went nowhere');
    t.near(readPageFormat(null).marginLeftPt, changed, 0.01,
      'includePage:false still wrote the page setup');
  } finally {
    writePageFormat({ tabId: was.tabId, marginLeftPt: was.marginLeftPt });
  }
});

/** A configuration handed over as the text of a file, which is what Upload does. */
test('a configuration arrives as text and is parsed', function (t) {
  var res = importConfig({ config: JSON.stringify(exportConfig(null)) });
  t.ok(res.applied > 0, 'a configuration given as a string was not applied');
  t.throws(function () { importConfig({ config: 'not json at all' }); },
    /not valid JSON/, 'a file that is not JSON should have been refused');
  t.throws(function () { importConfig({ config: null }); },
    /Empty configuration/, 'a configuration with nothing in it should have been refused');
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

/**
 * The selection path cannot be reached from here: this runs as a standalone
 * script, so DocumentApp.getActiveDocument() is null and there is no cursor
 * to act on. What can be checked is the guard in front of it, which fires
 * before anything touches the document.
 */
test('a style preset that is not there refuses to be applied to a selection', function (t) {
  t.throws(function () { applyStylePresetToSelection({ name: '__live nothing' }); },
    /No style preset named/, 'an unknown style preset should have been refused');
});

test('a style preset that is not there refuses to be bound to a named style', function (t) {
  t.throws(function () {
    applyStylePresetToNamedStyle({ name: '__live nothing', namedStyleType: 'HEADING_5' });
  }, /No style preset named/, 'an unknown style preset should have been refused');
});

test('a style preset renames, and will not rename onto another one', function (t) {
  saveStylePreset({ name: '__live style A', textStyle: { italic: true }, paragraphStyle: {} });
  saveStylePreset({ name: '__live style B', textStyle: { bold: true }, paragraphStyle: {} });
  try {
    renameStylePreset({ from: '__live style A', to: '__live style C' });
    var names = listStylePresets().map(function (p) { return p.name; });
    t.ok(names.indexOf('__live style C') !== -1, 'the new name is not there');
    t.ok(names.indexOf('__live style A') === -1, 'the old name is still there');
    t.throws(function () { renameStylePreset({ from: '__live style C', to: '__live style B' }); },
      /already exists/, 'renaming onto an occupied name should have been refused');
  } finally {
    deleteStylePreset({ name: '__live style A' });
    deleteStylePreset({ name: '__live style B' });
    deleteStylePreset({ name: '__live style C' });
  }
});

/* ------------------------------------------------------------------ *
 * Changes that cannot be undone
 *
 * Everything above puts back what it found. The last two suites do not,
 * because the API offers no way to: paragraphs that have lost their list
 * markers cannot be given them back (a list is addressed by an id that no
 * longer exists), and footnotes deleted in a conversion are gone. Both are
 * recoverable in the document with Ctrl+Z, which is what the sidebar tells
 * the user, and neither matters here because the fixture is rebuilt on the
 * next run. They come last so that nothing else has to work around what
 * they leave behind.
 *
 * They are split in two because only one of them can be checked offline.
 * Taking a marker off shifts no index, so the local sandbox applies it and
 * runs these tests for real; rewriting footnotes into paragraphs moves
 * every index after it, which the sandbox records without applying, so that
 * suite is skipped locally by name. See test/apply.js.
 * ------------------------------------------------------------------ */

suite('Where the cursor is');

/**
 * The one thing the lists, tables and sections panels all rest on: that
 * DocumentApp and the Docs API agree, element for element, about what the
 * body holds. Every panel that shows what the cursor is in reads a chain of
 * child indices from one view and follows it down the other, so if this ever
 * stops holding, all three quietly stop finding the cursor -- which is
 * exactly how the lists panel failed for months.
 *
 * DocumentApp cannot be asked about the scratch document through
 * getActiveDocument(), since the script is standalone and has no container.
 * openById is the same document service on the same document, and it is the
 * body walk that is under test here, not how the document was opened.
 */
test('DocumentApp and the API agree, element for element, about the body', function (t) {
  var body = DocumentApp.openById(liveTestDocId_()).getBody();
  // Everything but the document's own first section break, which is the one
  // element with no child slot on the DocumentApp side.
  var api = fixtureBodyContent_().slice(1);
  var n = body.getNumChildren();
  t.equal(n, api.length, 'the two views disagree about how many children the body has');

  var wrong = [];
  for (var i = 0; i < n && i < api.length; i++) {
    var app = String(body.getChild(i).getType());
    var el = api[i];
    var want = el.paragraph ? (el.paragraph.bullet ? 'LIST_ITEM' : 'PARAGRAPH')
      : el.table ? 'TABLE'
      : el.tableOfContents ? 'TABLE_OF_CONTENTS'
      // A section break is a child DocumentApp has no type for, and says so.
      : el.sectionBreak ? 'UNSUPPORTED'
      : '?';
    if (app !== want) wrong.push(i + ': app=' + app + ' api=' + want);
  }
  t.equal(wrong.join(' '), '', 'children that do not line up');
});

test('a cell path picks the same paragraph out of either view', function (t) {
  var body = DocumentApp.openById(liveTestDocId_()).getBody();
  var api = fixtureBodyContent_().slice(1);
  var at = -1;
  for (var i = 0; i < api.length; i++) { if (api[i].table) { at = i; break; } }
  t.ok(at >= 0, 'the fixture has a table to walk into');
  if (at < 0) return;

  // Down to the first paragraph of the first cell, by child index on both
  // sides, and then check they are the same paragraph by its text.
  var cell = body.getChild(at).getChild(0).getChild(0);
  t.equal(String(cell.getType()), 'TABLE_CELL', 'table > row > cell');
  var el = elementAtPath_(fixtureBodyContent_(), [at, 0, 0, 0]);
  t.ok(el && el.paragraph, 'the path reaches a paragraph in the API view');
  t.equal(paraText_(el.paragraph).replace(/\s+$/, ''),
    String(cell.getChild(0).getText() || '').replace(/\s+$/, ''),
    'the same cell paragraph, reached by the same path through both views');
});

suite('Markers taken off for good');

test('taking the markers off a list leaves the text and loses the list', function (t) {
  var read = readLists(null);
  if (!read.lists.length) { t.ok(true, 'no lists'); return; }
  var before = read.lists.length;
  var id = read.lists[read.lists.length - 1].listId;
  var res = removeBullets({ listId: id });
  t.ok(res.applied > 0, 'deleteParagraphBullets was refused');
  // The write answers with the reading, so this needs no second round trip.
  t.equal(res.lists.lists.length, before - 1,
    'the list should be gone from the reading the write came back with');
  t.ok(res.lists.lists.every(function (l) { return l.listId !== id; }),
    'the list that lost its markers is still being reported');
});

suite('Footnotes rewritten for good');

/**
 * 'copy' appends the Notes section and leaves the footnotes alone, so it is
 * the safe half and runs first. Both halves warn, because what they produce
 * is ordinary paragraphs rather than real endnotes -- Google Docs has no
 * such thing -- and saying so is the only honest description of the feature.
 */
test('copying footnotes to endnotes appends notes and keeps the footnotes', function (t) {
  var before = readFootnotes(null).footnotes.length;
  if (!before) { t.ok(true, 'no footnotes'); return; }
  var res = convertFootnotesToEndnotes({ mode: 'copy', heading: 'Notes' });
  t.ok(res.applied > 0, 'nothing was inserted');
  t.equal(res.converted, before, 'every footnote should have been written out');
  t.ok(res.warnings.length >= 2, 'the emulation was not explained');
  t.match(res.warnings[0], /emulated/, res.warnings[0]);
  t.equal(readFootnotes(null).footnotes.length, before,
    'a copy should have left the footnotes where they were');
});

test('converting footnotes to endnotes takes the footnotes away', function (t) {
  var before = readFootnotes(null).footnotes.length;
  if (!before) { t.ok(true, 'no footnotes'); return; }
  var res = convertFootnotesToEndnotes({ mode: 'convert', heading: 'Notes' });
  t.equal(res.converted, before, 'every footnote should have been converted');
  t.equal(readFootnotes(null).footnotes.length, 0,
    'the footnotes should be gone after a conversion');
  t.ok(res.warnings.some(function (w) { return /deleted/.test(w); }),
    'the user was not told the originals were deleted');
});

test('converting a document with no footnotes says so instead of failing', function (t) {
  var res = convertFootnotesToEndnotes({ mode: 'convert' });
  t.equal(res.applied, 0, 'nothing should have been sent');
  t.match(res.warnings[0], /no footnotes/, res.warnings[0]);
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

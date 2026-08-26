/**
 * The document the live suite runs against, and the state it starts from.
 *
 * The add-on is a standalone script, so there is no container document and
 * DocumentApp.getActiveDocument() answers null. The live suite therefore has
 * to say which document it means, and it wants the same one every time, in
 * the same state every time -- a suite whose result depends on what happened
 * to be in the document last week is not telling anyone anything.
 *
 * So: one real Google Doc, created by the first run and remembered in the
 * script's properties, wiped back to empty and refilled with a known fixture
 * at the start of every run afterwards. Nothing is faked and no id is
 * invented; it is an ordinary document in the runner's own Drive, and it can
 * be opened and looked at.
 *
 * What the fixture contains is what the suite needs a real document for: a
 * title and headings, a footnote and its callout, two kinds of list, a table,
 * a section break, a default header and footer, and a second section with a
 * header of its own. Without those, five of the live tests find nothing to
 * exercise and pass on an empty comment.
 *
 * What is NOT reset: the nine named styles. Every test that touches them
 * reads a value and writes the same value back, so what they currently hold
 * cannot change a pass into a fail, and resetting them would mean naming
 * every field of nine styles here for no gain.
 */

/* The property's name lives in DocModel.js, next to the code that reads it. */

var LIVE_TEST_DOC_TITLE_ = 'Stylist live tests — scratch document';

/**
 * The scratch document, made if it is not there.
 *
 * The id is checked rather than trusted: a document that has been deleted or
 * put in the bin since the last run reads back as an error, and the answer to
 * that is a new one rather than a failing suite.
 */
function liveTestDocId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(LIVE_TEST_DOC_PROP_);
  if (id) {
    try {
      Docs.Documents.get(id);
      return id;
    } catch (e) {
      id = null;   // gone, or no longer readable: make another
    }
  }
  var made = Docs.Documents.create({ title: LIVE_TEST_DOC_TITLE_ });
  props.setProperty(LIVE_TEST_DOC_PROP_, made.documentId);
  return made.documentId;
}

/* ------------------------------------------------------------------ *
 * Reading the fixture back while it is being built
 *
 * Every phase below re-reads the document, because every phase moves the
 * indexes the next one needs. batchUpdate_ drops the execution's cached
 * document, so fetchDoc_ after a write is a fresh read.
 * ------------------------------------------------------------------ */

/** This tab's DocumentTab-shaped content, as the rest of the add-on sees it. */
function fixtureTab_() {
  return resolveTab_(fetchDoc_(), null).content || {};
}

function fixtureBodyContent_() {
  return ((fixtureTab_().body || {}).content) || [];
}

/** The text of one structural element, or '' for anything that is not a paragraph. */
function fixtureParaText_(el) {
  if (!el || !el.paragraph) return '';
  return (el.paragraph.elements || []).map(function (e) {
    return (e.textRun && e.textRun.content) || '';
  }).join('');
}

/**
 * The paragraph the fixture text begins with `head`, as {start, end}.
 *
 * Finding paragraphs by their own text rather than by counting characters is
 * what keeps this readable: the fixture can gain a line without every index
 * below it having to be recounted.
 */
function findFixturePara_(head) {
  var content = fixtureBodyContent_();
  for (var i = 0; i < content.length; i++) {
    if (fixtureParaText_(content[i]).indexOf(head) === 0) {
      return { start: content[i].startIndex || 0, end: content[i].endIndex };
    }
  }
  throw new Error('the fixture has no paragraph starting "' + head + '"');
}

/**
 * Where the section break is, or 0 if there is none.
 *
 * Every document opens with a section break at index 0 standing for the first
 * section, so the one that matters is the second.
 */
function findFixtureSectionBreak_() {
  var content = fixtureBodyContent_();
  for (var i = 0; i < content.length; i++) {
    if (content[i].sectionBreak && (content[i].startIndex || 0) > 0) {
      return content[i].startIndex;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * The fixture itself
 * ------------------------------------------------------------------ */

/**
 * The whole of the fixture's text, written in one go so that every paragraph
 * below exists before anything starts styling them.
 */
var LIVE_FIXTURE_TEXT_ = [
  'Stylist live tests',
  'This document is created, emptied and refilled by the project’s live test '
    + 'suite at the start of every run. There is no point editing it: whatever '
    + 'is here is thrown away the next time the suite runs.',
  'The body',
  'An ordinary paragraph, which carries a footnote.',
  'First bullet',
  'Second bullet',
  'First step',
  'Second step',
  'After the break',
  'A paragraph in the second section, which keeps a header of its own.'
].join('\n') + '\n';

/** Letter, one-inch margins, and no first-page or even-page variants. */
function fixturePageSetupRequest_() {
  var inch = { magnitude: 72, unit: 'PT' };
  return {
    updateDocumentStyle: {
      documentStyle: {
        pageSize: {
          width: { magnitude: 612, unit: 'PT' },
          height: { magnitude: 792, unit: 'PT' }
        },
        marginTop: inch, marginBottom: inch, marginLeft: inch, marginRight: inch,
        useFirstPageHeaderFooter: false,
        useEvenPageHeaderFooter: false
      },
      fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight,'
            + 'useFirstPageHeaderFooter,useEvenPageHeaderFooter'
    }
  };
}

/**
 * Empty the document, then build the fixture back up.
 *
 * Returns a summary the calling test can assert on and print, so a run says
 * out loud what it was run against.
 */
function resetLiveFixture_() {
  // A live run makes over a hundred writes in one execution and the Docs API
  // allows sixty a minute per user, so the writes have to be spread out or
  // most of the suite fails on quota rather than on anything real. Nothing
  // but a live run calls this, so nothing but a live run is paced.
  writesPerMinute_ = 55;

  // Settle which document first: everything below reaches it through
  // activeDocId_, which reads the property this puts there.
  liveTestDocId_();

  // Phase 1: the body. The very last newline of a document belongs to the
  // document rather than to any paragraph, and cannot be deleted.
  var content = fixtureBodyContent_();
  var end = content.length ? content[content.length - 1].endIndex : 2;
  if (end > 2) {
    batchUpdate_([{ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } }]);
  }

  // Phase 2: whatever headers and footers outlived their sections, and the
  // page setup. Separately from phase 1, because deleting a section break
  // takes that section's header with it, and asking to delete it again in the
  // same batch is an error.
  var tab = fixtureTab_();
  var gone = [];
  Object.keys(tab.headers || {}).forEach(function (id) { gone.push({ deleteHeader: { headerId: id } }); });
  Object.keys(tab.footers || {}).forEach(function (id) { gone.push({ deleteFooter: { footerId: id } }); });
  gone.push(fixturePageSetupRequest_());
  batchUpdate_(gone);

  // Phase 3: the text.
  batchUpdate_([{ insertText: { location: { index: 1 }, text: LIVE_FIXTURE_TEXT_ } }]);

  // Phase 4: the paragraph styles and the two lists. None of these moves an
  // index, so they all read from the same document.
  var title = findFixturePara_('Stylist live tests');
  var h1 = findFixturePara_('The body');
  var h2 = findFixturePara_('After the break');
  var bullets = { start: findFixturePara_('First bullet').start,
                  end: findFixturePara_('Second bullet').end };
  var steps = { start: findFixturePara_('First step').start,
                end: findFixturePara_('Second step').end };
  batchUpdate_([
    named_(title, 'TITLE'), named_(h1, 'HEADING_1'), named_(h2, 'HEADING_1'),
    { createParagraphBullets: {
        range: { startIndex: bullets.start, endIndex: bullets.end },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } },
    { createParagraphBullets: {
        range: { startIndex: steps.start, endIndex: steps.end },
        bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' } }
  ]);

  // Phase 5: the footnote, at the end of its paragraph and before the newline
  // that ends it.
  var para = findFixturePara_('An ordinary paragraph');
  batchUpdate_([{ createFootnote: { location: { index: para.end - 1 } } }]);

  // Phase 6: the section break, immediately before the second heading.
  batchUpdate_([{ insertSectionBreak: {
    location: { index: findFixturePara_('After the break').start },
    sectionType: 'NEXT_PAGE'
  } }]);

  // Phase 7: two tables on the end. Asking for the end of the segment rather
  // than an index avoids counting past everything above. Two rather than one
  // because "apply to every table" and "make the tables match" are only worth
  // anything where there is more than one, and separate batches because the
  // second insert has to land after the first one has moved the end.
  batchUpdate_([{ insertTable: {
    endOfSegmentLocation: { segmentId: '' }, rows: 2, columns: 3
  } }]);
  batchUpdate_([{ insertTable: {
    endOfSegmentLocation: { segmentId: '' }, rows: 2, columns: 2
  } }]);

  // Phase 8: a default header and footer for the document, and one header
  // that belongs to the second section alone.
  var breakAt = findFixtureSectionBreak_();
  batchUpdate_([
    { createHeader: { type: 'DEFAULT' } },
    { createFooter: { type: 'DEFAULT' } },
    breakAt ? { createHeader: { type: 'DEFAULT',
                                sectionBreakLocation: { index: breakAt } } } : null
  ]);

  // Phase 9: something to read in each of them, so a styling test has text to
  // style rather than an empty paragraph.
  var after = fixtureTab_();
  var filled = [];
  Object.keys(after.headers || {}).forEach(function (id, i) {
    filled.push({ insertText: { location: { segmentId: id, index: 0 },
                                text: 'Header ' + (i + 1) } });
  });
  Object.keys(after.footers || {}).forEach(function (id, i) {
    filled.push({ insertText: { location: { segmentId: id, index: 0 },
                                text: 'Footer ' + (i + 1) } });
  });
  batchUpdate_(filled);

  var built = fixtureTab_();
  return {
    documentId: activeDocId_(),
    headers: Object.keys(built.headers || {}).length,
    footers: Object.keys(built.footers || {}).length,
    footnotes: Object.keys(built.footnotes || {}).length,
    sections: fixtureBodyContent_().filter(function (el) { return !!el.sectionBreak; }).length,
    tables: fixtureBodyContent_().filter(function (el) { return !!el.table; }).length
  };
}

/** One "make this paragraph a Heading 1" request, which reads better inline. */
function named_(range, type) {
  return {
    updateParagraphStyle: {
      range: { startIndex: range.start, endIndex: range.end },
      paragraphStyle: { namedStyleType: type },
      fields: 'namedStyleType'
    }
  };
}

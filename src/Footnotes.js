/**
 * Footnote tooling.
 *
 * What the Docs API does NOT offer, verified against the v1 discovery
 * document (no field anywhere in the schema mentions endnotes, footnote
 * placement, or footnote pagination):
 *
 *   - No endnote mode. Footnotes always render at the foot of the page
 *     containing their reference. Google Docs itself has no endnote
 *     feature, so this is a product limitation, not just an API gap.
 *   - No control over a footnote splitting across pages. The renderer
 *     decides, and nothing in DocumentStyle, SectionStyle or the footnote
 *     model influences it.
 *   - No footnote numbering format, restart-per-section, or separator
 *     configuration.
 *
 * The closest available levers, both offered here:
 *   - keepLinesTogether / keepWithNext on footnote paragraphs, applied via
 *     the Footnotes/Segments tab. This is a hint to the layout engine, not
 *     a guarantee, but it is the only pagination control that reaches
 *     footnote content at all.
 *   - convertFootnotesToEndnotes(), which physically rewrites footnotes
 *     into a numbered "Notes" section at the end of the document body.
 */

function footnoteCapabilities() {
  return {
    endnotesSupported: false,
    pageBreakControlSupported: false,
    numberingFormatSupported: false,
    notes: [
      'Footnotes always appear on the page of their reference; Google Docs has no endnote mode.',
      'Footnote splitting across pages cannot be controlled through the API.',
      'Footnote numbering format and per-section restart are not exposed.',
      'keepLinesTogether on footnote paragraphs is the only pagination hint available.',
      'Use "Convert footnotes to endnotes" to move the text into a Notes section at the end.'
    ]
  };
}

/** Text content of one footnote, flattened. */
function footnoteText_(footnote) {
  var text = '';
  ((footnote || {}).content || []).forEach(function (el) {
    ((el.paragraph || {}).elements || []).forEach(function (pe) {
      if (pe.textRun && pe.textRun.content) text += pe.textRun.content;
    });
  });
  return text.replace(/\n+$/, '').trim();
}

/** Footnote references in body order, with their footnote text. */
function orderedFootnotes_(content) {
  var refs = [];
  (((content.body || {}).content) || []).forEach(function (el) {
    ((el.paragraph || {}).elements || []).forEach(function (pe) {
      if (!pe.footnoteReference) return;
      var id = pe.footnoteReference.footnoteId;
      refs.push({
        footnoteId: id,
        startIndex: pe.startIndex,
        endIndex: pe.endIndex,
        number: pe.footnoteReference.footnoteNumber || String(refs.length + 1),
        text: footnoteText_((content.footnotes || {})[id])
      });
    });
  });
  return refs;
}

function readFootnotes(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  return {
    tabId: ctx.tabId,
    capabilities: footnoteCapabilities(),
    footnotes: orderedFootnotes_(ctx.content).map(function (f) {
      return {
        footnoteId: f.footnoteId,
        number: f.number,
        preview: f.text.length > 80 ? f.text.slice(0, 80) + '…' : f.text
      };
    })
  };
}

/**
 * Move (or copy) footnote text into a numbered "Notes" section at the end
 * of the body.
 *
 * payload: { tabId, mode: 'convert' | 'copy', heading, markerStyle }
 *
 *   'copy'    - append the Notes section, leave the footnotes in place.
 *   'convert' - append the Notes section, delete each footnote reference
 *               (which deletes the footnote) and leave a superscript
 *               number in the body where the reference used to be.
 *
 * This rewrites document content, so it is deliberately an explicit button
 * rather than part of the live-apply style editing.
 */
function convertFootnotesToEndnotes(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var refs = orderedFootnotes_(ctx.content);
  if (!refs.length) return { applied: 0, warnings: ['This document has no footnotes.'] };

  var tabId = ctx.tabId;
  var heading = payload.heading || 'Notes';

  // Pass 1: rewrite the body references, walking backwards so that each
  // edit cannot disturb the indices of references earlier in the document.
  var requests = [];
  if (payload.mode === 'convert') {
    refs.slice().sort(function (a, b) { return b.startIndex - a.startIndex; })
      .forEach(function (r) {
        var marker = String(r.number);
        var range = { startIndex: r.startIndex, endIndex: r.endIndex };
        if (tabId) range.tabId = tabId;
        var loc = { index: r.startIndex };
        if (tabId) loc.tabId = tabId;

        requests.push({ deleteContentRange: { range: range } });
        requests.push({ insertText: { location: loc, text: marker } });
        var styled = { startIndex: r.startIndex, endIndex: r.startIndex + marker.length };
        if (tabId) styled.tabId = tabId;
        requests.push({
          updateTextStyle: {
            range: styled,
            textStyle: { baselineOffset: 'SUPERSCRIPT' },
            fields: 'baselineOffset'
          }
        });
      });
    batchUpdate_(requests);
  }

  // Pass 2: append the Notes section. endOfSegmentLocation needs no index,
  // so it is unaffected by whatever pass 1 shifted.
  var body = '\n' + heading + '\n' +
    refs.map(function (r) { return r.number + '. ' + r.text; }).join('\n') + '\n';
  var eos = {};
  if (tabId) eos.tabId = tabId;
  var res = batchUpdate_([{ insertText: { endOfSegmentLocation: eos, text: body } }]);

  res.warnings = [
    'Endnotes are emulated: the text was appended as ordinary paragraphs, because ' +
    'neither Google Docs nor the Docs API has a real endnote feature.',
    'Style the "' + heading + '" paragraph and the note paragraphs from the Text styles tab.'
  ];
  if (payload.mode === 'convert') {
    res.warnings.push('The original footnotes were deleted. Undo in the document (Ctrl+Z) restores them.');
  }
  res.converted = refs.length;
  return res;
}

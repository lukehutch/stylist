/**
 * Specialised segments: headers, footers and footnotes.
 *
 * Docs has no *named* style for these -- there is no FOOTNOTE_TEXT entry in
 * the NamedStyleType enum. What the API does provide is Range.segmentId,
 * which targets a header/footer/footnote body. So "set the footnote style"
 * is implemented as: resolve every footnote segment, then apply the chosen
 * text and paragraph styles across each segment's whole content range.
 *
 * The same mechanism drives header and footer styling, plus styling of the
 * footnote reference marks, which live in the body as footnoteReference
 * elements and carry their own TextStyle.
 */

/**
 * Full styleable range of a segment.
 *
 * The trailing newline that terminates a segment cannot be styled, so the
 * range stops one code unit short of the last element's end index.
 */
function segmentRange_(content) {
  if (!content || !content.length) return null;
  var start = content[0].startIndex || 0;
  var end = content[content.length - 1].endIndex;
  if (end === undefined || end === null) return null;
  end = end - 1;
  if (end <= start) return null; // empty segment: nothing to style
  return { startIndex: start, endIndex: end };
}

/** Map every header/footer id to the role(s) it plays. */
function headerFooterRoles_(content) {
  var roles = {};
  function tag(id, role) {
    if (!id) return;
    roles[id] = roles[id] ? roles[id] + ', ' + role : role;
  }
  var ds = content.documentStyle || {};
  tag(ds.defaultHeaderId, 'Default header');
  tag(ds.firstPageHeaderId, 'First-page header');
  tag(ds.evenPageHeaderId, 'Even-page header');
  tag(ds.defaultFooterId, 'Default footer');
  tag(ds.firstPageFooterId, 'First-page footer');
  tag(ds.evenPageFooterId, 'Even-page footer');

  (((content.body || {}).content) || []).forEach(function (el) {
    if (!el.sectionBreak) return;
    var ss = el.sectionBreak.sectionStyle || {};
    tag(ss.defaultHeaderId, 'Section header');
    tag(ss.firstPageHeaderId, 'Section first-page header');
    tag(ss.evenPageHeaderId, 'Section even-page header');
    tag(ss.defaultFooterId, 'Section footer');
    tag(ss.firstPageFooterId, 'Section first-page footer');
    tag(ss.evenPageFooterId, 'Section even-page footer');
  });
  return roles;
}

/** Plain-text preview of a segment, for the segment list in the sidebar. */
function segmentPreview_(content) {
  var text = '';
  (content || []).forEach(function (el) {
    ((el.paragraph || {}).elements || []).forEach(function (pe) {
      if (pe.textRun && pe.textRun.content) text += pe.textRun.content;
    });
  });
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function readSegments(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var content = ctx.content;
  var roles = headerFooterRoles_(content);
  var out = { tabId: ctx.tabId, headers: [], footers: [], footnotes: [], footnoteReferenceCount: 0 };

  function collect(map, kind, list) {
    Object.keys(map || {}).forEach(function (id) {
      var seg = map[id] || {};
      var range = segmentRange_(seg.content);
      list.push({
        kind: kind,
        segmentId: id,
        role: roles[id] || ('Unreferenced ' + kind),
        preview: segmentPreview_(seg.content),
        empty: !range,
        style: styleSummary_(collectParagraphs_(seg.content))
      });
    });
  }
  collect(content.headers, 'header', out.headers);
  collect(content.footers, 'footer', out.footers);

  Object.keys(content.footnotes || {}).forEach(function (id) {
    var fn = content.footnotes[id] || {};
    out.footnotes.push({
      kind: 'footnote',
      segmentId: id,
      role: 'Footnote',
      preview: segmentPreview_(fn.content),
      empty: !segmentRange_(fn.content),
      style: styleSummary_(collectParagraphs_(fn.content))
    });
  });

  var refs = findFootnoteReferences_(content);
  out.footnoteReferenceCount = refs.length;

  // Current values for the three "style them all at once" editors, so those
  // show what the document actually looks like rather than empty fields.
  function summarise(map) {
    var paras = [];
    Object.keys(map || {}).forEach(function (id) {
      collectParagraphs_((map[id] || {}).content, paras);
    });
    return styleSummary_(paras);
  }
  out.allFootnotesStyle = summarise(content.footnotes);
  out.allHeadersStyle = summarise(content.headers);
  out.allFootersStyle = summarise(content.footers);
  out.footnoteRefStyle = textStyleSummary_(refs.map(function (r) { return r.textStyle; }));
  return out;
}

/** Every footnote reference mark in the body, as index ranges. */
function findFootnoteReferences_(content) {
  var refs = [];
  (((content.body || {}).content) || []).forEach(function (el) {
    ((el.paragraph || {}).elements || []).forEach(function (pe) {
      if (pe.footnoteReference) {
        refs.push({
          startIndex: pe.startIndex,
          endIndex: pe.endIndex,
          textStyle: pe.footnoteReference.textStyle || {}
        });
      }
    });
  });
  return refs;
}

/**
 * Apply text and/or paragraph styling across whole segments.
 *
 * payload: {
 *   tabId, scope,
 *   target: 'footnotes' | 'headers' | 'footers' | 'footnoteRefs' | 'body' | 'segment',
 *   segmentId,                      // only for target === 'segment'
 *   textStyle, paragraphStyle       // UI style objects
 * }
 */
function writeSegmentStyle(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var tabIds = targetTabIds_(doc, payload.tabId, payload.scope);
  var ts = uiToTextStyle_(payload.textStyle);
  var ps = uiToParagraphStyle_(payload.paragraphStyle);

  // The API rejects page_break_before outside the body: "Attempting to update
  // page_break_before for paragraphs in unsupported regions, including Table,
  // Header, Footer and Footnote, can result in an invalid document state that
  // returns a 400 bad request error." Strip it rather than fail the batch.
  var droppedPageBreak = false;
  if (payload.target !== 'body' && ps.fields.indexOf('pageBreakBefore') !== -1) {
    ps.fields = ps.fields.filter(function (f) { return f !== 'pageBreakBefore'; });
    delete ps.style.pageBreakBefore;
    droppedPageBreak = true;
  }

  // Nothing to send -- every field the editor offered was left blank, which
  // is what a segment whose paragraphs disagree looks like. Same result
  // shape as a real write, so callers do not have to special-case it.
  if (!ts.fields.length && !ps.fields.length) {
    return { applied: 0, segments: 0, warnings: [] };
  }

  var requests = [];
  var segmentCount = 0;
  var skippedEmpty = 0;

  tabIds.forEach(function (tid) {
    var content = resolveTab_(doc, tid).content;

    function styleSegment(segmentId, segContent) {
      var range = segmentRange_(segContent);
      if (!range) { skippedEmpty++; return; }
      range = { startIndex: range.startIndex, endIndex: range.endIndex };
      if (segmentId) range.segmentId = segmentId;
      if (tid) range.tabId = tid;
      segmentCount++;
      if (ts.fields.length) {
        requests.push({ updateTextStyle: { range: range, textStyle: ts.style, fields: ts.fields.join(',') } });
      }
      if (ps.fields.length) {
        requests.push({ updateParagraphStyle: { range: range, paragraphStyle: ps.style, fields: ps.fields.join(',') } });
      }
    }

    if (payload.target === 'footnotes') {
      Object.keys(content.footnotes || {}).forEach(function (id) {
        styleSegment(id, (content.footnotes[id] || {}).content);
      });
    } else if (payload.target === 'headers') {
      Object.keys(content.headers || {}).forEach(function (id) {
        styleSegment(id, (content.headers[id] || {}).content);
      });
    } else if (payload.target === 'footers') {
      Object.keys(content.footers || {}).forEach(function (id) {
        styleSegment(id, (content.footers[id] || {}).content);
      });
    } else if (payload.target === 'body') {
      styleSegment('', (content.body || {}).content);
    } else if (payload.target === 'segment') {
      var map = (content.headers || {})[payload.segmentId] ||
                (content.footers || {})[payload.segmentId] ||
                (content.footnotes || {})[payload.segmentId];
      if (map) styleSegment(payload.segmentId, map.content);
    } else if (payload.target === 'footnoteRefs') {
      // Reference marks are inline in the body; only text styling applies.
      findFootnoteReferences_(content).forEach(function (r) {
        if (!ts.fields.length) return;
        var range = { startIndex: r.startIndex, endIndex: r.endIndex };
        if (tid) range.tabId = tid;
        segmentCount++;
        requests.push({ updateTextStyle: { range: range, textStyle: ts.style, fields: ts.fields.join(',') } });
      });
    }
  });

  var res = batchUpdate_(requests);
  res.segments = segmentCount;
  res.warnings = [];
  if (skippedEmpty) {
    res.warnings.push(skippedEmpty + ' empty segment(s) were skipped -- there is no text in them to style.');
  }
  if (droppedPageBreak) {
    res.warnings.push('Page-break-before was ignored: the Docs API rejects it in headers, ' +
      'footers and footnotes.');
  }
  if (payload.target === 'footnoteRefs' && ps.fields.length) {
    res.warnings.push('Footnote reference marks are inline text; paragraph settings were ignored for them.');
  }
  return res;
}

/**
 * Read the styling currently in force at the start of a segment, so the
 * editor can be seeded with real values rather than blanks.
 */
function readSegmentStyle(tabId, kind, segmentId) {
  var doc = fetchDoc_();
  var content = resolveTab_(doc, tabId).content;
  var seg = null;
  if (kind === 'header') seg = (content.headers || {})[segmentId];
  else if (kind === 'footer') seg = (content.footers || {})[segmentId];
  else if (kind === 'footnote') seg = (content.footnotes || {})[segmentId];
  if (!seg) return { textStyle: {}, paragraphStyle: {} };

  var firstPara = null;
  (seg.content || []).some(function (el) {
    if (el.paragraph) { firstPara = el.paragraph; return true; }
    return false;
  });
  if (!firstPara) return { textStyle: {}, paragraphStyle: {} };

  var run = null;
  (firstPara.elements || []).some(function (pe) {
    if (pe.textRun) { run = pe.textRun; return true; }
    return false;
  });
  return {
    textStyle: textStyleToUi_(run ? run.textStyle : {}),
    paragraphStyle: paragraphStyleToUi_(firstPara.paragraphStyle)
  };
}

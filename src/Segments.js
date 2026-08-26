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

/**
 * A body range broken up so that page_break_before can be asked for over it.
 *
 * Two places in a body will not take that field, and the API refuses the
 * whole batch rather than the offending paragraph:
 *
 *   - inside a table -- "Cannot update page-break-before when the range
 *     contains paragraphs in a table";
 *   - on the document's own first section break -- "Cannot operate on the
 *     first section break in the document".
 *
 * So the paragraphs between them get every field asked for, the ones inside
 * a table get all of them but the page break, and the first section break is
 * left out altogether: it holds no text, so there is nothing to style on it.
 *
 * Returns null when nothing is in the way and one request will do.
 */
function splitForPageBreak_(content, range) {
  var blocks = [];
  (content || []).forEach(function (el, i) {
    if (el.table) blocks.push({ el: el, drop: false });
    else if (i === 0 && el.sectionBreak) blocks.push({ el: el, drop: true });
  });
  if (!blocks.length) return null;
  var parts = [];
  var at = range.startIndex;
  blocks.forEach(function (b) {
    var start = b.el.startIndex || 0;
    var end = b.el.endIndex;
    if (end === undefined) return;
    if (start > at) parts.push({ startIndex: at, endIndex: start, noBreak: false, drop: false });
    parts.push({ startIndex: Math.max(start, at), endIndex: Math.min(end, range.endIndex),
                 noBreak: true, drop: b.drop });
    at = Math.max(at, end);
  });
  if (at < range.endIndex) {
    parts.push({ startIndex: at, endIndex: range.endIndex, noBreak: false, drop: false });
  }
  return parts.filter(function (p) { return p.endIndex > p.startIndex; });
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

/**
 * Which side of the spread each header/footer is printed on.
 *
 * Docs keeps at most three of each per section: the default one, the
 * first-page one and the even-page one. With "different even pages" turned
 * on the default is the odd-page header, so it lands on right-hand pages;
 * the even-page one lands on left-hand pages. The first page is page one,
 * which is a right-hand page too. With even pages turned off there is no
 * even-page header at all and the default covers both sides -- calling it
 * 'right' is still true of every page it prints on.
 */
function headerFooterParity_(content) {
  var parity = {};
  function tag(id, side) { if (id) parity[id] = side; }
  function tagStyle(s) {
    s = s || {};
    tag(s.defaultHeaderId, 'right');
    tag(s.firstPageHeaderId, 'right');
    tag(s.evenPageHeaderId, 'left');
    tag(s.defaultFooterId, 'right');
    tag(s.firstPageFooterId, 'right');
    tag(s.evenPageFooterId, 'left');
  }
  tagStyle(content.documentStyle);
  (((content.body || {}).content) || []).forEach(function (el) {
    if (el.sectionBreak) tagStyle(el.sectionBreak.sectionStyle);
  });
  return parity;
}

/**
 * Which sections use each header and footer.
 *
 * A section names its own headers and footers on its section break, but an
 * id left unset there inherits from the section before it, and an id unset
 * in the first section inherits from the document. So one segment usually
 * serves a run of sections, and styling it styles all of them -- which is
 * why the sidebar says so before it writes.
 *
 * Returns section indices per segment id, counted the same way the sections
 * panel counts them: one per section break in the body, in order.
 */
function sectionSegmentUse_(content) {
  var KEYS = ['defaultHeaderId', 'firstPageHeaderId', 'evenPageHeaderId',
              'defaultFooterId', 'firstPageFooterId', 'evenPageFooterId'];
  var ds = content.documentStyle || {};
  var carried = {};
  KEYS.forEach(function (k) { carried[k] = ds[k] || null; });

  var use = {};
  var count = 0;
  (((content.body || {}).content) || []).forEach(function (el) {
    if (!el.sectionBreak) return;
    var ss = el.sectionBreak.sectionStyle || {};
    var at = count++;
    KEYS.forEach(function (k) {
      if (ss[k]) carried[k] = ss[k];
      var id = carried[k];
      if (!id) return;
      if (!use[id]) use[id] = [];
      if (use[id].indexOf(at) === -1) use[id].push(at);
    });
  });
  return { use: use, count: count };
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
  var parity = headerFooterParity_(content);
  var used = sectionSegmentUse_(content);
  var out = {
    tabId: ctx.tabId, headers: [], footers: [], footnotes: [],
    footnoteReferenceCount: 0, sectionCount: used.count
  };

  function collect(map, kind, list) {
    Object.keys(map || {}).forEach(function (id) {
      var seg = map[id] || {};
      var range = segmentRange_(seg.content);
      list.push({
        kind: kind,
        segmentId: id,
        parity: parity[id] || 'right',
        sections: used.use[id] || [],
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
 *   target: 'footnotes' | 'headers' | 'footers' | 'footnoteRefs' | 'body' |
 *           'segment' | 'segments',
 *   segmentId,                      // only for target === 'segment'
 *   segmentIds,                     // only for target === 'segments'
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

  var PAGE_BREAK_DROPPED_ = 'Page-break-before was ignored: the Docs API rejects it in ' +
    'headers, footers and footnotes.';
  var PAGE_BREAK_IN_TABLES_ = 'Page-break-before was skipped for the paragraphs inside ' +
    'tables: the Docs API does not allow it there. Everything else was applied to them.';
  var brokeAroundTables = false;

  // Nothing to send -- every field the editor offered was left blank, which
  // is what a segment whose paragraphs disagree looks like. Same result
  // shape as a real write, so callers do not have to special-case it.
  //
  // The page break is the exception: if stripping it is what emptied the
  // request, saying nothing would leave the user watching a setting they
  // asked for do nothing for a reason they were never told.
  if (!ts.fields.length && !ps.fields.length) {
    return { applied: 0, segments: 0,
             warnings: droppedPageBreak ? [PAGE_BREAK_DROPPED_] : [] };
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
        // A body-wide range takes in places that will not accept a page
        // break at all; see splitForPageBreak_.
        var parts = payload.target === 'body' &&
                    ps.fields.indexOf('pageBreakBefore') !== -1
          ? splitForPageBreak_(segContent, range) : null;
        if (!parts) {
          requests.push({ updateParagraphStyle: { range: range, paragraphStyle: ps.style, fields: ps.fields.join(',') } });
        } else {
          // Only the tables are worth telling the user about; the section
          // break carries nothing they asked to change.
          if ((segContent || []).some(function (el) { return !!el.table; })) {
            brokeAroundTables = true;
          }
          parts.forEach(function (part) {
            var style = ps.style, fields = ps.fields;
            if (part.drop) return;
            if (part.noBreak) {
              style = {};
              fields = ps.fields.filter(function (f) { return f !== 'pageBreakBefore'; });
              fields.forEach(function (f) { style[f] = ps.style[f]; });
              if (!fields.length) return;
            }
            var r = { startIndex: part.startIndex, endIndex: part.endIndex };
            if (range.tabId) r.tabId = range.tabId;
            requests.push({ updateParagraphStyle: { range: r, paragraphStyle: style, fields: fields.join(',') } });
          });
        }
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
    } else if (payload.target === 'segment' || payload.target === 'segments') {
      // The sidebar names the segments itself when it has narrowed a set down
      // by hand -- the headers/footers panel does, since which ones "the left
      // pages" means is a question it has already answered on screen. Ids
      // belong to one tab, so a segment named here is simply absent from the
      // others and skipped.
      var ids = payload.target === 'segments'
        ? (payload.segmentIds || []) : [payload.segmentId];
      ids.forEach(function (id) {
        var map = (content.headers || {})[id] ||
                  (content.footers || {})[id] ||
                  (content.footnotes || {})[id];
        if (map) styleSegment(id, map.content);
      });
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
  if (droppedPageBreak) res.warnings.push(PAGE_BREAK_DROPPED_);
  if (brokeAroundTables) res.warnings.push(PAGE_BREAK_IN_TABLES_);
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

/**
 * Whether a section keeps its own header or footer, or continues the one
 * before it -- Docs calls this "link to previous".
 *
 * The two kinds link independently: a section can have its own header while
 * its footer is still the previous section's. Within one kind, the default,
 * first-page and even-page variants belong to the section as a set, so a
 * section handed back to the one before it gives up all three.
 *
 * payload: { tabId, kind: 'header' | 'footer', sectionIndex, link: 'own' |
 *            'previous', applyAll }
 *
 * applyAll does the same to every section at once, in one batch. Going to
 * 'previous' everywhere leaves the whole tab on the document's header; the
 * first section is passed over rather than refused, because it has nothing
 * before it and that is not a mistake when the request was "all of them".
 *
 * 'own' creates a header or footer for the section. The API can only create
 * the default variant -- HeaderFooterType has no first-page or even-page
 * member -- so a section that needs its own first-page header still has to
 * get it from the Docs UI.
 *
 * 'previous' deletes the ones the section names, which is what makes it
 * continue the previous section again. That deletes their text with them,
 * which is why the sidebar asks first.
 */
function setSegmentLink(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var scan = sectionsScan_(ctx);
  var isHeader = payload.kind !== 'footer';
  var targets = scan.sections;
  if (!payload.applyAll) {
    var one = scan.sections[payload.sectionIndex];
    if (!one) throw new Error('There is no section ' + (payload.sectionIndex + 1) + ' in this tab.');
    targets = [one];
  }

  var requests = [];
  var refusedFirst = false;
  targets.forEach(function (sec) {
    var own = isHeader ? sec.ownHeaderIds : sec.ownFooterIds;
    if (payload.link === 'previous') {
      if (sec.isFirst) { refusedFirst = true; return; }
      own.forEach(function (id) {
        requests.push(isHeader
          ? { deleteHeader: { headerId: id, tabId: ctx.tabId } }
          : { deleteFooter: { footerId: id, tabId: ctx.tabId } });
      });
      return;
    }
    // The first section's header is the document's, so what counts as already
    // having one there is the document naming one at all.
    if (sec.isFirst ? !!(isHeader ? sec.headerId : sec.footerId) : own.length) return;
    // An unset location, or the first section break, means the document rather
    // than a section -- which is the right answer for the first section.
    var loc = { index: sec.startIndex };
    if (ctx.tabId) loc.tabId = ctx.tabId;
    var req = { type: 'DEFAULT', sectionBreakLocation: loc };
    requests.push(isHeader ? { createHeader: req } : { createFooter: req });
  });

  if (refusedFirst && !payload.applyAll) {
    throw new Error('The first section has nothing before it to continue from.');
  }
  if (!requests.length) return { applied: 0 };
  return batchUpdate_(requests);
}

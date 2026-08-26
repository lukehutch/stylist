/**
 * Page setup: page size, orientation, margins, header/footer margins,
 * page numbering, document mode (paged vs pageless) and page background.
 */

/** Common page sizes, in points (72pt = 1in). */
var PAGE_SIZE_PRESETS = [
  { id: 'LETTER',    label: 'Letter (8.5 x 11 in)',    widthPt: 612,     heightPt: 792 },
  { id: 'LEGAL',     label: 'Legal (8.5 x 14 in)',     widthPt: 612,     heightPt: 1008 },
  { id: 'TABLOID',   label: 'Tabloid (11 x 17 in)',    widthPt: 792,     heightPt: 1224 },
  { id: 'EXECUTIVE', label: 'Executive (7.25 x 10.5 in)', widthPt: 522,  heightPt: 756 },
  { id: 'STATEMENT', label: 'Statement (5.5 x 8.5 in)', widthPt: 396,    heightPt: 612 },
  { id: 'A3',        label: 'A3 (297 x 420 mm)',       widthPt: 841.89,  heightPt: 1190.55 },
  { id: 'A4',        label: 'A4 (210 x 297 mm)',       widthPt: 595.28,  heightPt: 841.89 },
  { id: 'A5',        label: 'A5 (148 x 210 mm)',       widthPt: 419.53,  heightPt: 595.28 },
  { id: 'B4',        label: 'B4 (250 x 353 mm)',       widthPt: 708.66,  heightPt: 1000.63 },
  { id: 'B5',        label: 'B5 (176 x 250 mm)',       widthPt: 498.9,   heightPt: 708.66 }
];

var DOC_MARGIN_KEYS = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHeader', 'marginFooter'];

/**
 * Page setup from a documentStyle message alone.
 *
 * Split from readPageFormat so the metadata-only read can serve it without
 * ever fetching body content: page setup is document-level data, and none of
 * it needs to know what is written on the page.
 */
function pageFormatFromStyle_(tabId, ds) {
  ds = ds || {};
  var out = {
    tabId: tabId,
    pageWidthPt: dimPt_((ds.pageSize || {}).width),
    pageHeightPt: dimPt_((ds.pageSize || {}).height),
    flipPageOrientation: !!ds.flipPageOrientation,
    pageNumberStart: ds.pageNumberStart === undefined ? 1 : ds.pageNumberStart,
    useFirstPageHeaderFooter: !!ds.useFirstPageHeaderFooter,
    useEvenPageHeaderFooter: !!ds.useEvenPageHeaderFooter,
    // Read-only in the API: when false, marginHeader/marginFooter are ignored
    // by the renderer and the Docs editor defaults are used instead.
    useCustomHeaderFooterMargins: !!ds.useCustomHeaderFooterMargins,
    documentMode: ((ds.documentFormat || {}).documentMode) || 'PAGES',
    backgroundColor: colorToHex_((ds.background || {}).color)
  };
  DOC_MARGIN_KEYS.forEach(function (k) { out[k + 'Pt'] = dimPt_(ds[k]); });
  return out;
}

function readPageFormat(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  return pageFormatFromStyle_(ctx.tabId, ctx.content.documentStyle);
}

/**
 * Apply page setup. `payload` carries points already (the sidebar converts
 * from the user's chosen unit before calling).
 */
function writePageFormat(payload) {
  payload = payload || {};
  var tabIds = knownTargetTabIds_(payload.tabIds, payload.tabId, payload.scope) ||
    targetTabIds_(fetchDoc_(), payload.tabId, payload.scope);
  var warnings = [];

  var requests = [];
  tabIds.forEach(function (tid) {
    var style = {};
    var fields = [];

    if (payload.pageWidthPt || payload.pageHeightPt) {
      // pageSize is one message and the mask names the whole of it, so an
      // absent side is not "leave it alone" -- it is a null where a Dimension
      // belongs, which the API refuses outright. The sidebar always sends
      // both; anything sending one (a hand-built import, a caller doing the
      // obvious thing) gets the other filled in from the document rather than
      // a 400. Only that case pays for the read.
      var w = payload.pageWidthPt;
      var h = payload.pageHeightPt;
      if (!w || !h) {
        var size = readPageFormat(tid);
        w = w || size.pageWidthPt;
        h = h || size.pageHeightPt;
      }
      style.pageSize = { width: ptDim_(w), height: ptDim_(h) };
      fields.push('pageSize');
    }
    DOC_MARGIN_KEYS.forEach(function (k) {
      var v = payload[k + 'Pt'];
      if (v !== undefined && v !== null && v !== '') {
        style[k] = ptDim_(v);
        fields.push(k);
      }
    });
    ['flipPageOrientation', 'useFirstPageHeaderFooter', 'useEvenPageHeaderFooter'].forEach(function (k) {
      if (payload[k] !== undefined) { style[k] = !!payload[k]; fields.push(k); }
    });
    if (payload.pageNumberStart !== undefined && payload.pageNumberStart !== '') {
      style.pageNumberStart = Number(payload.pageNumberStart);
      fields.push('pageNumberStart');
    }
    if (payload.documentMode) {
      style.documentFormat = { documentMode: payload.documentMode };
      fields.push('documentFormat.documentMode');
    }
    if (payload.backgroundColor !== undefined) {
      // background is the one property that cannot be reset. Naming a field
      // in the mask and sending no value for it is how every other property
      // is put back to its default, and for this one the API refuses the
      // whole batch: "A value for background color must be specified in
      // order to update it." A document background cannot be transparent
      // either, so there is no way to express "no colour" except by writing
      // the white that a document without a background already renders.
      //
      // Which leaves two cases that used to be one. The empty string is the
      // Clear button, and the user means white. null is what reading a
      // document that has no background gives back, and it means there was
      // nothing here to carry -- so exporting such a document and importing
      // it again must leave the background alone rather than 400 on it,
      // which is what applying any whole-document preset used to do.
      if (payload.backgroundColor === '') {
        style.background = { color: hexToColor_('#ffffff') };
        fields.push('background');
      } else if (payload.backgroundColor !== null) {
        style.background = { color: hexToColor_(payload.backgroundColor) };
        fields.push('background');
      }
    }
    if (!fields.length) return;

    var req = { updateDocumentStyle: { documentStyle: style, fields: fields.join(',') } };
    if (tid) req.updateDocumentStyle.tabId = tid;
    requests.push(req);
  });

  var touchesHfMargins = (payload.marginHeaderPt !== undefined && payload.marginHeaderPt !== '') ||
                         (payload.marginFooterPt !== undefined && payload.marginFooterPt !== '');
  if (touchesHfMargins) {
    var cur = readPageFormat(payload.tabId);
    if (!cur.useCustomHeaderFooterMargins) {
      warnings.push(
        'Header/footer margins were written, but this document has custom header/footer ' +
        'margins turned off. useCustomHeaderFooterMargins is read-only in the Docs API, so ' +
        'the values will not take effect until you enable them once in the Docs UI ' +
        '(Format > Headers & footers > set a Header or Footer margin).');
    }
  }
  if (payload.documentMode === 'PAGELESS') {
    warnings.push('In pageless mode Docs does not render page size, margins, headers or footers.');
  }

  var res = batchUpdate_(requests);
  res.warnings = warnings;
  return res;
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/**
 * Sections carry their own margins, column layout and header/footer bindings.
 * A section's style lives on the SectionBreak that starts it; the first
 * section of a tab is described by the body's leading sectionBreak.
 */
function readSections(tabId) {
  var r = resolveTab_(fetchDoc_(), tabId);
  var scan = sectionsScan_(r);
  return { tabId: r.tabId, sections: scan.sections };
}

/** The section breaks of one tab, plus the body elements the cursor probe
 *  is matched against. One walk serves both the full list and the
 *  find-the-current-section read. */
function sectionsScan_(tabCtx) {
  var elements = ((tabCtx.content.body || {}).content) || [];
  var ds = tabCtx.content.documentStyle || {};
  var sections = [];
  // The header and footer in force, carried forward: a section that does not
  // name its own continues the one before it, and the first section continues
  // the document's.
  var runHeader = ds.defaultHeaderId || null;
  var runFooter = ds.defaultFooterId || null;
  elements.forEach(function (el, i) {
    if (!el.sectionBreak) return;
    var ss = el.sectionBreak.sectionStyle || {};
    if (ss.defaultHeaderId) runHeader = ss.defaultHeaderId;
    if (ss.defaultFooterId) runFooter = ss.defaultFooterId;
    var cols = (ss.columnProperties || []).map(function (c) {
      return { widthPt: dimPt_(c.width), paddingEndPt: dimPt_(c.paddingEnd) };
    });
    sections.push({
      index: sections.length,
      startIndex: el.startIndex || 0,
      sectionType: ss.sectionType || 'CONTINUOUS',
      isFirst: (el.startIndex || 0) === 0,
      marginTopPt: dimPt_(ss.marginTop),
      marginBottomPt: dimPt_(ss.marginBottom),
      marginLeftPt: dimPt_(ss.marginLeft),
      marginRightPt: dimPt_(ss.marginRight),
      marginHeaderPt: dimPt_(ss.marginHeader),
      marginFooterPt: dimPt_(ss.marginFooter),
      contentDirection: ss.contentDirection || 'LEFT_TO_RIGHT',
      columnSeparatorStyle: ss.columnSeparatorStyle || 'NONE',
      pageNumberStart: ss.pageNumberStart,
      flipPageOrientation: !!ss.flipPageOrientation,
      useFirstPageHeaderFooter: !!ss.useFirstPageHeaderFooter,
      columnCount: cols.length || 1,
      columns: cols,
      headerId: runHeader,
      footerId: runFooter,
      // Whether this section names its own, as against continuing the one
      // before it. Every id it names of that kind, so handing the header back
      // to the previous section hands back all three variants at once.
      ownHeaderIds: ['defaultHeaderId', 'firstPageHeaderId', 'evenPageHeaderId']
        .map(function (k) { return ss[k]; }).filter(Boolean),
      ownFooterIds: ['defaultFooterId', 'firstPageFooterId', 'evenPageFooterId']
        .map(function (k) { return ss[k]; }).filter(Boolean)
    });
  });
  return { sections: sections, elements: elements };
}

/**
 * Which section the cursor is in, by matching the paragraph text the probe
 * reported against the body's paragraphs.
 *
 * DocumentApp cannot see section breaks, so there is no direct way to ask
 * which one holds the cursor. The probe's chain of child indices (see
 * cursorPath_) picks the cursor's paragraph out of the API's own content,
 * and the section holding that paragraph's start index is the answer.
 *
 * Two fallbacks sit behind it. Where the path cannot be resolved -- the
 * cursor is in a header, or the climb gave up -- the probe's paragraph text
 * is matched against the body instead, which is worth doing because two
 * paragraphs can share a prefix but most do not. Ties there go to the
 * section the panel was already showing, which is also the answer when
 * nothing matches at all: while you type in one section the panel should
 * not jump to another just because a twin paragraph exists elsewhere.
 */
function pickSection_(secs, elements, ctx) {
  if (!secs.length) return -1;
  var preferred = Math.min(Math.max(ctx.preferred || 0, 0), secs.length - 1);

  var starts = secs.map(function (s) { return s.startIndex; });
  function sectionOf(at) {
    var hit = 0;
    for (var i = 0; i < starts.length; i++) if (starts[i] <= at) hit = i;
    return hit;
  }

  if (ctx.root === 'body') {
    var el = elementAtPath_(elements, ctx.path);
    if (el && el.startIndex !== undefined) return sectionOf(el.startIndex);
  }

  var want = ctx.paraHead;
  if (want === undefined || want === null) return preferred;

  var wantLi = ctx.paraKind === 'li';
  var hits = [];
  function visit(els) {
    (els || []).forEach(function (e) {
      if (e.paragraph) {
        if (!!e.paragraph.bullet === wantLi) {
          var t = paraText_(e.paragraph);
          // An empty head can only stand for an empty paragraph; anything
          // else matches by its prefix.
          if (want === '' ? t === '' : t.slice(0, want.length) === want) {
            if (e.startIndex !== undefined) hits.push(sectionOf(e.startIndex));
          }
        }
        return;
      }
      if (e.table) {
        (e.table.tableRows || []).forEach(function (r) {
          (r.tableCells || []).forEach(function (c) { visit(c.content); });
        });
      }
    });
  }
  visit(elements);

  if (!hits.length) return preferred;
  // Nearest match wins, so a paragraph whose twin sits in the section the
  // panel already shows keeps the panel where it is -- and when the section
  // the panel shows is itself a match, its distance is zero and nothing
  // displaces it. That is the whole of the stickiness.
  return hits.reduce(function (best, h) {
    return Math.abs(h - preferred) < Math.abs(best - preferred) ? h : best;
  }, hits[0]);
}

function writeSection(payload) {
  payload = payload || {};
  var style = {};
  var fields = [];

  ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHeader', 'marginFooter'].forEach(function (k) {
    var v = payload[k + 'Pt'];
    if (v !== undefined && v !== null && v !== '') { style[k] = ptDim_(v); fields.push(k); }
  });
  if (payload.contentDirection) { style.contentDirection = payload.contentDirection; fields.push('contentDirection'); }
  if (payload.columnSeparatorStyle) { style.columnSeparatorStyle = payload.columnSeparatorStyle; fields.push('columnSeparatorStyle'); }
  if (payload.pageNumberStart !== undefined && payload.pageNumberStart !== '') {
    style.pageNumberStart = Number(payload.pageNumberStart); fields.push('pageNumberStart');
  }
  if (payload.flipPageOrientation !== undefined) { style.flipPageOrientation = !!payload.flipPageOrientation; fields.push('flipPageOrientation'); }
  if (payload.useFirstPageHeaderFooter !== undefined) { style.useFirstPageHeaderFooter = !!payload.useFirstPageHeaderFooter; fields.push('useFirstPageHeaderFooter'); }
  if (payload.columns && payload.columns.length) {
    style.columnProperties = payload.columns.map(function (c) {
      var out = {};
      if (c.widthPt) out.width = ptDim_(c.widthPt);
      if (c.paddingEndPt !== undefined && c.paddingEndPt !== '') out.paddingEnd = ptDim_(c.paddingEndPt);
      return out;
    });
    fields.push('columnProperties');
  }
  if (!fields.length) return { applied: 0 };

  // The range must overlap the section; a zero-width range at the section
  // break's own start index selects exactly that section.
  function request(startIndex) {
    var range = { startIndex: startIndex, endIndex: startIndex };
    if (payload.tabId) range.tabId = payload.tabId;
    return { updateSectionStyle: { sectionStyle: style, range: range, fields: fields.join(',') } };
  }
  if (!payload.applyAll) return batchUpdate_([request(payload.startIndex)]);

  // "Apply to all sections": one request per section, all in the one
  // batchUpdate, so the document goes from uneven to even in a single step.
  var secs = sectionsScan_(resolveTab_(fetchDoc_(), payload.tabId)).sections;
  return batchUpdate_(secs.map(function (s) { return request(s.startIndex); }));
}

/**
 * Bring every section into line with the one the panel is showing, which is
 * what ticking "Apply to all sections" promises. Only the sections that
 * actually differ get a request.
 */
function unifySections(payload) {
  payload = payload || {};
  var secs = sectionsScan_(resolveTab_(fetchDoc_(), payload.tabId)).sections;
  var src = secs.filter(function (s) { return s.startIndex === payload.fromStartIndex; })[0] || secs[0];
  if (!src || secs.length < 2) return { applied: 0 };

  var style = {};
  var fields = [];
  [['marginTopPt', 'marginTop'], ['marginBottomPt', 'marginBottom'],
   ['marginLeftPt', 'marginLeft'], ['marginRightPt', 'marginRight'],
   ['marginHeaderPt', 'marginHeader'], ['marginFooterPt', 'marginFooter']]
    .forEach(function (p) {
      if (src[p[0]] !== null && src[p[0]] !== undefined) {
        style[p[1]] = ptDim_(src[p[0]]);
        fields.push(p[1]);
      }
    });
  if (src.contentDirection) { style.contentDirection = src.contentDirection; fields.push('contentDirection'); }
  if (src.columnSeparatorStyle) { style.columnSeparatorStyle = src.columnSeparatorStyle; fields.push('columnSeparatorStyle'); }
  if (src.pageNumberStart !== null && src.pageNumberStart !== undefined) {
    style.pageNumberStart = src.pageNumberStart; fields.push('pageNumberStart');
  }
  if (src.flipPageOrientation) { style.flipPageOrientation = true; fields.push('flipPageOrientation'); }
  if (src.useFirstPageHeaderFooter) { style.useFirstPageHeaderFooter = true; fields.push('useFirstPageHeaderFooter'); }
  if (src.columns && src.columns.length) {
    style.columnProperties = src.columns.map(function (c) {
      var out = {};
      if (c.widthPt) out.width = ptDim_(c.widthPt);
      if (c.paddingEndPt !== undefined && c.paddingEndPt !== null) out.paddingEnd = ptDim_(c.paddingEndPt);
      return out;
    });
    fields.push('columnProperties');
  }
  if (!fields.length) return { applied: 0 };

  var requests = secs.filter(function (s) { return s !== src; }).map(function (s) {
    var range = { startIndex: s.startIndex, endIndex: s.startIndex };
    if (payload.tabId) range.tabId = payload.tabId;
    return { updateSectionStyle: { sectionStyle: style, range: range, fields: fields.join(',') } };
  });
  return requests.length ? batchUpdate_(requests) : { applied: 0 };
}

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

function readPageFormat(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var ds = ctx.content.documentStyle || {};
  var out = {
    tabId: ctx.tabId,
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

/**
 * Apply page setup. `payload` carries points already (the sidebar converts
 * from the user's chosen unit before calling).
 */
function writePageFormat(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var tabIds = targetTabIds_(doc, payload.tabId, payload.scope);
  var warnings = [];

  var requests = [];
  tabIds.forEach(function (tid) {
    var style = {};
    var fields = [];

    if (payload.pageWidthPt || payload.pageHeightPt) {
      style.pageSize = {
        width: ptDim_(payload.pageWidthPt),
        height: ptDim_(payload.pageHeightPt)
      };
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
      // A document background cannot be transparent -- the API says so in as
      // many words -- so "no colour" here has to mean the default, which is
      // white. Naming the field in the mask while sending no value for it is
      // how the Docs API is asked to reset a property, and it is the only way
      // to get white back without writing an explicit white the user would
      // then have to clear again.
      if (payload.backgroundColor === '' || payload.backgroundColor === null) {
        fields.push('background');
      } else {
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
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var elements = ((ctx.content.body || {}).content) || [];
  var sections = [];
  elements.forEach(function (el, i) {
    if (!el.sectionBreak) return;
    var ss = el.sectionBreak.sectionStyle || {};
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
      columns: cols
    });
  });
  return { tabId: ctx.tabId, sections: sections };
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
  var range = { startIndex: payload.startIndex, endIndex: payload.startIndex };
  if (payload.tabId) range.tabId = payload.tabId;
  return batchUpdate_([{ updateSectionStyle: { sectionStyle: style, range: range, fields: fields.join(',') } }]);
}

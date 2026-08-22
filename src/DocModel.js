/**
 * Document access, tab resolution, and conversion between the Docs API
 * style messages and the flat "UI style" objects the sidebar exchanges.
 *
 * UI style objects use points for every dimension and '#rrggbb' for every
 * colour; the sidebar renders them in whatever unit the user picked.
 */

function activeDocId_() {
  return DocumentApp.getActiveDocument().getId();
}

/**
 * Full document including tab contents, fetched at most once per execution.
 *
 * Every read* function needs the whole document, and loadAll calls seven of
 * them, so without this one sidebar refresh was eight full downloads of the
 * document -- the single largest cost in the add-on, paid again every time the
 * poll ticked. One Apps Script execution is short enough that a document
 * fetched at its start is still the document at its end; a write is the one
 * thing that makes that untrue, so batchUpdate_ clears the cache.
 *
 * Callers treat the result as read-only. Nothing here copies it, because
 * copying a large document is most of the cost this avoids.
 */
var docCache_ = null;

function fetchDoc_() {
  if (!docCache_) {
    docCache_ = Docs.Documents.get(activeDocId_(), { includeTabsContent: true });
  }
  return docCache_;
}

function batchUpdate_(requests) {
  var reqs = (requests || []).filter(function (r) { return !!r; });
  if (!reqs.length) return { applied: 0 };
  Docs.Documents.batchUpdate({ requests: reqs }, activeDocId_());
  docCache_ = null;   // the document just changed under us
  return { applied: reqs.length };
}

/**
 * The value that occurs most often, or undefined if there is nothing to count.
 *
 * Ties go to whichever value was seen first, which in document order means the
 * earliest list or table in the tab wins. Any tie-break would be arbitrary;
 * this one is at least predictable and does not depend on key ordering.
 */
function modeOf_(values) {
  var counts = {}, order = [], best, bestN = 0;
  (values || []).forEach(function (v) {
    if (v === undefined || v === null) return;
    var k = JSON.stringify(v);
    if (!(k in counts)) { counts[k] = 0; order.push(k); }
    counts[k]++;
  });
  order.forEach(function (k) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } });
  return best === undefined ? undefined : JSON.parse(best);
}

/**
 * Field by field, the value most of these objects carry.
 *
 * Settling each field on its own rather than picking one object wholesale is
 * what makes "apply to all" useful: tables that agree about their padding but
 * disagree about their borders keep the padding and get the majority border,
 * instead of one table's whole look being imposed on the rest.
 */
function commonFields_(objs) {
  var keys = {};
  (objs || []).forEach(function (o) {
    Object.keys(o || {}).forEach(function (k) { keys[k] = 1; });
  });
  var out = {};
  Object.keys(keys).forEach(function (k) {
    var vals = [];
    (objs || []).forEach(function (o) { if (o && o[k] !== undefined) vals.push(o[k]); });
    var m = modeOf_(vals);
    if (m !== undefined) out[k] = m;
  });
  return out;
}

/** Depth-first list of every tab, including nested child tabs. */
function flattenTabs_(doc) {
  var out = [];
  (function walk(tabs, depth) {
    (tabs || []).forEach(function (t) {
      var p = t.tabProperties || {};
      out.push({ tabId: p.tabId, title: p.title || '(untitled tab)', depth: depth, tab: t });
      walk(t.childTabs, depth + 1);
    });
  })(doc.tabs, 0);
  return out;
}

/**
 * Resolve the DocumentTab-shaped content to operate on.
 *
 * Documents created before the tabs feature (and responses fetched without
 * includeTabsContent) expose body/documentStyle/namedStyles directly on the
 * Document. Those legacy fields have the same shape as DocumentTab, so the
 * rest of the code can treat both uniformly; tabId is null in that case and
 * is simply omitted from requests, which targets the first tab.
 */
function resolveTab_(doc, tabId) {
  var flat = flattenTabs_(doc);
  if (!flat.length) return { tabId: null, content: doc };
  var hit = null;
  if (tabId) {
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].tabId === tabId) { hit = flat[i]; break; }
    }
  }
  if (!hit) hit = flat[0];
  return { tabId: hit.tabId, content: hit.tab.documentTab || {} };
}

/** Every tab id to operate on for a given scope ('current' or 'all'). */
function targetTabIds_(doc, tabId, scope) {
  var flat = flattenTabs_(doc);
  if (!flat.length) return [null];
  if (scope === 'all') return flat.map(function (f) { return f.tabId; });
  return [resolveTab_(doc, tabId).tabId];
}

/* ------------------------------------------------------------------ *
 * TextStyle <-> UI
 * ------------------------------------------------------------------ */

var TEXT_STYLE_BOOLS = ['bold', 'italic', 'underline', 'strikethrough', 'smallCaps'];

function textStyleToUi_(ts) {
  ts = ts || {};
  var ui = {};
  TEXT_STYLE_BOOLS.forEach(function (k) {
    if (ts[k] !== undefined) ui[k] = !!ts[k];
  });
  if (ts.baselineOffset !== undefined) ui.baselineOffset = ts.baselineOffset;
  if (ts.fontSize) ui.fontSizePt = dimPt_(ts.fontSize);
  if (ts.weightedFontFamily) {
    ui.fontFamily = ts.weightedFontFamily.fontFamily || '';
    ui.fontWeight = ts.weightedFontFamily.weight || 400;
  }
  if (ts.foregroundColor) ui.foregroundColor = colorToHex_(ts.foregroundColor);
  if (ts.backgroundColor) ui.backgroundColor = colorToHex_(ts.backgroundColor);
  return ui;
}

/**
 * Build a TextStyle plus the list of field-mask paths that were actually set.
 * Only keys present on `ui` produce output, so a partial edit stays partial.
 */
function uiToTextStyle_(ui) {
  ui = ui || {};
  var style = {};
  var fields = [];
  TEXT_STYLE_BOOLS.forEach(function (k) {
    if (ui[k] !== undefined) { style[k] = !!ui[k]; fields.push(k); }
  });
  // null means "put this back to whatever it inherits". The Docs API asks
  // for that by naming the field in the mask and sending no value for it,
  // which is exactly what pushing the field without setting style[k] does.
  if (ui.baselineOffset === null) {
    fields.push('baselineOffset');
  } else if (ui.baselineOffset !== undefined) {
    style.baselineOffset = ui.baselineOffset || 'NONE';
    fields.push('baselineOffset');
  }
  if (ui.fontSizePt !== undefined && ui.fontSizePt !== null && ui.fontSizePt !== '') {
    style.fontSize = ptDim_(ui.fontSizePt);
    fields.push('fontSize');
  }
  if (ui.fontFamily) {
    var w = Number(ui.fontWeight || 400);
    // The API rejects anything that is not a multiple of 100 in [100, 900].
    w = Math.min(900, Math.max(100, Math.round(w / 100) * 100));
    style.weightedFontFamily = { fontFamily: ui.fontFamily, weight: w };
    fields.push('weightedFontFamily');
  }
  if (ui.foregroundColor !== undefined) {
    style.foregroundColor = hexToColor_(ui.foregroundColor);
    fields.push('foregroundColor');
  }
  if (ui.backgroundColor !== undefined) {
    style.backgroundColor = hexToColor_(ui.backgroundColor);
    fields.push('backgroundColor');
  }
  return { style: style, fields: fields };
}

/* ------------------------------------------------------------------ *
 * Reading current values back out of the document
 *
 * The sidebar shows the document's real formatting, not empty boxes, so
 * every editor needs the current value of each field it offers. A field
 * only has one current value when everything it covers agrees: styling
 * "all footnotes" spans many paragraphs, and those paragraphs may differ.
 * styleSummary_ therefore returns the agreed values plus the names of the
 * fields that disagree, which the sidebar shows as "mixed".
 * ------------------------------------------------------------------ */

/** Every paragraph inside a content array, descending into table cells. */
function collectParagraphs_(content, out) {
  out = out || [];
  (content || []).forEach(function (el) {
    if (el.paragraph) out.push(el.paragraph);
    if (el.table) {
      (el.table.tableRows || []).forEach(function (row) {
        (row.tableCells || []).forEach(function (cell) {
          collectParagraphs_(cell.content, out);
        });
      });
    }
  });
  return out;
}

/**
 * Agreed current values across a set of paragraphs.
 *
 * Returns { textStyle, paragraphStyle, mixed }. A field is "mixed" -- and so
 * left out of the styles -- when the paragraphs carry different values for
 * it, or when only some of them set it at all.
 */
function styleSummary_(paragraphs) {
  paragraphs = paragraphs || [];
  var tVal = {}, pVal = {}, tSeen = {}, pSeen = {}, mixed = {};
  var runCount = 0, paraCount = 0;

  function merge(vals, seen, ui) {
    Object.keys(ui).forEach(function (k) {
      var j = JSON.stringify(ui[k]);
      if (!(k in vals)) { vals[k] = j; seen[k] = 1; }
      else if (vals[k] !== j) { mixed[k] = true; }
      else { seen[k]++; }
    });
  }

  paragraphs.forEach(function (para) {
    paraCount++;
    merge(pVal, pSeen, paragraphStyleToUi_(para.paragraphStyle));
    (para.elements || []).forEach(function (pe) {
      if (!pe.textRun) return;
      // A run holding only the paragraph's terminating newline says nothing
      // useful about how the paragraph looks.
      if (pe.textRun.content === '\n') return;
      runCount++;
      merge(tVal, tSeen, textStyleToUi_(pe.textRun.textStyle));
    });
  });

  // Set on some but not all is disagreement too.
  Object.keys(pVal).forEach(function (k) { if (pSeen[k] !== paraCount) mixed[k] = true; });
  Object.keys(tVal).forEach(function (k) { if (tSeen[k] !== runCount) mixed[k] = true; });

  var out = { textStyle: {}, paragraphStyle: {}, mixed: [] };
  Object.keys(tVal).forEach(function (k) { if (!mixed[k]) out.textStyle[k] = JSON.parse(tVal[k]); });
  Object.keys(pVal).forEach(function (k) { if (!mixed[k]) out.paragraphStyle[k] = JSON.parse(pVal[k]); });
  out.mixed = Object.keys(mixed).sort();
  return out;
}

/** The same idea for a bare set of TextStyles, e.g. footnote reference marks. */
function textStyleSummary_(textStyles) {
  var fake = (textStyles || []).map(function (ts) {
    return { elements: [{ textRun: { content: 'x', textStyle: ts || {} } }] };
  });
  var sum = styleSummary_(fake);
  return { textStyle: sum.textStyle, mixed: sum.mixed };
}

/* ------------------------------------------------------------------ *
 * ParagraphStyle <-> UI
 * ------------------------------------------------------------------ */

var PARA_STYLE_BOOLS = ['keepLinesTogether', 'keepWithNext', 'avoidWidowAndOrphan', 'pageBreakBefore'];
var PARA_STYLE_DIMS = ['spaceAbove', 'spaceBelow', 'indentStart', 'indentEnd', 'indentFirstLine'];
var PARA_BORDER_SIDES = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'borderBetween'];

function borderToUi_(b) {
  if (!b) return null;
  return {
    color: colorToHex_(b.color),
    widthPt: dimPt_(b.width),
    paddingPt: dimPt_(b.padding),
    dashStyle: b.dashStyle || 'SOLID'
  };
}

function uiToBorder_(u) {
  if (!u) return null;
  return {
    color: hexToColor_(u.color),
    width: ptDim_(u.widthPt === undefined || u.widthPt === '' ? 0 : u.widthPt),
    padding: ptDim_(u.paddingPt === undefined || u.paddingPt === '' ? 0 : u.paddingPt),
    dashStyle: u.dashStyle || 'SOLID'
  };
}

function paragraphStyleToUi_(ps) {
  ps = ps || {};
  var ui = {};
  if (ps.alignment !== undefined) ui.alignment = ps.alignment;
  if (ps.direction !== undefined) ui.direction = ps.direction;
  if (ps.spacingMode !== undefined) ui.spacingMode = ps.spacingMode;
  if (ps.lineSpacing !== undefined) ui.lineSpacing = ps.lineSpacing;
  PARA_STYLE_BOOLS.forEach(function (k) {
    if (ps[k] !== undefined) ui[k] = !!ps[k];
  });
  PARA_STYLE_DIMS.forEach(function (k) {
    if (ps[k]) ui[k + 'Pt'] = dimPt_(ps[k]);
  });
  if (ps.shading) ui.shadingColor = colorToHex_(ps.shading.backgroundColor);
  PARA_BORDER_SIDES.forEach(function (k) {
    if (ps[k]) ui[k] = borderToUi_(ps[k]);
  });
  if (ps.tabStops) {
    ui.tabStops = ps.tabStops.map(function (t) {
      return { offsetPt: dimPt_(t.offset), alignment: t.alignment || 'START' };
    });
  }
  return ui;
}

function uiToParagraphStyle_(ui) {
  ui = ui || {};
  var style = {};
  var fields = [];
  ['alignment', 'direction', 'spacingMode'].forEach(function (k) {
    // As above: null resets the property to the inherited value.
    if (ui[k] === null) { fields.push(k); return; }
    if (ui[k]) { style[k] = ui[k]; fields.push(k); }
  });
  if (ui.lineSpacing !== undefined && ui.lineSpacing !== null && ui.lineSpacing !== '') {
    // Docs expresses line spacing as a percentage where normal == 100.
    style.lineSpacing = Number(ui.lineSpacing);
    fields.push('lineSpacing');
  }
  PARA_STYLE_BOOLS.forEach(function (k) {
    if (ui[k] !== undefined) { style[k] = !!ui[k]; fields.push(k); }
  });
  PARA_STYLE_DIMS.forEach(function (k) {
    var v = ui[k + 'Pt'];
    if (v !== undefined && v !== null && v !== '') { style[k] = ptDim_(v); fields.push(k); }
  });
  if (ui.shadingColor !== undefined) {
    style.shading = { backgroundColor: hexToColor_(ui.shadingColor) };
    fields.push('shading');
  }
  PARA_BORDER_SIDES.forEach(function (k) {
    if (ui[k]) { style[k] = uiToBorder_(ui[k]); fields.push(k); }
  });
  // ParagraphStyle.tabStops is read-only in the Docs API ("This property is
  // read-only"), so it is never written. It is still read for display, and
  // callers that re-assert a whole style must not send it back.
  return { style: style, fields: fields };
}

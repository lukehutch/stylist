/**
 * Style writes, actually applied to the fixture.
 *
 * Recording a request proves it was built. It does not prove it works: the
 * Docs API answers 200 to an update whose field mask does not name what the
 * payload sets, changes nothing, and says nothing -- so "the request went
 * out" and "the document changed" are different facts, and only the second
 * one is what a user gets. Offline, only the first was ever checked.
 *
 * So this applies the style requests to the fixture document, through the
 * field mask and only through the field mask, the way the API does. A mask
 * that fails to name a field means the field is not applied here either, and
 * a read-back test fails locally instead of the change quietly not happening
 * in someone's document.
 *
 * WHAT THIS IS NOT. It handles the six style updates and nothing else.
 * Content edits -- insertText, deleteContentRange, createFootnote,
 * insertTable, createParagraphBullets and the rest -- move every index in
 * the document after them, and reproducing that faithfully is reproducing
 * Google Docs. Those are recorded and ignored here, and stay the live
 * suite's job. Requests this does not know are not errors; they are simply
 * not applied, so a test that needs one has to be a live test.
 */

const STYLE_REQUESTS = {
  updateDocumentStyle: 'documentStyle',
  updateSectionStyle: 'sectionStyle',
  updateNamedStyle: 'namedStyle',
  updateParagraphStyle: 'paragraphStyle',
  updateTextStyle: 'textStyle',
  updateTableCellStyle: 'tableCellStyle'
};

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function getPath(obj, parts) {
  return parts.reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);
}

function setPath(obj, parts, value) {
  const last = parts[parts.length - 1];
  let cur = obj;
  parts.slice(0, -1).forEach((k) => {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  });
  if (value === undefined) delete cur[last];
  else cur[last] = JSON.parse(JSON.stringify(value));
}

/**
 * Copy exactly the masked fields across, and no others.
 *
 * A path named in the mask with no value behind it is how the API is asked
 * to put a property back to what it inherits, so it deletes rather than
 * writes -- which is what made a zero read as null so damaging.
 */
function applyMask(target, payload, mask) {
  mask.split(',').map((s) => s.trim()).filter(Boolean).forEach((path) => {
    const parts = path.split('.');
    setPath(target, parts, getPath(payload, parts));
  });
}

/** Every tab's DocumentTab, plus the legacy shape where the doc IS one. */
function tabsOf(doc) {
  const out = [];
  (function walk(list) {
    (list || []).forEach((t) => {
      if (t.documentTab) out.push({ id: (t.tabProperties || {}).tabId, tab: t.documentTab });
      walk(t.childTabs);
    });
  })(doc.tabs);
  if (!out.length) out.push({ id: null, tab: doc });
  return out;
}

function targetTab(doc, tabId) {
  const all = tabsOf(doc);
  if (!tabId) return all[0].tab;
  const hit = all.filter((t) => t.id === tabId)[0];
  return hit ? hit.tab : all[0].tab;
}

/** Structural elements of a tab, body and every named segment alike. */
function segments(tab) {
  const out = [{ content: (tab.body || {}).content || [] }];
  ['headers', 'footers', 'footnotes'].forEach((k) => {
    Object.keys(tab[k] || {}).forEach((id) => out.push({ content: tab[k][id].content || [] }));
  });
  return out;
}

function overlaps(el, range) {
  const s = el.startIndex === undefined ? 0 : el.startIndex;
  const e = el.endIndex === undefined ? s : el.endIndex;
  if (range.startIndex === range.endIndex) return s <= range.startIndex && range.startIndex <= e;
  return s < range.endIndex && e > range.startIndex;
}

/** Paragraphs the range touches, cells included, across every segment. */
function paragraphsIn(tab, range) {
  const out = [];
  segments(tab).forEach((seg) => {
    (function scan(content) {
      (content || []).forEach((el) => {
        if (el.paragraph && overlaps(el, range)) out.push(el);
        if (el.table) {
          (el.table.tableRows || []).forEach((r) => {
            (r.tableCells || []).forEach((c) => scan(c.content));
          });
        }
      });
    })(seg.content);
  });
  return out;
}

/**
 * The section a range selects.
 *
 * A section break at index b begins a section that runs to the next break.
 * writeSection sends a zero-width range at the break's own index, which is
 * what the "startIndex <= s <= nextStart" test below has to admit.
 */
function sectionBreaksIn(tab, range) {
  const content = ((tab.body || {}).content) || [];
  const breaks = content
    .map((el, i) => ({ el: el, i: i, at: el.startIndex === undefined ? 0 : el.startIndex }))
    .filter((b) => b.el.sectionBreak);
  return breaks.filter((b, n) => {
    const next = breaks[n + 1] ? breaks[n + 1].at : Infinity;
    if (range.startIndex === range.endIndex) {
      return range.startIndex >= b.at && range.startIndex < next;
    }
    return range.startIndex < next && range.endIndex > b.at;
  }).map((b) => b.el);
}

function applyOne(doc, req) {
  const kind = Object.keys(req)[0];
  const key = STYLE_REQUESTS[kind];
  if (!key) return false;            // a content edit; recorded, not applied
  const body = req[kind];
  const tab = targetTab(doc, body.tabId);
  const mask = body.fields || '';
  const payload = body[key] || {};

  if (kind === 'updateDocumentStyle') {
    if (!tab.documentStyle) tab.documentStyle = {};
    applyMask(tab.documentStyle, payload, mask);
    return true;
  }

  if (kind === 'updateNamedStyle') {
    const styles = ((tab.namedStyles || {}).styles) || [];
    const hit = styles.filter((s) => s.namedStyleType === payload.namedStyleType)[0];
    if (!hit) return false;
    // The mask is relative to namedStyle, so namedStyleType is in it too;
    // applying it over itself is harmless and keeps the rule uniform.
    applyMask(hit, payload, mask);
    return true;
  }

  if (kind === 'updateSectionStyle') {
    sectionBreaksIn(tab, body.range || {}).forEach((el) => {
      if (!el.sectionBreak.sectionStyle) el.sectionBreak.sectionStyle = {};
      applyMask(el.sectionBreak.sectionStyle, payload, mask);
    });
    return true;
  }

  if (kind === 'updateParagraphStyle') {
    paragraphsIn(tab, body.range || {}).forEach((el) => {
      if (!el.paragraph.paragraphStyle) el.paragraph.paragraphStyle = {};
      applyMask(el.paragraph.paragraphStyle, payload, mask);
    });
    return true;
  }

  if (kind === 'updateTextStyle') {
    // Whole elements only. Splitting a text run at an index that falls in
    // the middle of it is content editing, and is not done here.
    paragraphsIn(tab, body.range || {}).forEach((el) => {
      (el.paragraph.elements || []).forEach((e) => {
        if (!overlaps(e, body.range || {})) return;
        const holder = e.textRun || e.footnoteReference;
        if (!holder) return;
        if (!holder.textStyle) holder.textStyle = {};
        applyMask(holder.textStyle, payload, mask);
      });
    });
    return true;
  }

  if (kind === 'updateTableCellStyle') {
    const r = body.tableRange || {};
    const loc = r.tableCellLocation || {};
    const start = (loc.tableStartLocation || {}).index;
    ((tab.body || {}).content || []).forEach((el) => {
      if (!el.table) return;
      if (start !== undefined && el.startIndex !== start) return;
      const rows = el.table.tableRows || [];
      const r0 = loc.rowIndex || 0;
      const c0 = loc.columnIndex || 0;
      rows.slice(r0, r0 + (r.rowSpan || rows.length)).forEach((row) => {
        (row.tableCells || []).slice(c0, c0 + (r.columnSpan || (row.tableCells || []).length))
          .forEach((cell) => {
            if (!cell.tableCellStyle) cell.tableCellStyle = {};
            applyMask(cell.tableCellStyle, payload, mask);
          });
      });
    });
    return true;
  }

  return false;
}

/** Apply what can be applied; report the kinds that were only recorded. */
function applyRequests(doc, requests) {
  const skipped = [];
  (requests || []).forEach((req) => {
    if (!isObj(req)) return;
    if (!applyOne(doc, req)) skipped.push(Object.keys(req)[0]);
  });
  return skipped;
}

module.exports = { applyRequests, applyMask, STYLE_REQUESTS };

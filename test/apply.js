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
 * WHAT THIS IS NOT. It handles the style updates and the two structural
 * writes that shift no indexes -- pinning header rows, and stripping bullets
 * off paragraphs that keep their text. Content edits proper -- insertText,
 * deleteContentRange, createFootnote, insertTable, createParagraphBullets
 * and the rest -- move every index in the document after them, and
 * reproducing that faithfully is reproducing Google Docs. Those are recorded
 * and ignored here, and stay the live suite's job. Requests this does not
 * know are not errors; they are simply not applied, so a test that needs one
 * has to be a live test.
 */

const STYLE_REQUESTS = {
  updateDocumentStyle: 'documentStyle',
  updateSectionStyle: 'sectionStyle',
  updateNamedStyle: 'namedStyle',
  updateParagraphStyle: 'paragraphStyle',
  updateTextStyle: 'textStyle',
  updateTableCellStyle: 'tableCellStyle',
  updateTableRowStyle: 'tableRowStyle',
  updateTableColumnProperties: 'tableColumnProperties'
};

/** Structural writes that carry no style payload and no field mask. */
const STRUCTURAL_REQUESTS = ['pinTableHeaderRows', 'deleteParagraphBullets'];

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

/**
 * Google Docs keeps only what a run overrides.
 *
 * Writing a value that matches what the paragraph already inherits from its
 * named style stores no override at all -- it takes away whatever override
 * was there -- so the run reads back carrying nothing rather than carrying
 * the value that was written. Reproducing that here is what stops a local
 * test from passing on a read-back the real API would never give.
 */
function dropInherited(textStyle, paragraph, tab, mask) {
  const type = ((paragraph.paragraphStyle || {}).namedStyleType) || 'NORMAL_TEXT';
  const styles = ((tab.namedStyles || {}).styles) || [];
  const from = ((styles.filter((s) => s.namedStyleType === type)[0]) || {}).textStyle || {};
  mask.split(',').map((s) => s.trim().split('.')[0]).filter(Boolean).forEach((k) => {
    if (k in from && k in textStyle &&
        JSON.stringify(from[k]) === JSON.stringify(textStyle[k])) {
      delete textStyle[k];
    }
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
  if (!key && STRUCTURAL_REQUESTS.indexOf(kind) === -1) {
    return false;                    // a content edit; recorded, not applied
  }
  const body = req[kind];
  const tab = targetTab(doc, body.tabId);
  const mask = body.fields || '';
  const payload = (key && body[key]) || {};

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
        dropInherited(holder.textStyle, el.paragraph, tab, mask);
      });
    });
    return true;
  }

  if (kind === 'updateTableCellStyle') {
    const r = body.tableRange || {};
    const loc = r.tableCellLocation || {};
    // Two forms, and they name the table in different places: a tableRange
    // carries the start location inside its cell location, while the
    // every-cell form carries it on the request itself. Reading only the
    // first meant the every-cell form matched no table in particular and so
    // was applied to all of them -- which nothing noticed while the fixture
    // had one table, and which would have made "style this table" look like
    // it worked on a document with two.
    const start = body.tableRange
      ? (loc.tableStartLocation || {}).index
      : (body.tableStartLocation || {}).index;
    tablesAt(tab, start).forEach((el) => {
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

  if (kind === 'updateTableRowStyle') {
    tablesAt(tab, (body.tableStartLocation || {}).index).forEach((el) => {
      const rows = el.table.tableRows || [];
      const which = (body.rowIndices && body.rowIndices.length)
        ? body.rowIndices : rows.map((_, i) => i);
      which.forEach((i) => {
        const row = rows[i];
        if (!row) return;
        if (!row.tableRowStyle) row.tableRowStyle = {};
        applyMask(row.tableRowStyle, payload, mask);
      });
    });
    return true;
  }

  if (kind === 'updateTableColumnProperties') {
    tablesAt(tab, (body.tableStartLocation || {}).index).forEach((el) => {
      const t = el.table;
      if (!t.tableStyle) t.tableStyle = {};
      if (!t.tableStyle.tableColumnProperties) {
        t.tableStyle.tableColumnProperties = [];
      }
      const props = t.tableStyle.tableColumnProperties;
      // A table whose columns have never been given properties still has
      // them; the API just has nothing to say about them yet.
      while (props.length < (t.columns || 0)) props.push({});
      const which = (body.columnIndices && body.columnIndices.length)
        ? body.columnIndices : props.map((_, i) => i);
      which.forEach((i) => {
        if (!props[i]) return;
        applyMask(props[i], payload, mask);
      });
    });
    return true;
  }

  // Pinning shifts nothing: it sets tableHeader on the leading run of rows
  // and clears it on the rest, which is exactly what the read reports back.
  if (kind === 'pinTableHeaderRows') {
    const n = Number(body.pinnedHeaderRowsCount) || 0;
    tablesAt(tab, (body.tableStartLocation || {}).index).forEach((el) => {
      (el.table.tableRows || []).forEach((row, i) => {
        if (!row.tableRowStyle) row.tableRowStyle = {};
        row.tableRowStyle.tableHeader = i < n;
      });
    });
    return true;
  }

  // Taking a marker off leaves the paragraph and its text exactly where they
  // were -- the only thing that goes is the bullet -- so unlike its opposite
  // number, createParagraphBullets, this one moves no index and can be done
  // here rather than only against Google.
  if (kind === 'deleteParagraphBullets') {
    paragraphsIn(tab, body.range || {}).forEach((el) => {
      delete el.paragraph.bullet;
    });
    return true;
  }

  return false;
}

/** The tables a request names: the one starting there, or all of them. */
function tablesAt(tab, start) {
  return ((tab.body || {}).content || []).filter(
    (el) => el.table && (start === undefined || el.startIndex === start));
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

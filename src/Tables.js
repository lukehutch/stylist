/**
 * Table formatting: cell padding, borders, background, content alignment,
 * column widths, row heights, header rows and pinned header rows.
 *
 * TableRowStyle.preventOverflow is the one page-breaking control the Docs
 * API exposes anywhere: it stops a row's content spilling across a page
 * boundary. There is no equivalent for footnotes (see Footnotes.js).
 */

/**
 * Agreed current values across a set of table cells.
 *
 * Same idea as styleSummary_ for paragraphs: the Tables panel styles many
 * cells at once, so a field only has a current value when every cell agrees.
 */
function cellStyleSummary_(cells) {
  var vals = {}, seen = {}, mixed = {};
  var count = 0;

  function ui(cs) {
    cs = cs || {};
    var o = {};
    ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'].forEach(function (k) {
      if (cs[k]) o[k + 'Pt'] = dimPt_(cs[k]);
    });
    if (cs.backgroundColor) o.backgroundColor = colorToHex_(cs.backgroundColor);
    if (cs.contentAlignment) o.contentAlignment = cs.contentAlignment;
    ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].forEach(function (k) {
      if (!cs[k]) return;
      o[k] = {
        color: colorToHex_(cs[k].color),
        widthPt: dimPt_(cs[k].width),
        dashStyle: cs[k].dashStyle || 'SOLID'
      };
    });
    return o;
  }

  (cells || []).forEach(function (cell) {
    count++;
    var o = ui(cell.tableCellStyle);
    Object.keys(o).forEach(function (k) {
      var j = JSON.stringify(o[k]);
      if (!(k in vals)) { vals[k] = j; seen[k] = 1; }
      else if (vals[k] !== j) { mixed[k] = true; }
      else { seen[k]++; }
    });
  });
  Object.keys(vals).forEach(function (k) { if (seen[k] !== count) mixed[k] = true; });

  var out = { style: {}, mixed: [] };
  Object.keys(vals).forEach(function (k) { if (!mixed[k]) out.style[k] = JSON.parse(vals[k]); });
  out.mixed = Object.keys(mixed).sort();
  return out;
}

/** Every cell in a table, and just the first row's cells. */
function tableCells_(t) {
  var all = [], firstRow = [];
  (t.tableRows || []).forEach(function (row, i) {
    (row.tableCells || []).forEach(function (cell) {
      all.push(cell);
      if (i === 0) firstRow.push(cell);
    });
  });
  return { all: all, firstRow: firstRow };
}

function tableLocations_(content, tabId) {
  var tables = [];
  var els = ((content.body || {}).content) || [];
  // DocumentApp's body does not expose the leading section break, so every
  // element after it is one child earlier than its index here. That offset is
  // what turns a cursor path into a table, in the sidebar, with no read.
  var drop = (els[0] && els[0].sectionBreak) ? 1 : 0;
  els.forEach(function (el, i) {
    if (!el.table) return;
    var t = el.table;
    var firstRowText = '';
    ((t.tableRows || [])[0] || {}).tableCells &&
      (t.tableRows[0].tableCells || []).forEach(function (cell) {
        (cell.content || []).forEach(function (ce) {
          ((ce.paragraph || {}).elements || []).forEach(function (pe) {
            if (pe.textRun && pe.textRun.content) firstRowText += pe.textRun.content + ' ';
          });
        });
      });
    tables.push({
      index: tables.length,
      bodyIndex: i - drop,
      startIndex: el.startIndex || 0,
      rows: t.rows || 0,
      columns: t.columns || 0,
      headerRow: !!(((t.tableRows || [])[0] || {}).tableRowStyle || {}).tableHeader,
      preview: firstRowText.replace(/\s+/g, ' ').trim().slice(0, 70),
      columnWidths: (((t.tableStyle || {}).tableColumnProperties) || []).map(function (c) {
        return { widthType: c.widthType || 'WIDTH_TYPE_UNSPECIFIED', widthPt: dimPt_(c.width) };
      }),
      cellStyle: cellStyleSummary_(tableCells_(t).all),
      headerCellStyle: cellStyleSummary_(tableCells_(t).firstRow),
      // Rows pinned as headers are the leading run with tableHeader set.
      pinnedHeaderRows: (function () {
        var n = 0;
        (t.tableRows || []).some(function (r) {
          if (((r.tableRowStyle || {}).tableHeader)) { n++; return false; }
          return true;
        });
        return n;
      })(),
      rowStyles: (t.tableRows || []).map(function (r, i) {
        var rs = r.tableRowStyle || {};
        return {
          row: i,
          minRowHeightPt: dimPt_(rs.minRowHeight),
          tableHeader: !!rs.tableHeader,
          preventOverflow: !!rs.preventOverflow
        };
      })
    });
  });
  return tables;
}

/**
 * Which top-level table the cursor or selection is inside, as an ordinal into
 * the list tableLocations_ builds, or null if it is not inside one.
 *
 * The cursor probe reports where it sits as a chain of child indices (see
 * cursorPath_). The first index in that chain is the body child the cursor is
 * under, so a cursor anywhere inside a table -- however deeply nested in its
 * cells -- names that table with its first number and no walk at all. The
 * outermost table is the one that counts, because a table nested inside a
 * cell is not in the list to begin with, and the first index is outermost by
 * construction.
 */
function activeTableIndex_(tables, elements, ctx) {
  ctx = ctx || {};
  if (ctx.root !== 'body' || !ctx.path || !ctx.path.length) return null;
  var el = elementAtPath_(elements, [ctx.path[0]]);
  if (!el || !el.table) return null;
  var at = el.startIndex || 0;
  for (var i = 0; i < (tables || []).length; i++) {
    if (tables[i].startIndex === at) return i;
  }
  return null;
}

function readTables(tabId, ctx) {
  var doc = fetchDoc_();
  var tab = resolveTab_(doc, tabId);
  var tables = tableLocations_(tab.content, tab.tabId);
  var elements = ((tab.content.body || {}).content) || [];
  return {
    tabId: tab.tabId,
    tables: tables,
    activeIndex: activeTableIndex_(tables, elements, ctx)
  };
}

/**
 * Make every table in the tab share the formatting most of them already have.
 *
 * The counterpart of unifyLists, and the same rule: every field is settled by
 * majority on its own, so tables that already agree keep what they have.
 * Only whole-table settings take part -- a header row's own colouring is left
 * to the header-row editor, since not every table has one.
 */
function unifyTables(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var tables = tableLocations_(ctx.content, ctx.tabId);
  if (tables.length < 2) return { applied: 0 };

  var cell = commonFields_(tables.map(function (t) { return (t.cellStyle || {}).style || {}; }));
  var rows = commonFields_(tables.map(function (t) {
    var rs = (t.rowStyles || [])[0] || {};
    var o = {};
    if (rs.minRowHeightPt !== null && rs.minRowHeightPt !== undefined) o.minRowHeightPt = rs.minRowHeightPt;
    o.preventOverflow = !!rs.preventOverflow;
    return o;
  }));
  var columns = commonFields_(tables.map(function (t) {
    var c = (t.columnWidths || [])[0] || {};
    var o = {};
    if (c.widthType && c.widthType !== 'WIDTH_TYPE_UNSPECIFIED') o.widthType = c.widthType;
    if (c.widthPt !== null && c.widthPt !== undefined) o.widthPt = c.widthPt;
    return o;
  }));
  // A width only means anything alongside FIXED_WIDTH; sending one with
  // EVENLY_DISTRIBUTED is a contradiction, and the majority vote on the two
  // fields is taken separately, so the pair can disagree.
  if (columns.widthType && columns.widthType !== 'FIXED_WIDTH') delete columns.widthPt;
  var pinned = modeOf_(tables.map(function (t) { return t.pinnedHeaderRows; }));

  var requests = [];
  tables.forEach(function (t) {
    tableRequests_({
      tabId: payload.tabId,
      cell: cell, applyCellsTo: 'all',
      rows: rows, columns: columns,
      pinnedHeaderRowsCount: pinned
    }, { startIndex: t.startIndex, columnCount: t.columns })
      .forEach(function (r) { requests.push(r); });
  });
  return batchUpdate_(requests);
}

function tableLoc_(startIndex, tabId) {
  var loc = { index: startIndex };
  if (tabId) loc.tabId = tabId;
  return loc;
}

/**
 * payload: {
 *   tabId, startIndex,
 *   cell: { paddingTopPt, paddingBottomPt, paddingLeftPt, paddingRightPt,
 *           contentAlignment, backgroundColor,
 *           borderTop|borderBottom|borderLeft|borderRight: {color,widthPt,dashStyle} },
 *   applyCellsTo: 'all' | 'headerRow',
 *   rows: { minRowHeightPt, tableHeader, preventOverflow, rowIndices? },
 *   columns: { widthType, widthPt, columnIndices? },
 *   pinnedHeaderRowsCount
 * }
 */
function writeTableFormat(payload) {
  payload = payload || {};
  var targets;
  if (payload.allTables) {
    // Every table in the tab, from one document read and into one batchUpdate.
    // None of the requests below insert or delete content, so a start index
    // found now is still correct when the batch reaches the later tables.
    var doc = fetchDoc_();
    var ctx = resolveTab_(doc, payload.tabId);
    targets = tableLocations_(ctx.content, ctx.tabId).map(function (t) {
      return { startIndex: t.startIndex, columnCount: t.columns };
    });
  } else {
    targets = [{ startIndex: payload.startIndex, columnCount: payload.columnCount }];
  }

  var requests = [];
  targets.forEach(function (target) {
    tableRequests_(payload, target).forEach(function (r) { requests.push(r); });
  });
  return batchUpdate_(requests);
}

/** The requests one table needs for `payload`. */
function tableRequests_(payload, target) {
  var requests = [];
  var loc = tableLoc_(target.startIndex, payload.tabId);

  if (payload.cell) {
    var c = payload.cell;
    var style = {};
    var fields = [];
    ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'].forEach(function (k) {
      var v = c[k + 'Pt'];
      if (v !== undefined && v !== null && v !== '') { style[k] = ptDim_(v); fields.push(k); }
    });
    if (c.contentAlignment) { style.contentAlignment = c.contentAlignment; fields.push('contentAlignment'); }
    if (c.backgroundColor !== undefined) { style.backgroundColor = hexToColor_(c.backgroundColor); fields.push('backgroundColor'); }
    ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].forEach(function (k) {
      var b = c[k];
      if (!b) return;
      style[k] = {
        color: hexToColor_(b.color),
        width: ptDim_(b.widthPt === undefined || b.widthPt === '' ? 0 : b.widthPt),
        dashStyle: b.dashStyle || 'SOLID'
      };
      fields.push(k);
    });
    if (fields.length) {
      var req = { updateTableCellStyle: { tableCellStyle: style, fields: fields.join(',') } };
      if (payload.applyCellsTo === 'headerRow') {
        req.updateTableCellStyle.tableRange = {
          tableCellLocation: { tableStartLocation: loc, rowIndex: 0, columnIndex: 0 },
          rowSpan: 1,
          columnSpan: target.columnCount || 1
        };
      } else {
        // Omitting tableRange and giving only the start location targets
        // every cell in the table.
        req.updateTableCellStyle.tableStartLocation = loc;
      }
      requests.push(req);
    }
  }

  if (payload.rows) {
    var r = payload.rows;
    var rstyle = {};
    var rfields = [];
    if (r.minRowHeightPt !== undefined && r.minRowHeightPt !== null && r.minRowHeightPt !== '') {
      rstyle.minRowHeight = ptDim_(r.minRowHeightPt); rfields.push('minRowHeight');
    }
    if (r.tableHeader !== undefined) { rstyle.tableHeader = !!r.tableHeader; rfields.push('tableHeader'); }
    if (r.preventOverflow !== undefined) { rstyle.preventOverflow = !!r.preventOverflow; rfields.push('preventOverflow'); }
    if (rfields.length) {
      requests.push({
        updateTableRowStyle: {
          tableStartLocation: loc,
          rowIndices: (r.rowIndices && r.rowIndices.length) ? r.rowIndices : undefined,
          tableRowStyle: rstyle,
          fields: rfields.join(',')
        }
      });
    }
  }

  if (payload.columns) {
    var col = payload.columns;
    var cprops = {};
    var cfields = [];
    if (col.widthType) { cprops.widthType = col.widthType; cfields.push('widthType'); }
    if (col.widthPt !== undefined && col.widthPt !== null && col.widthPt !== '') {
      cprops.width = ptDim_(col.widthPt); cfields.push('width');
    }
    if (cfields.length) {
      // A fixed width is only honoured when widthType is FIXED_WIDTH.
      if (cprops.width && !cprops.widthType) {
        cprops.widthType = 'FIXED_WIDTH';
        cfields.push('widthType');
      }
      requests.push({
        updateTableColumnProperties: {
          tableStartLocation: loc,
          columnIndices: (col.columnIndices && col.columnIndices.length) ? col.columnIndices : undefined,
          tableColumnProperties: cprops,
          fields: cfields.join(',')
        }
      });
    }
  }

  if (payload.pinnedHeaderRowsCount !== undefined && payload.pinnedHeaderRowsCount !== '') {
    requests.push({
      pinTableHeaderRows: {
        tableStartLocation: loc,
        pinnedHeaderRowsCount: Number(payload.pinnedHeaderRowsCount)
      }
    });
  }

  return requests;
}

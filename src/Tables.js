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
  (((content.body || {}).content) || []).forEach(function (el) {
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
 * The two halves of this add-on see the document through different APIs: the
 * Docs API knows character indexes, DocumentApp knows the cursor. Nothing maps
 * one to the other, so the join is position in the body -- the nth top-level
 * table by either route is the same table. The count check below is what keeps
 * that honest: DocumentApp's legacy Body methods read the document's own
 * active tab, which is not necessarily the tab the sidebar is showing, and a
 * differing table count is the cheap signal that they have diverged.
 *
 * The outermost table ancestor is the one that counts, because a table nested
 * inside a cell is not in the list at all.
 */
function activeTableIndex_(tables) {
  try {
    var doc = DocumentApp.getActiveDocument();
    var sel = doc.getSelection();
    var start = null;
    if (sel) {
      var res = sel.getRangeElements();
      if (res && res.length) start = res[0].getElement();
    } else {
      var cursor = doc.getCursor();
      if (cursor) start = cursor.getElement();
    }
    if (!start) return null;

    var body = doc.getBody();
    if (body.getNumChildren === undefined) return null;

    var outermost = null;
    for (var node = start; node; node = node.getParent()) {
      if (node.getType() === DocumentApp.ElementType.TABLE) outermost = node;
      if (node.getType() === DocumentApp.ElementType.BODY_SECTION ||
          node.getType() === DocumentApp.ElementType.BODY) break;
    }
    if (!outermost) return null;

    var target = body.getChildIndex(outermost);
    var found = null, total = 0;
    for (var i = 0; i < body.getNumChildren(); i++) {
      if (body.getChild(i).getType() !== DocumentApp.ElementType.TABLE) continue;
      if (i === target) found = total;
      total++;
    }
    if (total !== (tables || []).length) return null;
    return found;
  } catch (e) {
    // No cursor, a mocked DocumentApp, a document shape this cannot walk:
    // none of those are errors, they just mean "no table is selected".
    return null;
  }
}

function readTables(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var tables = tableLocations_(ctx.content, ctx.tabId);
  return { tabId: ctx.tabId, tables: tables, activeIndex: activeTableIndex_(tables) };
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
  var requests = [];
  var loc = tableLoc_(payload.startIndex, payload.tabId);

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
          columnSpan: payload.columnCount || 1
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

  return batchUpdate_(requests);
}

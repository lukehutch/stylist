/**
 * List / bullet styles.
 *
 * Honest statement of what the API allows, because this is the one area
 * where Docs is much less capable than its own UI:
 *
 *   READ  - NestingLevel exposes everything per level: glyphType,
 *           glyphSymbol, glyphFormat, startNumber, bulletAlignment,
 *           indentStart, indentFirstLine and the bullet's textStyle.
 *   WRITE - there is no updateListProperties request in the Docs API. The
 *           only glyph-level write is createParagraphBullets, which takes
 *           one of 16 fixed presets. Custom glyph symbols and per-level
 *           glyph formats cannot be set programmatically.
 *
 * What *is* writable per level is the paragraph styling of the items:
 * indents, spacing and text style. That is exposed here so indentation and
 * spacing of each nesting level can still be tuned precisely.
 */

/**
 * Every list marker the API can produce, as the characters it produces.
 *
 * `glyphs` is the marker at each of the first three nesting levels, so the
 * picker can offer a character to choose rather than the name of an enum. The
 * characters are Docs' own renderings of the preset names -- DISC is a filled
 * circle, ARROW3D is a shaded arrowhead, and so on. The document is the final
 * authority: whatever is applied is read back from `glyphSymbol` and shown.
 */
var BULLET_PRESETS = [
  { id: 'BULLET_DISC_CIRCLE_SQUARE',            numbered: false, glyphs: ['\u25cf', '\u25cb', '\u25a0'] },
  { id: 'BULLET_DIAMOND_CIRCLE_SQUARE',         numbered: false, glyphs: ['\u25c6', '\u25cb', '\u25a0'] },
  { id: 'BULLET_STAR_CIRCLE_SQUARE',            numbered: false, glyphs: ['\u2605', '\u25cb', '\u25a0'] },
  { id: 'BULLET_ARROW3D_CIRCLE_SQUARE',         numbered: false, glyphs: ['\u27a2', '\u25cb', '\u25a0'] },
  { id: 'BULLET_ARROW_DIAMOND_DISC',            numbered: false, glyphs: ['\u2794', '\u25c6', '\u25cf'] },
  { id: 'BULLET_DIAMONDX_ARROW3D_SQUARE',       numbered: false, glyphs: ['\u2756', '\u27a2', '\u25a0'] },
  { id: 'BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE', numbered: false, glyphs: ['\u2756', '\u25c7', '\u25a0'] },
  { id: 'BULLET_LEFTTRIANGLE_DIAMOND_DISC',     numbered: false, glyphs: ['\u25c4', '\u25c6', '\u25cf'] },
  { id: 'BULLET_CHECKBOX',                      numbered: false, glyphs: ['\u2751', '\u2751', '\u2751'] },
  { id: 'NUMBERED_DECIMAL_ALPHA_ROMAN',         numbered: true,  glyphs: ['1.', 'a.', 'i.'] },
  { id: 'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',  numbered: true,  glyphs: ['1)', 'a)', 'i)'] },
  { id: 'NUMBERED_DECIMAL_NESTED',              numbered: true,  glyphs: ['1.', '1.1.', '1.1.1.'] },
  { id: 'NUMBERED_UPPERALPHA_ALPHA_ROMAN',      numbered: true,  glyphs: ['A.', 'a.', 'i.'] },
  { id: 'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL', numbered: true, glyphs: ['I.', 'A.', '1.'] },
  { id: 'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',     numbered: true,  glyphs: ['01.', 'a.', 'i.'] }
];

BULLET_PRESETS.forEach(function (p) { p.label = p.glyphs.join(' / '); });

/** Glyph types that count as numbering rather than as a bullet character. */
var NUMBERED_GLYPH_TYPES = {
  DECIMAL: 1, ZERO_DECIMAL: 1, ALPHA: 1, UPPER_ALPHA: 1, ROMAN: 1, UPPER_ROMAN: 1
};

/**
 * Index every paragraph in the body that belongs to a list.
 *
 * Table cells are walked too, and so are tables inside them: a list in a cell
 * is an ordinary list, its paragraphs carry the same document-wide indexes as
 * any other, and every writer here works from those indexes. Stopping at the
 * top level would have hidden those lists from the panel and left them out of
 * every apply, which is not a smaller feature, just a wrong one.
 */
function listParagraphs_(content) {
  var byList = {};

  function walk(elements) {
    (elements || []).forEach(function (el) {
      if (el.table) {
        // Row-major, which is the order the Docs API lists them in and the
        // order DocumentApp walks them in -- the two views are joined on it.
        (el.table.tableRows || []).forEach(function (row) {
          (row.tableCells || []).forEach(function (cell) { walk(cell.content); });
        });
        return;
      }
      var p = el.paragraph;
      if (!p || !p.bullet || !p.bullet.listId) return;
      var id = p.bullet.listId;
      if (!byList[id]) byList[id] = [];
      var text = (p.elements || []).map(function (pe) {
        return (pe.textRun && pe.textRun.content) || '';
      }).join('').replace(/\s+/g, ' ').trim();
      byList[id].push({
        startIndex: el.startIndex || 0,
        endIndex: el.endIndex,
        nestingLevel: p.bullet.nestingLevel || 0,
        text: text,
        paragraph: p
      });
    });
  }

  walk(((content.body || {}).content) || []);
  return byList;
}

/**
 * Which list the cursor is in, as a listId, or null.
 *
 * The cursor probe reports the leading text of the paragraph it is in, and
 * that text is direct evidence: the list holding a paragraph that begins with
 * it is the list the cursor is in. That is the same match the sections panel
 * makes, and it needs the two views to agree about nothing at all.
 *
 * Without a probe -- the first full read, before the sidebar has polled -- or
 * when the text is ambiguous, it falls back to activeListId_, which joins the
 * two views on body order alone and gives up if they disagree about how many
 * lists there are. That guard is why the fallback cannot be the whole answer:
 * DocumentApp reads the document's own active tab, sees only what the body
 * holds, and any divergence at all silently produced "no list is selected".
 */
function pickList_(ordered, paras, ctx) {
  var byText = listIdByParaHead_(ordered, paras, ctx || {});
  if (byText.length === 1) return byText[0];
  return activeListId_(ordered) || byText[0] || null;
}

/** Every list holding a paragraph that starts with the probe's text. */
function listIdByParaHead_(ordered, paras, ctx) {
  var want = ctx.paraHead;
  if (ctx.paraKind !== 'li' || want === undefined || want === null) return [];
  var hits = [];
  (ordered || []).forEach(function (l) {
    var items = paras[l.listId] || [];
    for (var i = 0; i < items.length; i++) {
      var t = paraText_(items[i].paragraph);
      // An empty head can only stand for an empty item; anything else
      // matches by its prefix, the probe having truncated it at 80.
      if (want === '' ? t === '' : t.slice(0, want.length) === want) {
        hits.push(l.listId);
        return;
      }
    }
  });
  return hits;
}

/**
 * The fallback join: the nth distinct list down the body by either route is
 * the same list, so DocumentApp's ordinal for the cursor's list indexes the
 * Docs API's lists sorted by where their first paragraph starts.
 */
/** Timed, because on a long document this body walk costs more than the
 *  Docs API read it accompanies. */
function activeListId_(ordered) {
  return timed_('cursorList', function () { return activeListId_inner_(ordered); });
}

function activeListId_inner_(ordered) {
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

    var item = null;
    for (var node = start; node; node = node.getParent()) {
      if (node.getType() === DocumentApp.ElementType.LIST_ITEM) { item = node; break; }
      if (node.getType() === DocumentApp.ElementType.BODY_SECTION ||
          node.getType() === DocumentApp.ElementType.BODY) break;
    }
    if (!item) return null;
    var wanted = item.getListId();

    var body = doc.getBody();
    if (body.getNumChildren === undefined) return null;
    var seen = [], found = null;
    // Into table cells as well, in the same row-major order listParagraphs_
    // uses, because the two views are joined on nothing but this order.
    (function visit(container) {
      // Hoisted: every DocumentApp accessor is a call across the service
      // boundary, so re-asking the child count once per child triples the
      // cost of this walk on a long document.
      var n = container.getNumChildren();
      for (var i = 0; i < n; i++) {
        var child = container.getChild(i);
        var type = child.getType();
        if (type === DocumentApp.ElementType.TABLE ||
            type === DocumentApp.ElementType.TABLE_ROW ||
            type === DocumentApp.ElementType.TABLE_CELL) {
          visit(child);
          continue;
        }
        if (type !== DocumentApp.ElementType.LIST_ITEM) continue;
        var id = child.getListId();
        if (seen.indexOf(id) >= 0) continue;
        if (id === wanted) found = seen.length;
        seen.push(id);
      }
    })(body);
    if (found === null || seen.length !== (ordered || []).length) return null;
    return ordered[found].listId;
  } catch (e) {
    // No cursor, a mocked DocumentApp, a document shape this cannot walk:
    // none of those are errors, they just mean "no list is selected".
    return null;
  }
}

function readLists(tabId, ctx) {
  var doc = fetchDoc_();
  var tab = resolveTab_(doc, tabId);
  var content = tab.content;
  var paras = listParagraphs_(content);
  var lists = [];

  Object.keys(content.lists || {}).forEach(function (listId) {
    var lp = ((content.lists[listId] || {}).listProperties) || {};
    var items = paras[listId] || [];
    // A list whose paragraphs are all gone stays in document.lists for ever:
    // there is no request in the Docs API that deletes a list definition. It
    // has no text to style and no marker to change, so it is dropped here
    // rather than offered as a row that cannot do anything.
    if (!items.length) return;
    var usedLevels = {};
    items.forEach(function (i) { usedLevels[i.nestingLevel] = true; });

    var levelZero = ((lp.nestingLevels || [])[0]) || {};
    lists.push({
      listId: listId,
      kind: NUMBERED_GLYPH_TYPES[levelZero.glyphType] ? 'numbered' : 'bulleted',
      firstIndex: items.reduce(function (m, i) { return Math.min(m, i.startIndex); }, Infinity),
      itemCount: items.length,
      inUse: true,
      preview: items.slice(0, 3).map(function (i) { return i.text; })
                    .filter(String).join(' · ').slice(0, 80),
      levels: (lp.nestingLevels || []).map(function (nl, idx) {
        return {
          level: idx,
          inUse: !!usedLevels[idx],
          glyphType: nl.glyphType || 'GLYPH_TYPE_UNSPECIFIED',
          glyphSymbol: nl.glyphSymbol || '',
          glyphFormat: nl.glyphFormat || '',
          startNumber: nl.startNumber === undefined ? 1 : nl.startNumber,
          bulletAlignment: nl.bulletAlignment || 'START',
          indentStartPt: dimPt_(nl.indentStart),
          indentFirstLinePt: dimPt_(nl.indentFirstLine),
          textStyle: textStyleToUi_(nl.textStyle),
          // What the level's paragraphs currently look like. writeListLevelStyle
          // styles those paragraphs, not the NestingLevel, so the editor's
          // current values have to come from the same place.
          style: styleSummary_(items.filter(function (i) { return i.nestingLevel === idx; })
                                    .map(function (i) { return i.paragraph; }))
        };
      })
    });
  });

  // Body order, so "the nth list" means the same thing here as it does to
  // DocumentApp, which is what activeListId_ joins the two views on.
  lists.sort(function (a, b) { return a.firstIndex - b.firstIndex; });
  return {
    tabId: tab.tabId,
    lists: lists,
    activeListId: pickList_(lists, paras, ctx),
    presets: BULLET_PRESETS
  };
}

/** Contiguous index ranges covering the given paragraphs. */
function mergeRanges_(items) {
  var sorted = items.slice().sort(function (a, b) { return a.startIndex - b.startIndex; });
  var out = [];
  sorted.forEach(function (it) {
    var last = out[out.length - 1];
    if (last && it.startIndex <= last.endIndex) {
      last.endIndex = Math.max(last.endIndex, it.endIndex);
    } else {
      out.push({ startIndex: it.startIndex, endIndex: it.endIndex });
    }
  });
  return out;
}

/**
 * Which lists a write covers: the one named, or every list in the tab.
 *
 * `listId: null` with `allLists: true` is what the panel's "apply to all"
 * sends. Doing the fan-out here rather than in the sidebar keeps it to one
 * document read and one batchUpdate however many lists there are -- a call per
 * list would be a full document read per list.
 */
function targetLists_(byList, payload) {
  if (payload.allLists) return Object.keys(byList);
  return payload.listId ? [payload.listId] : [];
}

/** payload: { tabId, listId | allLists, bulletPreset } */
function applyBulletPreset(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var byList = listParagraphs_(ctx.content);
  var requests = [];
  targetLists_(byList, payload).forEach(function (id) {
    mergeRanges_(byList[id] || []).forEach(function (r) {
      if (ctx.tabId) r.tabId = ctx.tabId;
      requests.push({ createParagraphBullets: { range: r, bulletPreset: payload.bulletPreset } });
    });
  });
  // Answered with the reading as well, so a write that turned out to have
  // nothing to do still costs one round trip rather than two.
  if (!requests.length) {
    return withLists_(ctx.tabId,
      { applied: 0, warnings: ['That list has no paragraphs in the body.'] });
  }
  return withLists_(ctx.tabId, batchUpdate_(requests));
}

/**
 * A marker write answers with the reading the panel would have asked for.
 *
 * The sidebar used to call refresh() straight after one of these, which is a
 * second round trip to Apps Script -- and the round trip, not the document
 * read inside it, is most of the wait. batchUpdate_ has already dropped the
 * document cache, so the read here sees the write that just landed.
 */
function withLists_(tabId, result) {
  result = result || {};
  result.lists = readLists(tabId);
  return result;
}

/** payload: { tabId, listId | allLists } -- strips markers, keeping the text. */
/**
 * Take the markers off a list, or off one nesting level of it.
 *
 * A level is not a thing the API can address -- there is no request that
 * edits a list's levels -- but it is a set of paragraphs, and
 * deleteParagraphBullets works on paragraphs. So `payload.level` narrows the
 * paragraphs to those sitting at that depth and leaves the rest of the list
 * with its markers.
 */
function removeBullets(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var byList = listParagraphs_(ctx.content);
  var requests = [];
  targetLists_(byList, payload).forEach(function (id) {
    var items = byList[id] || [];
    if (payload.level !== undefined && payload.level !== null) {
      items = items.filter(function (it) { return it.nestingLevel === payload.level; });
    }
    mergeRanges_(items).forEach(function (r) {
      if (ctx.tabId) r.tabId = ctx.tabId;
      requests.push({ deleteParagraphBullets: { range: r } });
    });
  });
  return withLists_(ctx.tabId, batchUpdate_(requests));
}

/**
 * Style the paragraphs of one nesting level.
 *
 * payload: { tabId, listId | allLists, level, textStyle, paragraphStyle }
 *
 * `level` of null means every level.
 */
function writeListLevelStyle(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var byList = listParagraphs_(ctx.content);
  var levelGiven = payload.level !== null && payload.level !== undefined && payload.level !== '';
  var lvl = Number(payload.level);

  var items = [];
  targetLists_(byList, payload).forEach(function (id) {
    (byList[id] || []).forEach(function (it) {
      if (!levelGiven || it.nestingLevel === lvl) items.push(it);
    });
  });
  if (!items.length) return { applied: 0, warnings: ['No list items at that nesting level.'] };

  return batchUpdate_(levelRequests_(ctx.tabId, items, payload));
}

/** The style requests a set of list paragraphs needs, ready to batch. */
function levelRequests_(tabId, items, payload) {
  var ts = uiToTextStyle_(payload.textStyle);
  var ps = uiToParagraphStyle_(payload.paragraphStyle);
  var requests = [];
  mergeRanges_(items).forEach(function (r) {
    if (tabId) r.tabId = tabId;
    if (ts.fields.length) {
      requests.push({ updateTextStyle: { range: r, textStyle: ts.style, fields: ts.fields.join(',') } });
    }
    if (ps.fields.length) {
      requests.push({ updateParagraphStyle: { range: r, paragraphStyle: ps.style, fields: ps.fields.join(',') } });
    }
  });
  return requests;
}

/**
 * Make every list in the tab share the formatting most of them already have.
 *
 * This is what ticking "apply to all lists" does. Each field is settled
 * separately and by majority, so a document where nine lists indent by 18pt
 * and one by 36pt comes out at 18pt, and a field the lists already agree on
 * is written back unchanged. Levels are matched by depth: every list's second
 * level ends up looking like the second level most lists have.
 *
 * Markers are deliberately left alone. A tab usually holds both bulleted and
 * numbered lists, and a majority vote across the two would silently turn the
 * numbering of the minority into bullets.
 */
function unifyLists(payload) {
  payload = payload || {};
  var read = readLists(payload.tabId);
  var lists = read.lists;
  if (lists.length < 2) return { applied: 0 };

  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var byList = listParagraphs_(ctx.content);

  var depth = 0;
  lists.forEach(function (l) { depth = Math.max(depth, l.levels.length); });

  var requests = [];
  for (var lvl = 0; lvl < depth; lvl++) {
    var here = [];
    lists.forEach(function (l) {
      var st = (l.levels[lvl] || {}).style;
      if (st && (l.levels[lvl] || {}).inUse) here.push(st);
    });
    if (here.length < 2) continue;

    var want = {
      textStyle: commonFields_(here.map(function (st) { return st.textStyle || {}; })),
      paragraphStyle: commonFields_(here.map(function (st) { return st.paragraphStyle || {}; }))
    };
    var items = [];
    Object.keys(byList).forEach(function (id) {
      (byList[id] || []).forEach(function (it) {
        if (it.nestingLevel === lvl) items.push(it);
      });
    });
    levelRequests_(ctx.tabId, items, want).forEach(function (r) { requests.push(r); });
  }
  return batchUpdate_(requests);
}

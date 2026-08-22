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

var BULLET_PRESETS = [
  { id: 'BULLET_DISC_CIRCLE_SQUARE',          label: 'Disc / circle / square' },
  { id: 'BULLET_DIAMONDX_ARROW3D_SQUARE',     label: 'Diamond-x / arrow / square' },
  { id: 'BULLET_CHECKBOX',                    label: 'Checkbox' },
  { id: 'BULLET_ARROW_DIAMOND_DISC',          label: 'Arrow / diamond / disc' },
  { id: 'BULLET_STAR_CIRCLE_SQUARE',          label: 'Star / circle / square' },
  { id: 'BULLET_ARROW3D_CIRCLE_SQUARE',       label: 'Arrow 3D / circle / square' },
  { id: 'BULLET_LEFTTRIANGLE_DIAMOND_DISC',   label: 'Left triangle / diamond / disc' },
  { id: 'BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE', label: 'Diamond-x / hollow diamond / square' },
  { id: 'BULLET_DIAMOND_CIRCLE_SQUARE',       label: 'Diamond / circle / square' },
  { id: 'NUMBERED_DECIMAL_ALPHA_ROMAN',       label: '1. / a. / i.' },
  { id: 'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS', label: '1) / a) / i)' },
  { id: 'NUMBERED_DECIMAL_NESTED',            label: '1. / 1.1. / 1.1.1.' },
  { id: 'NUMBERED_UPPERALPHA_ALPHA_ROMAN',    label: 'A. / a. / i.' },
  { id: 'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL', label: 'I. / A. / 1.' },
  { id: 'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',   label: '01. / a. / i.' }
];

/** Index every body paragraph that belongs to a list. */
function listParagraphs_(content) {
  var byList = {};
  (((content.body || {}).content) || []).forEach(function (el) {
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
  return byList;
}

function readLists(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var content = ctx.content;
  var paras = listParagraphs_(content);
  var lists = [];

  Object.keys(content.lists || {}).forEach(function (listId) {
    var lp = ((content.lists[listId] || {}).listProperties) || {};
    var items = paras[listId] || [];
    var usedLevels = {};
    items.forEach(function (i) { usedLevels[i.nestingLevel] = true; });

    lists.push({
      listId: listId,
      itemCount: items.length,
      inUse: items.length > 0,
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

  lists.sort(function (a, b) { return b.itemCount - a.itemCount; });
  return { tabId: ctx.tabId, lists: lists, presets: BULLET_PRESETS };
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

/** payload: { tabId, listId, bulletPreset } */
function applyBulletPreset(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var items = (listParagraphs_(ctx.content)[payload.listId]) || [];
  if (!items.length) return { applied: 0, warnings: ['That list has no paragraphs in the body.'] };

  var requests = mergeRanges_(items).map(function (r) {
    if (ctx.tabId) r.tabId = ctx.tabId;
    return { createParagraphBullets: { range: r, bulletPreset: payload.bulletPreset } };
  });
  return batchUpdate_(requests);
}

/** payload: { tabId, listId } -- strips bullets, keeping the text. */
function removeBullets(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var items = (listParagraphs_(ctx.content)[payload.listId]) || [];
  if (!items.length) return { applied: 0 };
  var requests = mergeRanges_(items).map(function (r) {
    if (ctx.tabId) r.tabId = ctx.tabId;
    return { deleteParagraphBullets: { range: r } };
  });
  return batchUpdate_(requests);
}

/**
 * Style the paragraphs of one nesting level of one list.
 *
 * payload: { tabId, listId, level, textStyle, paragraphStyle }
 *
 * `level` of null means every level of the list.
 */
function writeListLevelStyle(payload) {
  payload = payload || {};
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, payload.tabId);
  var items = (listParagraphs_(ctx.content)[payload.listId]) || [];
  if (payload.level !== null && payload.level !== undefined && payload.level !== '') {
    var lvl = Number(payload.level);
    items = items.filter(function (i) { return i.nestingLevel === lvl; });
  }
  if (!items.length) return { applied: 0, warnings: ['No list items at that nesting level.'] };

  var ts = uiToTextStyle_(payload.textStyle);
  var ps = uiToParagraphStyle_(payload.paragraphStyle);
  var requests = [];
  mergeRanges_(items).forEach(function (r) {
    if (ctx.tabId) r.tabId = ctx.tabId;
    if (ts.fields.length) {
      requests.push({ updateTextStyle: { range: r, textStyle: ts.style, fields: ts.fields.join(',') } });
    }
    if (ps.fields.length) {
      requests.push({ updateParagraphStyle: { range: r, paragraphStyle: ps.style, fields: ps.fields.join(',') } });
    }
  });
  var res = batchUpdate_(requests);
  res.warnings = ['Glyph shape and glyph format are read-only in the Docs API; ' +
                  'indentation, spacing and text styling were applied.'];
  return res;
}

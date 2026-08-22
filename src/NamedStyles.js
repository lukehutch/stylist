/**
 * Named (text) styles: Normal text, Title, Subtitle, Heading 1-6.
 *
 * These are the styles behind the Docs "Styles" dropdown. updateNamedStyle
 * edits the style *definition*, so every paragraph using it reflows -- this
 * is the real equivalent of "Update Heading 1 to match" applied globally.
 *
 * The NamedStyleType enum is closed: the API cannot create a new named
 * style, so genuinely custom entries in the Styles menu are not possible.
 * See Presets.js for the supported alternative (saved style presets that
 * are applied to a selection or to a whole named style).
 */

var NAMED_STYLE_TYPES = [
  { id: 'NORMAL_TEXT', label: 'Normal text' },
  { id: 'TITLE',       label: 'Title' },
  { id: 'SUBTITLE',    label: 'Subtitle' },
  { id: 'HEADING_1',   label: 'Heading 1' },
  { id: 'HEADING_2',   label: 'Heading 2' },
  { id: 'HEADING_3',   label: 'Heading 3' },
  { id: 'HEADING_4',   label: 'Heading 4' },
  { id: 'HEADING_5',   label: 'Heading 5' },
  { id: 'HEADING_6',   label: 'Heading 6' }
];

function readNamedStyles(tabId) {
  var doc = fetchDoc_();
  var ctx = resolveTab_(doc, tabId);
  var byType = {};
  (((ctx.content.namedStyles) || {}).styles || []).forEach(function (s) {
    byType[s.namedStyleType] = s;
  });
  return {
    tabId: ctx.tabId,
    styles: NAMED_STYLE_TYPES.map(function (t) {
      var s = byType[t.id] || {};
      return {
        namedStyleType: t.id,
        label: t.label,
        textStyle: textStyleToUi_(s.textStyle),
        paragraphStyle: paragraphStyleToUi_(s.paragraphStyle)
      };
    })
  };
}

/**
 * Build the field mask for updateNamedStyle.
 *
 * The API requires named_style_type, and for nested styles it requires BOTH
 * the parent path and each leaf path -- the reference states: "to update the
 * text style to bold, set fields to include "text_style" and
 * "text_style.bold"". Emitting only the leaf paths silently no-ops.
 */
function namedStyleFieldMask_(textFields, paraFields) {
  var parts = ['namedStyleType'];
  if (textFields && textFields.length) {
    parts.push('textStyle');
    textFields.forEach(function (f) { parts.push('textStyle.' + f); });
  }
  if (paraFields && paraFields.length) {
    parts.push('paragraphStyle');
    paraFields.forEach(function (f) { parts.push('paragraphStyle.' + f); });
  }
  return parts.join(',');
}

function namedStyleRequest_(tabId, namedStyleType, textUi, paraUi) {
  var ts = uiToTextStyle_(textUi);
  var ps = uiToParagraphStyle_(paraUi);
  if (!ts.fields.length && !ps.fields.length) return null;

  var namedStyle = { namedStyleType: namedStyleType };
  if (ts.fields.length) namedStyle.textStyle = ts.style;
  if (ps.fields.length) namedStyle.paragraphStyle = ps.style;

  var req = {
    updateNamedStyle: {
      namedStyle: namedStyle,
      fields: namedStyleFieldMask_(ts.fields, ps.fields)
    }
  };
  if (tabId) req.updateNamedStyle.tabId = tabId;
  return req;
}

/** payload: { tabId, scope, namedStyleType, textStyle, paragraphStyle } */
function writeNamedStyle(payload) {
  payload = payload || {};
  var tabIds = knownTargetTabIds_(payload.tabIds, payload.tabId, payload.scope) ||
    targetTabIds_(fetchDoc_(), payload.tabId, payload.scope);
  var requests = tabIds.map(function (tid) {
    return namedStyleRequest_(tid, payload.namedStyleType, payload.textStyle, payload.paragraphStyle);
  });
  return batchUpdate_(requests);
}

/** Apply many named styles in one batch (used by preset import). */
function writeNamedStyles(payload) {
  payload = payload || {};
  var tabIds = knownTargetTabIds_(payload.tabIds, payload.tabId, payload.scope) ||
    targetTabIds_(fetchDoc_(), payload.tabId, payload.scope);
  var requests = [];
  tabIds.forEach(function (tid) {
    (payload.styles || []).forEach(function (s) {
      requests.push(namedStyleRequest_(tid, s.namedStyleType, s.textStyle, s.paragraphStyle));
    });
  });
  return batchUpdate_(requests);
}

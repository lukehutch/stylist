/**
 * Custom styles applied to the current selection.
 *
 * Google Docs will not let an add-on define a new entry in its own Styles
 * menu: NamedStyleType is a closed enum of nine values, and the editor's
 * toolbar is not an add-on extension point. What an add-on *can* do is offer
 * a second style list of its own, in its sidebar, that applies a saved style
 * to whatever the user has selected. That is what this file implements.
 *
 * It goes through DocumentApp rather than the Docs API, because the Docs API
 * addresses content by index and Apps Script does not expose the indices of
 * the user's selection. DocumentApp addresses the selection directly, at the
 * cost of a smaller attribute set -- see UNSUPPORTED_IN_SELECTION for exactly
 * which saved attributes cannot travel this way.
 */

/** Saved attributes DocumentApp has no equivalent for. */
var UNSUPPORTED_IN_SELECTION = {
  fontWeight: 'font weight',
  smallCaps: 'small caps',
  spacingMode: 'spacing mode',
  keepLinesTogether: 'keep lines together',
  keepWithNext: 'keep with next',
  avoidWidowAndOrphan: 'widow/orphan control',
  pageBreakBefore: 'page break before',
  shadingColor: 'paragraph shading',
  direction: 'text direction',
  borderTop: 'paragraph borders',
  borderBottom: 'paragraph borders',
  borderLeft: 'paragraph borders',
  borderRight: 'paragraph borders',
  borderBetween: 'paragraph borders'
};

var ALIGNMENT_TO_DOC = {
  START: 'LEFT', CENTER: 'CENTER', END: 'RIGHT', JUSTIFIED: 'JUSTIFY'
};

/** Translate a saved UI style into a DocumentApp attribute bag. */
function uiToDocAttributes_(textStyle, paragraphStyle) {
  var ts = textStyle || {};
  var ps = paragraphStyle || {};
  var A = DocumentApp.Attribute;
  var attrs = {};
  var dropped = {};

  function drop(key) {
    var label = UNSUPPORTED_IN_SELECTION[key];
    if (label) dropped[label] = true;
  }

  if (ts.fontFamily) attrs[A.FONT_FAMILY] = ts.fontFamily;
  if (ts.fontSizePt) attrs[A.FONT_SIZE] = Number(ts.fontSizePt);
  if (ts.bold !== undefined) attrs[A.BOLD] = !!ts.bold;
  if (ts.italic !== undefined) attrs[A.ITALIC] = !!ts.italic;
  if (ts.underline !== undefined) attrs[A.UNDERLINE] = !!ts.underline;
  if (ts.strikethrough !== undefined) attrs[A.STRIKETHROUGH] = !!ts.strikethrough;
  if (ts.foregroundColor) attrs[A.FOREGROUND_COLOR] = ts.foregroundColor;
  if (ts.backgroundColor) attrs[A.BACKGROUND_COLOR] = ts.backgroundColor;
  if (ts.baselineOffset) {
    var V = DocumentApp.VerticalAlignment;
    if (ts.baselineOffset === 'SUPERSCRIPT') attrs[A.VERTICAL_ALIGNMENT] = V.SUPERSCRIPT;
    else if (ts.baselineOffset === 'SUBSCRIPT') attrs[A.VERTICAL_ALIGNMENT] = V.SUBSCRIPT;
    else attrs[A.VERTICAL_ALIGNMENT] = V.NORMAL;
  }
  if (ts.fontWeight !== undefined && ts.fontWeight !== 400) drop('fontWeight');
  if (ts.smallCaps) drop('smallCaps');

  if (ps.alignment && ALIGNMENT_TO_DOC[ps.alignment]) {
    attrs[A.HORIZONTAL_ALIGNMENT] = DocumentApp.HorizontalAlignment[ALIGNMENT_TO_DOC[ps.alignment]];
  }
  // Docs stores line spacing as a percentage where 100 is single spacing;
  // DocumentApp wants the multiplier.
  if (ps.lineSpacing) attrs[A.LINE_SPACING] = Number(ps.lineSpacing) / 100;
  if (ps.spaceAbovePt !== undefined) attrs[A.SPACING_BEFORE] = Number(ps.spaceAbovePt);
  if (ps.spaceBelowPt !== undefined) attrs[A.SPACING_AFTER] = Number(ps.spaceBelowPt);
  if (ps.indentStartPt !== undefined) attrs[A.INDENT_START] = Number(ps.indentStartPt);
  if (ps.indentEndPt !== undefined) attrs[A.INDENT_END] = Number(ps.indentEndPt);
  if (ps.indentFirstLinePt !== undefined) attrs[A.INDENT_FIRST_LINE] = Number(ps.indentFirstLinePt);

  Object.keys(UNSUPPORTED_IN_SELECTION).forEach(function (k) {
    if (ps[k] !== undefined && ps[k] !== false && ps[k] !== '') drop(k);
  });

  return { attributes: attrs, dropped: Object.keys(dropped) };
}

/**
 * Elements the selection or cursor covers that can carry attributes.
 *
 * A selection gives RangeElements; a bare cursor gives the containing
 * element. Partial text selections are styled through the offsets so only
 * the selected characters change.
 */
function selectionTargets_() {
  var doc = DocumentApp.getActiveDocument();
  var sel = doc.getSelection();
  if (sel) {
    return sel.getRangeElements().map(function (re) {
      return {
        element: re.getElement(),
        partial: re.isPartial(),
        start: re.getStartOffset(),
        end: re.getEndOffsetInclusive()
      };
    });
  }
  var cursor = doc.getCursor();
  if (!cursor) return [];
  return [{ element: cursor.getElement(), partial: false }];
}

/** Walk up from an element to the paragraph or list item that contains it. */
function containingParagraph_(element) {
  var node = element;
  while (node) {
    var type = node.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH ||
        type === DocumentApp.ElementType.LIST_ITEM) {
      return node;
    }
    node = node.getParent();
  }
  return null;
}

/**
 * Apply a saved style preset to the current selection.
 *
 * payload: { name }
 */
function applyStylePresetToSelection(payload) {
  var name = (payload || {}).name;
  var store = readStore_(STYLE_PRESET_STORE_KEY);
  var preset = store[name];
  if (!preset) throw new Error('No style preset named "' + name + '".');

  var targets = selectionTargets_();
  if (!targets.length) {
    throw new Error('Put the cursor in the document, or select some text, then apply the style.');
  }

  var built = uiToDocAttributes_(preset.textStyle, preset.paragraphStyle);
  var attrs = built.attributes;
  if (!Object.keys(attrs).length) {
    return { applied: 0, warnings: ['"' + name + '" has no attributes that can be applied to a selection.'] };
  }

  var applied = 0;
  var paragraphsDone = {};

  targets.forEach(function (t) {
    var el = t.element;
    if (t.partial && el.getType() === DocumentApp.ElementType.TEXT) {
      el.asText().setAttributes(t.start, t.end, attrs);
      applied++;
    } else if (el.setAttributes) {
      el.setAttributes(attrs);
      applied++;
    }
    // Paragraph attributes live on the paragraph, not on the text run, so a
    // text-level target also needs its paragraph styled -- once each.
    var para = containingParagraph_(el);
    if (para && para !== el) {
      var parent = para.getParent();
      var key = parent ? String(parent.getChildIndex(para)) : String(para.getText()).slice(0, 40);
      if (!paragraphsDone[key]) {
        paragraphsDone[key] = true;
        para.setAttributes(attrs);
      }
    }
  });

  var warnings = [];
  if (built.dropped.length) {
    warnings.push('Applied to the selection, but ' + built.dropped.join(', ') +
      ' could not be: Apps Script cannot set those on a selection. Bind the style to a ' +
      'named style instead to get every attribute.');
  }
  return { applied: applied, warnings: warnings };
}

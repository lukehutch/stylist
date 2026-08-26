/**
 * A zero-width border, spelled out the way Google spells it.
 *
 * Every named style in a real document carries all five of these whether or
 * not anything is drawn, with a zero width and a zero padding. The harness
 * serves fixtures through proto3.protoize, which strips the zeros back out
 * again -- so what the reading code actually meets here is
 * { color: {}, width: {}, padding: {}, dashStyle: 'SOLID' }, exactly as it
 * would from the API, and a zero it mistakes for "unset" shows up locally
 * instead of in production.
 */
function noBorder() {
  return {
    color: {},
    width: { magnitude: 0, unit: 'PT' },
    padding: { magnitude: 0, unit: 'PT' },
    dashStyle: 'SOLID'
  };
}

/** The parts of a real paragraph style that are there even when unused. */
function realParagraphDefaults() {
  return {
    spacingMode: 'NEVER_COLLAPSE',
    keepLinesTogether: false,
    keepWithNext: false,
    avoidWidowAndOrphan: true,
    pageBreakBefore: false,
    spaceAbove: { magnitude: 0, unit: 'PT' },
    spaceBelow: { magnitude: 0, unit: 'PT' },
    indentStart: { magnitude: 0, unit: 'PT' },
    indentEnd: { magnitude: 0, unit: 'PT' },
    indentFirstLine: { magnitude: 0, unit: 'PT' },
    shading: { backgroundColor: {} },
    borderTop: noBorder(), borderBottom: noBorder(), borderLeft: noBorder(),
    borderRight: noBorder(), borderBetween: noBorder()
  };
}

/** The parts of a real text style that are there even when unused. */
function realTextDefaults() {
  return {
    bold: false, italic: false, underline: false, strikethrough: false,
    smallCaps: false, baselineOffset: 'NONE', backgroundColor: {}
  };
}

/** A document exercising tabs, named styles, headers, footers, footnotes,
 *  a list and a table. Indices are internally consistent. */
function makeDoc() {
  return {
    title: 'Fixture Doc',
    documentId: 'DOC_ID',
    tabs: [{
      tabProperties: { tabId: 't.0', title: 'Main', index: 0, nestingLevel: 0 },
      childTabs: [{
        tabProperties: { tabId: 't.1', title: 'Appendix', index: 0, nestingLevel: 1 },
        documentTab: emptyTab()
      }],
      documentTab: mainTab()
    }]
  };
}

function emptyTab() {
  return {
    documentStyle: { pageSize: { width: { magnitude: 612, unit: 'PT' }, height: { magnitude: 792, unit: 'PT' } } },
    namedStyles: { styles: [] },
    body: { content: [] },
    headers: {}, footers: {}, footnotes: {}, lists: {}
  };
}

function mainTab() {
  return {
    documentStyle: {
      pageSize: { width: { magnitude: 612, unit: 'PT' }, height: { magnitude: 792, unit: 'PT' } },
      marginTop: { magnitude: 72, unit: 'PT' },
      marginBottom: { magnitude: 72, unit: 'PT' },
      marginLeft: { magnitude: 72, unit: 'PT' },
      marginRight: { magnitude: 72, unit: 'PT' },
      marginHeader: { magnitude: 36, unit: 'PT' },
      marginFooter: { magnitude: 36, unit: 'PT' },
      useCustomHeaderFooterMargins: false,
      defaultHeaderId: 'h.default',
      defaultFooterId: 'f.default',
      pageNumberStart: 1
    },
    namedStyles: {
      styles: [
        {
          namedStyleType: 'NORMAL_TEXT',
          textStyle: Object.assign(realTextDefaults(), {
            weightedFontFamily: { fontFamily: 'Arial', weight: 400 },
            fontSize: { magnitude: 11, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } }
          }),
          paragraphStyle: Object.assign(realParagraphDefaults(), {
            alignment: 'START', lineSpacing: 115, direction: 'LEFT_TO_RIGHT'
          })
        },
        {
          namedStyleType: 'HEADING_1',
          textStyle: Object.assign(realTextDefaults(), {
            weightedFontFamily: { fontFamily: 'Georgia', weight: 700 },
            fontSize: { magnitude: 20, unit: 'PT' },
            bold: true
          }),
          paragraphStyle: Object.assign(realParagraphDefaults(), {
            alignment: 'START',
            spaceAbove: { magnitude: 18, unit: 'PT' },
            spaceBelow: { magnitude: 6, unit: 'PT' },
            keepWithNext: true
          })
        }
      ]
    },
    body: {
      content: [
        { startIndex: 0, endIndex: 1, sectionBreak: { sectionStyle: { sectionType: 'CONTINUOUS', columnProperties: [] } } },
        {
          startIndex: 1, endIndex: 30,
          paragraph: {
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            elements: [
              { startIndex: 1, endIndex: 20, textRun: { content: 'Body text with a note' } },
              { startIndex: 20, endIndex: 21, footnoteReference: { footnoteId: 'fn.1', footnoteNumber: '1' } },
              { startIndex: 21, endIndex: 30, textRun: { content: ' and more' } }
            ]
          }
        },
        {
          startIndex: 30, endIndex: 40,
          paragraph: {
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            bullet: { listId: 'list.1', nestingLevel: 0 },
            elements: [{ startIndex: 30, endIndex: 40, textRun: { content: 'Item one' } }]
          }
        },
        {
          startIndex: 40, endIndex: 50,
          paragraph: {
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            bullet: { listId: 'list.1', nestingLevel: 1 },
            elements: [{ startIndex: 40, endIndex: 50, textRun: { content: 'Item two' } }]
          }
        },
        {
          startIndex: 60, endIndex: 70,
          paragraph: {
            paragraphStyle: {},
            elements: [
              { startIndex: 60, endIndex: 61, footnoteReference: { footnoteId: 'fn.2', footnoteNumber: '2' } }
            ]
          }
        },
        {
          startIndex: 70, endIndex: 120,
          table: {
            rows: 2, columns: 3,
            tableStyle: { tableColumnProperties: [{ widthType: 'EVENLY_DISTRIBUTED' }] },
            tableRows: [
              { startIndex: 71, endIndex: 95, tableRowStyle: { tableHeader: true }, tableCells: [
                { content: [{ paragraph: { elements: [{ textRun: { content: 'H1' } }] } }] }
              ] },
              { startIndex: 95, endIndex: 119, tableRowStyle: {}, tableCells: [] }
            ]
          }
        }
      ]
    },
    headers: {
      'h.default': { headerId: 'h.default', content: [
        { startIndex: 0, endIndex: 12, paragraph: { paragraphStyle: {}, elements: [
          { startIndex: 0, endIndex: 12, textRun: { content: 'Header text' } }] } }
      ] }
    },
    footers: {
      'f.default': { footerId: 'f.default', content: [
        { startIndex: 0, endIndex: 1, paragraph: { paragraphStyle: {}, elements: [] } }
      ] }
    },
    footnotes: {
      'fn.1': { footnoteId: 'fn.1', content: [
        { startIndex: 0, endIndex: 15, paragraph: { paragraphStyle: {}, elements: [
          { startIndex: 0, endIndex: 15, textRun: { content: 'First footnote' } }] } }
      ] },
      'fn.2': { footnoteId: 'fn.2', content: [
        { startIndex: 0, endIndex: 16, paragraph: { paragraphStyle: {}, elements: [
          { startIndex: 0, endIndex: 16, textRun: { content: 'Second footnote' } }] } }
      ] }
    },
    lists: {
      'list.1': { listProperties: { nestingLevels: [
        { glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '●', glyphFormat: '%0',
          indentStart: { magnitude: 36, unit: 'PT' }, indentFirstLine: { magnitude: 18, unit: 'PT' },
          bulletAlignment: 'START', startNumber: 1 },
        { glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '○', glyphFormat: '%1',
          indentStart: { magnitude: 72, unit: 'PT' }, bulletAlignment: 'START' }
      ] } }
    }
  };
}

/**
 * Three lists and two tables, so "apply to all" has something to agree on.
 *
 * Deliberately not unanimous, and deliberately not led by the first list: the
 * first indents its first level by 90pt and does not centre, the other two
 * indent by 36pt and centre. So a majority vote has a winner, and it is not
 * "whatever the first list does". Same for the tables: their padding differs
 * and their column sizing does not.
 */
function makeMultiDoc() {
  const t = mainTab();
  const c = t.body.content;

  function item(start, listId, level, ps, text) {
    return {
      startIndex: start, endIndex: start + 10,
      paragraph: {
        paragraphStyle: Object.assign({ namedStyleType: 'NORMAL_TEXT' }, ps),
        bullet: { listId: listId, nestingLevel: level },
        elements: [{ startIndex: start, endIndex: start + 10, textRun: { content: text } }]
      }
    };
  }

  // list.1 is already in mainTab; give its paragraphs the majority style.
  c.forEach((el) => {
    const b = el.paragraph && el.paragraph.bullet;
    if (!b || b.listId !== 'list.1') return;
    if (b.nestingLevel) {
      el.paragraph.paragraphStyle.indentStart = { magnitude: 72, unit: 'PT' };
    } else {
      el.paragraph.paragraphStyle.indentStart = { magnitude: 90, unit: 'PT' };
      el.paragraph.paragraphStyle.alignment = 'START';
    }
  });

  c.push(item(200, 'list.2', 0, { indentStart: { magnitude: 36, unit: 'PT' }, alignment: 'CENTER' }, 'Two A'));
  c.push(item(210, 'list.2', 1, { indentStart: { magnitude: 72, unit: 'PT' } }, 'Two B'));
  c.push(item(220, 'list.3', 0, { indentStart: { magnitude: 36, unit: 'PT' }, alignment: 'CENTER' }, 'Three A'));

  c.push({
    startIndex: 300, endIndex: 340,
    table: {
      rows: 2, columns: 2,
      tableStyle: { tableColumnProperties: [{ widthType: 'FIXED_WIDTH', width: { magnitude: 100, unit: 'PT' } }] },
      tableRows: [
        { startIndex: 301, endIndex: 320, tableRowStyle: {}, tableCells: [
          { content: [{ paragraph: { elements: [{ textRun: { content: 'B1' } }] } }],
            tableCellStyle: { paddingTop: { magnitude: 9, unit: 'PT' } } }
        ] },
        { startIndex: 320, endIndex: 339, tableRowStyle: {}, tableCells: [] }
      ]
    }
  });

  t.lists['list.2'] = { listProperties: { nestingLevels: [
    { glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '\u25cf', glyphFormat: '%0' },
    { glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '\u25cb', glyphFormat: '%1' }
  ] } };
  t.lists['list.3'] = { listProperties: { nestingLevels: [
    { glyphType: 'DECIMAL', glyphFormat: '%0.', startNumber: 1 }
  ] } };

  return {
    title: 'Multi Doc',
    documentId: 'DOC_ID',
    tabs: [{
      tabProperties: { tabId: 't.0', title: 'Main', index: 0, nestingLevel: 0 },
      documentTab: t
    }]
  };
}

/** Same content, but exposed the legacy (pre-tabs) way. */
function makeLegacyDoc() {
  const t = mainTab();
  return Object.assign({ title: 'Legacy Doc', documentId: 'DOC_ID' }, t);
}

/**
 * Three sections, built to exercise finding the one under the cursor.
 *
 * Sections two and three deliberately hold twin paragraphs -- an empty one
 * each, plus a shared prefix between them -- because twins across sections
 * are exactly where picking the current section can go wrong. Margins differ
 * per section so a copied style can be told apart from an original one.
 */
function makeSectionedDoc() {
  function sb(start, style) {
    return {
      startIndex: start, endIndex: start,
      sectionBreak: Object.assign({ sectionStyle: Object.assign({
        sectionType: 'CONTINUOUS', columnProperties: []
      }, style) })
    };
  }
  function p(start, end, text, opts) {
    return {
      startIndex: start, endIndex: end,
      paragraph: Object.assign({
        paragraphStyle: {},
        elements: [{ startIndex: start, endIndex: end, textRun: { content: text } }]
      }, opts || {})
    };
  }
  return {
    title: 'Sectioned Doc',
    documentId: 'DOC_ID',
    tabs: [{
      tabProperties: { tabId: 't.0', title: 'Main', index: 0, nestingLevel: 0 },
      documentTab: {
        documentStyle: {},
        namedStyles: { styles: [] },
        body: { content: [
          sb(0, { marginTop: { magnitude: 72, unit: 'PT' } }),
          p(1, 16, 'First page text'),
          sb(17, { marginTop: { magnitude: 90, unit: 'PT' }, sectionType: 'NEXT_PAGE' }),
          p(18, 19, ''),
          p(20, 31, 'Shared heading'),
          sb(32, { marginTop: { magnitude: 108, unit: 'PT' } }),
          p(33, 34, ''),
          p(35, 44, 'Item one', {
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
            bullet: { listId: 'list.9', nestingLevel: 0 }
          }),
          {
            startIndex: 45, endIndex: 90,
            table: { rows: 1, columns: 1, tableRows: [
              { startIndex: 46, endIndex: 89, tableRowStyle: {}, tableCells: [
                { content: [p(47, 57, 'Cell words')] }
              ] }
            ] }
          }
        ] },
        lists: {}
      }
    }]
  };
}

module.exports = { makeDoc, makeLegacyDoc, makeMultiDoc, makeSectionedDoc,
                   noBorder, realTextDefaults, realParagraphDefaults };

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
          textStyle: {
            weightedFontFamily: { fontFamily: 'Arial', weight: 400 },
            fontSize: { magnitude: 11, unit: 'PT' },
            foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } }
          },
          paragraphStyle: { alignment: 'START', lineSpacing: 115, direction: 'LEFT_TO_RIGHT' }
        },
        {
          namedStyleType: 'HEADING_1',
          textStyle: {
            weightedFontFamily: { fontFamily: 'Georgia', weight: 700 },
            fontSize: { magnitude: 20, unit: 'PT' },
            bold: true
          },
          paragraphStyle: {
            alignment: 'START',
            spaceAbove: { magnitude: 18, unit: 'PT' },
            spaceBelow: { magnitude: 6, unit: 'PT' },
            keepWithNext: true
          }
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

/** Same content, but exposed the legacy (pre-tabs) way. */
function makeLegacyDoc() {
  const t = mainTab();
  return Object.assign({ title: 'Legacy Doc', documentId: 'DOC_ID' }, t);
}

module.exports = { makeDoc, makeLegacyDoc };

/**
 * The project's sandbox, built on gapp-tester.
 *
 * gapp-tester loads the script files into one shared scope and mocks the
 * Google services. Two of them are hand-written here instead:
 *
 *   - DocumentApp, because the custom-style tests drive a real selection
 *     and a recording mock cannot stand in for one;
 *   - Docs, because these tests turn on the exact requests the add-on
 *     issues, so batchUpdate is captured and get() answers with a fixture.
 *
 * Everything else -- PropertiesService, HtmlService, Logger and the rest --
 * comes from gapp-tester as-is.
 */
const path = require('path');
const { sandbox } = require('gapp-tester');
const config = require('../gapp.config.json');

const ROOT = path.join(__dirname, '..');

function makeSandbox(doc) {
  const captured = [];
  // DocumentApp reads these; the tests set them through sb.__selection.
  const state = { selection: null, cursor: null };

  const DocumentApp = {
    getActiveDocument: () => ({
      getId: () => 'DOC_ID',
      getSelection: () => state.selection,
      getCursor: () => state.cursor
    }),
    getUi: () => ({ createAddonMenu: () => ({ addItem: () => ({ addToUi() {} }) }) }),
    Attribute: {
      FONT_FAMILY: 'FONT_FAMILY', FONT_SIZE: 'FONT_SIZE', BOLD: 'BOLD',
      ITALIC: 'ITALIC', UNDERLINE: 'UNDERLINE', STRIKETHROUGH: 'STRIKETHROUGH',
      FOREGROUND_COLOR: 'FOREGROUND_COLOR', BACKGROUND_COLOR: 'BACKGROUND_COLOR',
      VERTICAL_ALIGNMENT: 'VERTICAL_ALIGNMENT', HORIZONTAL_ALIGNMENT: 'HORIZONTAL_ALIGNMENT',
      LINE_SPACING: 'LINE_SPACING', SPACING_BEFORE: 'SPACING_BEFORE',
      SPACING_AFTER: 'SPACING_AFTER', INDENT_START: 'INDENT_START',
      INDENT_END: 'INDENT_END', INDENT_FIRST_LINE: 'INDENT_FIRST_LINE'
    },
    ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', BODY: 'BODY' },
    HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFY: 'JUSTIFY' },
    VerticalAlignment: { SUPERSCRIPT: 'SUPERSCRIPT', SUBSCRIPT: 'SUBSCRIPT', NORMAL: 'NORMAL' }
  };

  const Docs = {
    Documents: {
      get: () => JSON.parse(JSON.stringify(doc)),
      batchUpdate: (resource, id) => {
        captured.push({ documentId: id, requests: resource.requests });
        return { replies: [] };
      }
    }
  };

  const sb = sandbox({
    dir: ROOT,
    src: config.src,
    files: config.serverFiles,
    globals: { DocumentApp, Docs },
    quiet: true
  });

  Object.defineProperty(sb, '__selection', {
    get: () => state.selection, set: (v) => { state.selection = v; }
  });
  Object.defineProperty(sb, '__cursor', {
    get: () => state.cursor, set: (v) => { state.cursor = v; }
  });
  sb.__captured = captured;
  sb.__reset = () => { captured.length = 0; };
  return sb;
}

/** All requests captured so far, flattened across batches. */
function allRequests(sb) {
  return sb.__captured.reduce((acc, b) => acc.concat(b.requests), []);
}

module.exports = { makeSandbox, allRequests };

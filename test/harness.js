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
const { checkRequests } = require('./apicheck');
const { protoize } = require('./proto3');
const { applyRequests } = require('./apply');

const ROOT = path.join(__dirname, '..');

/**
 * A response cut down to a field mask, the way the API cuts one down.
 *
 * The metadata poll's whole point is that it does not read the body, and
 * without this the mock hands back the entire document however small the
 * mask -- so a mask that had stopped working, or that named a path the API
 * does not have, would go on looking fine offline while the poll got slower
 * and slower on a real document.
 *
 * Paths are dotted and comma-separated, exactly as the API takes them. A
 * path naming a repeated field descends into every element of it, which is
 * what makes `tabs.tabProperties` mean "the properties of each tab". A path
 * with nothing under it keeps the whole subtree beneath it.
 */
function project(doc, fields) {
  if (!fields) return doc;
  const tree = {};
  String(fields).split(',').forEach((path) => {
    const parts = path.trim().split('.').filter(Boolean);
    let node = tree;
    parts.forEach((part) => {
      if (!node[part]) node[part] = {};
      node = node[part];
    });
  });
  return prune(doc, tree);
}

function prune(value, tree) {
  if (!Object.keys(tree).length) return value;
  if (Array.isArray(value)) return value.map((v) => prune(v, tree));
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  Object.keys(tree).forEach((k) => {
    if (k in value) out[k] = prune(value[k], tree[k]);
  });
  return out;
}

function makeSandbox(doc, opts) {
  opts = opts || {};
  const captured = [];
  // DocumentApp reads these; the tests set them through sb.__selection.
  const state = { selection: null, cursor: null };

  // DocumentApp's view of a document, built from the API's view of the same
  // one. The add-on joins the two by child index, so the mock has to be a
  // faithful second view rather than a hand-written chain: it is the
  // agreement between them that the live alignment tests are checking, and a
  // mock invented independently of the fixture would check nothing.
  const docAppBody = () => {
    const tab = (((live.tabs || [])[0] || {}).documentTab) || live;
    const content = (((tab.body || {}).content) || []);
    // Everything but the document's own first section break, which is the one
    // element with no child slot on the DocumentApp side.
    const top = content.length && content[0].sectionBreak ? content.slice(1) : content;
    const node = (el, parent) => {
      if (el.table) {
        const table = {
          getType: () => 'TABLE',
          getParent: () => parent,
          getNumChildren: () => (el.table.tableRows || []).length,
          getChild: (i) => rows[i],
          getChildIndex: (c) => rows.indexOf(c)
        };
        const rows = (el.table.tableRows || []).map((r) => {
          const row = {
            getType: () => 'TABLE_ROW',
            getParent: () => table,
            getNumChildren: () => (r.tableCells || []).length,
            getChild: (i) => cells[i],
            getChildIndex: (c) => cells.indexOf(c)
          };
          const cells = (r.tableCells || []).map((c) => {
            const cell = {
              getType: () => 'TABLE_CELL',
              getParent: () => row,
              getNumChildren: () => kids.length,
              getChild: (i) => kids[i],
              getChildIndex: (k) => kids.indexOf(k)
            };
            const kids = (c.content || []).map((k) => node(k, cell));
            return cell;
          });
          return row;
        });
        return table;
      }
      const text = ((el.paragraph || {}).elements || [])
        .map((e) => (e.textRun && e.textRun.content) || (e.autoText ? ' ' : '')).join('');
      return {
        getType: () => (el.paragraph
          ? (el.paragraph.bullet ? 'LIST_ITEM' : 'PARAGRAPH')
          : el.tableOfContents ? 'TABLE_OF_CONTENTS' : 'UNSUPPORTED'),
        getParent: () => parent,
        getText: () => text,
        getListId: () => ((el.paragraph || {}).bullet || {}).listId
      };
    };
    const body = {
      getType: () => 'BODY_SECTION',
      getParent: () => null,
      getNumChildren: () => kids.length,
      getChild: (i) => kids[i],
      getChildIndex: (c) => kids.indexOf(c)
    };
    const kids = top.map((el) => node(el, body));
    return body;
  };

  const DocumentApp = {
    // The live suite reaches the scratch document this way, because the
    // standalone script it runs in has no active document to be in.
    openById: () => ({ getBody: docAppBody }),
    getActiveDocument: () => ({
      getId: () => 'DOC_ID',
      getSelection: () => state.selection,
      getCursor: () => state.cursor,
      getBody: docAppBody
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
    ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', BODY: 'BODY',
                   BODY_SECTION: 'BODY_SECTION', TABLE: 'TABLE', TABLE_ROW: 'TABLE_ROW', TABLE_CELL: 'TABLE_CELL',
                   HEADER_SECTION: 'HEADER_SECTION', FOOTER_SECTION: 'FOOTER_SECTION',
                   FOOTNOTE_SECTION: 'FOOTNOTE_SECTION' },
    HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFY: 'JUSTIFY' },
    VerticalAlignment: { SUPERSCRIPT: 'SUPERSCRIPT', SUBSCRIPT: 'SUBSCRIPT', NORMAL: 'NORMAL' }
  };

  const counts = { get: 0 };
  const created = [];
  const skipped = [];
  // `opts.docsGet(id, optionalArgs)` replaces get() wholesale when a test has
  // to see the exact call -- the masked-read tests do, since their whole
  // subject is what got asked for.
  // Served the way the API serves it: proto3 leaves out every default, so a
  // zero margin arrives with no magnitude and the first element of a body
  // has no startIndex. opts.verbatim hands the fixture over as written, for
  // the few tests whose subject is the fixture rather than the reading of it.
  const shape = (d) => (opts.verbatim ? JSON.parse(JSON.stringify(d)) : protoize(d));
  // One document that writes actually change, so a test can write a value
  // and read it back the way a user would. `doc` itself is left alone.
  const live = JSON.parse(JSON.stringify(doc));
  const docsGet = opts.docsGet || ((id, args) => {
    counts.get++;
    return project(shape(live), (args || {}).fields);
  });
  const Docs = {
    Documents: {
      get: docsGet,
      batchUpdate: (resource, id) => {
        captured.push({ documentId: id, requests: resource.requests });
        // The real API refuses a malformed request; so does this, or the
        // local suite would go on passing while the add-on cannot write.
        // opts.lax turns it off for the tests whose subject IS a bad request.
        if (!opts.lax) {
          const errs = checkRequests(resource.requests);
          if (errs.length) {
            const e = new Error('Docs API would reject this batch:\n  - ' +
              errs.join('\n  - '));
            e.requests = resource.requests;
            throw e;
          }
        }
        // Style updates are applied through their field masks, so a mask
        // that misses a field means the field does not change here either.
        // Content edits are recorded only; see test/apply.js.
        skipped.push.apply(skipped, applyRequests(live, resource.requests));
        return { replies: [] };
      },
      // The live suite's fixture builder makes its scratch document if it
      // does not have one. Nothing here has a Drive to put it in, so this
      // records the call and hands back an id.
      create: (resource) => {
        created.push(resource);
        return { documentId: 'CREATED_DOC_ID', title: resource && resource.title };
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
  Object.defineProperty(sb, '__fetches', { get: () => counts.get });
  /** DocumentApp's view of the document, for tests that drive the cursor. */
  Object.defineProperty(sb, '__docAppBody', { get: docAppBody });
  Object.defineProperty(sb, '__cursor', {
    get: () => state.cursor, set: (v) => { state.cursor = v; }
  });
  sb.__captured = captured;
  sb.__created = created;
  /** Request kinds that were recorded but not applied -- content edits. */
  sb.__skipped = skipped;
  /** The document as it now stands, writes included, API-shaped. */
  sb.__doc = () => shape(live);
  // fetchDoc_ caches the document for the length of one Apps Script execution;
  // a test is a fresh execution, so the cache and the fetch count go with it.
  sb.__reset = () => {
    captured.length = 0; skipped.length = 0; counts.get = 0; sb.docCache_ = null;
  };
  return sb;
}

/** All requests captured so far, flattened across batches. */
function allRequests(sb) {
  return sb.__captured.reduce((acc, b) => acc.concat(b.requests), []);
}

module.exports = { makeSandbox, allRequests };

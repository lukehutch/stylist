/**
 * Add-on entry points and the aggregate load used by the sidebar.
 *
 * This is an Editor Add-on (menu + HtmlService sidebar) rather than a
 * CardService Workspace Add-on. The editor here needs tabbed navigation,
 * dozens of numeric fields with unit suffixes, colour inputs and per-field
 * live apply; CardService cannot express that. The trade-off is that the
 * add-on runs in Docs only, which is exactly its scope.
 */

function onOpen(e) {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('Open', 'showSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('Stylist');
  DocumentApp.getUi().showSidebar(html);
}

/** Lets Sidebar.html pull in the CSS and JS partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Everything the sidebar needs for its first paint, in one round trip.
 * google.script.run calls are individually slow, so batching the initial
 * load matters more than keeping this tidy.
 */
function loadAll(tabId) {
  timings_ = {};
  var t0 = Date.now();
  var doc = fetchDoc_();
  var flat = flattenTabs_(doc);
  var ctx = resolveTab_(doc, tabId);
  var active = ctx.tabId;
  var tables = timed_('tables', function () { return readTables(active); });

  var out = {
    documentTitle: doc.title,
    tabs: flat.map(function (t) {
      return { tabId: t.tabId, title: t.title, depth: t.depth };
    }),
    activeTabId: active,
    pageFormat: timed_('page', function () { return readPageFormat(active); }),
    namedStyles: timed_('styles', function () { return readNamedStyles(active).styles; }),
    segments: timed_('segments', function () { return readSegments(active); }),
    lists: timed_('lists', function () { return readLists(active); }),
    tables: tables.tables,
    activeTableIndex: tables.activeIndex,
    presets: timed_('presets', function () { return listPresets(); }),
    stylePresets: timed_('stylePresets', function () { return listStylePresets(); }),
    constants: {
      units: SUPPORTED_UNITS,
      pageSizePresets: PAGE_SIZE_PRESETS,
      namedStyleTypes: NAMED_STYLE_TYPES,
      bulletPresets: BULLET_PRESETS,
      fonts: FONT_LIST
    }
  };
  timings_.serverTotal = Date.now() - t0;
  out.timings = timings_;
  return out;
}

/** Fonts offered in the picker. Any Google Fonts family name also works. */
var FONT_LIST = [
  'Arial', 'Arial Narrow', 'Arvo', 'Calibri', 'Cambria', 'Caveat', 'Comfortaa',
  'Comic Sans MS', 'Consolas', 'Corsiva', 'Courier New', 'EB Garamond', 'Georgia',
  'Impact', 'Inconsolata', 'Lato', 'Lexend', 'Libre Baskerville', 'Lobster',
  'Merriweather', 'Montserrat', 'Nunito', 'Open Sans', 'Oswald', 'Pacifico',
  'Playfair Display', 'Proxima Nova', 'PT Sans', 'PT Serif', 'Raleway', 'Roboto',
  'Roboto Mono', 'Roboto Slab', 'Source Code Pro', 'Source Sans Pro', 'Spectral',
  'Times New Roman', 'Trebuchet MS', 'Ubuntu', 'Verdana', 'Work Sans'
];

/**
 * Re-read just the parts a live edit can have changed. The sidebar calls
 * this after an apply so that inherited/derived values stay honest without
 * paying for a full loadAll.
 */
/**
 * Re-read one slice of the sidebar's state.
 *
 * 'meta' is the cheap one: a masked response carrying page setup, named
 * styles and the tab list and nothing else -- no body -- so polling it does
 * not get slower as the document grows. Everything else is content-shaped
 * and pays for a full read; the caller's job is to ask rarely (see
 * cursorContext).
 */
function refresh(tabId, what, ctx) {
  if (what === 'meta') return readDocMeta(tabId);
  var out = {};
  if (!what || what === 'page') out.pageFormat = readPageFormat(tabId);
  if (!what || what === 'styles') out.namedStyles = readNamedStyles(tabId).styles;
  if (what === 'sections') {
    // The one section the cursor is in. `ctx` is the cursorContext answer the
    // sidebar probed a moment ago; without a usable one the panel falls back
    // to the section it was last showing.
    var scan = sectionsScan_(resolveTab_(fetchDoc_(), tabId));
    var at = pickSection_(scan.sections, scan.elements, ctx || {});
    out.sections = at >= 0 ? [scan.sections[at]] : [];
    out.activeSectionIndex = at;
    out.sectionCount = scan.sections.length;
  } else if (!what) {
    out.sections = readSections(tabId).sections;
  }
  // The headers/footers panel shows the segments themselves and the two
  // margins that position them, so it wants both in one answer.
  if (what === 'hf') {
    out.segments = readSegments(tabId);
    out.pageFormat = readPageFormat(tabId);
  }
  if (!what || what === 'lists') out.lists = readLists(tabId);
  if (!what || what === 'segments') out.segments = readSegments(tabId);
  if (!what || what === 'tables') {
    var t = readTables(tabId);
    out.tables = t.tables;
    out.activeTableIndex = t.activeIndex;
  }
  return out;
}

/**
 * What is under the cursor, for the price of a few accessor calls.
 *
 * This is the gate that keeps the lists, tables and sections panels from
 * re-reading the document every second: the panels only show what the cursor
 * sits in, so if this answer has not changed there is nothing for them to
 * learn from a read. Identity comes straight off the element the selection or
 * cursor is in -- no walk over the body, no indices.
 *
 * A table has no id in DocumentApp, so it reports presence only; moving
 * between two tables necessarily passes through not-being-in-one, which is
 * change enough.
 *
 * The paragraph's leading text is the handle the sections panel matches
 * against the body, because DocumentApp cannot see section breaks at all.
 * It is recorded on the way up even inside a table cell, and the climb
 * carries on so a table holding that paragraph is still reported.
 *
 * The climb runs all the way to the root rather than stopping at the first
 * thing it recognises, because the outermost element is the one that says
 * whether the cursor is in a header, a footer or a footnote rather than in
 * the body. That is reported as segmentKind, and only for those three: the
 * body is the ordinary case and saying so would only make the answer differ
 * from itself for no reason. It is a kind and not an identity -- DocumentApp
 * models a document as having at most one header section, so it cannot tell
 * the default header from the first-page or even-page one.
 */
function cursorContext() {
  var out = {};
  try {
    var doc = DocumentApp.getActiveDocument();
    if (!doc) return out;
    var el = null;
    var sel = doc.getSelection();
    if (sel && sel.getRangeElements && sel.getRangeElements().length) {
      el = sel.getRangeElements()[0].getElement();
    } else {
      var cur = doc.getCursor();
      if (cur) el = cur.getElement();
    }
    while (el && el.getType) {
      var type = el.getType();
      if ((type === DocumentApp.ElementType.PARAGRAPH ||
           type === DocumentApp.ElementType.LIST_ITEM) &&
          out.paraHead === undefined) {
        out.paraKind = type === DocumentApp.ElementType.LIST_ITEM ? 'li' : 'p';
        out.paraHead = String(el.getText() || '').slice(0, 80);
      }
      if (type === DocumentApp.ElementType.LIST_ITEM && out.listId === undefined) {
        // getListId is the identity of the list this item belongs to. Some
        // service versions expose it only via getList(); prefer the direct one.
        out.listId = el.getListId !== undefined ? el.getListId()
          : (el.getList && el.getList() ? el.getList().getId() : null);
      }
      if (type === DocumentApp.ElementType.TABLE) out.inTable = true;
      if (type === DocumentApp.ElementType.HEADER_SECTION) { out.segmentKind = 'header'; break; }
      if (type === DocumentApp.ElementType.FOOTER_SECTION) { out.segmentKind = 'footer'; break; }
      if (type === DocumentApp.ElementType.FOOTNOTE_SECTION) { out.segmentKind = 'footnote'; break; }
      el = el.getParent();
    }
  } catch (e) { /* nothing selected yet, or no cursor: an empty context */ }
  return out;
}

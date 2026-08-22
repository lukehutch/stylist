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
  var doc = fetchDoc_();
  var flat = flattenTabs_(doc);
  var ctx = resolveTab_(doc, tabId);
  var active = ctx.tabId;
  var tables = readTables(active);

  return {
    documentTitle: doc.title,
    tabs: flat.map(function (t) {
      return { tabId: t.tabId, title: t.title, depth: t.depth };
    }),
    activeTabId: active,
    pageFormat: readPageFormat(active),
    sections: readSections(active).sections,
    namedStyles: readNamedStyles(active).styles,
    segments: readSegments(active),
    lists: readLists(active),
    tables: tables.tables,
    activeTableIndex: tables.activeIndex,
    footnotes: readFootnotes(active),
    presets: listPresets(),
    stylePresets: listStylePresets(),
    constants: {
      units: SUPPORTED_UNITS,
      pageSizePresets: PAGE_SIZE_PRESETS,
      namedStyleTypes: NAMED_STYLE_TYPES,
      bulletPresets: BULLET_PRESETS,
      fonts: FONT_LIST
    }
  };
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
function refresh(tabId, what) {
  var out = {};
  if (!what || what === 'page') out.pageFormat = readPageFormat(tabId);
  if (!what || what === 'styles') out.namedStyles = readNamedStyles(tabId).styles;
  if (!what || what === 'sections') out.sections = readSections(tabId).sections;
  if (!what || what === 'lists') out.lists = readLists(tabId);
  if (!what || what === 'segments') out.segments = readSegments(tabId);
  if (!what || what === 'tables') {
    var t = readTables(tabId);
    out.tables = t.tables;
    out.activeTableIndex = t.activeIndex;
  }
  if (!what || what === 'footnotes') out.footnotes = readFootnotes(tabId);
  return out;
}

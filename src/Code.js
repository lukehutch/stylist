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
/**
 * `haveConstants` is the sidebar saying it already holds the font list, the
 * page-size presets and the rest. They never change within a session, so
 * every reload after the first leaves them out.
 */
function loadAll(tabId, haveConstants) {
  timings_ = {};
  var t0 = Date.now();
  var doc = fetchDoc_();
  var flat = flattenTabs_(doc);
  var ctx = resolveTab_(doc, tabId);
  var active = ctx.tabId;
  // One cursor lookup for the whole load: the lists and tables panels both
  // show what the cursor is in, and asking DocumentApp twice for the same
  // answer is two round trips across the service boundary for one fact.
  var cur = timed_('cursor', cursorContext);
  var tables = timed_('tables', function () { return readTables(active, cur); });
  // Every section, not just the one the cursor is in. A section is a handful
  // of numbers, so all of them together cost about what one of them costs to
  // ask for separately -- and holding all of them is what lets the sidebar
  // follow the cursor from one section to the next without reading anything.
  var scan = timed_('sections', function () { return sectionsScan_(ctx); });

  var out = {
    documentTitle: doc.title,
    tabs: flat.map(function (t) {
      return { tabId: t.tabId, title: t.title, depth: t.depth };
    }),
    activeTabId: active,
    // What the cursor was in when the sidebar opened, and the maps that turn
    // its answer into a list, a table and a section. Together these are what
    // the context panels need, so they are right on the first paint rather
    // than one poll tick later.
    cursor: cur,
    bodyChildCount: bodyChildCount_(scan.elements),
    sectionCount: scan.sections.length,
    sections: scan.sections,
    activeSectionIndex: pickSection_(scan.sections, scan.elements, cur),
    hfLinks: hfLinks_(scan.sections),
    pageFormat: timed_('page', function () { return readPageFormat(active); }),
    namedStyles: timed_('styles', function () { return readNamedStyles(active).styles; }),
    segments: timed_('segments', function () { return readSegments(active); }),
    lists: timed_('lists', function () { return readLists(active, cur); }),
    tables: tables.tables,
    activeTableIndex: tables.activeIndex,
    presets: timed_('presets', function () { return listPresets(); }),
    stylePresets: timed_('stylePresets', function () { return listStylePresets(); })
  };
  if (!haveConstants) {
    out.constants = {
      units: SUPPORTED_UNITS,
      pageSizePresets: PAGE_SIZE_PRESETS,
      namedStyleTypes: NAMED_STYLE_TYPES,
      bulletPresets: BULLET_PRESETS,
      fonts: FONT_LIST
    };
  }
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
  // Presets are the user's, not the document's, so this reads nothing from
  // Docs at all -- which is the whole point of asking for them on their own.
  if (what === 'presets') {
    return { presets: listPresets(), stylePresets: listStylePresets() };
  }
  var out = {};
  // Every slice below reads the document, and every one of them describes it
  // by position. This is the measure that says whether those positions still
  // mean what they meant -- sent with all of them, so whichever slice the
  // sidebar asked for leaves it able to place the cursor itself.
  out.bodyChildCount = bodyChildCount_(
    ((resolveTab_(fetchDoc_(), tabId).content.body) || {}).content);
  if (!what || what === 'page') out.pageFormat = readPageFormat(tabId);
  if (!what || what === 'styles') out.namedStyles = readNamedStyles(tabId).styles;
  if (what === 'sections') {
    // Every section, and which one the cursor is in. `ctx` is the
    // cursorContext answer the sidebar probed a moment ago; without a usable
    // one the panel falls back to the section it was last showing.
    var scan = sectionsScan_(resolveTab_(fetchDoc_(), tabId));
    out.sections = scan.sections;
    out.activeSectionIndex = pickSection_(scan.sections, scan.elements, ctx || {});
    out.sectionCount = scan.sections.length;
    out.hfLinks = hfLinks_(scan.sections);
  } else if (!what) {
    out.sections = readSections(tabId).sections;
  }
  // The headers/footers panel shows the segments themselves and the two
  // margins that position them, so it wants both in one answer. It also
  // offers to style one section's headers, and which section that is comes
  // from the same match the sections panel makes.
  if (what === 'hf') {
    out.segments = readSegments(tabId);
    out.pageFormat = readPageFormat(tabId);
    var hf = sectionsScan_(resolveTab_(fetchDoc_(), tabId));
    out.activeSectionIndex = pickSection_(hf.sections, hf.elements, ctx || {});
    out.sectionCount = hf.sections.length;
    // The sections themselves come back too: their header and footer margins
    // are what the panel shows, writing them needs a start index, and holding
    // all of them is what lets the sidebar follow the cursor with no read.
    out.sections = hf.sections;
    out.hfLinks = hfLinks_(hf.sections);
  }
  if (!what || what === 'lists') out.lists = readLists(tabId, ctx);
  if (!what || what === 'segments') out.segments = readSegments(tabId);
  if (!what || what === 'tables') {
    var t = readTables(tabId, ctx);
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
 * learn from a read.
 *
 * `root` and `path` are the answer those panels actually run on: the segment
 * the cursor is in, and the chain of child indices down to the paragraph or
 * table holding it, which picks the same element out of the Docs API's
 * content (see cursorPath_). It is a handful of accessor calls -- one per
 * level of nesting -- and no walk over the body.
 *
 * The rest is what the path cannot give, plus what stands in when it fails.
 * A table has no id in DocumentApp, so inTable reports presence only; moving
 * between two tables necessarily passes through not-being-in-one, which is
 * change enough. The paragraph's leading text is the fallback handle the
 * sections and lists panels match against the body when no path could be
 * built. It is recorded on the way up even inside a table cell, and the climb
 * carries on so a table holding that paragraph is still reported.
 *
 * A paragraph carrying no bullet is still asked whether it sits inside a
 * list, because a line typed between two bullets is one to a reader whatever
 * the API calls it. See listAbove_; it runs only when nothing bulleted was
 * found, so it never slows down finding a list item that is one.
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
/**
 * The list an unbulleted line belongs to by sitting inside one.
 *
 * A line typed between two bullets, or one indented under a bullet to carry
 * on the same point, wears no bullet of its own. Docs does not call it a list
 * item and neither does the API, so a click into it used to leave the lists
 * panel showing nothing -- even though to a reader the line is plainly part
 * of the list it sits in.
 *
 * The rule is the plain one: an indented line whose nearest preceding sibling
 * carrying a bullet sits at the same indent, or one level less, belongs to
 * that list. Unbulleted lines in between are stepped over, so a run of them
 * all answers with the same list; a line further out than this one ends the
 * search, because that is a line the list is no longer inside.
 *
 * Cost: two accessor calls per line stepped over, and it runs only when the
 * cursor is NOT in a list item. Finding a real list item is exactly as fast
 * as it was.
 */
function listAbove_(para) {
  try {
    if (!para.getIndentStart || !para.getPreviousSibling) return null;
    var mine = para.getIndentStart();
    if (!(mine > 0)) return null;                    // flush left: not inside anything
    var el = para.getPreviousSibling();
    for (var steps = 0; el && steps < 20; steps++) {
      var type = el.getType();
      if (type === DocumentApp.ElementType.LIST_ITEM) {
        var theirs = el.getIndentStart ? el.getIndentStart() : null;
        // Docs' nesting levels are 36pt apart, so "one level less" is a drop
        // of up to 36pt; the slack either side is for a hand-set indent that
        // is close to a level without being exactly on it.
        if (theirs === null || (theirs <= mine + 2 && theirs >= mine - 54)) {
          return el.getListId !== undefined ? el.getListId()
            : (el.getList && el.getList() ? el.getList().getId() : null);
        }
        return null;
      }
      if (type !== DocumentApp.ElementType.PARAGRAPH) return null;
      var out = el.getIndentStart ? el.getIndentStart() : null;
      if (!(out !== null && out >= mine - 2)) return null;
      el = el.getPreviousSibling();
    }
  } catch (e) { /* no indent, no sibling, or an element carrying neither */ }
  return null;
}

function cursorContext() {
  var out = {};
  try {
    var doc = DocumentApp.getActiveDocument();
    if (!doc) return out;
    // How many children the body has, which is one accessor call and is what
    // tells the sidebar whether the indexes it is holding still name the same
    // elements. Anything added or removed at the top level moves this.
    var body = doc.getBody();
    if (body && body.getNumChildren) out.bodyChildCount = body.getNumChildren();
    var el = null;
    var sel = doc.getSelection();
    if (sel && sel.getRangeElements && sel.getRangeElements().length) {
      el = sel.getRangeElements()[0].getElement();
    } else {
      var cur = doc.getCursor();
      if (cur) el = cur.getElement();
    }
    // Where it is, which is all the lists, tables and sections panels need:
    // one accessor call per level of nesting, and no walk.
    // An empty path means the climb reached a root without passing through
    // anything the API has, so there is nothing to report; absent is what
    // every reader of this already treats as "no answer".
    var where = cursorPath_(el);
    if (where && where.path.length) { out.root = where.root; out.path = where.path; }
    while (el && el.getType) {
      var type = el.getType();
      if ((type === DocumentApp.ElementType.PARAGRAPH ||
           type === DocumentApp.ElementType.LIST_ITEM) &&
          out.paraHead === undefined) {
        out.paraKind = type === DocumentApp.ElementType.LIST_ITEM ? 'li' : 'p';
        out.paraHead = String(el.getText() || '').slice(0, 80);
      }
      // An indented line with no bullet of its own, sitting inside a list:
      // the list it is inside is the one the panel should open. Only asked
      // when nothing bulleted has been found, so it costs a list item
      // nothing.
      if (type === DocumentApp.ElementType.PARAGRAPH && out.listId === undefined) {
        var inside = listAbove_(el);
        if (inside) out.listId = inside;
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

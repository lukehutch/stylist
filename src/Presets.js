/**
 * Style presets: the supported answer to "custom styles".
 *
 * The Docs API cannot create a new entry in the Styles menu -- the
 * NamedStyleType enum is closed at NORMAL_TEXT/TITLE/SUBTITLE/HEADING_1..6
 * and there is no request to define a new one. So a genuinely custom named
 * style that appears in the Docs UI dropdown is not possible.
 *
 * What is possible, and what this module does:
 *   - Save a complete formatting configuration (page setup + all nine named
 *     styles) under a name, per user, and re-apply it to any document.
 *   - Save individual character/paragraph style presets and apply them to
 *     one of the nine named styles, which is how a "custom style" gets onto
 *     the Styles menu in practice: define it once, bind it to a heading
 *     level you are not otherwise using.
 *   - Export and import the whole configuration as JSON, so a house style
 *     can live in version control and be shared.
 *
 * Two shapes of JSON travel through here, and keeping them apart matters.
 * exportConfig is one document's formatting -- page setup and the nine named
 * styles -- and that is what a saved preset stores. exportAll is the file the
 * Presets panel downloads: that same formatting plus every saved preset and
 * style preset the user has. A saved preset must never hold the second shape,
 * or each save would store a copy of every earlier save.
 */

var PRESET_STORE_KEY = 'stylist.presets';
var STYLE_PRESET_STORE_KEY = 'stylist.stylePresets';

function readStore_(key) {
  var raw = PropertiesService.getUserProperties().getProperty(key);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function writeStore_(key, obj) {
  PropertiesService.getUserProperties().setProperty(key, JSON.stringify(obj));
}

/** Snapshot the whole configuration of the current tab. */
function exportConfig(tabId) {
  var page = readPageFormat(tabId);
  var named = readNamedStyles(tabId);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    pageFormat: page,
    namedStyles: named.styles.map(function (s) {
      return {
        namedStyleType: s.namedStyleType,
        textStyle: s.textStyle,
        paragraphStyle: s.paragraphStyle
      };
    })
  };
}

/** Apply a previously exported configuration. */
function importConfig(payload) {
  payload = payload || {};
  var config = payload.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); }
    catch (e) { throw new Error('That is not valid JSON: ' + e.message); }
  }
  if (!config || typeof config !== 'object') throw new Error('Empty configuration.');

  var applied = 0;
  var warnings = [];

  if (config.pageFormat && payload.includePage !== false) {
    var pf = {};
    Object.keys(config.pageFormat).forEach(function (k) { pf[k] = config.pageFormat[k]; });
    pf.tabId = payload.tabId;
    pf.scope = payload.scope;
    // useCustomHeaderFooterMargins is read-only; never send it back.
    delete pf.useCustomHeaderFooterMargins;
    var r1 = writePageFormat(pf);
    applied += r1.applied || 0;
    (r1.warnings || []).forEach(function (w) { warnings.push(w); });
  }

  if (config.namedStyles && payload.includeStyles !== false) {
    var r2 = writeNamedStyles({
      tabId: payload.tabId,
      scope: payload.scope,
      styles: config.namedStyles
    });
    applied += r2.applied || 0;
  }

  return { applied: applied, warnings: warnings };
}

/* ---------------- The whole configuration, as one file ---------------- */

/**
 * Everything the Presets panel can hand you: this tab's formatting, plus the
 * saved presets and style presets, which live in the user's properties rather
 * than in the document and so are lost with the browser profile otherwise.
 *
 * List and table formatting is deliberately not in here. Both are addressed by
 * things that only mean something inside one document -- a list by its listId,
 * a table by where it starts -- so there is nothing to carry to another
 * document, and writing them into the file would promise a portability that
 * cannot be delivered.
 */
function exportAll(tabId) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    document: exportConfig(tabId),
    presets: readStore_(PRESET_STORE_KEY),
    stylePresets: readStore_(STYLE_PRESET_STORE_KEY)
  };
}

/**
 * Take such a file back in.
 *
 * A version 1 file -- everything written before there was a bundle, and every
 * preset already saved in the store -- is a bare configuration with pageFormat
 * at the top level. Those still work: they are recognised by shape and handed
 * straight to importConfig.
 *
 * Presets merge by name rather than replacing the store wholesale, so
 * uploading a colleague's file adds their house style to yours instead of
 * throwing yours away. A name that exists in both is taken from the file, and
 * said so in the warnings, because that is the one case where something the
 * user had is gone.
 *
 * payload: { config, tabId, scope, includePage, includeStyles }
 */
function importAll(payload) {
  payload = payload || {};
  var bundle = payload.config;
  if (typeof bundle === 'string') {
    // An empty file is its own mistake, and "Unexpected end of JSON input" is
    // not how to describe having picked one.
    if (!bundle.trim()) throw new Error('Empty configuration.');
    try { bundle = JSON.parse(bundle); }
    catch (e) { throw new Error('That is not valid JSON: ' + e.message); }
  }
  if (!bundle || typeof bundle !== 'object') throw new Error('Empty configuration.');

  // Version 1, or anything else shaped like a bare configuration.
  if (!bundle.document && (bundle.pageFormat || bundle.namedStyles)) {
    return importConfig({
      config: bundle,
      tabId: payload.tabId,
      scope: payload.scope,
      includePage: payload.includePage,
      includeStyles: payload.includeStyles
    });
  }

  var warnings = [];
  var applied = 0;

  if (bundle.document) {
    var r = importConfig({
      config: bundle.document,
      tabId: payload.tabId,
      scope: payload.scope,
      includePage: payload.includePage,
      includeStyles: payload.includeStyles
    });
    applied += r.applied || 0;
    (r.warnings || []).forEach(function (w) { warnings.push(w); });
  }

  var counts = mergeStore_(PRESET_STORE_KEY, bundle.presets);
  // So a user who has never opened the panel keeps the four built-in styles
  // alongside the uploaded ones, rather than the merge standing in for the
  // seeding that would otherwise have happened on the first read.
  seedStylePresets_();
  var styleCounts = mergeStore_(STYLE_PRESET_STORE_KEY, bundle.stylePresets);
  var added = counts.added + styleCounts.added;
  var replaced = counts.replaced.concat(styleCounts.replaced);
  if (added) warnings.push('Added ' + added + ' preset' + (added === 1 ? '' : 's') + '.');
  if (replaced.length) {
    warnings.push('Replaced what you had under ' + replaced.join(', ') + '.');
  }

  return { applied: applied, added: added, replaced: replaced, warnings: warnings };
}

/** Merge incoming named entries into a store, reporting what got overwritten. */
function mergeStore_(key, incoming) {
  var out = { added: 0, replaced: [] };
  if (!incoming || typeof incoming !== 'object') return out;
  var store = readStore_(key);
  Object.keys(incoming).forEach(function (name) {
    if (!name) return;
    if (Object.prototype.hasOwnProperty.call(store, name)) out.replaced.push(name);
    else out.added++;
    store[name] = incoming[name];
  });
  writeStore_(key, store);
  return out;
}

/* ---------------- Whole-document presets ---------------- */

function listPresets() {
  var store = readStore_(PRESET_STORE_KEY);
  return Object.keys(store).sort().map(function (name) {
    return { name: name, exportedAt: (store[name] || {}).exportedAt || '' };
  });
}

function savePreset(payload) {
  var name = String((payload || {}).name || '').trim();
  if (!name) throw new Error('Give the preset a name.');
  var store = readStore_(PRESET_STORE_KEY);
  store[name] = exportConfig((payload || {}).tabId);
  writeStore_(PRESET_STORE_KEY, store);
  return { saved: name, count: Object.keys(store).length };
}

function applyPreset(payload) {
  var store = readStore_(PRESET_STORE_KEY);
  var config = store[(payload || {}).name];
  if (!config) throw new Error('No preset named "' + (payload || {}).name + '".');
  return importConfig({
    config: config,
    tabId: payload.tabId,
    scope: payload.scope
  });
}

function deletePreset(payload) {
  var store = readStore_(PRESET_STORE_KEY);
  delete store[(payload || {}).name];
  writeStore_(PRESET_STORE_KEY, store);
  return { remaining: Object.keys(store).length };
}

/** payload: { from, to } */
function renamePreset(payload) {
  return renameInStore_(PRESET_STORE_KEY, payload);
}

/* ---------------- Individual style presets ---------------- */

/**
 * Styles a new user gets before defining any of their own.
 *
 * Courier New rather than a nicer monospace because it is one of the fonts
 * Docs always offers; a font the document has never used may not resolve.
 * Shading and borders cannot be set on a selection (see CustomStyles.js), so
 * the two block styles come into their own when bound to a named style --
 * the character-level styles work either way.
 */
var DEFAULT_STYLE_PRESETS = {
  'Source code': {
    textStyle: { fontFamily: 'Courier New', fontSizePt: 10, foregroundColor: '#202124' },
    paragraphStyle: {
      shadingColor: '#f1f3f4', spaceAbovePt: 6, spaceBelowPt: 6, lineSpacing: 100,
      borderTop: { color: '#dadce0', widthPt: 1, paddingPt: 6, dashStyle: 'SOLID' },
      borderBottom: { color: '#dadce0', widthPt: 1, paddingPt: 6, dashStyle: 'SOLID' },
      borderLeft: { color: '#dadce0', widthPt: 1, paddingPt: 6, dashStyle: 'SOLID' },
      borderRight: { color: '#dadce0', widthPt: 1, paddingPt: 6, dashStyle: 'SOLID' }
    }
  },
  'Inline code': {
    textStyle: {
      fontFamily: 'Courier New', fontSizePt: 10,
      foregroundColor: '#b31412', backgroundColor: '#f1f3f4'
    },
    paragraphStyle: {}
  },
  'Block quote': {
    textStyle: { italic: true, foregroundColor: '#5f6368' },
    paragraphStyle: {
      indentStartPt: 36, indentEndPt: 36, spaceAbovePt: 6, spaceBelowPt: 6,
      borderLeft: { color: '#dadce0', widthPt: 3, paddingPt: 8, dashStyle: 'SOLID' }
    }
  },
  'Caption': {
    textStyle: { italic: true, fontSizePt: 9, foregroundColor: '#5f6368' },
    paragraphStyle: { alignment: 'CENTER', spaceAbovePt: 2, spaceBelowPt: 10 }
  }
};

/**
 * Put the defaults in place once, the first time the list is read.
 *
 * The test is whether the property exists at all, not whether it holds any
 * styles: a user who deletes every default leaves an empty object behind,
 * and that has to stay empty rather than being refilled on the next read.
 */
function seedStylePresets_() {
  var props = PropertiesService.getUserProperties();
  if (props.getProperty(STYLE_PRESET_STORE_KEY) !== null) return;
  writeStore_(STYLE_PRESET_STORE_KEY, JSON.parse(JSON.stringify(DEFAULT_STYLE_PRESETS)));
}

function listStylePresets() {
  seedStylePresets_();
  var store = readStore_(STYLE_PRESET_STORE_KEY);
  return Object.keys(store).sort().map(function (name) {
    return {
      name: name,
      textStyle: store[name].textStyle || {},
      paragraphStyle: store[name].paragraphStyle || {}
    };
  });
}

/** payload: { name, textStyle, paragraphStyle } */
function saveStylePreset(payload) {
  var name = String((payload || {}).name || '').trim();
  if (!name) throw new Error('Give the style a name.');
  var store = readStore_(STYLE_PRESET_STORE_KEY);
  store[name] = {
    textStyle: payload.textStyle || {},
    paragraphStyle: payload.paragraphStyle || {}
  };
  writeStore_(STYLE_PRESET_STORE_KEY, store);
  return { saved: name };
}

function deleteStylePreset(payload) {
  var store = readStore_(STYLE_PRESET_STORE_KEY);
  delete store[(payload || {}).name];
  writeStore_(STYLE_PRESET_STORE_KEY, store);
  return { remaining: Object.keys(store).length };
}

/** payload: { from, to } */
function renameStylePreset(payload) {
  return renameInStore_(STYLE_PRESET_STORE_KEY, payload);
}

/**
 * A rename is a re-key: the value under `from` moves to `to`. Renaming to the
 * name it already has is a no-op, not a collision; renaming onto an occupied
 * name is refused rather than silently replacing the other style.
 */
function renameInStore_(key, payload) {
  payload = payload || {};
  var from = String(payload.from || '');
  var to = String(payload.to || '').trim();
  if (!from) throw new Error('Nothing to rename.');
  if (!to) throw new Error('Give it a name.');
  var store = readStore_(key);
  if (!store[from]) throw new Error('No preset named "' + from + '".');
  if (to !== from && store[to]) throw new Error('A preset named "' + to + '" already exists.');
  store[to] = store[from];
  delete store[from];
  writeStore_(key, store);
  return { renamed: to };
}

/**
 * Bind a saved style preset to one of the nine named styles, which is what
 * puts it on the Docs Styles menu.
 *
 * payload: { name, namedStyleType, tabId, scope }
 */
function applyStylePresetToNamedStyle(payload) {
  var store = readStore_(STYLE_PRESET_STORE_KEY);
  var preset = store[(payload || {}).name];
  if (!preset) throw new Error('No style preset named "' + (payload || {}).name + '".');
  return writeNamedStyle({
    tabId: payload.tabId,
    scope: payload.scope,
    namedStyleType: payload.namedStyleType,
    textStyle: preset.textStyle,
    paragraphStyle: preset.paragraphStyle
  });
}

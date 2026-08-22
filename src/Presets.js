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
 */

var PRESET_STORE_KEY = 'gdocFormatConfig.presets';
var STYLE_PRESET_STORE_KEY = 'gdocFormatConfig.stylePresets';

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

/* ---------------- Individual style presets ---------------- */

function listStylePresets() {
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

/**
 * Unit conversion and primitive value mapping.
 *
 * The Docs API only ever accepts Dimension.unit === 'PT' (the discovery
 * document's Dimension.unit enum is UNIT_UNSPECIFIED | PT). Every inch /
 * cm / mm value the user types is therefore converted to points here, and
 * converted back for display. Points are the single internal currency.
 */

var UNIT_TO_PT = {
  PT: 1,
  IN: 72,
  CM: 72 / 2.54,   // 28.346456692913385
  MM: 72 / 25.4    // 2.8346456692913385
};

var SUPPORTED_UNITS = ['PT', 'IN', 'CM', 'MM'];

function unitFactor_(unit) {
  var f = UNIT_TO_PT[String(unit || 'PT').toUpperCase()];
  if (!f) throw new Error('Unsupported unit: ' + unit + ' (expected one of ' + SUPPORTED_UNITS.join(', ') + ')');
  return f;
}

/** Convert a magnitude expressed in `unit` into points. */
function toPt_(magnitude, unit) {
  if (magnitude === null || magnitude === undefined || magnitude === '') return null;
  var n = Number(magnitude);
  if (!isFinite(n)) throw new Error('Not a number: ' + magnitude);
  return n * unitFactor_(unit);
}

/** Convert points into `unit`, rounded to `places` decimals (default 4). */
function fromPt_(pt, unit, places) {
  if (pt === null || pt === undefined) return null;
  var v = Number(pt) / unitFactor_(unit);
  var p = (places === undefined) ? 4 : places;
  return Math.round(v * Math.pow(10, p)) / Math.pow(10, p);
}

/** Build a Docs API Dimension from a value already in points. */
function ptDim_(pt) {
  if (pt === null || pt === undefined || pt === '') return null;
  var n = Number(pt);
  if (!isFinite(n)) return null;
  return { magnitude: n, unit: 'PT' };
}

/** Read a Docs API Dimension back out as points (null when unset). */
function dimPt_(dim) {
  if (!dim || dim.magnitude === null || dim.magnitude === undefined) return null;
  return Number(dim.magnitude);
}

/**
 * RgbColor -> '#rrggbb'.
 * Note: RgbColor is a proto3 message, so channels equal to 0 are omitted
 * from the JSON entirely. A missing channel means 0, not "unset".
 */
function colorToHex_(optionalColor) {
  if (!optionalColor || !optionalColor.color || !optionalColor.color.rgbColor) return null;
  var c = optionalColor.color.rgbColor;
  function ch(v) {
    var n = Math.round((Number(v) || 0) * 255);
    n = Math.max(0, Math.min(255, n));
    return ('0' + n.toString(16)).slice(-2);
  }
  return '#' + ch(c.red) + ch(c.green) + ch(c.blue);
}

/**
 * '#rrggbb' -> OptionalColor. The empty string / null maps to an empty
 * OptionalColor, which the API interprets as fully transparent.
 */
function hexToColor_(hex) {
  if (!hex) return {};
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error('Not a #rrggbb colour: ' + hex);
  var n = parseInt(m[1], 16);
  return {
    color: {
      rgbColor: {
        red: ((n >> 16) & 255) / 255,
        green: ((n >> 8) & 255) / 255,
        blue: (n & 255) / 255
      }
    }
  };
}

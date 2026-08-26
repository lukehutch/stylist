/**
 * Make a fixture look the way the Docs API actually answers.
 *
 * The fixtures are written by hand, so they spell out every value. A real
 * response does not: the Docs API speaks proto3 JSON, and proto3 leaves out
 * any field that holds its type's default. In practice that means a document
 * arrives missing most of what the fixtures state outright --
 *
 *   startIndex: 0                 is absent, on the first element of every
 *                                 body, header, footer and footnote
 *   { magnitude: 0, unit: 'PT' }  arrives as { unit: 'PT' }
 *   { magnitude: 0 }              arrives as {}
 *   bold: false                   is absent
 *   red: 0                        is absent from an rgbColor, so black is
 *                                 {} and pure blue is { blue: 1 }
 *   'GLYPH_TYPE_UNSPECIFIED'      is absent, being the enum's zero
 *   []                            is absent
 *
 * -- and every one of those is a place where reading code can mistake a real
 * zero for "not set". That is not hypothetical: dimPt_ did exactly that, and
 * turned a zero border width into a null Dimension that Google rejected.
 *
 * A message that IS set but holds nothing but defaults still serializes as
 * {}, which is why empty objects are kept while empty arrays are dropped.
 */

/** The enum zero is always the _UNSPECIFIED member, and is never sent. */
function isUnspecifiedEnum(v) {
  return typeof v === 'string' && /_UNSPECIFIED$/.test(v);
}

function isDefault(v) {
  return v === 0 || v === false || v === '' || isUnspecifiedEnum(v) ||
    (Array.isArray(v) && v.length === 0);
}

/**
 * A copy with every default-valued field left out, as the wire would.
 * Anything a test needs kept regardless goes in `keep` -- documentId and
 * title are not proto3 messages in any interesting sense, and dropping an
 * empty tab list would just confuse the tab tests.
 */
function protoize(node, keep) {
  keep = keep || new Set(['documentId', 'title']);
  if (Array.isArray(node)) return node.map((v) => protoize(v, keep));
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  Object.keys(node).forEach((k) => {
    const v = node[k];
    if (v === undefined) return;
    if (!keep.has(k) && isDefault(v)) return;
    out[k] = protoize(v, keep);
  });
  return out;
}

module.exports = { protoize, isDefault };

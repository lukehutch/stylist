/**
 * What the Docs API would refuse, checked without the Docs API.
 *
 * The mock batchUpdate records requests and answers "fine" to all of them,
 * so for a long time the only thing standing between a malformed request and
 * a user was the live suite -- which needs a network, a quota and a real
 * document, and so is not what runs on every change. A zero-width border
 * went out for months as "width": null, which Google rejects outright.
 *
 * This is not a reimplementation of Google Docs, and is not trying to be.
 * It is the handful of rules that hold for *every* request, whatever the
 * request does, each one written because getting it wrong is silent:
 *
 *   - a null where a message belongs. The API decodes it as the message's
 *     default, so a null Dimension becomes UNIT_UNSPECIFIED and the whole
 *     batch is rejected.
 *   - a Dimension without a usable unit, however it got that way.
 *   - a field set in the payload that the field mask does not name. The API
 *     ignores it silently: no error, no change, no way to tell from the
 *     outside that the edit did nothing.
 *   - a range that is empty or backwards, or an index below zero.
 *   - a colour channel outside 0..1, which is rejected rather than clamped.
 *
 * Everything else -- whether a style may hold that value, whether an index
 * exists in the document -- is the live suite's job, and stays there.
 */

/** Field masks are relative to this sibling; the rest identify the target. */
const NOT_THE_PAYLOAD = new Set([
  'fields', 'range', 'tabId', 'segmentId', 'objectId',
  'tableStartLocation', 'tableCellLocation', 'tableRange', 'location',
  'endOfSegmentLocation', 'columnIndices', 'rowIndices',
  'sectionBreakLocation', 'footnoteId', 'headerId', 'footerId'
]);

/**
 * Masks name these as one unit. Descending into them would demand
 * "weightedFontFamily.weight" in a mask, which the API does not want.
 */
const DESCEND_INTO = new Set(['textStyle', 'paragraphStyle', 'documentStyle',
  'sectionStyle', 'tableCellStyle', 'tableRowStyle', 'tableColumnProperties']);

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Walk every value in a request, path included, so errors can point at one. */
function walk(node, path, visit) {
  visit(node, path);
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, path + '[' + i + ']', visit));
  } else if (isObj(node)) {
    Object.keys(node).forEach((k) => walk(node[k], path ? path + '.' + k : k, visit));
  }
}

/**
 * The paths a mask has to name: every field that carries a value, stopping
 * at whatever the mask treats as one unit.
 */
function setPaths(node, prefix, out) {
  Object.keys(node || {}).forEach((k) => {
    const v = node[k];
    if (v === undefined) return;
    const p = prefix ? prefix + '.' + k : k;
    if (DESCEND_INTO.has(k) && isObj(v)) setPaths(v, p, out);
    else out.push(p);
  });
  return out;
}

/**
 * A mask may name the field itself, an ancestor of it (replace the whole
 * message), or a field inside it (replace just that part). Only a mask that
 * mentions the field nowhere at all leaves it silently ignored.
 */
function maskCovers(mask, path) {
  return mask.some((m) => m === path ||
    path.indexOf(m + '.') === 0 || m.indexOf(path + '.') === 0);
}

function checkOne(req, errs) {
  if (!isObj(req)) {
    errs.push('a request is ' + (req === null ? 'null' : typeof req) +
      ', not an object');
    return;
  }
  const kinds = Object.keys(req);
  if (kinds.length !== 1) {
    errs.push('a request names ' + kinds.length + ' operations (' +
      kinds.join(', ') + '); the API takes exactly one');
    return;
  }
  const kind = kinds[0];
  const body = req[kind];
  const at = (p) => kind + (p ? '.' + p : '');

  walk(body, '', (v, p) => {
    if (v === null) {
      errs.push(at(p) + ' is null; the API reads that as the field\'s default ' +
        '(a null Dimension becomes UNIT_UNSPECIFIED) and rejects the batch');
      return;
    }
    if (!isObj(v)) return;

    // A Dimension, wherever it turns up and whatever the field is called.
    if ('magnitude' in v || (Object.keys(v).length === 1 && 'unit' in v)) {
      if (v.unit !== 'PT') {
        errs.push(at(p) + ' has unit ' + JSON.stringify(v.unit) +
          '; the API accepts PT only');
      }
      if ('magnitude' in v && typeof v.magnitude !== 'number') {
        errs.push(at(p) + '.magnitude is ' + JSON.stringify(v.magnitude) +
          ', not a number');
      } else if ('magnitude' in v && !isFinite(v.magnitude)) {
        errs.push(at(p) + '.magnitude is ' + v.magnitude);
      }
    }

    if ('rgbColor' in v && isObj(v.rgbColor)) {
      ['red', 'green', 'blue'].forEach((ch) => {
        const c = v.rgbColor[ch];
        if (c === undefined) return;   // proto3 leaves out a zero channel
        if (typeof c !== 'number' || c < 0 || c > 1) {
          errs.push(at(p) + '.rgbColor.' + ch + ' is ' + JSON.stringify(c) +
            '; channels run 0..1');
        }
      });
    }

    // Ranges, by shape rather than by name: several requests carry one under
    // a field of their own.
    if ('startIndex' in v && 'endIndex' in v) {
      if (v.startIndex < 0) errs.push(at(p) + '.startIndex is ' + v.startIndex);
      if (v.endIndex < v.startIndex) {
        errs.push(at(p) + ' runs backwards: [' + v.startIndex + ', ' +
          v.endIndex + ')');
      } else if (v.endIndex === v.startIndex && kind !== 'updateSectionStyle') {
        // updateSectionStyle is the exception: its range only has to overlap
        // the section, and a zero-width range at the section break's own
        // index picks out that section and no other. Every other request
        // takes a range of content, and an empty one edits nothing.
        errs.push(at(p) + ' is empty: [' + v.startIndex + ', ' +
          v.endIndex + '), so the request changes nothing');
      }
    }
  });

  if (typeof body.fields === 'string') {
    const mask = body.fields.split(',').map((s) => s.trim()).filter(Boolean);
    if (!mask.length) {
      errs.push(at('fields') + ' is empty, so the request changes nothing');
    }
    const payloadKey = Object.keys(body).filter((k) => !NOT_THE_PAYLOAD.has(k) &&
      isObj(body[k]));
    payloadKey.forEach((k) => {
      // A mask is always relative to the message it accompanies:
      // updateParagraphStyle names "alignment", and updateNamedStyle names
      // "textStyle.bold" because textStyle sits inside namedStyle.
      const paths = setPaths(body[k], '', []);
      paths.forEach((p) => {
        if (!maskCovers(mask, p)) {
          errs.push(at(k) + ' sets ' + p + ' but ' + at('fields') +
            ' does not name it, so the API will ignore it without saying so');
        }
      });
    });
  }
}

/** Every rule broken by these requests, as sentences. */
function checkRequests(requests) {
  const errs = [];
  if (!Array.isArray(requests)) {
    return ['batchUpdate was given ' + JSON.stringify(requests) +
      ', not an array of requests'];
  }
  if (!requests.length) errs.push('batchUpdate was given no requests at all');
  requests.forEach((r) => checkOne(r, errs));
  return errs;
}

module.exports = { checkRequests };

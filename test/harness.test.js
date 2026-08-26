/**
 * The test harness, tested.
 *
 * apicheck, proto3 and apply are now load-bearing: every other suite trusts
 * them. A validator that waves everything through is worse than none, because
 * it looks like coverage; a fixture transform that drops the wrong field
 * makes every read test a lie. So each rule is checked in both directions --
 * that it fires on what it is for, and that it stays quiet on what it is not.
 */
const { checkRequests } = require('./apicheck');
const { protoize } = require('./proto3');
const { applyRequests, applyMask } = require('./apply');
const { makeSandbox, allRequests } = require('./harness');
const { makeDoc, makeLiveLikeDoc } = require('./fixture');

const pt = (n) => ({ magnitude: n, unit: 'PT' });

module.exports = ({ suite, test }) => {

/* ------------------------------------------------------------------ */
suite('Harness: what the API would refuse');

/** The shape of a request that breaks no rule, to vary one field at a time. */
const goodStyle = () => ({
  updateParagraphStyle: {
    paragraphStyle: { alignment: 'CENTER', spaceAbove: pt(6) },
    range: { startIndex: 1, endIndex: 10 },
    fields: 'alignment,spaceAbove'
  }
});

test('a request that breaks no rule is passed', (t) => {
  t.deepEqual(checkRequests([goodStyle()]), []);
});

test('a null Dimension is refused, wherever it sits', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.spaceAbove = null;
  const errs = checkRequests([r]);
  t.equal(errs.length, 1, errs.join('; '));
  t.match(errs[0], /spaceAbove is null/);
  t.match(errs[0], /UNIT_UNSPECIFIED/, 'and says why it matters');
});

test('a null deeper inside a message is refused too', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.borderTop =
    { color: {}, width: null, padding: pt(0), dashStyle: 'SOLID' };
  r.updateParagraphStyle.fields += ',borderTop';
  t.match(checkRequests([r]).join('; '), /borderTop\.width is null/);
});

test('a Dimension with no unit, or the wrong one, is refused', (t) => {
  [{ magnitude: 6 }, { magnitude: 6, unit: 'UNIT_UNSPECIFIED' },
   { magnitude: 6, unit: 'IN' }].forEach((dim) => {
    const r = goodStyle();
    r.updateParagraphStyle.paragraphStyle.spaceAbove = dim;
    t.match(checkRequests([r]).join('; '), /accepts PT only/,
      JSON.stringify(dim) + ' should be refused');
  });
});

test('a Dimension of zero points is fine', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.spaceAbove = pt(0);
  t.deepEqual(checkRequests([r]), [], 'zero is a value, not an absence');
});

test('a magnitude that is not a finite number is refused', (t) => {
  ['6', NaN, Infinity].forEach((m) => {
    const r = goodStyle();
    r.updateParagraphStyle.paragraphStyle.spaceAbove = { magnitude: m, unit: 'PT' };
    t.ok(checkRequests([r]).length, String(m) + ' should be refused');
  });
});

test('a field set but not named in the mask is refused', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.lineSpacing = 150;
  const errs = checkRequests([r]);
  t.match(errs.join('; '), /sets lineSpacing but/);
  t.match(errs.join('; '), /ignore it without saying so/,
    'the point being that the API does this in silence');
});

test('a mask may name a field that carries no value', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.fields += ',indentStart';
  t.deepEqual(checkRequests([r]), [],
    'naming a field with nothing behind it is how a reset is asked for');
});

test('a mask may name a field deeper than the one set', (t) => {
  t.deepEqual(checkRequests([{
    updateDocumentStyle: {
      documentStyle: { documentFormat: { documentMode: 'PAGELESS' } },
      fields: 'documentFormat.documentMode'
    }
  }]), [], 'which is how one sub-field is replaced without the rest');
});

test('a mask relative to namedStyle is read relative to namedStyle', (t) => {
  t.deepEqual(checkRequests([{
    updateNamedStyle: {
      namedStyle: { namedStyleType: 'NORMAL_TEXT', textStyle: { bold: true } },
      fields: 'namedStyleType,textStyle,textStyle.bold'
    }
  }]), []);
});

test('what identifies the target is not mistaken for the payload', (t) => {
  // tableRange says which cells; it is not something the mask should name.
  t.deepEqual(checkRequests([{
    updateTableCellStyle: {
      tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 1 } } } },
      tableRange: {
        tableCellLocation: { tableStartLocation: { index: 70 }, rowIndex: 0, columnIndex: 0 },
        rowSpan: 1, columnSpan: 3
      },
      fields: 'backgroundColor'
    }
  }]), []);
});

test('an empty range is refused, and a backwards one', (t) => {
  const empty = goodStyle();
  empty.updateParagraphStyle.range = { startIndex: 5, endIndex: 5 };
  t.match(checkRequests([empty]).join('; '), /is empty/);

  const back = goodStyle();
  back.updateParagraphStyle.range = { startIndex: 9, endIndex: 4 };
  t.match(checkRequests([back]).join('; '), /runs backwards/);

  const below = goodStyle();
  below.updateParagraphStyle.range = { startIndex: -1, endIndex: 4 };
  t.match(checkRequests([below]).join('; '), /startIndex is -1/);
});

test('updateSectionStyle is the one request an empty range suits', (t) => {
  t.deepEqual(checkRequests([{
    updateSectionStyle: {
      sectionStyle: { marginTop: pt(90) },
      range: { startIndex: 17, endIndex: 17 },
      fields: 'marginTop'
    }
  }]), [], 'a zero-width range picks out the section it sits on');
});

test('a colour channel outside 0..1 is refused', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.shading =
    { backgroundColor: { color: { rgbColor: { red: 255 } } } };
  r.updateParagraphStyle.fields += ',shading';
  t.match(checkRequests([r]).join('; '), /channels run 0\.\.1/);
});

test('a missing colour channel is black, not an error', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.shading =
    { backgroundColor: { color: { rgbColor: { blue: 1 } } } };
  r.updateParagraphStyle.fields += ',shading';
  t.deepEqual(checkRequests([r]), [], 'proto3 leaves a zero channel out');
});

test('a batch with no requests, or a request with no operation, is refused', (t) => {
  t.match(checkRequests([]).join('; '), /no requests at all/);
  t.match(checkRequests([{}]).join('; '), /names 0 operations/);
  t.match(checkRequests([{ a: 1, b: 2 }]).join('; '), /names 2 operations/);
  t.match(checkRequests([null]).join('; '), /is null/);
  t.match(checkRequests('nope').join('; '), /not an array/);
});

test('an empty field mask is refused', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.fields = '';
  t.match(checkRequests([r]).join('; '), /changes nothing/);
});

test('every rule is reported, not just the first', (t) => {
  const r = goodStyle();
  r.updateParagraphStyle.paragraphStyle.spaceAbove = null;
  r.updateParagraphStyle.paragraphStyle.spaceBelow = { magnitude: 3 };
  r.updateParagraphStyle.range = { startIndex: 5, endIndex: 5 };
  t.ok(checkRequests([r]).length >= 3, 'one run should show every problem');
});

/* ------------------------------------------------------------------ */
suite('Harness: the shape the API actually sends');

test('proto3 leaves out every default', (t) => {
  t.deepEqual(protoize({
    startIndex: 0, endIndex: 5, bold: false, italic: true, name: '',
    glyphType: 'GLYPH_TYPE_UNSPECIFIED', alignment: 'CENTER',
    columnProperties: [], magnitude: 0, unit: 'PT'
  }), { endIndex: 5, italic: true, alignment: 'CENTER', unit: 'PT' });
});

test('a message set to nothing but defaults still arrives, as {}', (t) => {
  t.deepEqual(protoize({ borderTop: { width: pt(0), color: {} } }),
    { borderTop: { width: { unit: 'PT' }, color: {} } },
    'which is why an empty object is kept and an empty array is not');
});

test('black is an empty rgbColor', (t) => {
  t.deepEqual(protoize({ rgbColor: { red: 0, green: 0, blue: 0 } }), { rgbColor: {} });
  t.deepEqual(protoize({ rgbColor: { red: 0, green: 0, blue: 1 } }), { rgbColor: { blue: 1 } });
});

test('documentId and title survive being empty', (t) => {
  t.deepEqual(protoize({ documentId: '', title: '', other: '' }),
    { documentId: '', title: '' }, 'tests name them, so they are kept');
});

test('the sandbox serves a document in that shape', (t) => {
  const S = makeSandbox(makeDoc());
  const tab = S.fetchDoc_().tabs[0].documentTab;
  t.equal(tab.body.content[0].startIndex, undefined,
    'the first element of a body has no startIndex');
  t.deepEqual(tab.namedStyles.styles[0].textStyle.foregroundColor.color.rgbColor, {},
    'and black is empty');
  t.equal(tab.namedStyles.styles[0].paragraphStyle.borderTop.width.magnitude, undefined,
    'and a zero border width has no magnitude');
});

test('every read still works on a document in that shape', (t) => {
  const S = makeSandbox(makeLiveLikeDoc());
  const all = S.loadAll('t.0');
  t.ok(all.pageFormat.marginTopPt > 0, 'margins read');
  t.equal(all.namedStyles[0].textStyle.fontFamily, 'Arial', 'fonts read');
  t.ok(all.lists.lists.length, 'lists read');
  t.ok(all.segments.headers.length, 'headers read');
});

/* ------------------------------------------------------------------ */
suite('Harness: writes that actually land');

test('a mask copies exactly what it names, and nothing else', (t) => {
  const target = { alignment: 'START', lineSpacing: 100 };
  applyMask(target, { alignment: 'CENTER', lineSpacing: 150 }, 'alignment');
  t.deepEqual(target, { alignment: 'CENTER', lineSpacing: 100 },
    'lineSpacing was sent but not named, so it did not move');
});

test('a mask naming a field with no value clears it', (t) => {
  const target = { spaceAbove: pt(12) };
  applyMask(target, {}, 'spaceAbove');
  t.deepEqual(target, {}, 'which is how a reset to the inherited value is asked for');
});

test('a mask reaches into nested messages', (t) => {
  const target = { documentFormat: { documentMode: 'PAGES', other: 1 } };
  applyMask(target, { documentFormat: { documentMode: 'PAGELESS' } },
    'documentFormat.documentMode');
  t.deepEqual(target, { documentFormat: { documentMode: 'PAGELESS', other: 1 } });
});

test('a write is visible to the next read', (t) => {
  const S = makeSandbox(makeDoc());
  S.writePageFormat({ tabId: 't.0', marginLeftPt: 90 });
  t.near(S.readPageFormat('t.0').marginLeftPt, 90, 1e-6);
});

test('a field the mask forgets does not land, exactly as in production', (t) => {
  const S = makeSandbox(makeDoc());
  const before = S.readPageFormat('t.0').marginLeftPt;
  S.batchUpdate_([{
    updateDocumentStyle: {
      // marginLeft is sent, and named nowhere. The API ignores it silently.
      documentStyle: { marginLeft: pt(200), marginRight: pt(200) },
      fields: 'marginLeft,marginRight',
      tabId: 't.0'
    }
  }]);
  t.near(S.readPageFormat('t.0').marginLeftPt, 200, 1e-6, 'named, so applied');
  const T = makeSandbox(makeDoc(), { lax: true });
  T.batchUpdate_([{
    updateDocumentStyle: {
      documentStyle: { marginLeft: pt(200) }, fields: 'marginRight', tabId: 't.0'
    }
  }]);
  t.near(T.readPageFormat('t.0').marginLeftPt, before, 1e-6,
    'not named, so not applied -- the request succeeds and nothing happens');
});

test('a content edit is recorded but not applied, and says so', (t) => {
  const S = makeSandbox(makeDoc(), { lax: true });
  S.batchUpdate_([{ insertText: { text: 'hello', location: { index: 1 } } }]);
  t.deepEqual(S.__skipped, ['insertText'],
    'index arithmetic is the live suite\'s job, and this says which requests need it');
  t.equal(allRequests(S).length, 1, 'it is still recorded');
});

test('a malformed request throws instead of being recorded as fine', (t) => {
  const S = makeSandbox(makeDoc());
  t.throws(() => S.batchUpdate_([{
    updateParagraphStyle: {
      paragraphStyle: { spaceAbove: null },
      range: { startIndex: 1, endIndex: 5 },
      fields: 'spaceAbove'
    }
  }]), /would reject this batch/);
});

test('lax turns the checking off for tests whose subject is a bad request', (t) => {
  const S = makeSandbox(makeDoc(), { lax: true });
  S.batchUpdate_([{ updateParagraphStyle: {
    paragraphStyle: { spaceAbove: null },
    range: { startIndex: 1, endIndex: 5 }, fields: 'spaceAbove' } }]);
  t.equal(allRequests(S).length, 1, 'recorded without complaint');
});

test('one sandbox does not write into another', (t) => {
  const A = makeSandbox(makeDoc());
  const B = makeSandbox(makeDoc());
  A.writePageFormat({ tabId: 't.0', marginLeftPt: 200 });
  t.near(B.readPageFormat('t.0').marginLeftPt, 72, 1e-6,
    'the fixture factory is shared; the document must not be');
});

};

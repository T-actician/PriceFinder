// Regression tests: every search that ever went wrong, as (query, title) -> expected match.
// Run: npm test   (no network needed)
const assert = require('assert');
const { analyze, shopQueries, variationRow } = require('../src/search');

const OK = ['exact', 'near'];
const cases = [
  // [query, title, shouldBeShown]
  ['Hdpe Pipe 75Mm Pn10 Roll', 'HDPE ROLL PN 10 at Best Price in KENYA', true],
  ['Hdpe Pipe 75Mm Pn10 Roll', 'HDPE PRESSURE PIPE - PN10', true],
  ['Hdpe Pipe 75Mm Pn10 Roll', 'Danco HDPE Pipe 75mm PN10 - 100 metres - ConstructionHub', true],
  ['Hdpe Pipe 40Mm Pn10 100M Roll', 'HDPE PIPE 40MM ROLL(PN10)', true],
  ['Gi Stand Pipe ¾ 3Ft L/G', 'GI Stand 3ft x 3/4', true],
  ['Gi Pipe 2.5"', 'Galvanized Iron-GI Pipe 21/2', true],
  ['Gi Pipe 2.5"', 'GI Pipe 2 1/2" Heavy', true],
  ['Gi Pipe 2.5"', 'Galvanised Pipe - Class B (Medium)', true],
  ['Gi Pipe 2.5"', 'GI Pipe 1 1/2"', false],
  ['Gi Pipe 2.5"', 'GI Pipe 1/2 inch', false],
  ['Furniture Pipe 3/4 16G', 'Furniture Pipe 3/4" 16G', true],
  ['Furniture Pipe 3/4 16G', 'FURNITURE PIPE 3/4 X 16G X 6M', true],
  ['Furniture Pipe 3/4 16G', 'Furniture Pipe 3/4", 16 Gauge', true],
  ['Furniture Pipe 3/4 16G', 'Furniture pipe 19mm 16G', true],
  ['Furniture Pipe 3/4 16G', 'Furniture Pipe 1/2 16G', false],
  ['Reducer 3/4 1/2', 'Reducer 3/4 x 1/2 brass', true],
  ['Ingco drill 13mm', 'Bosch drill 13mm', false],
  ['Zebra hose pipe 1 inch', 'Zebra pipe fitting 1 inch', false],
];
let fail = 0;
for (const [q, t, want] of cases) {
  const a = analyze(q, t, '', 'shop.co.ke'), got = OK.includes(a.match);
  if (got !== want) { fail++; console.error(`FAIL  "${q}" vs "${t}" -> ${a.match} (${a.reason || ''}), expected ${want ? 'shown' : 'hidden'}`); }
}
// the shop searches must include short distinctive queries, not only the full title
assert(shopQueries('Hdpe Pipe 75Mm Pn10 Roll').some(x => /^hdpe roll$/i.test(x)), 'missing "Hdpe Roll" query');
assert(shopQueries('Gi Pipe 2.5"').some(x => /2 1\/2/.test(x)), 'missing alternate size spelling');
// size dropdowns: pick the right size, in mm or inches
const mk = vs => `<form data-product_variations='${JSON.stringify(vs)}'></form>`;
const v1 = variationRow(mk([{ attributes: { s: '63mm', p: 'PN10' }, display_price: 9000 }, { attributes: { s: '75mm', p: 'PN10' }, display_price: 12500 }]), 'Hdpe Pipe 75Mm Pn10');
assert.strictEqual(v1 && v1.money.value, 12500, 'mm variation');
const v2 = variationRow(mk([{ attributes: { s: '1/2"' }, display_price: 500 }, { attributes: { s: '2 1/2"' }, display_price: 13000 }]), 'Gi Pipe 2.5"');
assert.strictEqual(v2 && v2.money.value, 13000, 'inch variation');
if (fail) { console.error(fail + ' matching case(s) failed'); process.exit(1); }
console.log('All ' + cases.length + ' matching cases + queries + variations passed.');

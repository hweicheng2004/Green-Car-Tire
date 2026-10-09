// A real shop workbook's layout (made-up values): several tire tabs, a status column with sold rows, "Type" that
// isn't the season, "Brand + Model" in one column, a purchasing price, and wheels as "18/5x112/66.6" in one cell.
import assert from 'node:assert/strict';
import { cleanTab } from '../lib/inventory-sync';
import { autoMap, parseQty, parseTireSize, parseWheelSpec, splitBrandModel } from '../lib/inventory-clean';
import { suggestTabs } from '../components/import/read-sheet';

const USED = [
  ['Column 1', 'Brand', 'Size', 'Qty', 'Type', 'DOT Year', 'R17', 'Area', 'Location', 'Status', 'Season', 'Notes', 'Date Sold'],
  ['INV-1', 'Yoklohoma', '225/45R18', '4', 'Set', '2021', 'NYK3', 'Left', 'Left Front', 'Available', 'Winter', '', ''],
  ['INV-2', 'Pireli', '235/55R19', '2', 'Pair', '2022', 'NYK1', 'Right', 'Right Back', 'Sold', 'A/S', '', '9/14/2026'],
  ['INV-3', 'Michelin', '205/55R16', '2 + 2', 'Set', '2024', 'NYK2', 'Left', 'Left Back', 'Reserved', 'A/S', 'For Sam', ''],
  ['INV-4', 'Winrun', '', '4', 'Set', '2023', 'NYK1', 'Right', 'Right Back', 'Status Unknown', 'A/S', '', ''],
];
const NEW = [
  ['Inventory #', 'Part #', 'Brand + Model', 'Size', 'Qty', 'PO #', 'Price Per Unit', 'Invoice #', 'Date of Delivery', 'Supplier', 'Location', 'Area', 'Status', 'Notes'],
  ['NT-1', '8293', 'Bridgestone Blizzak Icepeak', '235/60R18 107H XL', '4', 'PO1', '184.41', '9963', '8/20/2026', 'Dttire', 'Garage', 'D2', 'Available', ''],
  ['NT-2', '1', 'Continental Vikingcontact 8', '265,40R18 95H XL', '4', 'PO2', '212', '1', '8/21/2026', 'Dttire', '', '', 'Returned', ''],
  ['NT-3', '2', 'Lanvigator', '225/45R18', '1/2/26', 'PO3', '', '1', '8/22/2026', 'Stox', 'Garage', 'A2', 'Available', ''],
];
const ALLOY = [
  ['Inventory ID', 'Brand/Style', 'Size / Bolt Pattern / Hub Bore', 'Type', 'Color', 'Quantity', 'Container', 'Area', 'Shelf/Location', 'Status', 'Notes'],
  ['AR-1', 'Subaru', '17/5x100/56.1', 'Alloy Rim', 'Silver', '4', 'Red', 'B2', 'B2', 'Available', ''],
  ['AR-2', 'Generic', '18/5x108/114.3/72.62', 'New Alloy Rim', 'Black', '4', 'White', 'D3', 'Box', 'Available', ''],
  ['AR-3', 'Chevy', '17/5/120x67 cb', 'Alloy Rim', 'Silver', '2+2 Stag', 'Red', 'F2', 'F2', 'Available', ''],
  ['AR-4', 'BMW', '?/5x112/66.6', 'Alloy Rim', 'Black', '4', 'Red', 'H2', 'H2', 'Available', ''],
  ['AR-5', 'Kraze', '18/5x112/67', 'Alloy Rim', 'Black', '4', 'Red', 'C1', 'C1', 'Sold', ''],
];
const STEEL = [
  ['Inventory ID', 'Condition', 'Size / Bolt Pattern / Hub Bore', 'Type', 'Color', 'Quantity', 'Area', 'Shelf/Location', 'Status', 'Notes', 'Price Per Unit', 'Supplier'],
  ['SR-1', 'NOS', '15/4x100/58.1', 'Steel Rims', 'Black', '3', 'CRA - 12', '', 'Available', '', '', ''],
];

// columns
const m = autoMap(USED[0], 'tires');
assert.equal(USED[0][m.season], 'Season', '"Season" beats "Type"');
assert.equal(m.condition, undefined, '"Status" is not new/used');
assert.equal(USED[0][m.status], 'Status');
assert.equal(USED[0][m.dot], 'DOT Year');
const mn = autoMap(NEW[0], 'tires');
assert.equal(mn.dot, undefined, '"Date of Delivery" is not the DOT');
assert.equal(mn.price, undefined); assert.equal(NEW[0][mn.cost], 'Price Per Unit', 'a purchasing price is the cost, not the sell price');

// used tires: hint from the tab name, sold left out, location over two columns
const used = cleanTab('Used Tires', 'tires', USED).cleaned;
const ok = used.filter(c => c.row).map(c => c.row as any);
assert.deepEqual(ok.map(r => [r.tire_size, r.brand, r.condition, r.season, r.qty]), [
  ['225/45R18', 'Yokohama', 'used', 'W', 4], ['205/55R16', 'Michelin', 'used', 'AS', 4]]);
assert.equal(ok[0].location, 'Left · Left Front');
assert.match(ok[1].notes, /For Sam; Reserved/);
assert.ok(used.find(c => c.sourceRow === 3)!.skipped, 'sold row skipped, not an error');
assert.equal(used.filter(c => !c.row && !c.skipped).length, 1, 'only the row with no size is a problem');

// new tires: brand + model split, cost to notes, returned left out, a date in the qty column is an error
const nt = cleanTab('New tires', 'tires', NEW).cleaned;
const n1 = nt[0].row as any;
assert.deepEqual([n1.brand, n1.model, n1.season, n1.condition, n1.load_index, n1.is_xl, n1.price, n1.location], ['Bridgestone', 'Blizzak Icepeak', 'W', 'new', 107, true, null, 'Garage · D2']);
assert.match(n1.notes, /Cost \$184\.41/);
assert.ok(nt[1].skipped, 'returned');
assert.equal(nt[2].row, null); assert.ok(!nt[2].skipped);
assert.equal(parseTireSize('265,40R18 95H XL')?.size, '265/40R18');
assert.deepEqual([parseQty('2 + 2').qty, parseQty('2+2 Stag').qty, parseQty('1/2/26').ok], [4, 4, false]);
assert.deepEqual(splitBrandModel('Michellin X-Ice snow+'), { brand: 'Michelin', model: 'X-Ice snow+' });
assert.deepEqual(splitBrandModel('N/A'), { brand: null, model: null });

// wheels: the one-cell spec, dual drilled, new marked in Type, rest used, a "?" diameter is a problem
assert.deepEqual(parseWheelSpec('18/5x108/114.3/72.62'), { diameter: 18, width: null, bolts: ['5x108', '5x114.3'], cb: 72.6 });
assert.deepEqual(parseWheelSpec('18x9 8x180 124.2 MLT + 01'), { diameter: 18, width: 9, bolts: ['8x180'], cb: 124.2 });
assert.equal(parseWheelSpec('?/5x112/66.6'), null);
const al = cleanTab('Alloy RIMS', 'wheels', ALLOY);
assert.deepEqual(al.missing, []);
const w = al.cleaned.filter(c => c.row).map(c => c.row as any);
assert.deepEqual(w.map(x => [x.diameter, x.bolt_pattern, x.bolt_pattern_alt, x.center_bore, x.wheel_type, x.condition, x.qty]), [
  [17, '5x100', null, 56.1, 'alloy', 'used', 4], [18, '5x108', '5x114.3', 72.6, 'alloy', 'new', 4], [17, '5x120', null, 67, 'alloy', 'used', 4]]);
assert.equal(w[0].location, 'Red · B2');
assert.equal(al.cleaned.filter(c => !c.row && !c.skipped).length, 1, 'the "?" diameter');
const st = cleanTab('Steel rims', 'wheels', STEEL).cleaned[0].row as any;
assert.deepEqual([st.wheel_type, st.condition, st.diameter, st.bolt_pattern, st.center_bore], ['steel', 'new', 15, '4x100', 58.1]);

// which tabs /setup loads: stock tabs yes; a tab repeating another's rows, and reports, no
const sheets = [{ name: 'Used Tires', rows: USED }, { name: 'New tires', rows: NEW }, { name: 'Alloy RIMS', rows: ALLOY },
  { name: 'Winter packages', rows: USED.slice(0, 3) }, { name: 'Used tires copy', rows: USED }, { name: 'Process Log', rows: [['Timestamp', 'Size / Fitment', 'Qty'], ['x', '225/65R17', '4']] }];
assert.deepEqual(suggestTabs(sheets, 'tires').filter(t => t.on).map(t => t.name), ['Used Tires', 'New tires']);
assert.match(suggestTabs(sheets, 'tires').find(t => t.name === 'Used tires copy')!.why, /repeats rows from Used Tires/);
assert.deepEqual(suggestTabs(sheets, 'wheels').filter(t => t.on).map(t => t.name), ['Alloy RIMS']);
console.log('WORKBOOK TEST PASSED');

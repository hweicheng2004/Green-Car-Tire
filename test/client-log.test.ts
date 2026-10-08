import assert from 'node:assert/strict';
const sent: any[] = [];
(globalThis as any).fetch = (_u: string, o: any) => { sent.push(JSON.parse(o.body)); return Promise.resolve(); };
import { logSearch, flushSearch, _reset } from '../lib/log-search-client';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  _reset();
  // typing "18 outback" letter by letter: only the settled search is sent
  for (const q of ['1', '18', '18 o', '18 out', '18 outback']) logSearch({ kind: 'vehicle', query: q }, 50);
  await wait(80);
  assert.equal(sent.length, 1); assert.equal(sent[0].query, '18 outback');
  // Enter flushes immediately; the same search again is not duplicated
  logSearch({ kind: 'size', query: '225 65 17', tireSize: '225/65R17', exactInStock: 4 }, 5000); flushSearch();
  logSearch({ kind: 'size', query: '225/65R17', tireSize: '225/65R17', exactInStock: 4 }, 5000); flushSearch();
  assert.equal(sent.length, 2);
  console.log('CLIENT LOG TEST PASSED');
})();

// Google Sheets sync end to end: fake Sheets API, real (embedded) Postgres with migrations 003 + 004.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { parseDelimited } from '../lib/inventory-clean';
import { runSync, syncConfig, type SyncStore, type LastSync, type InventoryRow } from '../lib/inventory-sync';
import { sheetsClient, serviceAccount, type SheetsClient } from '../lib/google-sheets';
import { SAMPLE_TIRES, SAMPLE_WHEELS } from '../lib/sample-sheets';

const sql = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(sql('003_inventory.sql'));
await db.exec(sql('004_inventory_sync.sql'));

// Rows from the importer page, to prove the sync replaces them instead of duplicating.
await db.exec(`insert into tires (tire_size, section_width, aspect_ratio, rim_diameter, condition, qty, source)
               values ('205/55R16', 205, 55, 16, 'new', 3, 'Old import')`);

const store: SyncStore = {
  async lastSync(kind) {
    return ((await db.query<LastSync>(`select id, status, content_hash, message from inventory_syncs where kind = $1 order by id desc limit 1`, [kind])).rows[0]) ?? null;
  },
  async count(kind) { return (await db.query<{ n: number }>(`select count(*)::int n from ${kind}`)).rows[0].n; },
  async replace(kind, rows: InventoryRow[]) {
    return (await db.query<{ n: number }>(`select replace_inventory($1, $2::jsonb) n`, [kind, JSON.stringify(rows)])).rows[0].n;
  },
  async log(r) {
    await db.query(`insert into inventory_syncs (trigger, kind, tabs, status, rows_synced, qty_on_hand, rejected, warnings, content_hash, message)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.trigger, r.kind, r.tabs, r.status, r.rows_synced ?? null, r.qty_on_hand ?? null, r.rejected ?? null, r.warnings ?? null, r.content_hash ?? null, r.message ?? null]);
  },
  async touch(id) { await db.query(`update inventory_syncs set checked_at = now() where id = $1`, [id]); },
};

// Sheets API returns cells as strings and drops trailing blanks, like this.
const asSheet = (text: string) => parseDelimited(text).map(r => { const c = [...r]; while (c.length && !c[c.length - 1]) c.pop(); return c; });
const book: Record<string, string[][]> = { Tires: asSheet(SAMPLE_TIRES), Wheels: asSheet(SAMPLE_WHEELS), Notes: [['hi']] };
const written: Record<string, (string | number)[][]> = {};
let reads = 0;
const sheets = {
  email: 'sync@test.iam.gserviceaccount.com',
  async tabs() { return Object.keys(book); },
  async read(tabs: string[]) { reads++; return Object.fromEntries(tabs.map(t => [t, structuredClone(book[t])])); },
  async addTab(t: string) { book[t] = []; },
  async replaceTab(t: string, v: (string | number)[][]) { written[t] = v; book[t] = v.map(r => r.map(String)); },
} as unknown as SheetsClient;
const config = syncConfig({});
const count = async (t: string) => (await db.query<{ n: number; q: number }>(`select count(*)::int n, coalesce(sum(qty),0)::int q from ${t}`)).rows[0];
const logs = async () => (await db.query<{ n: number }>(`select count(*)::int n from inventory_syncs`)).rows[0].n;

// 1. First sync loads both tabs and replaces the old importer rows.
let r = await runSync({ sheets, store, config, trigger: 'cron' });
assert.deepEqual(r.kinds.map(k => [k.kind, k.status, k.rows, k.rejected]), [['tires', 'ok', 11, 2], ['wheels', 'ok', 7, 1]]);
assert.deepEqual(await count('tires'), { n: 11, q: 45 });
assert.equal((await count('wheels')).n, 7);
assert.equal((await db.query(`select 1 from tires where source = 'Old import'`)).rows.length, 0, 'importer rows replaced');
const row3 = (await db.query<{ tire_size: string; source: string; source_row: number; price: string; raw: Record<string, string> }>(
  `select tire_size, source, source_row, price, raw from tires where source_row = 3`)).rows[0];
assert.deepEqual([row3.tire_size, row3.source, row3.source_row, Number(row3.price), row3.raw.Brand], ['225/65R17', 'Tires tab', 3, 229, 'Michelin']);

// "Sync issues" tab: created, rejected rows first with their sheet row numbers.
assert.equal(r.issuesTab, 'written');
const iss = written['Sync issues'];
const head = iss.findIndex(l => l[0] === 'Tab');
assert.ok(head > 0);
const lines = iss.slice(head + 1);
assert.deepEqual(lines.filter(l => l[2] === 'Not synced').map(l => [l[0], l[1]]), [['Tires', '16'], ['Tires', '17'], ['Wheels', '9']]);
assert.match(String(lines[0][3]), /31x10\.50R15/);
assert.ok(lines.some(l => l[2] === 'Synced, check'), 'warnings listed after');
assert.match(String(iss[2][1]), /11 rows synced, 45 on hand\. 2 not synced/);

// 2. Nothing changed: no writes, no new log rows, issues tab left alone.
const before = await logs(); delete written['Sync issues'];
r = await runSync({ sheets, store, config, trigger: 'cron' });
assert.deepEqual(r.kinds.map(k => k.status), ['unchanged', 'unchanged']);
assert.equal(await logs(), before); assert.equal(r.issuesTab, 'skipped'); assert.equal(written['Sync issues'], undefined);

// 3. Staff change a qty: only tires rewrite.
book.Tires[2][8] = '6';   // row 3, Michelin X-Ice 8 -> 6
r = await runSync({ sheets, store, config, trigger: 'cron' });
assert.deepEqual(r.kinds.map(k => k.status), ['ok', 'unchanged']);
assert.equal((await count('tires')).q, 43);
assert.equal(r.issuesTab, 'written');

// 4. Header renamed so no size column is found: blocked, counter keeps the last good rows, logged once.
const savedHeader = book.Tires[1][0];
book.Tires[1][0] = 'Thing';
r = await runSync({ sheets, store, config, trigger: 'cron' });
assert.equal(r.kinds[0].status, 'blocked'); assert.match(r.kinds[0].message!, /no Tire size column/);
assert.equal((await count('tires')).n, 11, 'nothing wiped');
assert.match(String(written['Sync issues'][2][1]), /^NOT SYNCED/);
const n1 = await logs();
await runSync({ sheets, store, config, trigger: 'cron' });
assert.equal(await logs(), n1, 'same block again only bumps checked_at');
book.Tires[1][0] = savedHeader;

// 5. Most rows deleted: big-drop guard blocks; "Sync anyway" (force) goes through.
const full = book.Tires;
book.Tires = full.slice(0, 4);
for (let i = 0; i < 30; i++) await db.exec(`insert into tires (tire_size, section_width, aspect_ratio, rim_diameter, condition, qty, source) values ('205/55R16',205,55,16,'new',1,'pad')`);
r = await runSync({ sheets, store, config, trigger: 'cron' });
assert.equal(r.kinds[0].status, 'blocked'); assert.match(r.kinds[0].message!, /would drop from 41 rows to 2/);
r = await runSync({ sheets, store, config, trigger: 'manual', force: true });
assert.equal(r.kinds[0].status, 'ok'); assert.equal((await count('tires')).n, 2);
book.Tires = full;

// 6. Missing tab, and a Sheets outage: logged, nothing wiped, error surfaces.
const cfg2 = { ...config, wheelTabs: ['Rims'] };
r = await runSync({ sheets, store, config: cfg2, trigger: 'cron' });
assert.equal(r.kinds[1].status, 'blocked'); assert.match(r.kinds[1].message!, /"Rims" not found/);
const broken = { ...sheets, tabs: async () => { throw new Error('Google Sheets returned 503.'); } } as SheetsClient;
await assert.rejects(runSync({ sheets: broken, store, config, trigger: 'cron' }), /503/);
assert.equal((await db.query(`select 1 from inventory_syncs where status = 'error'`)).rows.length, 2);
assert.equal((await count('wheels')).n, 7);

// 7. replace_inventory refuses bad input inside its transaction, leaving the table as it was.
await assert.rejects(db.query(`select replace_inventory('tires', '[{"tire_size":"bad"}]'::jsonb)`));
assert.equal((await count('tires')).n, 11, 'step 6 resynced the restored sheet; the bad call changed nothing');

// ---- the real Sheets client against a fake Google: token signing, tab quoting, caching the token
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const sa = serviceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sync@x.iam.gserviceaccount.com', private_key: pem.replace(/\n/g, '\\n') }) });
const calls: { url: string; method: string; body?: string }[] = [];
const fakeFetch = (async (url: string, init: RequestInit = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? String(init.body) : undefined });
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
  if (String(url).includes('oauth2')) {
    const jwt = new URLSearchParams(String(init.body)).get('assertion')!;
    const [h, c, s] = jwt.split('.');
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), 'JWT signature verifies');
    assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).scope, 'https://www.googleapis.com/auth/spreadsheets');
    return json({ access_token: 'tok', expires_in: 3600 });
  }
  if (String(url).includes('batchGet')) return json({ valueRanges: [{ values: [['Size', 'Qty'], ['225/65R17', 4]] }, {}] });
  return json({});
}) as typeof fetch;
const live = sheetsClient('sheet-id', sa, fakeFetch);
const vals = await live.read(['Tires', "Bob's wheels"]);
assert.deepEqual(vals, { Tires: [['Size', 'Qty'], ['225/65R17', '4']], "Bob's wheels": [] });
assert.ok(calls[1].url.includes(encodeURIComponent("'Bob''s wheels'")), 'tab names quoted');
await live.replaceTab('Sync issues', [['a']]);
assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1, 'token reused');
assert.ok(calls.some(c => c.method === 'PUT' && c.url.includes('valueInputOption=RAW')), 'written as plain text, not formulas');

console.log(`sync: ${reads} sheet reads, ${await logs()} log rows`);
console.log('SYNC TEST PASSED');

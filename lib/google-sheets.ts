// Google Sheets client for the inventory sync. SERVER-SIDE ONLY: it holds the service account's private key.
// Signs its own service-account token with node:crypto, so there is no googleapis dependency.
// Setup: Google Cloud > IAM > Service accounts > create one, add a JSON key, enable the Google Sheets API,
// then share the inventory sheet with the service account's email as Editor (Editor so it can write "Sync issues").
import { createSign } from 'node:crypto';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class SheetsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ServiceAccount = { client_email: string; private_key: string };

/** GOOGLE_SERVICE_ACCOUNT_JSON holds the whole key file, pasted as is (or base64 of it). */
export function serviceAccount(env: Record<string, string | undefined> = process.env): ServiceAccount {
  const v = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!v) throw new SheetsError(500, 'GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste the service account key file into it.');
  let sa: Partial<ServiceAccount>;
  try { sa = JSON.parse(v.startsWith('{') ? v : Buffer.from(v, 'base64').toString('utf8')); }
  catch { throw new SheetsError(500, 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file.'); }
  if (!sa.client_email || !sa.private_key) throw new SheetsError(500, 'GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key.');
  return { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n') };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key);
  return `${head}.${claim}.${b64url(sig)}`;
}

/** A1 range for a whole tab. Quotes the name so tabs with spaces work. */
export const tabRange = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export type SheetsClient = ReturnType<typeof sheetsClient>;

// Tokens last an hour; a warm instance reuses one across 5-minute syncs instead of signing in every time.
const tokens = new Map<string, { value: string; exp: number }>();

export function sheetsClient(spreadsheetId: string, sa: ServiceAccount, fetchImpl: typeof fetch = fetch) {
  async function accessToken() {
    const cached = tokens.get(sa.client_email);
    if (cached && cached.exp > Date.now() + 60_000) return cached.value;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa) }),
    });
    const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) throw new SheetsError(res.status, `Google sign-in failed: ${body.error_description || res.status}. Check GOOGLE_SERVICE_ACCOUNT_JSON.`);
    tokens.set(sa.client_email, { value: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${API}/${encodeURIComponent(spreadsheetId)}${path}`, {
      method, cache: 'no-store',
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint = res.status === 403 ? ` Share the sheet with ${sa.client_email} as Editor, and enable the Sheets API.`
        : res.status === 404 ? ' Check GOOGLE_SHEET_ID.' : '';
      throw new SheetsError(res.status, `Google Sheets returned ${res.status}.${hint} ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    email: sa.client_email,

    async tabs(): Promise<string[]> {
      const r = await call<{ sheets?: { properties: { title: string } }[] }>('GET', '?fields=sheets.properties.title');
      return (r.sheets ?? []).map(s => s.properties.title);
    },

    /** Cell values as shown in the sheet ("$229.00", "0525"), one array per row. Blank rows come back as []. */
    async read(tabs: string[]): Promise<Record<string, string[][]>> {
      const q = tabs.map(t => `ranges=${encodeURIComponent(tabRange(t))}`).join('&');
      const r = await call<{ valueRanges?: { values?: unknown[][] }[] }>('GET', `/values:batchGet?${q}&majorDimension=ROWS`);
      return Object.fromEntries(tabs.map((t, i) =>
        [t, (r.valueRanges?.[i]?.values ?? []).map(row => row.map(v => String(v ?? '')))]));
    },

    async addTab(title: string) {
      await call('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title } } }] });
    },

    /** Clears the tab, then writes the rows from A1. Values are written as plain text, never as formulas. */
    async replaceTab(title: string, values: (string | number)[][]) {
      const range = tabRange(title);
      await call('POST', `/values/${encodeURIComponent(range)}:clear`, {});
      if (values.length) await call('PUT', `/values/${encodeURIComponent(range + '!A1')}?valueInputOption=RAW`, { values });
    },
  };
}

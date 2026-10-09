'use client';
// The counter screen. React renders the prototype's markup once; counter.js fills it and handles every interaction.
import { useEffect } from 'react';
import { COUNTER_MARKUP } from './markup';
import { startCounter } from './counter.js';
import { logSearch, flushSearch } from '@/lib/log-search-client';
import type { CounterInventory, VehicleResult, VehicleAsk } from '@/lib/counter-data';
import type { Catalog } from '@/lib/vehicle-lookup';
import type { CounterSearch } from '@/lib/search-log';

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `${url} returned ${res.status}`);
  return body as T;
};

export default function Counter({ data, error }: { data?: CounterInventory; error?: string }) {
  useEffect(() => {
    if (!data) return;
    const live = data.mode === 'live';
    return startCounter({
      data,
      api: {
        vehicle: (ask: VehicleAsk, lookup = false) => getJson<VehicleResult>(`/api/counter/vehicle?${new URLSearchParams({
          year: String(ask.year ?? ''), make: ask.make, model: ask.model, ...(lookup ? { lookup: '1' } : {}) })}`),
        catalog: () => getJson<{ makes: Catalog }>('/api/counter/catalog').then(r => r.makes),
        oeOn: (size: string) => getJson<{ vehicles: { label: string; year: number; make: string; model: string }[] }>(`/api/counter/size?size=${encodeURIComponent(size)}`).then(r => r.vehicles),
      },
      // Demo mode has no database, so searches aren't saved.
      log: live ? (s: CounterSearch) => logSearch(s) : () => {},
      flush: live ? flushSearch : () => {},
    });
  }, [data]);

  if (error || !data) return (
    <div className="loading">
      <div className="setup">
        <div className="eyebrow">Couldn&apos;t load inventory</div>
        <p>{error ?? 'No data.'}</p>
        <p><a href="/setup">Open setup</a></p>
        <div className="acts">
          <a className="primary" href="/">Try again</a>
          <a href="/sync">Check the sheet sync</a>
        </div>
      </div>
    </div>
  );
  return <div className="app" dangerouslySetInnerHTML={{ __html: COUNTER_MARKUP }} />;
}

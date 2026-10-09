'use client';
// The counter screen. React renders the prototype's markup once; counter.js fills it and handles every interaction.
import { useEffect } from 'react';
import { COUNTER_MARKUP } from './markup';
import { startCounter } from './counter.js';
import { logSearch, flushSearch } from '@/lib/log-search-client';
import type { CounterInventory, VehicleResult } from '@/lib/counter-data';
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
        vehicle: (q: string) => getJson<VehicleResult>(`/api/counter/vehicle?q=${encodeURIComponent(q)}`),
        oeOn: (size: string) => getJson<{ vehicles: { label: string; q: string }[] }>(`/api/counter/size?size=${encodeURIComponent(size)}`).then(r => r.vehicles),
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
      </div>
    </div>
  );
  return <div className="app" dangerouslySetInnerHTML={{ __html: COUNTER_MARKUP }} />;
}

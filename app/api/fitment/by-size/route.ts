// GET /api/fitment/by-size?size=225/65R17
// Vehicles that came on this size, from fitments already saved. No API calls.
// Grows as the counter looks up more vehicles.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: Request) {
  const size = new URL(req.url).searchParams.get('size')?.toUpperCase().replace(/\s/g, '') ?? '';
  if (!/^\d{3}\/\d{2}R\d{2}$/.test(size)) return NextResponse.json({ error: 'size like 225/65R17 is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin().from('fitment_oe_sizes')
    .select('make_slug, model_slug, year, load_index, speed_rating, rim_width, rim_offset, stock, trims')
    .eq('tire_size', size).order('stock', { ascending: false }).order('year', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Collapse years into ranges per make/model: "2017–2022 Mazda CX-5"
  type Row = { make_slug: string; model_slug: string; year: number; load_index: number | null; stock: boolean };
  const groups = new Map<string, { make: string; model: string; years: number[]; stock: boolean; loadIndex: number | null }>();
  for (const r of (data ?? []) as Row[]) {
    const k = `${r.make_slug}/${r.model_slug}/${r.stock}`;
    const g = groups.get(k) || { make: r.make_slug, model: r.model_slug, years: [], stock: r.stock, loadIndex: r.load_index };
    if (!g.years.includes(r.year)) g.years.push(r.year);
    if (r.load_index !== null && (g.loadIndex === null || r.load_index > g.loadIndex)) g.loadIndex = r.load_index;
    groups.set(k, g);
  }
  const vehicles = [...groups.values()].map(g => {
    const ys = g.years.sort((a, b) => a - b);
    return { ...g, years: ys, label: ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}` };
  });
  return NextResponse.json({ size, vehicles });
}

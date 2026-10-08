// Run this first with your key: npx tsx scripts/check-key.ts 2018 subaru outback
// Spends one hit per market (2 with cdm,usdm). Prints what the counter will show, and saves the raw response next to it so the
// field mapping in lib/fitment.ts can be checked against real data.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { searchAllRegions, regions } from '../lib/wheelsize';
import { normalize } from '../lib/fitment';

const [year = '2018', make = 'subaru', model = 'outback'] = process.argv.slice(2);

console.log(`Querying ${regions().join(' + ')} (${regions().length} hits)`);
searchAllRegions(make, model, Number(year)).then(raw => {
  writeFileSync(`ws-${year}-${make}-${model}.json`, JSON.stringify(raw, null, 2));
  const f = normalize(raw, Number(year));
  if (!f) { console.log('No results. Check make/model slugs (lowercase, dashes: cr-v, f-150).'); return; }
  console.log(`\n${f.year} ${f.make} ${f.model}  (${f.generation ?? 'generation n/a'} ${f.generationYears ?? ''})`);
  console.log(`Bolt ${f.boltPattern}  ·  CB ${f.centreBoreMm} mm  ·  ${f.lugThread} ${f.fastener ?? ''}  ·  ${f.torqueFtLb ?? '?'} ft·lb`);
  for (const s of f.oe) console.log(`  ${s.stock ? 'OE ' : 'opt'} ${s.tire} ${s.loadIndex ?? '?'}${s.speedRating ?? ''}  ${s.rimDiameter}×${s.rimWidth ?? '?'} ET${s.offset ?? '?'}  ${s.pressurePsi.front ?? '?'} psi${s.extraLoad ? ' XL' : ''}  ${s.trims.join(', ')}`);
  for (const m of f.mixedSpecs) console.log(`  ! ${m}`);
  console.log(`\nRaw response saved to ws-${year}-${make}-${model}.json`);
}).catch(e => { console.error(e.message); process.exit(1); });

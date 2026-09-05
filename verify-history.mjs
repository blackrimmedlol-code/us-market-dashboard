import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import model from './market-model.js';
const file = resolve(process.argv[2] || 'data.json'), session = process.argv[3] || 'close';
const data = JSON.parse(readFileSync(file, 'utf8')), odds = data[session]?.odds;
if (!odds || odds.length !== model.TARGETS.length * 2) throw Error('Expected 16 percentile rows');
for (const item of odds) {
  if (!item.historyFile) throw Error(item.asset + ': missing auditable historyFile');
  const history = JSON.parse(readFileSync(resolve(dirname(file), item.historyFile), 'utf8'));
  const asset = history.assets[item.asset];
  if (!asset?.rows?.length || history.marketDate !== item.asOf) throw Error(item.asset + ': history date mismatch');
  const result = model.percentile(asset.rows, item.window === '60D' ? 60 : 252);
  for (const key of ['percentile', 'sampleSize', 'referencePrice', 'asOf']) if (result[key] !== item[key]) throw Error(item.asset + ': incorrect ' + key);
  if (result.low !== item.rangeLow || result.high !== item.rangeHigh) throw Error(item.asset + ': incorrect close range');
  if (item.asset === 'SPCX' && asset.rows.some(x => x.date < '2026-06-12')) throw Error('SPCX contains old instrument history');
  if (item.asset === 'DRAM' && asset.rows.some(x => x.date < '2026-04-02')) throw Error('DRAM contains pre-launch history');
}
console.log('VERIFIED: all 16 percentiles reproduce from dated source bars');

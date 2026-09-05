// Acquire auditable daily bars. Does not change data.json or make investment decisions.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import model from './market-model.js';
const run = promisify(execFile);
const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw Error('Usage: node refresh-history.mjs YYYY-MM-DD');
const start = new Date(date + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - 390);
const earliest = start.toISOString().slice(0, 10);
const peers = ['MU', 'SNDK', 'WDC', 'STX', 'COHR', 'VST', 'NRG', 'CEG', 'GEV', 'WULF', 'CIFR', 'CLSK', 'IBIT', 'ANET'];
const onlyPeers = process.argv.includes('--peers');
const results = onlyPeers ? JSON.parse(readFileSync(new URL(`./history/${date}.json`, import.meta.url), 'utf8')).assets : {};
const number = s => Number(String(s).replace(/[$,]/g, ''));
await Promise.all((onlyPeers ? peers : model.REQUIRED_CLOSE).map(async symbol => {
  const assetclass = ['DRAM', 'SPY', 'QQQ', 'SOXX', 'IBIT'].includes(symbol) ? 'etf' : 'stocks';
  const from = onlyPeers ? new Date(Date.parse(date + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10) : symbol === 'SPCX' ? '2026-06-12' : symbol === 'DRAM' ? '2026-04-02' : earliest;
  const url = `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=${assetclass}&fromdate=${from}&todate=${date}&limit=500`;
  try {
    const { stdout } = await run('curl', ['-L', '--max-time', '35', '-sS', url, '-H', 'User-Agent: Mozilla/5.0', '-H', 'Accept: application/json'], { maxBuffer: 4 * 1024 * 1024 });
    const raw = JSON.parse(stdout), table = raw.data?.tradesTable;
    if (!table?.rows?.length || table.rows.length !== raw.data.totalRecords) throw Error('Incomplete response or pagination required');
    const rows = table.rows.map(r => {
      const [m, d, y] = r.date.split('/');
      return { date: `${y}-${m}-${d}`, open: number(r.open), high: number(r.high), low: number(r.low), close: number(r.close), volume: number(r.volume) };
    }).filter(r => r.date >= from && r.date <= date && r.volume > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length || rows.at(-1).date !== date || rows.some(r => ![r.open, r.high, r.low, r.close, r.volume].every(model.positive) || r.high < Math.max(r.open, r.close) || r.low > Math.min(r.open, r.close)) || new Set(rows.map(r => r.date)).size !== rows.length) throw Error('Invalid, stale or duplicate OHLCV');
    results[symbol] = { source: 'Nasdaq historical daily OHLCV', sourceUrl: `https://www.nasdaq.com/market-activity/${assetclass}/${symbol.toLowerCase()}/historical`, apiUrl: url, fetchedAt: new Date().toISOString(), basis: 'Nasdaq historical Close/Last；非复权总回报；不拼接其他供应商或旧代码历史', rows };
    console.log(JSON.stringify({ symbol, rows: rows.length, latest: rows.at(-1), previous: rows.at(-2), ...(!onlyPeers ? { p60: model.percentile(rows, 60), p252: model.percentile(rows, 252) } : {}) }));
  } catch (e) { results[symbol] = { error: e.message, apiUrl: url, attemptedAt: new Date().toISOString() }; console.error(symbol + ': ' + e.message); }
}));
mkdirSync(new URL('./history/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./history/${date}.json`, import.meta.url), JSON.stringify({ marketDate: date, assets: results }, null, 2) + '\n');
if (Object.values(results).some(x => x.error)) process.exitCode = 2;

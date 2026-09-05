import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import model from './market-model.js';

const [file = 'data.json', session = 'close', expectedDate, previous] = process.argv.slice(2);
if (!expectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw Error('Usage: node check-session.mjs data.json SESSION YYYY-MM-DD [previous.json]');
const validated = spawnSync(process.execPath, [new URL('./validate-data.mjs', import.meta.url).pathname, file, ...(previous ? [previous] : [])], { encoding: 'utf8' });
if (validated.status !== 0) { process.stderr.write(validated.stderr || validated.stdout); process.exit(1); }
const result = model.completion(JSON.parse(readFileSync(file, 'utf8')), session, expectedDate);
console.log(JSON.stringify({ session, expectedDate, ...result }, null, 2));
process.exit(result.complete && result.researchComplete ? 0 : 2);

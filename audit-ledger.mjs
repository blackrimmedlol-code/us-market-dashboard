import { readFileSync } from 'node:fs';
import model from './market-model.js';

const data = JSON.parse(readFileSync(process.argv[2] || new URL('./data.json', import.meta.url), 'utf8'));
const audit = model.auditLedger(data.decisionLedger || []);
const { rows, ...summary } = audit;
console.log(JSON.stringify({
  marketDate: data.meta.sessionDate,
  warning: '原始标签不等于交易结果；缺少触发记录不证明未触发。该审计不改写历史。',
  ...summary,
  flagged: rows.filter(r => r.flags.length).map(r => ({ callId: r.callId, flags: r.flags })),
}, null, 2));

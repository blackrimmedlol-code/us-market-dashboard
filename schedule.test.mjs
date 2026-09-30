import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {zonedTime,tradingDay,updateHealth} from './schedule.mjs';
const schedule=JSON.parse(fs.readFileSync(new URL('./schedule.json',import.meta.url)));
const stamp=s=>Date.parse(s);
const meta={automationEnabled:true,marketDate:'2026-09-29',session:'close',updatedAt:'2026-09-29T20:24:44Z',updateStatus:'complete'};
test('summer and winter schedules both render the intended China times',()=>{
  assert.equal(new Date(zonedTime('2026-09-30','09:05')).toISOString(),'2026-09-30T13:05:00.000Z');
  assert.equal(new Date(zonedTime('2026-11-02','09:05')).toISOString(),'2026-11-02T14:05:00.000Z');
});
test('overnight closed-session wait is healthy; missing due premarket becomes overdue',()=>{
  const waiting=updateHealth(meta,schedule,stamp('2026-09-30T04:55:00Z'));
  assert.equal(waiting.state,'ready');assert.equal(waiting.next.id,'premarket');
  assert.equal(updateHealth(meta,schedule,stamp('2026-09-30T13:10:00Z')).state,'pending');
  assert.equal(updateHealth(meta,schedule,stamp('2026-09-30T13:21:00Z')).state,'overdue');
});
test('holidays and weekends skip slots; missing updates stay observable',()=>{
  assert.equal(tradingDay('2026-11-26',schedule),false);
  const closed={...meta,marketDate:'2026-11-25',updatedAt:'2026-11-25T21:27:00Z'};
  const health=updateHealth(closed,schedule,stamp('2026-11-26T20:00:00Z'));
  assert.equal(health.state,'ready');assert.equal(health.next.marketDate,'2026-11-27');
});
test('an early same-session snapshot cannot satisfy the later due update',()=>{
  const early={...meta,marketDate:'2026-09-30',session:'premarket',updatedAt:'2026-09-30T12:00:00Z'};
  assert.equal(updateHealth(early,schedule,stamp('2026-09-30T13:25:00Z')).state,'overdue');
});
test('partial, paused, failed and out-of-calendar states remain distinct',()=>{
  assert.equal(updateHealth({...meta,updateStatus:'partial'},schedule,stamp('2026-09-30T04:55:00Z')).state,'partial');
  assert.equal(updateHealth({...meta,automationEnabled:false},schedule,stamp('2026-09-30T04:55:00Z')).state,'paused');
  assert.equal(updateHealth(meta,schedule,stamp('2026-09-30T13:25:00Z'),{status:'failed',marketDate:'2026-09-30',session:'premarket'}).state,'failed');
  assert.equal(updateHealth(meta,schedule,stamp('2029-01-02T13:25:00Z')).state,'unknown');
});

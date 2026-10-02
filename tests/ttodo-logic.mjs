/* The scanner's write rules, no browser and no database. */
import { planChanges } from '../tools/todo-logic.mjs';

let failed = 0;
const ok = (n, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const NOW = '2026-10-02T15:00:00.000Z';
const src = (ref, kind = 'slack', extra = {}) => ({ kind, label: 'DM with Sam', quote: 'q', url: 'https://x.slack.com/' + ref, at: NOW, ref, ...extra });

const existing = [
  { id: 'a', text: 'Send Dr. Patel the pricing sheet', owner: 'garrett', priority: 'normal', status: 'open', sources: [src('s1')], locked: {} },
  { id: 'b', text: 'Not a real task', owner: 'both', status: 'deleted', sources: [src('s2')], locked: {} },
  { id: 'c', text: 'Book demo room', owner: 'samuel', status: 'open', sources: [src('s3')], locked: { status: true, text: true } },
  { id: 'd', text: 'Sign the Twilio BAA', owner: 'both', status: 'done', sources: [src('g1', 'gmail')], locked: {} }
];

let r = planChanges(existing, { add: [{ text: 'Email Delta Dental about the claim API', owner: 'garrett', priority: 'high', due: '2026-10-09', source: src('s9') }] }, NOW);
ok('1 a new task is added with its source', r.writes.length === 1 && r.writes[0].op === 'add' && r.writes[0].data.status === 'open' && r.writes[0].data.sources[0].ref === 's9' && r.writes[0].data.due === '2026-10-09');

r = planChanges(existing, { add: [{ text: 'Something else', source: src('s2') }] }, NOW);
ok('2 a message already tracked (even by a deleted task) adds nothing', r.writes.length === 0 && r.skipped[0].reason === 'message already tracked');

r = planChanges(existing, { add: [{ text: 'not a real task!', source: src('s77') }] }, NOW);
ok('3 a deleted task never comes back from a new message', r.writes.length === 0 && r.skipped[0].reason === 'deleted before');

r = planChanges(existing, { add: [{ text: 'Send Dr. Patel the pricing sheet.', source: src('g5', 'gmail') }] }, NOW);
ok('4 the same task from another place becomes a second source', r.writes.length === 1 && r.writes[0].op === 'update' && r.writes[0].id === 'a' && r.writes[0].data.sources.length === 2);

r = planChanges(existing, { add: [{ text: 'Call Hobbs', source: src('n1') }, { text: 'Call Hobbs', source: src('n2') }] }, NOW);
ok('5 duplicates inside one scan collapse to one add with both sources', r.writes.length === 1 && r.writes[0].op === 'add' && r.writes[0].data.sources.length === 2, JSON.stringify(r.writes.map(w => w.op)));

r = planChanges(existing, { update: [{ id: 'c', text: 'Book the big demo room', owner: 'both' }] }, NOW);
ok('6 a field a person edited is never overwritten', r.writes.length === 1 && !('text' in r.writes[0].data) && r.writes[0].data.owner === 'both');

r = planChanges(existing, { complete: [{ id: 'c', source: src('s50') }] }, NOW);
ok('7 a task a person reopened is never re-checked', r.writes.length === 0 && r.skipped[0].reason === 'a person reopened it');

r = planChanges(existing, { complete: [{ id: 'a', source: src('s51', 'gmail', { at: '2026-10-02T18:00:00Z' }) }] }, NOW);
ok('8 checking off writes who, when and why', r.writes[0].data.status === 'done' && r.writes[0].data.doneBy === 'scanner' && /^done per Gmail, Oct 2$/.test(r.writes[0].data.doneNote), r.writes[0].data.doneNote);

r = planChanges(existing, { complete: [{ id: 'd' }, { id: 'b' }, { id: 'zz' }] }, NOW);
ok('9 done, deleted and missing tasks are left alone', r.writes.length === 0 && r.skipped.length === 3);

r = planChanges(existing, { add: [{ text: 'x', owner: 'mallory', priority: 'urgent!!', due: 'Friday', source: { ...src('s99'), url: 'javascript:alert(1)' } }] }, NOW);
const d = r.writes[0].data;
ok('10 bad values fall back to safe defaults', d.owner === 'both' && d.priority === 'normal' && d.due === null && d.sources[0].url === null);

r = planChanges(existing, { add: [{ text: 'no source' }, { text: '', source: src('e1') }, { text: 'bad kind', source: { kind: 'sms', ref: 'q' } }] }, NOW);
ok('11 tasks without a real source or text are refused', r.writes.length === 0 && r.skipped.length === 3);

r = planChanges(existing, { update: [{ id: 'a', source: src('s1') }] }, NOW);
ok('12 re-sending a known source changes nothing', r.writes.length === 0);

r = planChanges(existing, { add: [{ text: 'A', source: src('m1') }], complete: [{ id: 'a' }] }, NOW);
ok('13 summary counts adds and check-offs', r.summary === '1 added, 1 checked off', r.summary);

process.exit(failed ? 1 : 0);

/* The CRM side: pipeline stages, stage-follows-outcome, lost handling with a
   reason, owner filtering, and the gone-quiet calculation.

   Seeds the fake database with contacts before sign-in, including one carrying
   the old two-value stage, because real records in Samuel's project still do. */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const inDays  = (n) => new Date(Date.now() + n * 86400000).toISOString();

const SEED = `
(() => {
  const S = window.__STORE;
  const C = (id, o) => S['contacts/' + id] = Object.assign({ archived:false, lost:false }, o);
  const now = new Date().toISOString();

  // a legacy record: stage "connected" no longer exists in the app's list
  C('c_legacy', { name:'Dr. Old Record', company:'Legacy Dental', stage:'connected',
                  ownerId:'samuel', createdAt:'${daysAgo(60)}', lastTouchedAt:'${daysAgo(3)}' });
  // quiet: no open action, nothing logged for weeks
  C('c_quiet',  { name:'Dr. Quiet', company:'Silent Smiles', stage:'interested',
                  ownerId:'samuel', createdAt:'${daysAgo(90)}', lastTouchedAt:'${daysAgo(30)}' });
  // a second quiet one, so the gone-quiet list still has a member after the
  // lost-reason flow removes Dr. Quiet from it
  C('c_quiet2', { name:'Dr. Dormant', company:'Dormant Dental', stage:'contacted',
                  ownerId:'samuel', createdAt:'${daysAgo(70)}', lastTouchedAt:'${daysAgo(21)}' });
  // equally old, but has something scheduled, so NOT quiet
  C('c_sched',  { name:'Dr. Scheduled', company:'Booked Dental', stage:'interested',
                  ownerId:'samuel', createdAt:'${daysAgo(90)}', lastTouchedAt:'${daysAgo(40)}' });
  // Garrett's, for the owner filter
  C('c_garrett',{ name:'Dr. Garrett Lead', company:'GW Dental', stage:'pilot', value:400,
                  ownerId:'garrett', createdAt:'${daysAgo(10)}', lastTouchedAt:'${daysAgo(1)}' });
  // further along, with a value
  C('c_closed', { name:'Dr. Signed', company:'Paying Practice', stage:'closed', value:250,
                  ownerId:'samuel', createdAt:'${daysAgo(20)}', lastTouchedAt:'${daysAgo(2)}' });
  // specialties within dentistry, for the specialty sort
  S['industries/ind_dent'] = { name:'Dentistry', createdAt: now };
  S['positions/p_perio'] = { industryId:'ind_dent', name:'Periodontist', createdAt: now };
  S['positions/p_ortho'] = { industryId:'ind_dent', name:'Orthodontist', createdAt: now };
  S['contacts/c_garrett'].industryId = 'ind_dent'; S['contacts/c_garrett'].positionId = 'p_perio';
  S['contacts/c_closed'].industryId  = 'ind_dent'; S['contacts/c_closed'].positionId  = 'p_ortho';
  // fresh, to receive a logged call in the test
  C('c_fresh',  { name:'Dr. Fresh', company:'New Lead Dental', stage:'contacted',
                  ownerId:'samuel', createdAt: now, lastTouchedAt: now });

  S['reminders/r_sched'] = { contactId:'c_sched', text:'Call back about pricing',
    kind:'call', dueAt:'${inDays(2)}', assigneeId:'samuel', status:'scheduled', createdAt: now };
  S['reminders/r_over'] = { contactId:'c_closed', text:'Send the onboarding pack',
    kind:'email', dueAt:'${daysAgo(3)}', assigneeId:'samuel', status:'scheduled', createdAt: now };
})();`;

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addInitScript(FAKE);
/* The real Firebase SDK would load from gstatic and replace the fake. */
await ctx.route(/gstatic\.com\/firebasejs/, r => r.abort());
await ctx.addInitScript(SEED);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => {
  if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push('CONSOLE ' + m.text());
});

const ok = (n, cond, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
const contact = (id) => p.evaluate((i) => window.__STORE['contacts/' + i], id);
const rows = () => p.$$eval('.ctable tbody tr', ns => ns.map(n => ({
  stage: (n.querySelector('.c-stage .stage') || {}).textContent || '',
  name:  (n.querySelector('.c-name .nm') || {}).textContent || '',
  touch: (n.querySelector('.c-touch') || {}).textContent || '',
  quiet: !!n.querySelector('.c-touch.quiet')
})));

await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi');
await p.click('#gsi');
await p.waitForTimeout(1200);
await p.click('[data-nav="contacts"]');
await p.waitForTimeout(700);

// --- 1. legacy records still render ---------------------------------------
const all = await rows();
const legacy = all.find(r => /Old Record/.test(r.name));
ok('1 the table renders', all.length >= 6, all.length + ' rows');
ok('1b a legacy "connected" record shows as Interested, not blank',
   !!legacy && legacy.stage === 'Interested', legacy ? legacy.stage : 'row missing');
ok('1c and the database was not rewritten behind the scenes',
   (await contact('c_legacy')).stage === 'connected');

// --- 2. gone quiet ---------------------------------------------------------
const quietRow = all.find(r => /Dr\. Quiet/.test(r.name));
const schedRow = all.find(r => /Dr\. Scheduled/.test(r.name));
ok('2 a contact with no activity and nothing booked is flagged quiet',
   !!quietRow && quietRow.quiet, quietRow ? quietRow.touch : '');
ok('2b one just as old but with a follow-up booked is not',
   !!schedRow && !schedRow.quiet, schedRow ? schedRow.touch : '');
ok('2c there is no gone-quiet banner above the table',
   (await p.$$('.gone-quiet, [data-action="sort-stale"]')).length === 0);

// --- 3. the pipeline summary ----------------------------------------------
await p.click('[data-cview="board"]');
await p.waitForTimeout(500);
const stages = await p.$$eval('.pstage .ps-label', ns => ns.map(n => n.textContent));
ok('3 six stages, in order',
   stages.join(',') === 'Not contacted,Contacted,Interested,Pilot,Closed,Onboarded', stages.join(','));
const countBy = () => p.$$eval('.pstage', ns => Object.fromEntries(ns.map(n => [
  n.querySelector('.ps-label').textContent.trim(), +n.querySelector('.ps-count').textContent])));
const counts = await countBy();
ok('3b legacy record counted under Interested', counts['Interested'] === 3, JSON.stringify(counts));
ok('3c pipeline value totals only contacts that have one',
   /\$650/.test(await p.$eval('.pipe-total', n => n.textContent).catch(() => '')),
   await p.$eval('.pipe-total', n => n.textContent.trim()).catch(() => 'no total shown'));

// clicking a stage filters the table to it
await p.click('.pstage[data-stage="pilot"]');
await p.waitForTimeout(500);
ok('3d clicking a stage filters the table',
   (await rows()).every(r => r.stage === 'Pilot'), JSON.stringify(await rows()));
await p.selectOption('#stage-filter', '');
await p.waitForTimeout(400);

// --- 4. the stage follows the logged outcome ------------------------------
async function openFull(name){
  await p.click('tr:has(.nm:text("' + name + '"))');
  await p.waitForTimeout(500);
  await p.click('[data-action="open-full"]');
  await p.waitForTimeout(700);
  /* The call log lives behind a tab on the full view. */
  await p.click('[data-action="set-contact-tab"][data-tab="calls"]');
  await p.waitForTimeout(400);
}
await openFull('Dr. Fresh');
await p.click('[data-action="log-call-form"]');
await p.waitForTimeout(400);
const formThere = await p.$$eval('[id^="call-outcome-"]', n => n.length > 0);
ok('4 the call form offers an outcome', formThere);
if (formThere) {
  const sel = await p.$('[id^="call-outcome-"]');
  await sel.selectOption('pilot');
  await p.click('[data-action="save-call"]');
  await p.waitForTimeout(900);
  ok('4b logging "agreed to try it" moved them to Pilot',
     (await contact('c_fresh')).stage === 'pilot', (await contact('c_fresh')).stage);
  ok('4c and stamped them as touched', !!(await contact('c_fresh')).lastTouchedAt);

  /* A later poor call must not drag a signed customer backwards. */
  await p.goto(SITE + '/index.html');
  await p.waitForSelector('#gsi'); await p.click('#gsi'); await p.waitForTimeout(1200);
  await p.click('[data-nav="contacts"]'); await p.waitForTimeout(600);
  await openFull('Dr. Signed');
  await p.click('[data-action="log-call-form"]');
  await p.waitForTimeout(400);
  const sel2 = await p.$('[id^="call-outcome-"]');
  if (sel2) {
    await sel2.selectOption('spoke');          // Interested — earlier than Closed
    await p.click('[data-action="save-call"]');
    await p.waitForTimeout(900);
    ok('4d an outcome never demotes someone further along',
       (await contact('c_closed')).stage === 'closed', (await contact('c_closed')).stage);
  }
}

// --- 5. not interested, with a reason -------------------------------------
await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi'); await p.click('#gsi'); await p.waitForTimeout(1200);
await p.click('[data-nav="contacts"]'); await p.waitForTimeout(600);
await p.click('tr:has(.nm:text("Dr. Quiet"))');
await p.waitForTimeout(600);
await p.click('[data-action="mark-lost"]');
await p.waitForTimeout(400);
ok('5 marking not interested asks why first', await p.$$eval('#lost-reason', n => n.length === 1));
await p.click('[data-action="confirm-lost"]');
await p.waitForTimeout(500);
ok('5b and refuses to proceed without a reason',
   (await contact('c_quiet')).lost !== true);
await p.selectOption('#lost-reason', 'too_expensive');
await p.fill('#lost-note', 'Quoted 250, wanted 100');
await p.click('[data-action="confirm-lost"]');
await p.waitForTimeout(900);
const lostC = await contact('c_quiet');
ok('5c reason recorded', lostC.lost === true && lostC.lostReason === 'too_expensive',
   JSON.stringify({ lost: lostC.lost, why: lostC.lostReason }));
ok('5d the note is kept too', lostC.lostNote === 'Quoted 250, wanted 100');

await p.click('[data-action="close-modal"]').catch(() => {});
await p.waitForTimeout(400);
await p.click('[data-nav="contacts"]'); await p.waitForTimeout(600);
ok('5e they drop out of the table', !(await rows()).some(r => /Dr\. Quiet/.test(r.name)));
await p.click('[data-cview="board"]'); await p.waitForTimeout(500);
const counts2 = await countBy();
ok('5f and out of the pipeline count', counts2['Interested'] === 2, JSON.stringify(counts2));
ok('5g the reason shows up in the breakdown',
   /Price/.test(await p.$eval('.lost-panel', n => n.textContent).catch(() => '')));
await p.click('[data-cview="list"]'); await p.waitForTimeout(500);
await p.check('#show-lost').catch(() => {});
await p.waitForTimeout(500);
ok('5h but they are still findable', (await rows()).some(r => /Dr\. Quiet/.test(r.name)));
await p.uncheck('#show-lost').catch(() => {});
await p.waitForTimeout(400);

// --- 6. owner filter -------------------------------------------------------
const ownerVals = await p.$$eval('#owner-filter option', ns => ns.map(n => n.value));
ok('6 owner filter lists the owners', ownerVals.length >= 3, JSON.stringify(ownerVals));
await p.selectOption('#owner-filter', 'garrett');
await p.waitForTimeout(500);
ok('6b filtering by owner narrows the table',
   (await rows()).length === 1 && /Garrett Lead/.test((await rows())[0].name),
   JSON.stringify(await rows()));
await p.selectOption('#owner-filter', '');
await p.waitForTimeout(400);

// --- 7. sorting ------------------------------------------------------------
await p.click('th[data-sort="name"]');
await p.waitForTimeout(400);
const names = (await rows()).map(r => r.name);
ok('7 sorting by name works', names.join('|') === names.slice().sort().join('|'), names.join(' | '));
await p.click('th[data-sort="name"]');
await p.waitForTimeout(400);
const desc = (await rows()).map(r => r.name);
ok('7b clicking again reverses it', desc.join('|') === names.slice().reverse().join('|'));

await p.click('th[data-sort="specialty"]');
await p.waitForTimeout(400);
const bySpec = (await rows()).map(r => r.name);
ok('7c sorting by specialty puts specialties first, alphabetically',
   /Signed/.test(bySpec[0]) && /Garrett Lead/.test(bySpec[1]), bySpec.join(' | '));
await p.click('th[data-sort="specialty"]');
await p.waitForTimeout(400);
const bySpecDesc = (await rows()).map(r => r.name);
ok('7d reversing keeps contacts with no specialty at the bottom',
   /Garrett Lead/.test(bySpecDesc[0]) && /Signed/.test(bySpecDesc[1]), bySpecDesc.join(' | '));
ok('7e the specialty shows in its column',
   await p.$$eval('.ctable td.c-spec', ns => ns.some(n => n.textContent === 'Orthodontist')));

// --- 8. action items grouped by urgency ------------------------------------
await p.click('[data-nav="reminders"]');
await p.waitForTimeout(700);
const heads = await p.$$eval('.act-group .section-head h3', ns => ns.map(n => n.textContent.trim()));
ok('8 actions are grouped by urgency, overdue first',
   /^Overdue/.test(heads[0] || ''), JSON.stringify(heads));
ok('8b the overdue one is the one that is actually overdue',
   /onboarding pack/.test(await p.$eval('.act-group.bad .act-text', n => n.textContent).catch(() => '')));
ok('8c action types are shown', await p.$$eval('.act-row .kind',
   ns => ns.some(n => /EMAIL/i.test(n.textContent))));
const actionsText = await p.$eval('#view-root', n => n.textContent);
ok('8d gone-quiet contacts appear here too', /Gone quiet/.test(actionsText));
ok('8e a contact marked not interested is no longer chased',
   !/Dr\. Quiet/.test(actionsText));
ok('8f but one that is genuinely dormant still is', /Dr\. Dormant/.test(actionsText));

// --- 9. logging a conversation straight from the preview -------------------
await p.click('[data-nav="contacts"]'); await p.waitForTimeout(600);
await p.click('tr:has(.nm:text("Dr. Garrett Lead"))');
await p.waitForTimeout(500);
const touchBefore = await p.$eval('#modal-root .pv-touch', n => n.textContent).catch(() => '');
await p.click('#modal-root [data-action="preview-log-call"]');
await p.waitForTimeout(300);
const pNotes = '#modal-root [data-draft^="pcall:"][data-draft$=":notes"]';
ok('9 the preview opens a log form in place', await p.$$eval(pNotes, n => n.length === 1));
ok('9b without leaving for the full contact page',
   await p.$$eval('[data-action="set-contact-tab"]', n => n.length === 0));

// cancel collapses it, and reopening starts empty
await p.fill(pNotes, 'throw this away');
await p.click('#modal-root [data-action="cancel-preview-call"]');
await p.waitForTimeout(300);
ok('9c cancel collapses the form', await p.$$eval(pNotes, n => n.length === 0));
await p.click('#modal-root [data-action="preview-log-call"]');
await p.waitForTimeout(300);
ok('9d and reopening starts from a blank note', await p.$eval(pNotes, n => n.value) === '');

// half-typed text, caret mid-word, then Garrett saves something
const PTYPED = 'Walked through the chart-note flow with the front desk';
await p.selectOption('#modal-root [id^="pcall-type-"]', 'video');
await p.fill(pNotes, PTYPED);
const PCARET = PTYPED.indexOf('chart-note') + 5;
await p.evaluate(({ sel, c }) => {
  const el = document.querySelector(sel); el.focus(); el.setSelectionRange(c, c);
}, { sel: pNotes, c: PCARET });
await p.evaluate(() => window.__REMOTE('contacts/c_remote', {
  name: 'Dr. Remote Add', company: 'Elsewhere Dental', stage: 'contacted', ownerId: 'garrett',
  archived: false, lost: false, createdAt: new Date().toISOString(), lastTouchedAt: new Date().toISOString()
}));
await p.waitForTimeout(600);
const pAfter = await p.evaluate((sel) => {
  const t = document.querySelector(sel);
  return { there: !!t, val: t ? t.value : null, focused: !!t && document.activeElement === t,
           caret: t ? t.selectionStart : null,
           type: (document.querySelector('#modal-root [id^="pcall-type-"]') || {}).value,
           arrived: [...document.querySelectorAll('.ctable .nm')].some(n => /Remote Add/.test(n.textContent)) };
}, pNotes);
ok('9e the remote contact did arrive', pAfter.arrived);
ok('9f the preview form survived the remote save', pAfter.there);
ok('9g half-typed notes intact', pAfter.val === PTYPED, JSON.stringify(pAfter.val));
ok('9h the picked type is intact too', pAfter.type === 'video', pAfter.type);
ok('9i cursor still where it was, field still focused', pAfter.focused && pAfter.caret === PCARET,
   JSON.stringify({ focused: pAfter.focused, caret: pAfter.caret, want: PCARET }));

// save: stays on the preview, writes the call, says so, updates the info
await p.selectOption('#modal-root [id^="pcall-outcome-"]', 'spoke');
await p.click('#modal-root [data-action="save-preview-call"]');
await p.waitForTimeout(900);
const loggedCall = await p.evaluate(() => Object.keys(window.__STORE)
  .filter(k => k.startsWith('calls/')).map(k => window.__STORE[k])
  .find(c => c.contactId === 'c_garrett'));
ok('9j the conversation was saved through the normal path',
   !!loggedCall && loggedCall.notes === PTYPED && loggedCall.type === 'video' && loggedCall.outcome === 'spoke',
   JSON.stringify(loggedCall));
ok('9k still on the preview afterwards',
   await p.$$eval('#modal-root .modal-head h3', ns => ns.some(n => /Garrett Lead/.test(n.textContent))));
ok('9l the form closed', await p.$$eval(pNotes, n => n.length === 0));
ok('9m a toast confirms it',
   /logged/i.test(await p.$eval('#ct-toast', n => n.textContent).catch(() => '')));
const touchAfter = await p.$eval('#modal-root .pv-touch', n => n.textContent).catch(() => '');
ok('9n last touch on the preview reflects it', /just now/.test(touchAfter) && touchAfter !== touchBefore,
   JSON.stringify([touchBefore, touchAfter]));
ok('9o and a later stage is never pulled back', (await contact('c_garrett')).stage === 'pilot');

// closing the preview throws away an open form
await p.click('#modal-root [data-action="preview-log-call"]');
await p.waitForTimeout(300);
await p.fill(pNotes, 'abandoned');
await p.click('#modal-root .modal-foot [data-action="close-modal"]');
await p.waitForTimeout(300);
await p.click('tr:has(.nm:text("Dr. Garrett Lead"))');
await p.waitForTimeout(500);
ok('9p closing the preview resets the form', await p.$$eval(pNotes, n => n.length === 0));

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

/* Editing a conversation after it's been logged.
 *
 * Two things are worth guarding. First that an edit actually saves, and keeps
 * the parts of the record it shouldn't touch — who logged it, and the outcome
 * that moved the contact along the pipeline at the time.
 *
 * Second, and the one that has bitten this codebase twice: the calls tab
 * re-renders whenever anything live changes. A form built straight into the
 * page gets wiped mid-sentence the moment the other founder saves something.
 * The last checks here drive exactly that.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const SEED = `
(() => {
  const S = window.__STORE;
  S['contacts/c_dave'] = { name:'David Christensen', company:'Canyon Creek Endodontics',
    title:'Endodontist', stage:'interested', ownerId:'samuel', archived:false, lost:false,
    createdAt:'${daysAgo(5)}', lastTouchedAt:'${daysAgo(1)}' };
  S['calls/call1'] = { contactId:'c_dave', type:'call', occurredAt:'${daysAgo(1)}',
    durationMinutes:15, notes:'Spoke breifly about claims', outcome:'spoke',
    createdBy:'samuel', createdAt:'${daysAgo(1)}' };
})();`;

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addInitScript(FAKE);
await ctx.addInitScript(SEED);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

const ok = (n, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
const call1 = () => p.evaluate(() => window.__STORE['calls/call1']);

await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi');
await p.click('#gsi');
await p.waitForTimeout(1300);
await p.click('[data-nav="contacts"]');
await p.waitForTimeout(700);

/* open the contact's full view, then the Calls tab — same route the CRM suite uses */
await p.click('tr:has(.nm:text("David Christensen"))');
await p.waitForTimeout(500);
await p.click('[data-action="open-full"]');
await p.waitForTimeout(700);
await p.click('[data-action="set-contact-tab"][data-tab="calls"]');
await p.waitForTimeout(500);

ok('1. the logged conversation is shown', /breifly/.test(await p.evaluate(() => document.body.textContent)));

const editBtn = await p.$('[data-action="edit-call"]');
ok('2. it offers an Edit button', !!editBtn);
if (!editBtn) {
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 4)));
  await b.close(); process.exit(1);
}

await editBtn.click();
await p.waitForTimeout(400);
const notesBox = '[data-draft^="ecall:"][data-draft$=":notes"]';
ok('3. the form opens with the existing notes in it',
  (await p.$eval(notesBox, n => n.value)) === 'Spoke breifly about claims');

/* ---- the concurrency case ---- */
await p.fill(notesBox, 'Spoke briefly about the claims backlog. Wants a quote for two chairs.');
await p.waitForTimeout(150);

await p.evaluate(() => {
  // Garrett saves something unrelated, from his own browser.
  window.__REMOTE('contacts/c_other', { name:'Someone Else', stage:'contacted',
    ownerId:'garrett', archived:false, lost:false, createdAt:new Date().toISOString() });
});
await p.waitForTimeout(700);

const survived = await p.$$eval(notesBox, ns => ns.length ? ns[0].value : null);
ok('4. the edit form survived a live update from the other founder', survived !== null,
  survived === null ? '  <-- the form was destroyed' : '');
ok('5. and the typed text is still there',
  survived === 'Spoke briefly about the claims backlog. Wants a quote for two chairs.',
  JSON.stringify(survived));

/* ---- saving ---- */
await p.click('[data-action="save-call-edit"]');
await p.waitForTimeout(900);

const after = await call1();
ok('6. the notes were saved', after.notes === 'Spoke briefly about the claims backlog. Wants a quote for two chairs.',
  JSON.stringify(after.notes));
ok('7. the outcome was left alone', after.outcome === 'spoke', String(after.outcome));
ok('8. who logged it survived', after.createdBy === 'samuel', String(after.createdBy));
ok('9. the edit is stamped so the history shows it changed', !!after.editedAt && !!after.editedBy);
ok('10. the form closed after saving', (await p.$$(notesBox)).length === 0);

/* ---- cancelling ---- */
const editAgain = await p.$('[data-action="edit-call"]');
if (editAgain) {
  await editAgain.click();
  await p.waitForTimeout(400);
  await p.fill(notesBox, 'this should be thrown away');
  await p.click('[data-action="cancel-call-edit"]');
  await p.waitForTimeout(600);
  const unchanged = await call1();
  ok('11. cancel discarded the change',
    unchanged.notes === 'Spoke briefly about the claims backlog. Wants a quote for two chairs.');
  ok('12. cancel closed the form', (await p.$$(notesBox)).length === 0);
} else {
  console.log('FAIL  11/12. could not reopen the editor');
}

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 5), null, 1) : '[]');
await b.close();

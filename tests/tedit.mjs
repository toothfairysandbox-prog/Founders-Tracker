/* Editing a goal while the other founder saves one of theirs.
 *
 * The bug: the "Edit goal" form was built in JavaScript and pushed straight
 * into the board. Nothing in state knew it existed. So when Garrett saved
 * anything, the Firestore snapshot fired, render() rebuilt the board, and the
 * form — with whatever had been typed into it — was gone. No warning, no
 * recovery; it just vanished mid-sentence.
 *
 * These checks drive that exact sequence, so the bug can't come back quietly.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(FAKE);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

await p.goto((process.env.SITE_URL || 'http://localhost:8101') + '/index.html');
await p.waitForSelector('#gsi', { timeout: 6000 });
await p.click('#gsi');
await p.waitForTimeout(1200);
await p.click('[data-gnav="both"]');
await p.waitForTimeout(400);

/* a goal of Samuel's to edit */
await p.click('[data-act="openadd"][data-p="samuel"]');
await p.fill('[data-draft="new:samuel"]', 'Call Dr. Gibby about the pilot');
await p.click('[data-act="createconfirm"][data-p="samuel"]');
await p.waitForTimeout(500);

const gid = await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.includes('/goals/'));
  return k ? window.__STORE[k].id : null;
});
console.log('1. goal created:', gid ? 'yes' : 'NO  <-- setup failed');

/* open it and start editing */
await p.click(`[data-act="toggle"][data-id="${gid}"]`);
await p.waitForTimeout(300);
await p.click(`[data-act="edit"][data-id="${gid}"]`);
await p.waitForTimeout(300);
const editorOpen = await p.$$eval(`[data-draft="etitle:${gid}"]`, n => n.length === 1);
console.log('2. editor open:', editorOpen);
if (!editorOpen) {
  console.log('   <-- the editor is not state-backed markup; the remaining checks cannot run');
  console.log('ERRORS:', JSON.stringify(['editor did not open as [data-draft] fields']));
  await b.close();
  process.exit(1);
}

/* type a replacement title and a description, then put the cursor mid-word —
   the realistic case, not a cursor parked at the end */
const TYPED = 'Call Dr. Gibby about the two-chair pilot and pricing';
await p.fill(`[data-draft="etitle:${gid}"]`, TYPED);
await p.fill(`[data-draft="edesc:${gid}"]`, 'He wants to see the chart-note flow first.');
const CARET = TYPED.indexOf('two-chair') + 4;
await p.evaluate(({ gid, CARET }) => {
  const el = document.querySelector(`[data-draft="etitle:${gid}"]`);
  el.focus();
  el.setSelectionRange(CARET, CARET);
}, { gid, CARET });
await p.waitForTimeout(150);

/* ---- Garrett saves one of his own goals, from his own browser ---- */
await p.evaluate(() => {
  const col = Object.keys(window.__STORE).find(x => x.includes('/goals/')).split('/goals/')[0] + '/goals';
  window.__REMOTE(col + '/garrett_remote_1', {
    id: 'garrett_remote_1', owner: 'garrett', title: 'Ship the booking screen',
    category: 'Build', description: '', dueDate: null, dueDay: null, priority: 2,
    status: null, reflection: '', comments: [], createdAt: Date.now(), sort: Date.now()
  });
});
await p.waitForTimeout(600);

const after = await p.evaluate(({ gid }) => {
  const t = document.querySelector(`[data-draft="etitle:${gid}"]`);
  const d = document.querySelector(`[data-draft="edesc:${gid}"]`);
  return {
    formStillThere: !!t,
    title: t ? t.value : null,
    desc: d ? d.value : null,
    focused: !!t && document.activeElement === t,
    caret: t ? t.selectionStart : null,
    garrettGoalArrived: !!document.querySelector('[data-act="toggle"][data-id="garrett_remote_1"]')
  };
}, { gid });

console.log('3. Garrett\'s goal did arrive on the board:', after.garrettGoalArrived);
console.log('4. edit form survived his save:', after.formStillThere,
  after.formStillThere ? '' : '  <-- THE BUG IS BACK');
console.log('5. typed title intact:', after.title === TYPED ? 'yes' : `NO  <-- got ${JSON.stringify(after.title)}`);
console.log('6. typed description intact:',
  after.desc === 'He wants to see the chart-note flow first.' ? 'yes' : `NO  <-- got ${JSON.stringify(after.desc)}`);
console.log('7. cursor still mid-word, not flung to the end:',
  after.caret === CARET ? `yes (${after.caret})` : `NO  <-- at ${after.caret}, expected ${CARET}`);
console.log('8. field still focused:', after.focused);

/* the next keystroke must land where the cursor was */
await p.keyboard.type('X');
await p.waitForTimeout(200);
const typedAt = await p.$eval(`[data-draft="etitle:${gid}"]`, n => n.value);
console.log('9. next keystroke lands at the cursor:',
  typedAt === TYPED.slice(0, CARET) + 'X' + TYPED.slice(CARET)
    ? 'yes' : `NO  <-- got ${JSON.stringify(typedAt)}`);

/* and saving still writes the edit through */
await p.fill(`[data-draft="etitle:${gid}"]`, TYPED);
await p.click(`[data-act="editsave"][data-id="${gid}"]`);
await p.waitForTimeout(500);
const saved = await p.evaluate(({ gid }) => {
  const k = Object.keys(window.__STORE).find(x => x.endsWith('/goals/' + gid));
  return k ? { title: window.__STORE[k].title, desc: window.__STORE[k].description } : null;
}, { gid });
console.log('10. save wrote the edit:', saved && saved.title === TYPED ? 'yes' : `NO  <-- ${JSON.stringify(saved)}`);
console.log('11. editor closed after save:',
  await p.$$eval(`[data-draft="etitle:${gid}"]`, n => n.length === 0));

/* cancel must discard, not save */
await p.click(`[data-act="edit"][data-id="${gid}"]`);
await p.waitForTimeout(250);
await p.fill(`[data-draft="etitle:${gid}"]`, 'this should be thrown away');
await p.click(`[data-act="editcancel"][data-id="${gid}"]`);
await p.waitForTimeout(400);
const afterCancel = await p.evaluate(({ gid }) => {
  const k = Object.keys(window.__STORE).find(x => x.endsWith('/goals/' + gid));
  return { stored: k ? window.__STORE[k].title : null,
           formGone: !document.querySelector(`[data-draft="etitle:${gid}"]`) };
}, { gid });
console.log('12. cancel discarded the change:', afterCancel.stored === TYPED ? 'yes' : `NO  <-- ${JSON.stringify(afterCancel.stored)}`);
console.log('13. cancel closed the form:', afterCancel.formGone);

/* reopening after a cancel must start from the stored value, not the discarded draft */
await p.click(`[data-act="edit"][data-id="${gid}"]`);
await p.waitForTimeout(250);
console.log('14. reopen starts from the saved title:',
  await p.$eval(`[data-draft="etitle:${gid}"]`, n => n.value) === TYPED ? 'yes' : 'NO');

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

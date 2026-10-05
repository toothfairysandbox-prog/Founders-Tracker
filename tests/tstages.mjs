/* Editing the pipeline itself: add, rename, reorder, delete.
 *
 * The thing that makes this more than a settings screen is deletion. A stage
 * with contacts in it can't just disappear — those contacts would be pointing
 * at a stage that no longer exists. So removing one asks where its people go,
 * and moves them before the new pipeline is saved.
 *
 * Renaming is the other case worth guarding: a stage's id is what contacts
 * store, so renaming must change the label and touch no contact at all.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const SEED = `
(() => {
  const S = window.__STORE;
  const C = (id, o) => S['contacts/' + id] = Object.assign({ archived:false, lost:false }, o);
  C('s_a', { name:'Dr. Alpha',  stage:'contacted',  ownerId:'samuel', createdAt:'${daysAgo(9)}', lastTouchedAt:'${daysAgo(1)}' });
  C('s_b', { name:'Dr. Bravo',  stage:'interested', ownerId:'samuel', createdAt:'${daysAgo(9)}', lastTouchedAt:'${daysAgo(1)}' });
  C('s_c', { name:'Dr. Charlie',stage:'pilot',      ownerId:'samuel', createdAt:'${daysAgo(9)}', lastTouchedAt:'${daysAgo(1)}' });
  C('s_d', { name:'Dr. Delta',  stage:'pilot',      ownerId:'samuel', createdAt:'${daysAgo(9)}', lastTouchedAt:'${daysAgo(1)}' });
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
const contact = (id) => p.evaluate(i => window.__STORE['contacts/' + i], id);
const savedStages = () => p.evaluate(() => (window.__STORE['settings/crm'] || {}).stages || null);
const labels = () => p.$$eval('.pipeline .ps-label', ns => ns.map(n => n.textContent.trim()));
const editorLabels = () => p.$$eval('#modal-root .se-label', ns => ns.map(n => n.value));

const openEditor = async () => {
  await p.click('[data-action="manage-stages"]');
  await p.waitForSelector('#modal-root .stage-edit-list', { timeout: 4000 });
  await p.waitForTimeout(150);
};

await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi');
await p.click('#gsi');
await p.waitForTimeout(1200);
await p.click('[data-nav="contacts"]');
await p.waitForTimeout(600);
await p.click('[data-cview="board"]');          // the pipeline, where the stages live
await p.waitForTimeout(600);

// --- 1. the default pipeline is on screen --------------------------------
const start = await labels();
ok('1. default five stages render', start.length === 5 && start[0] === 'Contacted' && start[4] === 'Onboarded', JSON.stringify(start));

// --- 2. the editor opens with a row per stage ----------------------------
await openEditor();
ok('2. editor lists every stage', (await editorLabels()).length === 5);

// --- 3. add a stage ------------------------------------------------------
await p.fill('#se-new', 'Proposal sent');
await p.click('[data-action="stage-add"]');
await p.waitForTimeout(250);
ok('3. added stage appears in the editor', (await editorLabels()).includes('Proposal sent'));
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(700);
const after3 = await labels();
ok('4. added stage saved to the pipeline', after3.length === 6 && after3[5] === 'Proposal sent', JSON.stringify(after3));
ok('5. pipeline persisted to settings/crm', (await savedStages() || []).length === 6);

// --- 6. renaming keeps every contact where it is -------------------------
const beforeRename = await contact('s_c');
await openEditor();
await p.fill('#modal-root .stage-edit-row:nth-child(3) .se-label', 'Chair trial');
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(700);
const after6 = await labels();
ok('6. rename shows the new label', after6[2] === 'Chair trial', JSON.stringify(after6));
const afterRename = await contact('s_c');
ok('7. rename left the contact\'s stage id alone',
  afterRename.stage === 'pilot' && beforeRename.stage === 'pilot', `now ${afterRename.stage}`);
ok('8. renamed stage still shows its contacts',
  await p.$$eval('.pipeline .pstage', ns => {
    const col = ns.find(n => /Chair trial/.test(n.textContent));
    return col ? /2/.test(col.querySelector('.ps-count').textContent) : false;
  }));

// --- 9. reorder ----------------------------------------------------------
await openEditor();
await p.click('#modal-root .stage-edit-row:nth-child(2) [data-action="stage-down"]');
await p.waitForTimeout(250);
const reordered = await editorLabels();
ok('9. moving a stage down swaps it with the next', reordered[1] === 'Chair trial' && reordered[2] === 'Interested', JSON.stringify(reordered));
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(700);
ok('10. new order saved', (await labels())[1] === 'Chair trial');

// --- 11. a pipeline needs at least one stage -----------------------------
await openEditor();
ok('11. remove is offered while several stages exist',
  await p.$$eval('#modal-root [data-action="stage-remove"]:not([disabled])', n => n.length === 6));

// --- 12. deleting a stage that holds contacts must reassign them ---------
// "Chair trial" is now at position 2 and holds Dr. Charlie and Dr. Delta.
const idx = (await editorLabels()).indexOf('Chair trial');
await p.click(`#modal-root .stage-edit-row:nth-child(${idx + 1}) [data-action="stage-remove"]`);
await p.waitForTimeout(300);
ok('12. removal asks where its contacts go', await p.$$eval('#modal-root .se-reassign', n => n.length === 1));
const destOpts = await p.$$eval('#modal-root [data-stage-move] option', ns => ns.map(n => n.textContent));
ok('13. the deleted stage is not offered as a destination', !destOpts.includes('Chair trial'), JSON.stringify(destOpts));
await p.selectOption('#modal-root [data-stage-move]', { label: 'Onboarded' });
await p.waitForTimeout(150);
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(900);
ok('14. stage is gone from the pipeline', !(await labels()).includes('Chair trial'), JSON.stringify(await labels()));
const movedC = await contact('s_c'), movedD = await contact('s_d');
ok('15. its contacts were moved, not orphaned',
  movedC.stage === 'onboarded' && movedD.stage === 'onboarded', `${movedC.stage} / ${movedD.stage}`);

// --- 16. duplicate names are refused ------------------------------------
await openEditor();
await p.fill('#modal-root .stage-edit-row:nth-child(2) .se-label', 'Contacted');
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(500);
ok('16. two stages cannot share a name',
  await p.$$eval('#modal-root .modal-body .hint[style*="danger"]', n => n.length > 0));
ok('17. the editor stays open so it can be fixed',
  await p.$$eval('#modal-root .stage-edit-list', n => n.length === 1));

// --- 18. an empty name is refused ---------------------------------------
await p.fill('#modal-root .stage-edit-row:nth-child(2) .se-label', '   ');
await p.click('[data-action="stage-save"]');
await p.waitForTimeout(500);
ok('18. a stage cannot be left unnamed',
  await p.$eval('#modal-root .modal-body .hint[style*="danger"]', n => /needs a name/.test(n.textContent)));

// --- 19. cancel discards everything -------------------------------------
const beforeCancel = await labels();
await p.click('[data-action="close-stages"]');
await p.waitForTimeout(400);
ok('19. cancel changed nothing', JSON.stringify(await labels()) === JSON.stringify(beforeCancel));
ok('20. cancel closed the editor', await p.$$eval('#modal-root .stage-edit-list', n => n.length === 0));

// --- 21. reset ----------------------------------------------------------
await openEditor();
await p.click('[data-action="stage-reset"]');
await p.waitForTimeout(250);
ok('21. reset restores the default five', JSON.stringify(await editorLabels()) ===
  JSON.stringify(['Contacted', 'Interested', 'Pilot', 'Closed', 'Onboarded']));
await p.click('[data-action="close-stages"]');
await p.waitForTimeout(300);

// --- 22. the new-contact form offers the real stages --------------------
await p.click('[data-nav="contacts"]');
await p.waitForTimeout(500);
const addBtn = await p.$('[data-action="new-contact"]');
if (addBtn) {
  await addBtn.click();
  await p.waitForTimeout(400);
  const chips = await p.$$eval('#modal-root [data-radio="nc-stage"]', ns => ns.map(n => n.textContent.trim()));
  ok('22. new-contact stages come from the real pipeline', chips.length === (await labels()).length, JSON.stringify(chips));
  ok('23. the retired "Connected" stage is gone from the form', !chips.includes('Connected'), JSON.stringify(chips));
} else {
  console.log('SKIP  22/23. no new-contact button found on this view');
}

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

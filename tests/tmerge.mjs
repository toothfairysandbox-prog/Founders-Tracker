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
console.log('1. gate up, shell hidden:', await p.$eval('#shell', n => n.hidden));

await p.click('#gsi');
await p.waitForTimeout(1200);
console.log('2. shell open:', !(await p.$eval('#shell', n => n.hidden)));
console.log('3. goal nav:', await p.$$eval('#goals-nav [data-gnav]', n => n.map(x => x.textContent.trim())));
console.log('4. contact nav:', await p.$$eval('[data-nav]', n => n.map(x => x.textContent.trim().split(/\\s+/)[1] || x.textContent.trim())));
console.log('5. section headers:', await p.$$eval('.navsection', n => n.map(x => x.textContent)));
console.log('6. idchip:', (await p.$eval('#idchip', n => n.textContent)).replace(/\\s+/g, ' ').trim());

// ---- goal side ----
await p.click('[data-gnav="both"]');
await p.waitForTimeout(500);
console.log('7. goals visible:', !(await p.$eval('#goals-root', n => n.hidden)), '| title:', await p.$eval('#page-title', n => n.textContent));
console.log('8. two columns:', await p.$$eval('#goals-root .col-head .name', n => n.map(x => x.textContent)));
await p.click('[data-act="openadd"][data-p="samuel"]');
await p.fill('[data-draft="new:samuel"]', 'Merged-app smoke test goal');
await p.click('[data-act="createconfirm"][data-p="samuel"]');
await p.waitForTimeout(500);
console.log('9. goal written:', await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.includes('/goals/'));
  return k ? window.__STORE[k].title : null; }));
const cancel = await p.$('[data-act="canceladd"][data-p="samuel"]'); if (cancel) await cancel.click();

await p.click('[data-gnav="build"]'); await p.waitForTimeout(400);
console.log('10. build night reachable:', await p.$$eval('#goals-root .build-wrap, #goals-root .build-bar', n => n.length > 0));
await p.click('[data-gnav="notes"]'); await p.waitForTimeout(400);
console.log('11. notes reachable:', await p.$$eval('#goals-root .notes-bar', n => n.length > 0));

// ---- contacts side ----
const views = ['home', 'contacts', 'reminders', 'calendar', 'activity', 'industries'];
for (const v of views) {
  await p.click(`[data-nav="${v}"]`);
  await p.waitForTimeout(500);
  const len = await p.$eval('#view-root', n => n.innerHTML.length);
  const title = await p.$eval('#page-title', n => n.textContent);
  const hidden = await p.$eval('#goals-root', n => n.hidden);
  console.log(`12.${v}: title="${title}" htmlLen=${len} goalsHidden=${hidden}`);
}

// write through Garrett's code path (industries has a simple inline form)
await p.click('[data-nav="industries"]'); await p.waitForTimeout(500);
const inp = await p.$('#new-industry-input');
if (inp) {
  await p.fill('#new-industry-input', 'Dental');
  await p.click('[data-action="add-industry"]');
  await p.waitForTimeout(900);
}
console.log('13. industry written:', await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.startsWith('industries/'));
  return k ? window.__STORE[k].name : null; }));
console.log('14. activity logged:', await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.startsWith('activity/'));
  return k ? window.__STORE[k].summary : null; }));

// back to goals: state intact
await p.click('[data-gnav="both"]'); await p.waitForTimeout(500);
console.log('15. goal survived the round trip:', await p.$$eval('#goals-root .goal-title', n => n.map(x => x.textContent)));
console.log('16. view-root hidden on goals:', await p.$eval('#view-root', n => n.hidden));

await p.screenshot({ path: 'goals.png', fullPage: false });
await p.click('[data-nav="home"]'); await p.waitForTimeout(600);
await p.screenshot({ path: 'contacts.png', fullPage: false });


// ---- overlays must be styled and centred, not dumped at the foot of the page ----
await p.click('[data-gnav="both"]'); await p.waitForTimeout(400);
await p.click('#catBtn'); await p.waitForTimeout(600);
const modal = await p.evaluate(() => {
  const sc = document.querySelector('.scrim');
  const md = document.querySelector('.scrim .modal');
  if (!sc || !md) return { found: false };
  const cs = getComputedStyle(sc), mr = md.getBoundingClientRect();
  return {
    found: true,
    inHost: !!sc.closest('#goals-overlays'),
    position: cs.position,
    covers: cs.inset === '0px' || (cs.top === '0px' && cs.left === '0px'),
    centredX: Math.abs((mr.left + mr.width / 2) - window.innerWidth / 2) < 40,
    onScreen: mr.top >= 0 && mr.bottom <= window.innerHeight + 2,
    modalBg: getComputedStyle(md).backgroundColor
  };
});
console.log('17. categories modal:', JSON.stringify(modal));
await p.screenshot({ path: 'modal.png' });
await p.keyboard.press('Escape');
const cancelBtn = await p.$('#catcancel'); if (cancelBtn) await cancelBtn.click();
await p.waitForTimeout(300);


// ---- the two halves must not fight over the shared topbar --------------
await p.click('[data-gnav="notes"]'); await p.waitForTimeout(400);
const t0 = await p.$eval('#page-title', n => n.textContent);
// force a contacts-side data push while the goals half is on screen
await p.evaluate(() => window.__STORE && (window.__STORE['industries/zz'] = { name: 'Ping' }));
await p.evaluate(() => { const r = window.__FB; r.setDoc(r.docRef('industries/zz'), { name: 'Ping' }); });
await p.waitForTimeout(800);
const t1 = await p.$eval('#page-title', n => n.textContent);
console.log('19. title survives a background contacts update:',
  JSON.stringify({ before: t0, after: t1, ok: t0 === 'Notes' && t1 === 'Notes' }));

// the sidebar is the only goal navigation now — it must drive the topbar
for (const [nav, want] of [['garrett','Garrett'], ['build','Build night'], ['samuel','Samuel']]) {
  await p.click(`[data-gnav="${nav}"]`); await p.waitForTimeout(350);
  const got = await p.$eval('#page-title', n => n.textContent);
  console.log(`20.${nav}: topbar reads "${got}"`, got === want ? '' : `  <-- expected "${want}"`);
}
console.log('20b. no leftover hidden tab strip:',
  await p.$$eval('#viewSwitch', n => n.length === 0));

// ---- the sign-in gate is also outside #goals-root; it must be styled too ----
await p.click('#switchMe'); await p.waitForTimeout(800);
const gate = await p.evaluate(() => {
  const g = document.getElementById('gate');
  const card = document.querySelector('.gate-card');
  if (!g || !card) return { found: false };
  const cs = getComputedStyle(g), cr = card.getBoundingClientRect();
  return { found: true, inHost: !!g.closest('#goals-overlays'), position: cs.position,
           centred: Math.abs((cr.left + cr.width / 2) - window.innerWidth / 2) < 40,
           cardBg: getComputedStyle(card).backgroundColor, cardW: Math.round(cr.width) };
});
console.log('18. sign-in gate:', JSON.stringify(gate));
await p.screenshot({ path: 'gate.png' });


console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

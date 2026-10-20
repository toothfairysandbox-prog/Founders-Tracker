/* Who gets in, and who the app thinks they are.
 *
 * The trap here is personById(): anything it doesn't recognise falls back to
 * PEOPLE[0]. So a member who isn't on the board — Stuart, or the shared sandbox
 * account — would silently render as Samuel, and his comments would be signed
 * with Samuel's name. These checks pin that down, and also confirm the gate
 * still actually refuses an address that isn't on the list.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ok = (n, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
const errs = [];

async function signInAs(email, name) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(FAKE);
  await ctx.addInitScript(`window.__EMAIL = ${JSON.stringify(email)}; window.__NAME = ${JSON.stringify(name)};`);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
  await p.goto(SITE + '/index.html');
  await p.waitForSelector('#gsi', { timeout: 6000 });
  await p.click('#gsi');
  await p.waitForTimeout(1400);
  return { p, ctx };
}

// ---- Stuart: access, but no column of his own ----
{
  const { p, ctx } = await signInAs('pulpdoc2008@gmail.com', 'Stuart Gibby');

  ok('1. Stuart is let in', !(await p.$eval('#shell', n => n.hidden)));

  const chip = (await p.$eval('#idchip', n => n.textContent)).replace(/\s+/g, ' ');
  ok('2. and is shown as himself, not Samuel', /Stuart/.test(chip) && !/Samuel/.test(chip), chip);

  await p.click('[data-gnav="both"]');
  await p.waitForTimeout(500);
  const cols = await p.$$eval('#goals-root .col-head .name', ns => ns.map(n => n.textContent));
  ok('3. the board still shows two founder columns', JSON.stringify(cols) === '["Samuel","Garrett"]', JSON.stringify(cols));
  ok('4. and no column of his own', !cols.includes('Stuart'));

  // access is full — it just isn't his goals
  await p.click('[data-act="openadd"][data-p="samuel"]');
  await p.fill('[data-draft="new:samuel"]', 'Stuart can write to the board');
  await p.click('[data-act="createconfirm"][data-p="samuel"]');
  await p.waitForTimeout(600);
  const wrote = await p.evaluate(() => {
    const k = Object.keys(window.__STORE).find(x => x.includes('/goals/'));
    return k ? window.__STORE[k].title : null;
  });
  ok('5. he has edit access, not just read', wrote === 'Stuart can write to the board', String(wrote));

  const gid = await p.evaluate(() => {
    const k = Object.keys(window.__STORE).find(x => x.includes('/goals/'));
    return k ? window.__STORE[k].id : null;
  });
  await p.click(`[data-act="toggle"][data-id="${gid}"]`);
  await p.waitForTimeout(400);
  const posting = await p.$eval('#goals-root .composer .due', n => n.textContent);
  ok('6. comments are signed as Stuart', /Stuart/.test(posting), posting);
  await ctx.close();
}

// ---- the shared sandbox account keeps its own identity ----
{
  const { p, ctx } = await signInAs('toothfairysandbox@gmail.com', 'Tooth Fairy');
  const chip = (await p.$eval('#idchip', n => n.textContent)).replace(/\s+/g, ' ');
  ok('7. the sandbox account is not Stuart and not Samuel',
    !/Stuart/.test(chip) && !/Signed in as Samuel/.test(chip), chip);
  await ctx.close();
}

// ---- and the gate still refuses an address that isn't listed ----
{
  const { p, ctx } = await signInAs('stranger@example.com', 'Passing Stranger');
  ok('8. an address not on the list is refused', (await p.$eval('#shell', n => n.hidden)) === true);
  const gate = await p.$$eval('.gate-msg', ns => ns.map(n => n.textContent).join(' '));
  ok('9. and told why', /access list/i.test(gate), gate.slice(0, 90));
  await ctx.close();
}

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 4), null, 1) : '[]');
await b.close();

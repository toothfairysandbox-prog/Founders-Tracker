/* Attachments end-to-end: pick files, watch them upload, save the note,
   reopen it, remove one, delete the note — and check storage agrees at
   every step. Runs against a stand-in Supabase (fakesupa.py) so the real
   XHR/fetch code paths are exercised, not mocked away. */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SUPA = process.env.SUPA_URL || 'http://localhost:8100';
const SITE = process.env.SITE_URL || 'http://localhost:8101';
const files = async () => (await fetch(SUPA + '/__files')).json();

await fetch(SUPA + '/__reset');

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(FAKE);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => {
  if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push('CONSOLE ' + m.text());
});

const ok = (n, cond, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi');
await p.click('#gsi');
await p.waitForTimeout(1000);
await p.click('[data-gnav="notes"]');
await p.waitForTimeout(400);

// --- 1. the upload control is offered at all -----------------------------
await p.click('[data-act="newnote"]');
await p.waitForTimeout(300);
ok('1 upload box shown when storage is configured', await p.$$eval('#attDrop', n => n.length === 1));
ok('1b "not set up" notice absent',                 await p.$$eval('.att-off', n => n.length === 0));

// --- 2. a mixed batch uploads --------------------------------------------
await p.fill('[data-draft="nf-title"]', 'Call with Dr. Hobbs');
await p.setInputFiles('#attInput', [
  { name: 'deck.pptx',  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.alloc(4096, 7) },
  { name: 'model.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         buffer: Buffer.alloc(2048, 3) },
  { name: 'scan.pdf',   mimeType: 'application/pdf',                                                           buffer: Buffer.alloc(9000, 1) },
  { name: 'shot.png',   mimeType: 'image/png',                                                                 buffer: Buffer.alloc(1500, 9) }
]);
await p.waitForTimeout(1800);
const rows = await p.$$eval('.att-list .att-row', n => n.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
ok('2 all four attached', rows.length === 4, JSON.stringify(rows));
let st = await files();
ok('2b four objects in storage', st.paths.length === 4, JSON.stringify(st.paths));
ok('2c stored under the note id', st.paths.every(x => /^notes\/n[a-z0-9]+\//.test(x)));
ok('2d bytes intact', st.sizes[st.paths.find(x => /deck/.test(x))] === 4096);
ok('2e kind icons differ', await p.$$eval('.att-list .att-ico',
   n => new Set(n.map(x => x.textContent)).size >= 3));

// --- 3. oversize and executables are refused before any upload -----------
await p.setInputFiles('#attInput', [
  { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10, 1) }]);
await p.waitForTimeout(600);
ok('3 .exe refused', /blocked/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')));
st = await files();
ok('3b nothing extra uploaded', st.paths.length === 4);

const HUGE = '/tmp/claude-0/huge.zip';
if (!fs.existsSync(HUGE)) fs.writeFileSync(HUGE, Buffer.alloc(51 * 1024 * 1024, 1));
await p.setInputFiles('#attInput', HUGE);
await p.waitForTimeout(1500);
ok('3c oversize refused', /limit is/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')));
ok('3d still four in storage', (await files()).paths.length === 4);

// --- 4. saving keeps them, and they survive a reload ---------------------
await p.click('[data-act="savenote"]');
await p.waitForTimeout(700);
ok('4 strip renders on the saved note', await p.$$eval('.att-strip .att-row', n => n.length === 4));
const saved = await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.startsWith('notes/'));
  return window.__STORE[k];
});
ok('4b file list persisted to the database', (saved.files || []).length === 4);
ok('4c metadata only — no bytes in the note', JSON.stringify(saved).length < 3000,
   'note doc is ' + JSON.stringify(saved).length + ' bytes');

// --- 5. signed links: preview in a tab, or download ----------------------
const signed = [];
p.on('request', r => { if (/\/object\/sign\//.test(r.url())) signed.push(r.url()); });

const pdfRow = '.att-strip .att-row:has([data-kind="pdf"]) .att-name';
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null),
  p.click(pdfRow)
]);
/* The thing that was broken: the tab is claimed inside the click, before the
   signing round trip, so the popup blocker never sees an orphan window.open.
   (This stand-in server returns no content type, so Chromium won't actually
   render the placeholder bytes as a PDF — the tab opening at all, plus the
   signed request going out, is what's under test.) */
await p.waitForTimeout(800);
ok('5 PDF opens a tab, not blocked by the popup blocker', !!popup,
   popup ? 'tab opened' : 'no tab opened');
ok('5a and it signed the pdf', signed.some(u => /scan\.pdf$/.test(u)),
   signed.map(u => u.split('/').pop().slice(0, 28)).join(' '));
if (popup) await popup.close();

// a deck is not previewable, so it should download rather than open a tab
const before = ctx.pages().length;
const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
await p.click('.att-strip .att-row:has([data-kind="slide"]) .att-name');
const got = await dl;
await p.waitForTimeout(500);
ok('5b a .pptx downloads instead of opening a tab',
   !!got && ctx.pages().length === before,
   got ? 'as ' + got.suggestedFilename() : 'no download fired');
ok('5b-name it keeps the original filename',
   !!got && got.suggestedFilename() === 'deck.pptx',
   got ? got.suggestedFilename() : '');
ok('5c both went through /object/sign', signed.length >= 2, signed.length + ' signed requests');

// --- 6. removing one, then cancelling, leaves it alone -------------------
await p.click('.note .note-title');           // expand so Edit/Delete show
await p.waitForTimeout(300);
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.click('.att-list .att-row:first-child .att-x');
await p.waitForTimeout(300);
ok('6 row disappears from the form', await p.$$eval('.att-list .att-row', n => n.length === 3));
await p.click('[data-act="cancelnote"]');
await p.waitForTimeout(700);
ok('6b cancel puts it back on the note', await p.$$eval('.att-strip .att-row', n => n.length === 4));
ok('6c cancel did not delete the object', (await files()).paths.length === 4);

// --- 7. removing one and saving really deletes it ------------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.click('.att-list .att-row:first-child .att-x');
await p.click('[data-act="savenote"]');
await p.waitForTimeout(900);
ok('7 three left on the note', await p.$$eval('.att-strip .att-row', n => n.length === 3));
ok('7b three left in storage', (await files()).paths.length === 3, JSON.stringify((await files()).paths.length));

// --- 8. a file added then cancelled is not left behind -------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.setInputFiles('#attInput', [
  { name: 'stray.csv', mimeType: 'text/csv', buffer: Buffer.alloc(120, 5) }]);
await p.waitForTimeout(1200);
ok('8 uploaded while editing', (await files()).paths.length === 4);
await p.click('[data-act="cancelnote"]');
await p.waitForTimeout(900);
ok('8b cancel cleaned up the orphan', (await files()).paths.length === 3,
   JSON.stringify((await files()).paths));

// --- 9. deleting the note takes its files with it ------------------------
await p.click('[data-act="delnote"]');
await p.click('[data-act="delnote"]');
await p.waitForTimeout(1200);
ok('9 storage emptied with the note', (await files()).paths.length === 0,
   JSON.stringify((await files()).paths));

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await p.screenshot({ path: 'att-check.png' });
await b.close();

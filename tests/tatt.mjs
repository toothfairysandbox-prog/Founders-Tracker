/* Attachments end to end: pick files, watch them upload, save the note,
   reopen it, remove one, delete the note — checking storage agrees at every
   step. Firebase Storage is stubbed in fake-firebase.js, the same boundary the
   database is stubbed at, so nothing here touches the real project. */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(FAKE);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => {
  if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push('CONSOLE ' + m.text());
});

const files = () => p.evaluate(() => window.__FILES);
const paths = async () => Object.keys(await files());
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
ok('1 upload box shown when storage is available', await p.$$eval('#attDrop', n => n.length === 1));
ok('1b "not set up" notice absent',                await p.$$eval('.att-off', n => n.length === 0));

// --- 2. a mixed batch uploads --------------------------------------------
await p.fill('[data-draft="nf-title"]', 'Call with Dr. Hobbs');
await p.setInputFiles('#attInput', [
  { name: 'Pitch deck Sept.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.alloc(4096, 7) },
  { name: 'model.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.alloc(2048, 3) },
  { name: 'scan.pdf',   mimeType: 'application/pdf', buffer: Buffer.alloc(9000, 1) },
  { name: 'shot.png',   mimeType: 'image/png',       buffer: Buffer.alloc(1500, 9) }
]);
await p.waitForTimeout(1800);
const rows = await p.$$eval('.att-list .att-row', n => n.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
ok('2 all four attached', rows.length === 4, JSON.stringify(rows));
ok('2b four objects in storage', (await paths()).length === 4, JSON.stringify(await paths()));
ok('2c stored under the note id', (await paths()).every(x => /^notes\/n[a-z0-9]+\//.test(x)));
const st2 = await files();
ok('2d bytes intact', st2[(await paths()).find(x => /Pitch/.test(x))].bytes === 4096);
ok('2e badges show the extension', await p.$$eval('.att-list .att-ico',
   n => n.map(x => x.textContent).join(',') ), '');

// the filename the user gets back must be the one they uploaded, not the key
const deckMeta = st2[(await paths()).find(x => /Pitch/.test(x))].meta;
ok('2f a deck is marked as a download, under its real name',
   /^attachment; filename="Pitch deck Sept\.pptx"$/.test(deckMeta.contentDisposition),
   deckMeta.contentDisposition);
const pdfMeta = st2[(await paths()).find(x => /scan/.test(x))].meta;
ok('2g a PDF is marked to display inline',
   /^inline; filename="scan\.pdf"$/.test(pdfMeta.contentDisposition), pdfMeta.contentDisposition);
ok('2h content type preserved', pdfMeta.contentType === 'application/pdf', pdfMeta.contentType);

// --- 3. oversize and executables are refused before any upload -----------
await p.setInputFiles('#attInput', [
  { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10, 1) }]);
await p.waitForTimeout(600);
ok('3 .exe refused', /blocked/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')));
ok('3b nothing extra uploaded', (await paths()).length === 4);

const HUGE = '/tmp/claude-0/huge.zip';
if (!fs.existsSync(HUGE)) fs.writeFileSync(HUGE, Buffer.alloc(51 * 1024 * 1024, 1));
await p.setInputFiles('#attInput', HUGE);
await p.waitForTimeout(1500);
ok('3c oversize refused', /limit is/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')));
ok('3d still four in storage', (await paths()).length === 4);

// --- 3e a refusal from storage surfaces as a readable sentence -----------
await p.evaluate(() => { window.__FAIL_UPLOAD = true; });
await p.setInputFiles('#attInput', [
  { name: 'denied.txt', mimeType: 'text/plain', buffer: Buffer.alloc(50, 1) }]);
await p.waitForTimeout(900);
ok('3e a rules rejection explains itself',
   /storage\.rules/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')),
   await p.$eval('.att-err', n => n.textContent).catch(() => ''));
await p.evaluate(() => { window.__FAIL_UPLOAD = false; });

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

// --- 5. opening a file ---------------------------------------------------
const pdfRow = '.att-strip .att-row:has([data-kind="pdf"]) .att-name';
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null),
  p.click(pdfRow)
]);
/* The thing that was broken once: the tab is claimed inside the click, before
   the URL is fetched, so the popup blocker never sees an orphan window.open. */
await p.waitForTimeout(800);
ok('5 PDF opens a tab, not blocked by the popup blocker', !!popup);
if (popup) {
  await popup.waitForURL(/^blob:/, { timeout: 4000 }).catch(() => {});
  const asked = await p.evaluate(() => window.__URL_CALLS[window.__URL_CALLS.length - 1] || '');
  ok('5a it asked storage for the PDF and pointed the tab at what came back',
     /scan\.pdf$/.test(asked) && /^blob:/.test(popup.url()), asked.split('/').pop());
  await popup.close();
}
const before = ctx.pages().length;
const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
await p.click('.att-strip .att-row:has([data-kind="slide"]) .att-name');
const got = await dl;
await p.waitForTimeout(500);
ok('5b a .pptx downloads instead of opening a tab', !!got && ctx.pages().length === before,
   got ? 'fired' : 'no download fired');

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
ok('6c cancel did not delete the object', (await paths()).length === 4);

// --- 7. removing one and saving really deletes it ------------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.click('.att-list .att-row:first-child .att-x');
await p.click('[data-act="savenote"]');
await p.waitForTimeout(900);
ok('7 three left on the note', await p.$$eval('.att-strip .att-row', n => n.length === 3));
ok('7b three left in storage', (await paths()).length === 3);

// --- 8. a file added then cancelled is not left behind -------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.setInputFiles('#attInput', [
  { name: 'stray.csv', mimeType: 'text/csv', buffer: Buffer.alloc(120, 5) }]);
await p.waitForTimeout(1200);
ok('8 uploaded while editing', (await paths()).length === 4);
await p.click('[data-act="cancelnote"]');
await p.waitForTimeout(900);
ok('8b cancel cleaned up the orphan', (await paths()).length === 3, JSON.stringify(await paths()));

// --- 9. deleting the note takes its files with it ------------------------
await p.click('[data-act="delnote"]');
await p.click('[data-act="delnote"]');
await p.waitForTimeout(1200);
ok('9 storage emptied with the note', (await paths()).length === 0, JSON.stringify(await paths()));

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

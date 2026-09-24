/* Attachments end to end: pick files, watch them upload, save the note, reopen
   it, remove one, delete the note — checking the database agrees at every step.
   Files are chunked into Firestore documents, so the fake database in
   fake-firebase.js covers storage too and nothing here touches the real project. */
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

/* Everything the app has actually written, read straight out of the fake db. */
const chunkKeys = () => p.evaluate(() =>
  Object.keys(window.__STORE).filter(k => k.startsWith('filechunks/')));
const fids = async () =>
  [...new Set((await chunkKeys()).map(k => k.slice(11).replace(/_\d+$/, '')))];
/* Decodes what's stored and reports its true byte length — this is what proves
   a file split across several documents comes back whole. */
const storedBytes = (fid) => p.evaluate((f) => {
  const keys = Object.keys(window.__STORE)
    .filter(k => k.startsWith('filechunks/' + f + '_'))
    .sort((a, b) => +a.split('_').pop() - +b.split('_').pop());
  return keys.reduce((n, k) => n + atob(window.__STORE[k].b).length, 0);
}, fid);
const noteFiles = () => p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.startsWith('notes/'));
  return k ? (window.__STORE[k].files || []) : [];
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
ok('1 upload box shown when the database is up', await p.$$eval('#attDrop', n => n.length === 1));
ok('1b offline notice absent',                   await p.$$eval('.att-off', n => n.length === 0));

// --- 2. a mixed batch uploads, including one too big for a single document
await p.fill('[data-draft="nf-title"]', 'Call with Dr. Hobbs');
const BIG = 1_300_000;                       // 3 chunks at 525,000 bytes each
await p.setInputFiles('#attInput', [
  { name: 'Pitch deck Sept.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.alloc(BIG, 7) },
  { name: 'model.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.alloc(2048, 3) },
  { name: 'scan.pdf',   mimeType: 'application/pdf', buffer: Buffer.alloc(9000, 1) },
  { name: 'shot.png',   mimeType: 'image/png',       buffer: Buffer.alloc(1500, 9) }
]);
await p.waitForTimeout(4000);
const rows = await p.$$eval('.att-list .att-row', n => n.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
ok('2 all four attached', rows.length === 4, JSON.stringify(rows));
ok('2b four files in the database', (await fids()).length === 4, JSON.stringify(await fids()));

const metas = await p.evaluate(() => window.__ATT && window.__STATE_FILES || null);
const formFiles = await p.evaluate(() =>
  Array.from(document.querySelectorAll('.att-list .att-row .att-name'))
       .map(n => ({ fid: n.getAttribute('data-fid'), name: n.getAttribute('data-fn') })));
const deck = formFiles.find(f => /Pitch/.test(f.name));

ok('2c the big file was split across documents',
   (await chunkKeys()).filter(k => k.includes(deck.fid)).length === 3,
   (await chunkKeys()).filter(k => k.includes(deck.fid)).length + ' chunks');
ok('2d and it decodes back to exactly its original size',
   (await storedBytes(deck.fid)) === BIG,
   (await storedBytes(deck.fid)) + ' vs ' + BIG);
const png = formFiles.find(f => /shot/.test(f.name));
ok('2e a small file is a single document',
   (await chunkKeys()).filter(k => k.includes(png.fid)).length === 1);
ok('2f badges show the extension',
   (await p.$$eval('.att-list .att-ico', n => n.map(x => x.textContent))).join(',') ===
   'PPTX,XLSX,PDF,PNG',
   (await p.$$eval('.att-list .att-ico', n => n.map(x => x.textContent))).join(','));
ok('2g usage meter appears', await p.$$eval('.att-use', n => n.length === 1),
   await p.$eval('.att-use', n => n.textContent).catch(() => ''));

// --- 3. oversize and executables are refused before any upload -----------
await p.setInputFiles('#attInput', [
  { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10, 1) }]);
await p.waitForTimeout(600);
ok('3 .exe refused', /blocked/i.test(await p.$eval('.att-err', n => n.textContent).catch(() => '')));
ok('3b nothing extra uploaded', (await fids()).length === 4);

const HUGE = '/tmp/claude-0/huge11.zip';
if (!fs.existsSync(HUGE)) fs.writeFileSync(HUGE, Buffer.alloc(11 * 1024 * 1024, 1));
await p.setInputFiles('#attInput', HUGE);
await p.waitForTimeout(1500);
const bigErr = await p.$eval('.att-err', n => n.textContent).catch(() => '');
ok('3c oversize refused, and says what to do instead',
   /limit is/i.test(bigErr) && /Drive/i.test(bigErr), bigErr.slice(0, 96));
ok('3d still four in the database', (await fids()).length === 4);

// --- 4. saving keeps them ------------------------------------------------
await p.click('[data-act="savenote"]');
await p.waitForTimeout(900);
ok('4 strip renders on the saved note', await p.$$eval('.att-strip .att-row', n => n.length === 4));
const saved = await noteFiles();
ok('4b file list persisted', saved.length === 4);
ok('4c chunk counts recorded', saved.find(f => /Pitch/.test(f.name)).chunks === 3);
const noteDoc = await p.evaluate(() => {
  const k = Object.keys(window.__STORE).find(x => x.startsWith('notes/'));
  return JSON.stringify(window.__STORE[k]).length;
});
ok('4d the note stays small — no bytes in it', noteDoc < 3000, noteDoc + ' bytes');

// --- 5. opening a file ---------------------------------------------------
const pdfRow = '.att-strip .att-row:has([data-kind="pdf"]) .att-name';
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null),
  p.click(pdfRow)
]);
/* The thing that was broken once: the tab is claimed inside the click, before
   the chunks are fetched, so the popup blocker never sees an orphan window.open. */
await p.waitForTimeout(1000);
ok('5 PDF opens a tab, not blocked by the popup blocker', !!popup);
if (popup) {
  await popup.waitForURL(/^blob:/, { timeout: 4000 }).catch(() => {});
  ok('5a and the tab holds the reassembled file', /^blob:/.test(popup.url()), popup.url().slice(0, 40));
  await popup.close();
}
const before = ctx.pages().length;
const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
await p.click('.att-strip .att-row:has([data-kind="slide"]) .att-name');
const got = await dl;
await p.waitForTimeout(500);
ok('5b a .pptx downloads instead of opening a tab', !!got && ctx.pages().length === before,
   got ? 'fired' : 'no download fired');
ok('5c and under the name the user uploaded',
   !!got && got.suggestedFilename() === 'Pitch deck Sept.pptx',
   got ? got.suggestedFilename() : '');

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
ok('6c cancel did not delete the data', (await fids()).length === 4);

// --- 7. removing one and saving really deletes it ------------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.click('.att-list .att-row:first-child .att-x');
await p.click('[data-act="savenote"]');
await p.waitForTimeout(1200);
ok('7 three left on the note', await p.$$eval('.att-strip .att-row', n => n.length === 3));
ok('7b three left in the database', (await fids()).length === 3, JSON.stringify(await fids()));
ok('7c every chunk of the removed file is gone — not just the first',
   (await chunkKeys()).length === (await noteFiles()).reduce((n, f) => n + (f.chunks || 1), 0),
   (await chunkKeys()).length + ' chunks for ' + (await noteFiles()).length + ' files');

// --- 8. a file added then cancelled is not left behind -------------------
await p.click('[data-act="editnote"]');
await p.waitForTimeout(400);
await p.setInputFiles('#attInput', [
  { name: 'stray.csv', mimeType: 'text/csv', buffer: Buffer.alloc(120, 5) }]);
await p.waitForTimeout(1200);
ok('8 uploaded while editing', (await fids()).length === 4);
await p.click('[data-act="cancelnote"]');
await p.waitForTimeout(1000);
ok('8b cancel cleaned up the orphan', (await fids()).length === 3, JSON.stringify(await fids()));

// --- 9. deleting the note takes its files with it ------------------------
await p.click('[data-act="delnote"]');
await p.click('[data-act="delnote"]');
await p.waitForTimeout(1500);
ok('9 database emptied with the note', (await chunkKeys()).length === 0,
   JSON.stringify(await chunkKeys()));

console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6), null, 1) : '[]');
await b.close();

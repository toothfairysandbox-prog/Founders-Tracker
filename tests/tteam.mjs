/* To-do and Documents end to end, against the fake database in
   fake-firebase.js. Seeds to-dos the way the scanner writes them, then does
   what you and Sam would do on the page and checks the database agrees. */
import { chromium } from 'playwright';
import fs from 'fs';

const FAKE = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
const SITE = process.env.SITE_URL || 'http://localhost:8101';

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript(FAKE);
/* The real Firebase SDK would load from gstatic and replace the fake. */
await ctx.route(/gstatic\.com\/firebasejs/, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
p.on('console', m => {
  if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push('CONSOLE ' + m.text());
});
p.on('dialog', d => d.accept());

let failed = 0;
const ok = (n, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const doc = (path) => p.evaluate((k) => window.__STORE[k], path);
const keys = (prefix) => p.evaluate((pre) => Object.keys(window.__STORE).filter(k => k.startsWith(pre)), prefix);
const put = (path, data) => p.evaluate(([k, d]) => window.__FB.setDoc({ __doc: k }, d), [path, data]);
const wait = (ms = 300) => p.waitForTimeout(ms);

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const src = (kind, label, quote) => ({ kind, label, quote, url: 'https://example.com/' + kind, at: new Date().toISOString(), ref: kind + ':' + label });

await p.goto(SITE + '/index.html');
await p.waitForSelector('#gsi');
await p.click('#gsi');
await wait(1000);

// --- sidebar order ---------------------------------------------------------
const sections = await p.$$eval('.sidebar .navsection', n => n.map(x => x.textContent.trim()));
ok('1 sidebar order is Goal setting, Contacts, Team', JSON.stringify(sections) === '["Goal setting","Contacts","Team"]', JSON.stringify(sections));
const team = await p.$$eval('[data-wnav]', n => n.map(x => x.getAttribute('data-wnav')));
ok('1b Team holds To-do then Documents', JSON.stringify(team) === '["todo","docs"]');

// --- seed what the scanner would have written --------------------------------
await put('todos/t1', { text: 'Send Dr. Patel the pilot pricing sheet', owner: 'garrett', priority: 'high', due: day(-2), status: 'open',
  sources: [src('slack', 'DM with Sam', 'can you send Patel the pricing by Friday?')], createdAt: new Date().toISOString(), createdBy: 'scanner' });
await put('todos/t2', { text: 'Book the Sandbox demo room', owner: 'samuel', priority: 'normal', due: null, status: 'open',
  sources: [src('gmail', 'Sandbox demo day', null)], createdAt: new Date().toISOString(), createdBy: 'scanner' });
await put('todos/t3', { text: 'Sign the Twilio BAA', owner: 'both', priority: 'normal', due: null, status: 'done',
  doneAt: new Date().toISOString(), doneBy: 'scanner', doneNote: 'done per Gmail, Oct 2',
  sources: [src('gmail', 'Twilio BAA', null)], createdAt: new Date().toISOString(), createdBy: 'scanner' });
await put('todos/t4', { text: 'Not a real task', owner: 'garrett', priority: 'low', status: 'deleted',
  sources: [src('claude', 'dental session', null)], createdAt: new Date().toISOString(), createdBy: 'scanner' });
await put('todos/t5', { text: 'Water the plant', owner: 'both', priority: 'low', due: null, status: 'open',
  sources: [{ kind: 'slack', label: 'x', url: 'javascript:alert(1)' }], createdAt: new Date().toISOString(), createdBy: 'scanner' });

// --- open the tab ----------------------------------------------------------
await p.click('[data-wnav="todo"]');
await wait();
const vis = await p.evaluate(() => ({
  todo: !document.getElementById('todo-root').hidden,
  contacts: !document.getElementById('view-root').hidden,
  goals: !document.getElementById('goals-root').hidden,
  docs: !document.getElementById('docs-root').hidden,
  title: document.getElementById('page-title').textContent,
  newBtn: !document.getElementById('newContactBtn').hidden,
  active: [...document.querySelectorAll('.navitem.active')].map(n => n.textContent.trim())
}));
ok('2 To-do shows alone', vis.todo && !vis.contacts && !vis.goals && !vis.docs, JSON.stringify(vis));
ok('2b title and nav say To-do', vis.title === 'To-do' && vis.active.length === 1 && /To-do/.test(vis.active[0]), JSON.stringify(vis.active));
ok('2c no "+ New contact" here', !vis.newBtn);
ok('3 nav count is the open tasks', (await p.$eval('#nav-count-todo', n => n.textContent)) === '3');

const groups = await p.$$eval('.todo-group h3', n => n.map(x => x.textContent.replace(/\d+/g, '').trim()));
ok('4 overdue first, then open, then recently done', groups[0] === 'Overdue' && groups[1] === 'Open' && /Done in the last/.test(groups[2]), JSON.stringify(groups));
const texts = await p.$$eval('.todo-text', n => n.map(x => x.textContent));
ok('4b deleted tasks stay hidden', !texts.includes('Not a real task'));
ok('4c source and quote shown', await p.$$eval('.todo-row[data-id="t1"] .todo-src', n => n.length === 1 && /Slack · DM with Sam/.test(n[0].textContent) && /pricing by Friday/.test(n[0].textContent)));
ok('4d auto-check note shown', await p.$eval('.todo-row[data-id="t3"] .todo-done', n => /done per Gmail/.test(n.textContent)));
ok('4e a javascript: link is not made clickable', await p.$$eval('.todo-row[data-id="t5"] .todo-src a', n => n.length === 0));

await p.click('[data-tact="who"][data-v="samuel"]'); await wait();
const samTexts = await p.$$eval('.todo-text', n => n.map(x => x.textContent));
ok('5 Sam filter shows his and shared tasks only', !samTexts.includes('Send Dr. Patel the pilot pricing sheet') && samTexts.includes('Book the Sandbox demo room') && samTexts.includes('Water the plant'), JSON.stringify(samTexts));
await p.click('[data-tact="who"][data-v="all"]'); await wait();

// --- check off, uncheck ----------------------------------------------------
await p.check('.todo-row[data-id="t2"] .todo-check'); await wait();
let t2 = await doc('todos/t2');
ok('6 checking it off saves who and when', t2.status === 'done' && t2.doneBy === 'samuel' && !!t2.doneAt, JSON.stringify(t2));
await p.uncheck('.todo-row[data-id="t3"] .todo-check'); await wait();
let t3 = await doc('todos/t3');
ok('7 unchecking an auto-check reopens it and locks the checkbox from the scanner', t3.status === 'open' && t3.locked && t3.locked.status === true, JSON.stringify(t3));

// --- edit text, a push arrives mid-edit --------------------------------------
await p.click('.todo-row[data-id="t1"] .todo-text'); await wait();
await p.fill('#todo-edit-t1', 'Send Dr. Patel the pilot pricing sheet + case study');
await put('contacts/c1', { name: 'Dr. Hobbs', stage: 'contacted', createdAt: new Date().toISOString() });
await put('todos/t9', { text: 'Pushed in while editing', owner: 'both', status: 'open', sources: [], createdAt: new Date().toISOString(), createdBy: 'scanner' });
await wait();
ok('8 a live update does not wipe what you are typing', (await p.$eval('#todo-edit-t1', n => n.value)) === 'Send Dr. Patel the pilot pricing sheet + case study');
await p.press('#todo-edit-t1', 'Enter'); await wait();
let t1 = await doc('todos/t1');
ok('8b Enter saves and locks the text', t1.text === 'Send Dr. Patel the pilot pricing sheet + case study' && t1.locked.text === true, JSON.stringify(t1.locked));
ok('8c the task that arrived mid-edit appears after', (await p.$$eval('.todo-text', n => n.map(x => x.textContent))).includes('Pushed in while editing'));

// --- background contacts push must not steal the nav or title ------------------
const after = await p.evaluate(() => ({
  title: document.getElementById('page-title').textContent,
  active: [...document.querySelectorAll('.navitem.active')].map(n => n.textContent.trim()),
  todo: !document.getElementById('todo-root').hidden
}));
ok('9 contacts updating in the background leaves To-do in charge', after.title === 'To-do' && after.active.length === 1 && /To-do/.test(after.active[0]) && after.todo, JSON.stringify(after));

// --- owner / priority / due ----------------------------------------------------
await p.selectOption('.todo-row[data-id="t1"] [data-tact="priority"]', 'low'); await wait();
await p.selectOption('.todo-row[data-id="t1"] [data-tact="owner"]', 'samuel'); await wait();
await p.fill('.todo-row[data-id="t1"] [data-tact="due"]', day(5)); await wait();
t1 = await doc('todos/t1');
ok('10 priority, owner and due save and lock', t1.priority === 'low' && t1.owner === 'samuel' && t1.due === day(5) && t1.locked.priority && t1.locked.owner && t1.locked.due, JSON.stringify(t1));
ok('10b no longer overdue once moved out', !(await p.$$eval('.todo-group h3', n => n.map(x => x.textContent))).some(t => /Overdue/.test(t)));

// --- delete and undo -----------------------------------------------------------
await p.click('.todo-row[data-id="t5"] [data-tact="delete"]'); await wait();
ok('11 delete marks it deleted, keeps the record', (await doc('todos/t5')).status === 'deleted');
ok('11b it leaves the list', !(await p.$$eval('.todo-text', n => n.map(x => x.textContent))).includes('Water the plant'));
await p.click('#todo-toast button'); await wait();
ok('11c Undo brings it back', (await doc('todos/t5')).status === 'open');

await p.click('[data-tact="show"][data-v="done"]'); await wait();
ok('12 Done filter lists finished tasks', (await p.$$eval('.todo-text', n => n.map(x => x.textContent))).includes('Book the Sandbox demo room'));
await p.click('[data-tact="show"][data-v="open"]'); await wait();

// --- last scan line --------------------------------------------------------------
await put('settings/todoScanner', { lastRunAt: new Date().toISOString(), lastSummary: '2 added, 1 checked off' });
await wait();
ok('13 last scan shown', /Last scan .*2 added, 1 checked off/.test(await p.$eval('.todo-scan', n => n.textContent)));

// --- phone width -------------------------------------------------------------------
await p.setViewportSize({ width: 375, height: 800 });
await wait();
ok('14 no sideways scroll on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await p.screenshot({ path: 'todo-phone.png' });
await p.setViewportSize({ width: 1400, height: 1000 });
await wait();
await p.screenshot({ path: 'todo.png' });

// ================================ Documents ================================
await p.click('[data-wnav="docs"]'); await wait(600);
ok('20 Documents shows alone', await p.evaluate(() => !document.getElementById('docs-root').hidden && document.getElementById('todo-root').hidden && document.getElementById('page-title').textContent === 'Documents'));
const cats = await p.$$eval('.doc-chip', n => n.map(x => x.textContent.replace(/\d+/g, '').trim()));
ok('21 starts with the three categories', JSON.stringify(cats) === '["All","Legal & compliance","Customers","Vendors","Edit categories"]', JSON.stringify(cats));
ok('21b and remembers it seeded them', (await doc('settings/documents') || {}).seeded === true);

await p.setInputFiles('#docs-input', [
  { name: 'Twilio BAA signed.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1_200_000, 5) },
  { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(100, 1) }
]);
await wait(3000);
const docKeys = await keys('documents/');
ok('22 PDF uploaded, program refused', docKeys.length === 1, JSON.stringify(docKeys));
const d1 = await doc(docKeys[0]);
ok('22b filed under the first category, split into chunks', d1.categoryId === 'legal' && d1.file.chunks === 3 && (await keys('filechunks/' + d1.file.fid)).length === 3, JSON.stringify(d1));
ok('22c listed with size and uploader', await p.$eval('.doc-row .doc-sub', n => /1\.1 MB/.test(n.textContent) && /Sam/.test(n.textContent)));

const dl = p.waitForEvent('download');
await p.click('.doc-row [data-dact="download"]');
const download = await dl;
const dlPath = await download.path();
ok('23 download returns the whole file under its own name', download.suggestedFilename() === 'Twilio BAA signed.pdf' && fs.statSync(dlPath).size === 1_200_000, download.suggestedFilename() + ' ' + fs.statSync(dlPath).size);

await p.click('.doc-row [data-dact="rename"]'); await wait();
await p.fill('.doc-rename', 'Twilio BAA');
await p.press('.doc-rename', 'Enter'); await wait();
ok('24 rename keeps the extension', (await doc(docKeys[0])).name === 'Twilio BAA.pdf');

await p.selectOption('.doc-row [data-dact="category"]', 'vendors'); await wait();
ok('25 change category', (await doc(docKeys[0])).categoryId === 'vendors');
await p.click('.doc-chip[data-v="customers"]'); await wait();
ok('25b Customers filter is empty', await p.$$eval('.doc-row', n => n.length === 0));
await p.click('.doc-chip[data-v="all"]'); await wait();

await p.fill('#docs-search', 'nothing like this'); await wait();
ok('26 search filters', await p.$$eval('.doc-row', n => n.length === 0));
ok('26b and keeps focus while you type', await p.evaluate(() => document.activeElement && document.activeElement.id === 'docs-search'));
await p.fill('#docs-search', 'twilio'); await wait();
ok('26c finds by name', await p.$$eval('.doc-row', n => n.length === 1));
await p.fill('#docs-search', ''); await wait();

await p.click('[data-dact="manage"]'); await wait();
await p.fill('#doc-cat-new', 'Investors');
await p.click('[data-dact="cat-add"]'); await wait();
ok('27 add a category', (await p.$$eval('.doc-chip', n => n.map(x => x.textContent))).some(t => /Investors/.test(t)));
await p.click('.doc-cat-row[data-cid="vendors"] [data-dact="cat-delete"]'); await wait(500);
ok('27b deleting a category moves its documents to Uncategorized', (await doc(docKeys[0])).categoryId === null && !(await doc('doccategories/vendors')));
ok('27c and Uncategorized appears', (await p.$$eval('.doc-chip', n => n.map(x => x.textContent))).some(t => /Uncategorized/.test(t)));

await p.click('.doc-row [data-dact="delete"]'); await wait(600);
ok('28 delete removes the record and its chunks', (await keys('documents/')).length === 0 && (await keys('filechunks/')).length === 0);

await p.setViewportSize({ width: 375, height: 800 });
await p.setInputFiles('#docs-input', [{ name: 'NDA.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.alloc(5000, 2) }]);
await wait(1200);
ok('29 Documents fits a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await p.screenshot({ path: 'docs-phone.png' });
await p.setViewportSize({ width: 1400, height: 1000 });
await wait();
await p.screenshot({ path: 'docs.png' });

// --- the other halves still work -------------------------------------------------
await p.click('[data-nav="contacts"]'); await wait();
ok('30 Contacts still opens', await p.evaluate(() => !document.getElementById('view-root').hidden && document.getElementById('docs-root').hidden));
await p.click('[data-gnav="both"]'); await wait();
ok('30b Goals still opens', await p.evaluate(() => !document.getElementById('goals-root').hidden && document.getElementById('todo-root').hidden));

ok('31 no page errors', errs.length === 0, errs.join(' | '));
await b.close();
process.exit(failed ? 1 : 0);

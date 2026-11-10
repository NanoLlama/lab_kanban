// End-to-end check of time-blocker.html (Phase 1): drawing, moving, resizing, keyboard, overlaps,
// the inbox, day notes, persistence, the backup round-trip, and that it never touches the board's storage.
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const http = require('http');
const fs = require('fs');
// Served over http://127.0.0.1 rather than file:// so the test can use the browser's private file storage
// as a stand-in backup folder (it is not available to file:// pages).
const ROOT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  if (req.url === '/blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let FILE, BOARD;
const NOW = new Date(2026, 10, 9, 8, 0); // Mon 9 Nov 2026, 08:00 local: fixed so "next free time" is predictable
const log = (o) => console.log(JSON.stringify(o));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  FILE = base + 'time-blocker.html'; BOARD = base + 'lab-board.html'; // BOARD's origin is the same as FILE's
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // The folder dialog cannot be driven headless; hand back a real folder from the browser's private file storage.
  // This headless Chromium closes the page when a folder handle is read back from IndexedDB (even on a blank
  // page; the board's own autobackup test hits it too). Real Chrome stores and reads them normally. So the test
  // stores a folder's name in place of the handle and swaps the handle back in when it is read. Choosing,
  // writing, permissions and the board's database are otherwise untouched.
  const FS_SHIM = () => {
    if (!(navigator.storage && navigator.storage.getDirectory)) return; // e.g. the opaque page a download opens
    const cache = {};
    (async () => { const root = await navigator.storage.getDirectory(); cache[''] = root; for (const n of ['picked', 'lab-backups']) cache[n] = await root.getDirectoryHandle(n, { create: true }); })();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) { if (v instanceof FileSystemHandle) v = { __fsdir: v.name }; return put.call(this, v, k); };
    const res = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
    Object.defineProperty(IDBRequest.prototype, 'result', { configurable: true, get() { const r = res.get.call(this); return r && r.__fsdir !== undefined ? cache[r.__fsdir] : r; } });
  };
  await ctx.addInitScript(FS_SHIM);
  await ctx.addInitScript(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('picked', { create: true }); });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('labboard.theme', 'dark'); sessionStorage.setItem('seeded', '1'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.goto(FILE);
  await page.waitForSelector('#status[data-s]');
  await page.waitForTimeout(300);

  // Theme falls back to the board's choice without writing it.
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await page.textContent('#tb-date'), 'Mon, Nov 9');
  assert.equal(await page.isHidden('#tb-today'), true);

  const col = await page.$('#tb-col');
  const yFor = (min) => page.evaluate((m) => {
    const c = document.getElementById('tb-col').getBoundingClientRect();
    const [h, mm] = document.querySelector('.tb-hour').textContent.split(':').map(Number);
    return c.top + (m - (h * 60 + mm)) * 64 / 60;
  }, min);
  const times = (t) => page.textContent(`.tb-block:has-text("${t}") .tb-b-time`);
  await page.evaluate(() => (document.getElementById('tb-scroll').scrollTop = 0));
  const box = await col.boundingBox();

  // Click creates a default-length block at the snapped time.
  await page.mouse.click(box.x + 200, await yFor(9 * 60 + 5));
  assert.equal(await page.textContent('#modal-title'), 'New block');
  assert.deepEqual([await page.inputValue('#ed-start'), await page.inputValue('#ed-end')], ['09:00', '10:00']);
  await page.fill('#ed-title', 'Email triage');
  await page.click('[data-m=ed-save]');

  // First change: the time blocker offers automatic backup once. Choose a folder.
  assert.equal(await page.isVisible('#ab-chip'), true);
  assert.equal((await page.textContent('#ab-chip')).trim(), 'Set up backup');
  await page.waitForSelector('#modal-title:text("Set up automatic backup")');
  await page.click('[data-m=ab-choose]');
  await page.waitForSelector('#overlay', { state: 'hidden' });
  assert.match(await page.textContent('#toast'), /Automatic backup on\. Saving _time-blocker\.json to the folder “picked”/);
  assert.equal((await page.textContent('#ab-chip')).trim(), 'Auto-backup on');

  // Drag draws a block of the dragged length.
  const y0 = await yFor(600), y1 = await yFor(690);
  await page.mouse.move(box.x + 200, y0 + 2); await page.mouse.down();
  await page.mouse.move(box.x + 200, y0 + 40, { steps: 4 }); await page.mouse.move(box.x + 200, y1, { steps: 6 }); await page.mouse.up();
  assert.deepEqual([await page.inputValue('#ed-start'), await page.inputValue('#ed-end')], ['10:00', '11:30']);
  await page.fill('#ed-title', 'Write methods');
  await page.click('[data-m=ed-save]');

  // A "none" block typed in by hand overlaps and both are flagged side by side.
  await page.keyboard.press('n');
  await page.fill('#ed-start', '10:30'); await page.fill('#ed-end', '11:00');
  await page.click('label.seg-opt:has(input[value=none])');
  await page.fill('#ed-label', 'Coffee');
  await page.click('[data-m=ed-save]');
  const ov = await page.$$eval('.tb-block.overlap', (b) => b.map((x) => x.querySelector('.tb-b-title').textContent));
  assert.deepEqual(ov.sort(), ['Coffee', 'Write methods']);
  const [wa, wb] = await Promise.all(['Coffee', 'Write methods'].map(async (t) => (await page.$(`.tb-block:has-text("${t}")`)).boundingBox()));
  assert.ok(wa.x + wa.width <= wb.x + 1 || wb.x + wb.width <= wa.x + 1, 'overlapping blocks sit side by side');

  // Drag-move by 30 minutes, then resize and undo.
  let b = await (await page.$('.tb-block:has-text("Email triage")')).boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + b.height / 2 + 20, { steps: 3 }); await page.mouse.move(b.x + 40, b.y + b.height / 2 + 32, { steps: 3 }); await page.mouse.up();
  assert.equal(await times('Email triage'), '09:30–10:30');
  b = await (await page.$('.tb-block:has-text("Write methods")')).boundingBox();
  await page.mouse.move(b.x + 60, b.y + b.height - 2); await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + b.height + 15, { steps: 3 }); await page.mouse.move(b.x + 60, b.y + b.height + 31, { steps: 3 }); await page.mouse.up();
  assert.equal(await times('Write methods'), '10:00–12:00');
  await page.click('#toast [data-toast-act]');
  assert.equal(await times('Write methods'), '10:00–11:30');

  // Keyboard: move twice, grow once, keep focus; Delete then Undo.
  await page.focus('.tb-block:has-text("Coffee")');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await times('Coffee'), '11:00–11:45');
  assert.ok((await page.evaluate(() => document.activeElement.className)).includes('tb-block'));
  await page.keyboard.press('Delete');
  assert.equal(await page.$$eval('.tb-block', (x) => x.length), 2);
  await page.click('#toast [data-toast-act]');
  assert.equal(await page.$$eval('.tb-block', (x) => x.length), 3);

  // Inbox: add two items, drag one to 14:00, block the other at the next free time after now (08:00).
  for (const t of ['Order antibodies', 'Lab meeting prep']) { await page.fill('#ib-add', t); await page.press('#ib-add', 'Enter'); }
  const y14 = await yFor(14 * 60);
  await page.dragAndDrop('.tb-ib:has-text("Order antibodies")', '#tb-col', { targetPosition: { x: 200, y: y14 - box.y + 5 } });
  assert.equal(await times('Order antibodies'), '14:00–15:00');
  await page.click('.tb-ib:has-text("Lab meeting") [data-act=ib-add]');
  assert.equal(await times('Lab meeting prep'), '08:00–09:00');
  assert.deepEqual(await page.$$eval('.tb-ib small', (s) => s.map((x) => x.textContent)), ['1 block today, 1 h', '1 block today, 1 h']);
  assert.match(await page.textContent('#stats'), /5\.3 h planned.*2\.0 h focus.*0\/5 done/);

  // Done: tick the box on a block (no drag, no editor), X on a focused block, and the editor's Done box.
  const isDone = (t) => page.$eval(`.tb-block:has-text("${t}")`, (b) => b.classList.contains('st-done'));
  const before0 = await times('Email triage');
  await page.click('.tb-block:has-text("Email triage") .tb-chk');
  assert.equal(await isDone('Email triage'), true);
  assert.equal(await page.isHidden('#overlay'), true, 'ticking does not open the editor');
  assert.equal(await times('Email triage'), before0, 'ticking does not move the block');
  assert.equal(await page.getAttribute('.tb-block:has-text("Email triage") .tb-chk', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#stats'), /1\/5 done/);
  await page.focus('.tb-block:has-text("Write methods")'); await page.keyboard.press('x');
  assert.equal(await isDone('Write methods'), true);
  assert.ok((await page.evaluate(() => document.activeElement.className)).includes('tb-block'), 'focus stays on the block');
  await page.keyboard.press('x');
  assert.equal(await isDone('Write methods'), false);
  await page.click('.tb-block:has-text("Email triage") .tb-chk');
  assert.equal(await isDone('Email triage'), false);
  await page.click('.tb-block:has-text("Coffee") .tb-b-title');
  assert.equal(await page.isChecked('#ed-done'), false);
  await page.check('#ed-done'); await page.click('[data-m=ed-save]');
  assert.equal(await isDone('Coffee'), true);
  await page.click('.tb-block:has-text("Coffee") .tb-b-title'); await page.uncheck('#ed-done'); await page.click('[data-m=ed-save]');
  assert.equal(await isDone('Coffee'), false);
  await page.click('.tb-block:has-text("Order antibodies") .tb-chk');
  assert.match(await page.textContent('#stats'), /1\/5 done/);

  // Day note, other days, persistence.
  await page.fill('#tb-note', 'Top three: methods, antibodies, meeting');
  await page.keyboard.press('Escape'); await page.click('#tb-next');
  assert.equal(await page.textContent('#tb-date'), 'Tue, Nov 10');
  assert.equal(await page.$$eval('.tb-block', (x) => x.length), 0);
  assert.equal(await page.inputValue('#tb-note'), '');
  await page.click('#tb-today');
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForTimeout(500);
  assert.equal(await page.$$eval('.tb-block', (x) => x.length), 5);
  assert.equal(await page.inputValue('#tb-note'), 'Top three: methods, antibodies, meeting');
  assert.equal(await isDone('Order antibodies'), true);
  assert.equal(await page.$eval('.tb-ib:has-text("Order antibodies")', (x) => x.classList.contains('done')), false, 'a done block leaves its inbox item open');

  // Backup round-trip: download, wipe, restore; the restored state must match.
  const before = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('timeblock'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(JSON.parse(g.result)); }; }));
  await page.click('#btn-backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-m=b-dl]')]);
  assert.equal(dl.suggestedFilename(), 'time-blocker-backup-2026-11-09.json');
  const file = await dl.path();
  const saved = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  assert.equal(saved.days['2026-11-09'].blocks.length, 5);
  await page.click('[data-close]');
  // Restore over a changed day: delete a block first, then restore the file.
  await page.focus('.tb-block:has-text("Coffee")'); await page.keyboard.press('Delete');
  await page.click('#btn-backup');
  await page.setInputFiles('#b-file', file);
  await page.waitForSelector('#b-restore', { state: 'visible' });
  await page.click('#b-restore'); await page.click('#b-restore');
  await page.waitForTimeout(400);
  assert.equal(await page.$$eval('.tb-block', (x) => x.length), 5);
  const after = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('timeblock'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(JSON.parse(g.result)); }; }));
  assert.deepEqual(after.days, before.days);
  assert.deepEqual(after.inbox, before.inbox);

  // The backup file follows every change.
  await page.waitForTimeout(1800);
  const onDisk = await page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked');
    return JSON.parse(await (await (await d.getFileHandle('_time-blocker.json')).getFile()).text());
  });
  assert.deepEqual(onDisk.days, after.days);
  assert.deepEqual(onDisk.inbox, after.inbox);
  // Pause stops writing; it stays paused after a reload; Resume writes at once.
  await page.click('#ab-chip'); await page.click('[data-m=ab-pause]'); await page.click('[data-close]');
  await page.fill('#ib-add', 'Paused item'); await page.press('#ib-add', 'Enter');
  await page.waitForTimeout(1800);
  const readInbox = () => page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked');
    return JSON.parse(await (await (await d.getFileHandle('_time-blocker.json')).getFile()).text()).inbox.map((x) => x.title);
  });
  assert.ok(!(await readInbox()).includes('Paused item'));
  await page.reload(); await page.waitForTimeout(500);
  assert.equal((await page.textContent('#ab-chip')).trim(), 'Resume backup');
  assert.equal(await page.isHidden('#overlay'), true, 'no prompt while the user has paused it');
  await page.click('#ab-chip'); await page.waitForTimeout(400);
  assert.equal((await page.textContent('#ab-chip')).trim(), 'Auto-backup on');
  assert.ok((await readInbox()).includes('Paused item'));

  // Never touches the board's storage.
  const dbs = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).sort();
  assert.deepEqual(dbs, ['timeblock']);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys.filter((k) => k.startsWith('labboard.')), ['labboard.theme']);
  assert.equal(await page.evaluate(() => localStorage.getItem('labboard.theme')), 'dark');

  assert.deepEqual(errors, []);
  log({ test: 'timeblocker:phase1', ok: true });
  await ctx.close();

  // The board already backs up to a folder: the time blocker offers that folder, reads it without changing the
  // board's database, and writes its file beside the board's.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx2.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx2.addInitScript(FS_SHIM);
  const p2 = await ctx2.newPage();
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(e.message));
  await p2.goto(BOARD.replace('lab-board.html', 'blank'));
  // Seed what the board stores when its backup folder is set (done here directly, not through the board's UI).
  const seeded = await p2.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('lab-backups', { create: true });
    await (await (await dir.getFileHandle('main-backup.json', { create: true })).createWritable()).close();
    const db = await new Promise((res) => { const r = indexedDB.open('labboard', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); }; r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(dir, 'backupDir'); tx.oncomplete = res; });
    const keys = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); });
    db.close(); return { version: db.version, keys };
  });
  await p2.goto(FILE);
  await p2.waitForSelector('#status[data-s]');
  await p2.fill('#ib-add', 'First item'); await p2.press('#ib-add', 'Enter');
  await p2.waitForSelector('#modal-title:text("Set up automatic backup")');
  assert.match(await p2.textContent('#modal-body'), /already backs up to the folder lab-backups/);
  await p2.click('[data-m=ab-board]');
  await p2.waitForSelector('#overlay', { state: 'hidden' });
  assert.match(await p2.textContent('#toast'), /the board's folder “lab-backups”/);
  const files = await p2.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('lab-backups'); const n = [];
    for await (const k of d.keys()) n.push(k); return n.sort();
  });
  assert.deepEqual(files, ['_time-blocker.json', 'main-backup.json']);
  const boardAfter = await p2.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('labboard'); r.onsuccess = () => res(r.result); });
    const keys = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); });
    db.close(); return { version: db.version, keys };
  });
  assert.deepEqual(boardAfter, seeded);
  assert.deepEqual(errors2, []);
  log({ test: 'timeblocker:board-folder', ok: true });
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

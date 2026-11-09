// End-to-end check of time-blocker.html (Phase 1): drawing, moving, resizing, keyboard, overlaps,
// the inbox, day notes, persistence, the backup round-trip, and that it never touches the board's storage.
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const FILE = 'file://' + path.resolve(process.env.TIME_BLOCKER || path.join(__dirname, '../time-blocker.html'));
const NOW = new Date(2026, 10, 9, 8, 0); // Mon 9 Nov 2026, 08:00 local: fixed so "next free time" is predictable
const log = (o) => console.log(JSON.stringify(o));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
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

  // Backup round-trip: download, wipe, restore; the restored state must match.
  const before = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('timeblock'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); }; }));
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
  const after = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('timeblock'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); }; }));
  assert.deepEqual(after.days, before.days);
  assert.deepEqual(after.inbox, before.inbox);

  // Never touches the board's storage.
  const dbs = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).sort();
  assert.deepEqual(dbs, ['timeblock']);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys.filter((k) => k.startsWith('labboard.')), ['labboard.theme']);
  assert.equal(await page.evaluate(() => localStorage.getItem('labboard.theme')), 'dark');

  assert.deepEqual(errors, []);
  log({ test: 'timeblocker:phase1', ok: true });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

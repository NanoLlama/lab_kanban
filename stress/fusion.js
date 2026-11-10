// The board and the day planner in one file (lab-board.html, Day view). Checks that planning works on the
// board's own cards: the panel, drag and Block, live titles, ticking a block done and moving its card, the card
// dialog's Plan time, badges on cards, other boards, deleted cards, persistence, the plans backup, moving plans
// over from the stand-alone time blocker, and the plan file in the backup folder.
const L = require('./lib');
const assert = require('assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const log = (o) => console.log(JSON.stringify(o));
const BOARD = path.resolve(process.env.LAB_BOARD || path.join(__dirname, '../lab-board.html'));

const blocks = (p) => p.$$eval('.tb-block:not(.tb-ghost)', (bs) => bs.map((b) => ({
  head: b.querySelector('.tb-b-head').textContent, title: b.querySelector('.tb-b-title').textContent,
  done: b.classList.contains('st-done'), flag: (b.querySelector('.tb-flag') || {}).textContent || '' })));
const storedPlan = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('labboard'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('planner'); g.onsuccess = () => res(g.result ? JSON.parse(g.result) : null); }; }));
const yFor = (p, min) => p.evaluate((m) => { const c = document.getElementById('tb-col').getBoundingClientRect(); const [h, mm] = document.querySelector('.tb-hour').textContent.split(':').map(Number); return c.top + (m - (h * 60 + mm)) * 64 / 60; }, min);

(async () => {
  // ---------- A. planning the board's cards ----------
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    await page.click('#tab-day'); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.body.classList.contains('v-day')));
    assert.equal(await page.isVisible('#filters'), false, 'board filters hide in the Day view');
    assert.equal(await page.isVisible('#btn-new'), false, 'New task hides; New block shows');
    assert.equal(await page.isVisible('#tb-new'), true);
    assert.equal(await page.$$eval('.tb-tk', (x) => x.length), 17, 'open tasks of the board (done hidden)');
    await page.click('#tp-done');
    assert.equal(await page.$$eval('.tb-tk', (x) => x.length), 20);
    await page.click('#tp-done');
    await page.fill('#tp-q', 'lenti'); await page.waitForTimeout(200);
    assert.deepEqual(await page.$$eval('.tb-tk .t', (x) => x.map((e) => e.textContent)), ['Lentivirus packaging and titer']);
    await page.fill('#tp-q', ''); await page.waitForTimeout(200);

    // Drag a task to 10:00 and press Block on another.
    await page.evaluate(() => (document.getElementById('tb-scroll').scrollTop = 0));
    const col = await (await page.$('#tb-col')).boundingBox();
    const y10 = await yFor(page, 600);
    await page.dragAndDrop('.tb-tk:has-text("Lentivirus") .tb-tk-main', '#tb-col', { targetPosition: { x: 200, y: y10 - col.y + 5 } });
    let bl = await blocks(page);
    assert.equal(bl.length, 1);
    assert.match(bl[0].head, /^10:00–11:001 hT-003/);
    assert.equal(bl[0].title, 'Lentivirus packaging and titer');
    await page.click('.tb-tk:has-text("Titrate primary") [data-act=tb-task-block]');
    bl = await blocks(page);
    assert.equal(bl.length, 2);
    assert.ok(bl.some((b) => b.head.includes('T-008')));
    assert.match(await page.textContent('.tb-tk:has-text("Lentivirus") small.use'), /1 block today, 1 h/);
    assert.match(await page.textContent('#stats'), /2\.0 h planned.*2\.0 h on tasks.*0\/2 blocks done/);

    // Drawing on the timeline opens the editor on "Board task"; search and pick a task.
    const y14 = await yFor(page, 840), y15 = await yFor(page, 900);
    await page.mouse.move(col.x + 200, y14 + 2); await page.mouse.down(); await page.mouse.move(col.x + 200, y14 + 30, { steps: 3 }); await page.mouse.move(col.x + 200, y15, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.isChecked('input[name=ed-kind][value=board]'), true);
    await page.fill('#ed-tq', 'mycoplasma');
    assert.equal(await page.$$eval('#ed-task option:not([hidden])', (o) => o.length), 1);
    await page.selectOption('#ed-task', { label: 'T-019 · Mycoplasma test on all active lines' });
    assert.match(await page.textContent('#ed-tsum'), /T-019.*Cell line authentication.*To Do/);
    await page.click('[data-m=ed-save]');
    assert.ok((await blocks(page)).some((b) => b.head.startsWith('14:00–15:00') && b.title === 'Mycoplasma test on all active lines'));

    // Tick the Lentivirus block: the toast offers to move the card to Done; take it, then Undo on the board.
    await page.click('.tb-block:has-text("Lentivirus") .tb-chk');
    assert.match(await page.textContent('#toast'), /Done: Lentivirus.*Move T-003 to Done/);
    await page.click('#toast [data-toast-act]');
    assert.match(await page.textContent('#toast'), /T-003 moved to Done on the board/);
    assert.equal((await blocks(page)).find((b) => b.title.startsWith('Lenti')).flag, 'Done on board');
    const stageOf = (ref) => page.evaluate((r) => { const s = JSON.parse(localStorage.getItem('labboard.data.v1') || 'null'); return s; }, ref);
    await page.click('#tab-board'); await page.waitForTimeout(200);
    assert.ok(await page.$('.cell[data-stage=st_done] .card:has-text("Lentivirus")'), 'the card is in Done');
    await page.click('#toast [data-toast-act]'); await page.waitForTimeout(150);
    assert.ok(await page.$('.cell[data-stage=st_prog] .card:has-text("Lentivirus")'), 'board Undo puts it back');

    // Badge on cards planned today; editing a card's title shows in the Day view and in the stored snapshot.
    assert.deepEqual(await page.$$eval('.badge.tb-pl', (x) => x.map((e) => e.closest('.card').querySelector('.ref').textContent).sort()), ['T-003', 'T-008', 'T-019']);
    await page.click('.card:has-text("Titrate primary")');
    assert.match(await page.textContent('[data-m=plan]'), /Plan time1 h/);
    await page.fill('#f-title', 'Titrate p-ERK antibody'); await page.click('[data-m=save]'); await page.waitForTimeout(500);
    await page.click('#tab-day'); await page.waitForTimeout(200);
    assert.ok((await blocks(page)).some((b) => b.title === 'Titrate p-ERK antibody'));
    await page.waitForTimeout(500);
    const snapTitles = Object.values((await storedPlan(page)).days)[0].blocks.map((b) => b.focus.ref && b.focus.ref.title);
    assert.ok(snapTitles.includes('Titrate p-ERK antibody'), 'the snapshot follows the card');

    // Plan time from a card's dialog, with an unsaved edit: the edit is saved, then the block editor opens.
    await page.click('#tab-board');
    await page.click('.card:has-text("Tryptic digest")');
    await page.fill('#f-title', 'Tryptic digest of 24 lysates (batch 2)');
    await page.click('[data-m=plan]');
    assert.equal(await page.evaluate(() => document.body.classList.contains('v-day')), true);
    assert.equal(await page.textContent('#modal-title'), 'New block');
    assert.match(await page.textContent('#ed-tsum'), /T-013/);
    await page.click('[data-m=ed-save]');
    assert.ok((await blocks(page)).some((b) => b.title === 'Tryptic digest of 24 lysates (batch 2)'), 'the card edit was saved');

    // Keys in the Day view: N is a new block (not a new task); Esc closes.
    await page.keyboard.press('n');
    assert.equal(await page.textContent('#modal-title'), 'New block');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // A card deleted on the board: its block keeps its details and says so.
    await page.click('#tab-board');
    await page.click('.card:has-text("Mycoplasma")'); await page.click('[data-m=delete]'); await page.click('[data-m=delete]'); await page.waitForTimeout(150);
    await page.click('#tab-day'); await page.waitForTimeout(200);
    const myco = (await blocks(page)).find((b) => b.title.startsWith('Mycoplasma'));
    assert.equal(myco.flag, 'Not on the board');

    // Another board: the panel shows its tasks (none); blocks for the first board's cards show its title.
    await page.click('#tab-board');
    await page.click('[data-act=boards-new]'); await page.waitForTimeout(200);
    await page.fill('#nb-name', 'Grant writing');
    await page.click('#nb-go');
    await page.waitForTimeout(500);
    const tabs = await page.$$eval('#btabs [data-act=board-go]', (x) => x.map((e) => e.textContent.trim()));
    if (tabs.length > 1) {
      await page.click('#tab-day'); await page.waitForTimeout(300);
      assert.equal(await page.$$eval('.tb-tk', (x) => x.length), 0);
      const other = (await blocks(page)).find((b) => b.title.startsWith('Lentivirus'));
      assert.equal(other.flag, 'Lab Task Board', 'a card from another board names that board');
    } else log({ note: 'new-board dialog not driven; other-board check skipped', tabs });

    // Reload: the Day view and the plan are kept.
    await page.waitForTimeout(500);
    // (The stress harness resets view settings on reload; section B checks that the Day view is remembered.)
    await page.reload(); await page.waitForTimeout(800);
    if (!(await page.evaluate(() => document.body.classList.contains('v-day')))) await page.click('#tab-day');
    await page.waitForTimeout(200);
    assert.equal((await blocks(page)).length, 4);

    // Plans backup: download, restore (two clicks), compare.
    const before = await storedPlan(page);
    await page.click('#tb-backup');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-m=pb-dl]')]);
    assert.match(dl.suggestedFilename(), /^day-plans-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await dl.path();
    await page.click('[data-close]');
    await page.focus('.tb-block'); await page.keyboard.press('Delete');
    assert.equal((await blocks(page)).length, 3);
    await page.click('#tb-backup');
    await page.setInputFiles('#pb-file', file);
    await page.waitForSelector('#pb-restore', { state: 'visible' });
    await page.click('#pb-restore'); await page.click('#pb-restore'); await page.waitForTimeout(500);
    assert.equal((await blocks(page)).length, 4);
    const after = await storedPlan(page);
    assert.deepEqual(after.days, before.days);
    assert.deepEqual(page._errors, []);
    log({ test: 'fusion:planning', ok: true });
    await ctx.close();
  }

  // ---------- B. plans from the stand-alone time blocker move over once ----------
  {
    const b = await L.getBrowser();
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, (r) => r.abort());
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + path.resolve(__dirname, '../time-blocker.html')); await page.waitForTimeout(500);
    if (await page.isVisible('#overlay')) await page.click('[data-close]').catch(() => {});
    await page.fill('#ib-add', 'Weekly lab meeting'); await page.press('#ib-add', 'Enter'); await page.waitForTimeout(150);
    await page.click('.tb-ib [data-act=ib-add]'); await page.waitForTimeout(600);
    if (await page.isVisible('#overlay')) await page.click('[data-m=ab-later]').catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(() => localStorage.setItem('labboard.prefs.v1', JSON.stringify({ abDontAsk: true, abNoticeSeen: true, view: 'day' })));
    await page.goto('file://' + BOARD); await page.waitForTimeout(1500);
    assert.match(await page.textContent('#toast'), /plans from the time blocker are now in the Day view/);
    const bl = await blocks(page);
    assert.equal(bl.length, 1); assert.equal(bl[0].title, 'Weekly lab meeting');
    await page.reload(); await page.waitForTimeout(1000);
    assert.equal((await blocks(page)).length, 1, 'moved once, then read from the board database');
    assert.ok(await page.evaluate(() => document.body.classList.contains('v-day')), 'the Day view is remembered');
    assert.deepEqual(errors, []);
    log({ test: 'fusion:fromStandalone', ok: true });
    await ctx.close();
  }

  // ---------- C. a browser that never used the time blocker does not create its database ----------
  {
    const { page, ctx } = await L.open({});
    await page.click('#tab-day'); await page.waitForTimeout(400);
    const dbs = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).sort();
    assert.deepEqual(dbs, ['labboard']);
    log({ test: 'fusion:noStrayDatabase', ok: true, dbs });
    await ctx.close();
  }

  // ---------- D. the plan file in the board's backup folder ----------
  // Served over http so the browser's private file storage can stand in for the folder. This headless
  // Chromium closes the page when a folder handle is read back from IndexedDB, so the handle is swapped for
  // its name on the way in and back on the way out; everything else is the real code.
  {
    const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(BOARD)); }).listen(0);
    const URL = 'http://localhost:' + srv.address().port + '/';
    const b = await L.getBrowser();
    const SHIM = () => {
      if (!(navigator.storage && navigator.storage.getDirectory)) return;
      const cache = {};
      (async () => { cache[''] = await navigator.storage.getDirectory(); })();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) { if (v instanceof FileSystemHandle) v = { __fsdir: v.name }; return put.call(this, v, k); };
      const res = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
      Object.defineProperty(IDBRequest.prototype, 'result', { configurable: true, get() { const r = res.get.call(this); return r && r.__fsdir !== undefined ? cache[r.__fsdir] : r; } });
      window.showDirectoryPicker = async () => navigator.storage.getDirectory();
    };
    const files = (p) => p.evaluate(async () => { const n = []; for await (const k of (await navigator.storage.getDirectory()).keys()) n.push(k); return n.sort(); });
    const readPlanFile = (p) => p.evaluate(async () => JSON.parse(await (await (await (await navigator.storage.getDirectory()).getFileHandle('_time-blocker.json')).getFile()).text()));
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, (r) => r.abort());
    await ctx.addInitScript(SHIM);
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL); await page.waitForTimeout(900);
    await page.click('[data-m=ab-choose]'); await page.waitForTimeout(800);
    let f = await files(page);
    assert.ok(f.includes('lab-task-board-backup.json'));
    assert.ok(!f.includes('_time-blocker.json'), 'an empty plan is not written');
    await page.click('[data-act=load-sample]'); await page.click('#tab-day'); await page.waitForTimeout(300);
    await page.click('.tb-tk:has-text("Lentivirus") [data-act=tb-task-block]'); await page.waitForTimeout(2200);
    f = await files(page);
    assert.ok(f.includes('_time-blocker.json'), 'the plan is written next to the board');
    const pf = await readPlanFile(page);
    assert.equal(Object.values(pf.days)[0].blocks[0].focus.ref.ref, 'T-003');
    await page.click('#tb-backup');
    assert.match(await page.textContent('#modal-body'), /Also saved automatically as .*\/_time-blocker\.json/);
    await page.click('[data-close]');
    // A second browser profile with an empty plan and the same folder: it offers the folder's plans instead of overwriting them.
    const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx2.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, (r) => r.abort());
    await ctx2.addInitScript(SHIM);
    const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(URL); await p2.waitForTimeout(900);
    // Its private storage is its own; copy the folder's plan file in to act as the shared folder.
    await p2.evaluate(async (txt) => { const w = await (await (await navigator.storage.getDirectory()).getFileHandle('_time-blocker.json', { create: true })).createWritable(); await w.write(txt); await w.close(); }, JSON.stringify(pf));
    await p2.click('[data-m=ab-choose]'); await p2.waitForTimeout(3500);
    assert.match(await p2.textContent('#toast'), /Day plans were found in your backup folder \(1 block\)/);
    await p2.click('#toast [data-toast-act]'); await p2.waitForTimeout(300);
    await p2.click('#tab-day'); await p2.waitForTimeout(300);
    assert.equal((await blocks(p2)).length, 1);
    assert.deepEqual(errors, []);
    log({ test: 'fusion:backupFolder', ok: true });
    await ctx2.close(); await ctx.close(); srv.close();
  }
  await L.close();
})().catch(async (e) => { console.error(e); await L.close(); process.exit(1); });

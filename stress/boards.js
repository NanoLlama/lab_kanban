// Multiple boards as tabs, archiving finished cards, renaming columns in place.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));
const tabs = (p) => p.$$eval('.btab', (t) => t.map((x) => (x.classList.contains('on') ? '*' : '') + x.querySelector('.btab-go').textContent));
const total = (p) => p.$$eval('.stage-head .count', (c) => c.reduce((s, e) => s + +e.textContent, 0)).catch(() => 0);
const ready = (p) => p.waitForFunction(() => !document.querySelector('#view .loading'));
async function goTab(p, title) { await p.click(`.btab-go:text-is("${title}")`); await ready(p); await p.waitForTimeout(150); }
async function newBoard(p, name, mode, project) {
  await p.click('[data-act=boards]'); await p.fill('#nb-name', name);
  await p.check(`input[name=nb-mode][value=${mode}]`); if (project) await p.selectOption('#nb-proj', { label: project });
  await p.click('[data-m=b-create]'); await ready(p); await p.waitForTimeout(200);
}

(async () => {
  // 1. Local: create, move a project out, switch, persist, close and reopen, delete.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    const start = { tabs: await tabs(page), cards: await total(page) };
    await newBoard(page, '', 'move', 'Western blot optimization');
    const moved = { tabs: await tabs(page), cards: await total(page), projects: await page.$$eval('#flt-project option', (o) => o.map((x) => x.textContent)) };
    await newBoard(page, 'Grant reporting', 'empty');
    const empty = { tabs: await tabs(page), emptyState: !!(await page.$('#view .empty')) };
    await goTab(page, 'Lab Task Board');
    const firstAfterMove = await total(page);
    // An edit followed by an immediate tab switch must not be lost (the switch writes pending changes first).
    await page.click('#btn-new'); await page.fill('#f-title', 'Saved across a fast switch'); await page.click('[data-m=save]');
    await goTab(page, 'Western blot optimization'); await goTab(page, 'Lab Task Board');
    const fastSwitchKept = await page.$$eval('.card h4', (h) => h.some((x) => x.textContent === 'Saved across a fast switch'));
    // Column widths are per board.
    const hb = await page.locator('.stage-head .col-rz').first().boundingBox();
    await page.mouse.move(hb.x + 5, hb.y + 8); await page.mouse.down(); await page.mouse.move(hb.x + 105, hb.y + 8, { steps: 4 }); await page.mouse.up();
    const wA = await page.$eval('.stage-head', (e) => Math.round(e.getBoundingClientRect().width));
    await goTab(page, 'Western blot optimization');
    const wB = await page.$eval('.stage-head', (e) => Math.round(e.getBoundingClientRect().width));
    // Reload restores the open tabs, the active one and each board's own cards.
    await page.reload(); await ready(page); await page.waitForSelector('.btab'); await page.waitForTimeout(300);
    const afterReload = { tabs: await tabs(page), cards: await total(page) };
    // Close a tab: the board is kept and can be reopened.
    await page.click('.btab:has-text("Grant reporting") .btab-x'); await page.waitForTimeout(200);
    const afterClose = await tabs(page);
    await page.click('[data-act=boards]');
    const listed = await page.$$eval('.brow .bname', (n) => n.map((x) => x.textContent));
    await page.click('.brow:has-text("Grant reporting") [data-m=b-open]'); await ready(page);
    const reopened = await tabs(page);
    // Delete a board (two clicks), from the Boards dialog.
    await page.click('[data-act=boards]'); await page.click('.brow:has-text("Grant reporting") [data-m=b-del]'); await page.click('.brow:has-text("Grant reporting") [data-m=b-del-ok]');
    await page.waitForTimeout(300);
    // It was the board being viewed, so the app switched away first (which closes the dialog).
    await ready(page); await page.click('[data-act=boards]');
    const afterDelete = { list: await page.$$eval('.brow .bname', (n) => n.map((x) => x.textContent)), tabs: await tabs(page) };
    await page.click('[data-close]');
    // Rename via the header title: the tab follows.
    await goTab(page, 'Western blot optimization');
    await page.click('#title-btn'); await page.fill('#title-in', 'Blots only'); await page.keyboard.press('Enter');
    log({ test: 'boards:local', start, moved, empty, firstAfterMove, fastSwitchKept, widthsIndependent: wA !== wB, wA, wB, afterReload, afterClose, listed, reopened, afterDelete, tabsAfterRename: await tabs(page), errors: page._errors });
    // Restore a backup as a new board.
    await goTab(page, 'Lab Task Board');
    const backup = await page.evaluate(() => { const s = { version: 2, meta: { title: 'Imported study' }, stages: [{ id: 'a', name: 'Plan' }, { id: 'b', name: 'Run', done: true }], projects: [], tasks: [{ id: 'x1', ref: 'T-001', title: 'From file', stageId: 'a' }] }; return JSON.stringify(s) });
    await page.click('#btn-backup');
    await page.setInputFiles('#b-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.waitForSelector('#b-restore-new:not([disabled])'); await page.click('#b-restore-new'); await ready(page); await page.waitForTimeout(200);
    log({ test: 'boards:restoreAsNew', tabs: await tabs(page), columns: await page.$$eval('.stage-head h3', (h) => h.map((x) => x.textContent)), cards: await total(page), firstBoardStill: await (async () => { await goTab(page, 'Lab Task Board'); return total(page) })(), errors: page._errors });
    await ctx.close();
  }

  // 2. Archive: per card, per column, from the dialog; restore, delete, undo, persistence, backups.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    const before = await total(page), openStat = await page.textContent('#stats');
    const todoHasArchive = await page.$$eval('.cell[data-stage=st_todo] .arch', (a) => a.length);
    const doneButtons = await page.$$eval('.cell[data-stage=st_done] .arch', (a) => a.length);
    await page.click('.cell[data-stage=st_done] .card .arch');
    const one = { cards: await total(page), archivedBtn: await page.textContent('#btn-archive'), toast: await page.textContent('#toast'), statsSame: (await page.textContent('#stats')).split('open')[0] === openStat.split('open')[0] };
    await page.click('#toast [data-toast-act]');
    const undone = await total(page);
    await page.click('.stage-head[data-stage=st_done] [data-act=archive-col]');
    const col = { cards: await total(page), doneLeft: await page.$$eval('.cell[data-stage=st_done] .card', (c) => c.length), archivedBtn: await page.textContent('#btn-archive') };
    // Task dialog offers Archive only for finished cards.
    await page.click('.cell[data-stage=st_todo] .card');
    const dialogArchiveForTodo = !!(await page.$('#modal-foot [data-m=archive]')); await page.click('[data-close]');
    await page.click('#btn-archive');
    const listed = await page.$$eval('.arow .atitle', (a) => a.map((x) => x.textContent));
    await page.fill('#a-q', 'orbitrap'); const searched = await page.$$eval('.arow .atitle', (a) => a.map((x) => x.textContent));
    await page.fill('#a-q', '');
    await page.click('.arow:has-text("Orbitrap") [data-m=a-restore]');
    const restoredIn = await page.$eval('.card:has-text("Orbitrap")', (c) => c.closest('.cell').dataset.stage).catch(() => null);
    await page.click('.arow:first-of-type [data-m=a-del]'); await page.click('.arow:first-of-type [data-m=a-del]');
    const afterDelete = await page.$$eval('.arow', (a) => a.length);
    await page.click('[data-close]');
    await page.waitForTimeout(600); await page.reload(); await ready(page);
    const persisted = { cards: await total(page), archivedBtn: await page.textContent('#btn-archive') };
    await page.click('#btn-backup'); const inBackup = await page.$eval('#b-text', (t) => JSON.parse(t.value).tasks.filter((x) => x.archived).length);
    log({ test: 'archive', before, todoHasArchive, doneButtons, one, undone, col, dialogArchiveForTodo, listed: listed.length, searched, restoredIn, archivedLeftAfterDelete: afterDelete, persisted, archivedInBackup: inBackup, errors: page._errors });
    // In the dialog of a finished card the Archive button saves edits first, then archives.
    await page.click('[data-close]');
    await page.click('.cell[data-stage=st_done] .card'); await page.fill('#f-title', 'Edited then archived'); await page.click('#modal-foot [data-m=archive]');
    await page.click('#btn-archive');
    log({ test: 'archive:fromDialog', editedTitleArchived: await page.$$eval('.arow .atitle', (a) => a.some((x) => x.textContent === 'Edited then archived')) });
    await ctx.close();
  }

  // 3. Rename a column by clicking its name.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    await page.click('.stage-head[data-stage=st_todo] .st-name'); await page.fill('.st-in', 'Backlog'); await page.keyboard.press('Enter');
    await page.click('.stage-head[data-stage=st_review] .st-name'); await page.fill('.st-in', 'Discard me'); await page.keyboard.press('Escape');
    await page.click('.stage-head[data-stage=st_prog] .st-name'); await page.fill('.st-in', '   '); await page.keyboard.press('Enter');
    const heads = await page.$$eval('.stage-head h3', (h) => h.map((x) => x.textContent));
    await page.click('#btn-stages'); const inDialog = await page.$$eval('.s-name', (i) => i.map((x) => x.value)); await page.click('[data-close]');
    await page.waitForTimeout(600); await page.reload(); await ready(page);
    log({ test: 'renameColumn', heads, inStagesDialog: inDialog, afterReload: await page.$$eval('.stage-head h3', (h) => h.map((x) => x.textContent)), cardsStillThere: await total(page), errors: page._errors });
    await ctx.close();
  }
  await L.close();
})();

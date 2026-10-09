// Safety nets: every destructive action must be confirmed or reversible, and no save may be lost.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));
const tabs = (p) => p.$$eval('.btab-go', (t) => t.map((x) => x.textContent));
const total = (p) => p.$$eval('.stage-head .count', (c) => c.reduce((s, e) => s + +e.textContent, 0)).catch(() => 0);
const ready = (p) => p.waitForFunction(() => !document.querySelector('#view .loading'));
const dialog = (p) => p.$eval('#overlay', (o) => o.hidden ? null : document.getElementById('modal-title').textContent);
async function newBoard(p, name) { await p.click('[data-act=boards]'); await p.fill('#nb-name', name); await p.click('[data-m=b-create]'); await ready(p); await p.waitForTimeout(200); }
const idbKeys = (p) => p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('labboard', 1); q.onsuccess = () => r(q.result) }); return new Promise((r) => { const g = db.transaction('kv').objectStore('kv').getAllKeys(); g.onsuccess = () => r(g.result) }) });

(async () => {
  // 1. Closing a tab keeps the board and offers it back.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    await newBoard(page, 'Side project'); await page.click('#btn-new'); await page.fill('#f-title', 'Keep me'); await page.click('[data-m=save]');
    await page.click('.btab:has-text("Side project") .btab-x'); await page.waitForTimeout(200);
    const toast = await page.textContent('#toast'), tabsAfter = await tabs(page);
    await page.click('#toast [data-toast-act]'); await ready(page); await page.waitForTimeout(200);
    log({ test: 'safety:closeTab', toast, tabsAfterClose: tabsAfter, tabsAfterReopen: await tabs(page), cardsBack: await page.$$eval('.card h4', (h) => h.map((x) => x.textContent)), errors: page._errors });

    // 2. Deleting a board: counts, typed name, backup first, recycle bin, restore, erase.
    await page.click('[data-act=boards]'); await page.click('.brow:has-text("Side project") [data-m=b-del]');
    await page.waitForFunction(() => !/Counting/.test(document.getElementById('db-count').textContent));
    const d = { title: await dialog(page), count: await page.textContent('#db-count'), disabledAtStart: await page.$eval('#db-ok', (b) => b.disabled) };
    await page.fill('#db-name', 'Side'); d.disabledWrongName = await page.$eval('#db-ok', (b) => b.disabled);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-m=db-backup]')]);
    d.backupFile = dl && dl.suggestedFilename();
    // Escape with a typed name asks first (the dialog has edits).
    await page.keyboard.press('Escape'); d.escOnceKeepsOpen = !!(await dialog(page));
    await page.fill('#db-name', 'side PROJECT'); d.enabledCaseInsensitive = !(await page.$eval('#db-ok', (b) => b.disabled));
    await page.click('#db-ok'); await ready(page); await page.waitForTimeout(300);
    d.toast = await page.textContent('#toast'); d.tabs = await tabs(page);
    await page.click('[data-act=boards]');
    d.recentlyDeleted = await page.$$eval('.trash-h ~ .brow .bname', (n) => n.map((x) => x.textContent));
    d.dataStillStored = (await idbKeys(page)).filter((k) => String(k).startsWith('board:')).length;
    await page.click('.brow:has-text("Side project") [data-m=b-restore]'); await ready(page); await page.waitForTimeout(300);
    d.restored = { tabs: await tabs(page), cards: await page.$$eval('.card h4', (h) => h.map((x) => x.textContent)) };
    // Delete again, then erase from the bin (two clicks).
    await page.click('[data-act=boards]'); await page.click('.brow:has-text("Side project") [data-m=b-del]'); await page.fill('#db-name', 'Side project'); await page.click('#db-ok'); await ready(page);
    await page.click('[data-act=boards]'); await page.click('.brow:has-text("Side project") [data-m=b-purge]');
    d.purgeArmedText = await page.textContent('.brow:has-text("Side project") [data-m=b-purge]');
    await page.click('.brow:has-text("Side project") [data-m=b-purge]'); await page.waitForTimeout(300);
    d.afterErase = { list: await page.$$eval('.brow .bname', (n) => n.map((x) => x.textContent)), stored: (await idbKeys(page)).filter((k) => String(k).startsWith('board:')).length };
    await page.click('[data-close]');
    log({ test: 'safety:deleteBoard', ...d, errors: page._errors });

    // 3. Boards deleted more than 30 days ago are erased on load.
    await newBoard(page, 'Old board');
    await page.click('[data-act=boards]'); await page.click('.brow:has-text("Old board") [data-m=b-del]'); await page.fill('#db-name', 'Old board'); await page.click('#db-ok'); await ready(page);
    // The toast appears once the deletion has been written; edit the stored date only after that.
    await page.waitForFunction(() => /Recently deleted/.test(document.getElementById('toast').textContent));
    await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('labboard', 1); q.onsuccess = () => r(q.result) });
      const get = () => new Promise((r) => { const g = db.transaction('kv').objectStore('kv').get('boards'); g.onsuccess = () => r(g.result) });
      const list = JSON.parse(await get()); list.forEach((b) => { if (b.deleted) b.deletedAt = new Date(Date.now() - 31 * 864e5).toISOString() });
      await new Promise((r) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.stringify(list), 'boards'); t.oncomplete = r });
    });
    await page.reload(); await ready(page); await page.waitForTimeout(3200);
    await page.click('[data-act=boards]');
    log({ test: 'safety:expiredErased', binAfterReload: await page.$$eval('.trash-h ~ .brow .bname', (n) => n.map((x) => x.textContent)), stored: (await idbKeys(page)).filter((k) => String(k).startsWith('board:')).length });
    await page.click('[data-close]');

    // 4. Removing example data asks first; Cancel changes nothing.
    await page.click('.btab-go:text-is("Lab Task Board")'); await ready(page);
    const before = await total(page);
    await page.click('[data-act=clear-sample]'); const ask = await dialog(page), askText = await page.textContent('#modal-body');
    await page.click('[data-close]'); const afterCancel = await total(page);
    await page.click('[data-act=clear-sample]'); await page.click('[data-m=cs-ok]');
    log({ test: 'safety:clearSample', ask, askText: askText.slice(0, 90), before, afterCancel, afterConfirm: await total(page), undoOffered: /Undo/.test(await page.textContent('#toast')) });

    // 5. Replacing a board from a backup takes a second click that names what is replaced.
    await page.click('#btn-new'); await page.fill('#f-title', 'Mine'); await page.click('[data-m=save]');
    await page.click('#btn-backup');
    await page.setInputFiles('#b-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ stages: [{ id: 'a', name: 'A' }], projects: [], tasks: [{ id: 'z', title: 'From file' }, { id: 'y', title: 'Also from file' }] })) });
    await page.waitForSelector('#b-restore:not([disabled])'); await page.click('#b-restore');
    const armedText = await page.textContent('#b-restore'), stillOld = await total(page);
    await page.click('#b-restore');
    log({ test: 'safety:replaceFromBackup', armedText, cardsAfterFirstClick: stillOld, cardsAfterSecondClick: await total(page), undoOffered: /Undo/.test(await page.textContent('#toast')) });
    await page.click('#toast [data-toast-act]');

    // 6. Every Apply in Stages can be undone (e.g. un-ticking "Counts as done" clears completion dates).
    await page.click('#btn-new'); await page.fill('#f-title', 'Finished card'); await page.selectOption('#f-stage', { index: 0 }); await page.click('[data-m=save]');
    await page.click('#btn-stages'); await page.check('.srow:first-child .s-done'); await page.click('[data-m=apply]'); await page.waitForTimeout(100);
    await page.click('#btn-backup'); const doneAtBefore = await page.$eval('#b-text', (t) => JSON.parse(t.value).tasks.filter((x) => x.doneAt).length); await page.click('[data-close]');
    await page.click('#btn-stages'); await page.uncheck('.srow:first-child .s-done'); await page.click('[data-m=apply]');
    const toast6 = await page.textContent('#toast');
    const doneAtAfterUntick = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 500)); const db = await new Promise((r) => { const q = indexedDB.open('labboard', 1); q.onsuccess = () => r(q.result) }); const v = await new Promise((r) => { const g = db.transaction('kv').objectStore('kv').get('board'); g.onsuccess = () => r(g.result) }); return JSON.parse(v).tasks.filter((x) => x.doneAt).length }); await page.click('#toast [data-toast-act]');
    await page.click('#btn-backup'); const doneAtAfterUndo = await page.$eval('#b-text', (t) => JSON.parse(t.value).tasks.filter((x) => x.doneAt).length); await page.click('[data-close]');
    log({ test: 'safety:stagesUndo', toast: toast6, doneAtBefore, doneAtAfterUntick, doneAtAfterUndo, errors: page._errors });
    await ctx.close();
  }

  // 7. Two browser tabs on the same board stay in step instead of overwriting each other.
  {
    const { page: a, ctx } = await L.open({});
    await a.click('[data-act=load-sample]'); await a.waitForTimeout(600);
    const b = await ctx.newPage(); b._errors = []; b.on('pageerror', (e) => b._errors.push(String(e)));
    await b.goto(L.FILE); await ready(b); await b.waitForTimeout(300);
    await a.click('#btn-new'); await a.fill('#f-title', 'Added in tab A'); await a.click('[data-m=save]'); await a.waitForTimeout(900);
    const bSeesA = await b.$$eval('.card h4', (h) => h.some((x) => x.textContent === 'Added in tab A'));
    await b.click('#btn-new'); await b.fill('#f-title', 'Added in tab B'); await b.click('[data-m=save]'); await b.waitForTimeout(900);
    const aSeesB = await a.$$eval('.card h4', (h) => h.some((x) => x.textContent === 'Added in tab B'));
    await a.reload(); await ready(a); await a.waitForTimeout(300);
    const both = await a.$$eval('.card h4', (h) => ['Added in tab A', 'Added in tab B'].map((t) => h.some((x) => x.textContent === t)));
    // A board created in one tab appears in the other's Boards list.
    await newBoard(a, 'Made in tab A'); await b.waitForTimeout(400);
    await b.click('[data-act=boards]'); const bList = await b.$$eval('.brow .bname', (n) => n.map((x) => x.textContent));
    log({ test: 'safety:twoBrowserTabs', bSeesA, aSeesB, bothSurviveReload: both, bListsNewBoard: bList.includes('Made in tab A'), errors: a._errors.concat(b._errors) });
    await ctx.close();
  }

  // 8. Closing the page right after an edit: the browser is asked to warn, and the edit is saved.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]'); await page.waitForTimeout(600);
    let warned = false; page.on('dialog', (dg) => { if (dg.type() === 'beforeunload') warned = true; dg.dismiss().catch(() => {}) });
    await page.click('#btn-new'); await page.fill('#f-title', 'Typed just before closing'); await page.click('[data-m=save]');
    await page.close({ runBeforeUnload: true }); await new Promise((r) => setTimeout(r, 800));
    const p2 = await ctx.newPage(); await p2.goto(L.FILE); await ready(p2); await p2.waitForTimeout(300);
    log({ test: 'safety:closeRightAfterEdit', browserAskedToWarn: warned, editSaved: await p2.$$eval('.card h4', (h) => h.some((x) => x.textContent === 'Typed just before closing')) });
    await ctx.close();
  }
  await L.close();
})();

// Feature checks: touch drag, undo, project/stage deletion choices, color picker, partial rendering, long cells.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));
const mini = (tasks, extra = {}) => Object.assign({
  version: 1, meta: { nextNum: tasks.length + 1 },
  stages: [{ id: 'st_todo', name: 'To Do' }, { id: 'st_prog', name: 'Doing' }, { id: 'st_rev', name: 'Review' }, { id: 'st_done', name: 'Done', done: true }],
  projects: [{ id: 'pr_a', name: 'Alpha', color: '#2D7FF9' }, { id: 'pr_b', name: 'Beta', color: '#E0662B' }], tasks,
}, extra);
const T = (i, o = {}) => Object.assign({ id: 't' + i, ref: 'T-' + String(i).padStart(3, '0'), title: 'Task ' + i, projectId: 'pr_a', stageId: 'st_todo', priority: 'medium', order: i * 10 }, o);
const stageOfCard = (p, title) => p.$eval(`.card:has(h4:text-is("${title}"))`, (c) => c.closest('.cell').dataset.stage).catch(() => null);
const total = (p) => p.$$eval('.stage-head .count', (c) => c.reduce((s, e) => s + +e.textContent, 0));

(async () => {
  // 1. Touch drag with real touch input (CDP touch events produce pointer + touch events like a phone).
  {
    const b = await L.getBrowser();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript((d) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('labboard.data.v1', d); localStorage.setItem('labboard.prefs.v1', '{"groupBy":"none"}') } }, JSON.stringify(mini([T(1, { title: 'Drag me' }), T(2), T(3, { stageId: 'st_prog' })])));
    await page.goto(L.FILE); await page.waitForSelector('.card');
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const from = await page.locator('.card:has-text("Drag me")').boundingBox();
    const to = await page.locator('.cell[data-stage=st_prog]').boundingBox();
    // a) quick swipe = scroll, not drag
    await touch('touchStart', from.x + 20, from.y + 20); await touch('touchMove', from.x + 120, from.y + 25); await touch('touchEnd');
    await page.waitForTimeout(400);
    const afterSwipe = await stageOfCard(page, 'Drag me');
    // b) tap opens the card
    await page.touchscreen.tap(from.x + 20, from.y + 20); await page.waitForTimeout(200);
    const tapOpens = await page.$eval('#overlay', (o) => !o.hidden); if (tapOpens) await page.click('[data-close]');
    // c) long press, then drag into "Doing" (auto-scrolls the board sideways near the edge)
    await touch('touchStart', from.x + 20, from.y + 20); await page.waitForTimeout(500);
    const lifted = await page.$$eval('.drag-ghost', (g) => g.length);
    let x = from.x + 20, y = from.y + 20; const tx = Math.min(to.x + 40, 350), ty = to.y + 20;   // inside the board, in its right-edge auto-scroll zone
    for (let i = 1; i <= 12; i++) { await touch('touchMove', x + (tx - x) * i / 12, y + (ty - y) * i / 12); await page.waitForTimeout(30); }
    // hold near the right edge until the target column scrolls under the finger
    for (let i = 0; i < 40 && !(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.cell[data-stage=st_prog]')) }, [tx, ty])); i++) { await touch('touchMove', tx, ty); await page.waitForTimeout(40); }
    await touch('touchEnd'); await page.waitForTimeout(300);
    log({ test: 'touch', swipeMovedCard: afterSwipe !== 'st_todo', tapOpensDialog: tapOpens, liftedAfterHold: lifted === 1, stageAfterDrag: await stageOfCard(page, 'Drag me'), dialogOpenAfterDrop: await page.$eval('#overlay', (o) => !o.hidden), ghostsLeft: await page.$$eval('.drag-ghost', (g) => g.length), errors: errs });
    await ctx.close();
  }

  // 2. Undo after deleting a task; project deletion keep vs delete; stage removal destination.
  {
    const { page, ctx } = await L.open({ data: mini([T(1, { title: 'Keep me' }), T(2, { title: 'B task', projectId: 'pr_b' }), T(3, { title: 'Review task', stageId: 'st_rev' })]), prefs: { groupBy: 'none' } });
    await page.click('.card:has-text("Keep me")'); await page.click('[data-m=delete]'); await page.click('[data-m=delete]');
    const afterDelete = await total(page);
    await page.click('#toast [data-toast-act]');
    const afterUndo = await total(page);
    // Project delete, keep tasks
    await page.click('#btn-projects'); await page.click('.prow[data-i="1"] [data-m=del]');
    const choices = await page.$$eval('.prow[data-i="1"] [data-m^=del-]', (b) => b.map((x) => x.textContent));
    await page.click('.prow[data-i="1"] [data-m=del-keep]'); await page.click('[data-m=apply]');
    const bTask = await page.$eval('.card:has-text("B task")', (c) => !!c.querySelector('.chip')).catch(() => 'missing');
    await page.click('#toast [data-toast-act]');
    const bRestored = await page.$eval('.card:has-text("B task") .chip', (c) => c.textContent).catch(() => null);
    // Stage removal: send Review's tasks to Doing (not the first stage)
    await page.click('#btn-stages'); await page.click('.srow[data-i="2"] [data-m=del]');
    await page.selectOption('.srow[data-i="2"] .s-dest', 'st_prog');
    await page.click('.srow[data-i="2"] [data-m=del-ok]');
    const note = await page.textContent('.rm-note');
    await page.click('[data-m=apply]');
    log({ test: 'undo+delete', afterDelete, afterUndo, projectDeleteChoices: choices, bTaskKeptWithChip: bTask, bProjectAfterUndo: bRestored, stageNote: note, reviewTaskNowIn: await stageOfCard(page, 'Review task'), errors: page._errors });
    await ctx.close();
  }

  // 3. Color picker: palette, custom hex, saved colors, per-card override, timeline bar color.
  {
    const { page, ctx } = await L.open({ data: mini([T(1, { title: 'Colored' }), T(2, { due: L.iso(5), start: L.iso(0) })]) });
    await page.click('#btn-projects');
    const paletteSize = await page.$$eval('.prow[data-i="0"] .cp-grid .sw', (s) => s.length);
    await page.click('.prow[data-i="0"] summary');
    await page.fill('.prow[data-i="0"] .cp-hex', '#1a2b3c');
    await page.click('[data-m=apply]');
    const projColor = await page.$eval('.card:has-text("Task 2")', (c) => c.style.getPropertyValue('--pc'));
    await page.click('.card:has-text("Colored")'); await page.click('.cdet summary');
    const saved = await page.$$eval('.cp-row .cp-grid .sw', (s) => s.map((x) => x.dataset.c));
    await page.click('.cp-grid .sw[data-c="#C11574"]');
    const summary = await page.textContent('.cdet .clab');
    await page.click('[data-m=save]');
    const cardColor = await page.$eval('.card:has-text("Colored")', (c) => c.style.getPropertyValue('--pc'));
    const chipColor = await page.$eval('.card:has-text("Colored") .chip', (c) => c.style.getPropertyValue('--pc'));
    // back to project color
    await page.click('.card:has-text("Colored")'); await page.click('.cdet summary'); await page.click('.cp [data-c=""]'); await page.click('[data-m=save]');
    const reset = await page.$eval('.card:has-text("Colored")', (c) => c.style.getPropertyValue('--pc'));
    // native color input (fires input events while dragging)
    await page.click('.card:has-text("Task 2")'); await page.click('.cdet summary');
    await page.$eval('.cp-in', (e) => { e.value = '#00ff88'; e.dispatchEvent(new Event('input', { bubbles: true })) });
    const pickerStillOpen = await page.$eval('.cdet', (d) => d.open);
    await page.click('[data-m=save]');
    await page.click('#tab-timeline');
    const bar = await page.$eval('.bar', (b) => b.style.getPropertyValue('--pc'));
    log({ test: 'colors', paletteSize, projectCustomHex: projColor, savedColorsOffered: saved, summaryAfterPick: summary, cardColor, chipKeepsProjectColor: chipColor, resetToProject: reset, nativePickerKeepsPanelOpen: pickerStillOpen, timelineBarColor: bar, errors: page._errors });
    await ctx.close();
  }

  // 4. Partial rendering and long cells.
  {
    const tasks = Array.from({ length: 300 }, (_, i) => T(i + 1, { stageId: i < 200 ? 'st_todo' : 'st_prog' }));
    const { page, ctx } = await L.open({ data: mini(tasks), prefs: { groupBy: 'none' } });
    const r = await page.evaluate(() => {
      const todo = document.querySelector('.cell[data-stage=st_todo]'), prog = document.querySelector('.cell[data-stage=st_prog]');
      todo.__mark = prog.__mark = 1;
      return { cardsInTodo: todo.querySelectorAll('.card').length, more: (todo.querySelector('.more') || {}).textContent };
    });
    // Edit one card in "Doing": the To Do cell must not be rebuilt.
    await page.click('.cell[data-stage=st_prog] .card'); await page.fill('#f-title', 'Edited in place'); await page.click('[data-m=save]');
    const kept = await page.evaluate(() => ({ todoSameNode: document.querySelector('.cell[data-stage=st_todo]').__mark === 1, progRebuilt: document.querySelector('.cell[data-stage=st_prog]').__mark !== 1 }));
    await page.click('.cell[data-stage=st_todo] .more');
    const expanded = await page.$$eval('.cell[data-stage=st_todo] .card', (c) => c.length);
    log({ test: 'render', ...r, ...kept, cardsAfterShowMore: expanded, totalCount: await total(page) });
    await ctx.close();
  }
  await L.close();
})();

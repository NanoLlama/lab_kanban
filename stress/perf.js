// Scale test: load, re-render, search keystroke, timeline, save, at increasing task counts.
const L = require('./lib');

(async () => {
  const out = [];
  for (const n of [100, 1000, 3000, 5000, 10000]) {
    const data = L.genBoard(n);
    const bytes = JSON.stringify(data).length;
    const { page, ctx } = await L.open({ data, prefs: { view: 'board', groupBy: 'priority' } });
    const r = { n, jsonKB: Math.round(bytes / 1024), loadMs: page._loadMs };
    r.domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    // Grouping change = full board rebuild.
    r.regroupMs = await L.timeIt(page, "var g=document.getElementById('grp');g.value='assignee';g.dispatchEvent(new Event('change'))");
    r.regroupBackMs = await L.timeIt(page, "var g=document.getElementById('grp');g.value='priority';g.dispatchEvent(new Event('change'))");
    // One keystroke in search re-renders everything.
    const keys = [];
    for (const q of ['a', 'as', 'ass', 'assa']) {
      keys.push(await L.timeIt(page, `var q=document.getElementById('flt-q');q.value='${q}';q.dispatchEvent(new Event('input'))`));
    }
    r.searchKeystrokeMs = keys;
    await L.timeIt(page, "var q=document.getElementById('flt-q');q.value='';q.dispatchEvent(new Event('input'))");
    // Timeline view.
    r.timelineMs = await L.timeIt(page, "document.getElementById('tab-timeline').click()");
    r.timelineDomNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    await L.timeIt(page, "document.getElementById('tab-board').click()");
    // Open a card, save it, measure commit + local save.
    await page.click('.card');
    await page.fill('#f-title', 'edited title');
    const t0 = Date.now();
    await page.click('[data-m=save]');
    await page.waitForTimeout(600);
    r.saveRoundtripMs = Date.now() - t0;
    r.status = await L.status(page);
    // Paint/layout time (first frame after a forced reflow).
    r.layoutMs = await page.evaluate(() => { const t = performance.now(); document.body.offsetHeight; document.querySelector('.board-wrap').scrollWidth; return +(performance.now() - t).toFixed(1); });
    r.errors = page._errors;
    out.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  await L.close();
})();

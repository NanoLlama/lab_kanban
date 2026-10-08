const L = require('./lib');
(async () => {
  const { page, ctx } = await L.open({});
  for (const n of [500, 1000, 2000, 4000, 8000]) {
    const ms = await page.evaluate(async (n) => {
      const v = document.getElementById('view');
      v.innerHTML = '<div class="board-wrap"><div class="board" style="--n:4;grid-template-columns:var(--lane-w) repeat(4,minmax(250px,1fr))"><div class="cell"><article class="card"><h4>' + 'W'.repeat(n) + '</h4></article></div></div></div>';
      const t = performance.now(); document.body.offsetHeight; return +(performance.now() - t).toFixed(0);
    }, n);
    const spaced = await page.evaluate(async (n) => {
      const v = document.getElementById('view');
      v.innerHTML = '<div class="board-wrap"><div class="board" style="--n:4;grid-template-columns:var(--lane-w) repeat(4,minmax(250px,1fr))"><div class="cell"><article class="card"><h4>' + 'Word '.repeat(n / 5) + '</h4></article></div></div></div>';
      const t = performance.now(); document.body.offsetHeight; return +(performance.now() - t).toFixed(0);
    }, n);
    console.log(JSON.stringify({ test: 'longTitleLayout', chars: n, unbrokenMs: ms, withSpacesMs: spaced }));
    if (ms > 20000) break;
  }
  await ctx.close(); await L.close(); process.exit(0);
})();

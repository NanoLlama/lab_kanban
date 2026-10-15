// Work-in-progress limits: a team limit per stage plus personal limits (a default and each person's own).
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));
(async () => {
  const { page, ctx } = await L.open({});
  await page.click('[data-act=load-sample]');
  const gaugeOnUnlimited = await page.$$eval('.stage-head[data-stage=st_todo] .wip-set', (e) => e.length);
  await page.click('.stage-head[data-stage=st_prog] .wip-btn');
  await page.fill('#w-def', '2'); await page.fill('.w-own[data-name=Okafor]', '1'); await page.fill('.w-own[data-name=Patel]', '3');
  await page.fill('.w-own[data-name=Tanaka]', '0'); await page.click('[data-m=w-save]');
  const rejectsZero = await page.textContent('#w-err');
  await page.fill('.w-own[data-name=Tanaka]', ''); await page.click('[data-m=w-save]'); await page.waitForTimeout(100);
  const head = (await page.textContent('.stage-head[data-stage=st_prog] .wip-btn')).trim();
  const rings = await page.$$eval('.who.over', (w) => w.map((x) => x.textContent));
  await page.selectOption('#grp', 'assignee');
  const cells = await page.$$eval('.cell[data-stage=st_prog] .cell-wip', (c) => c.map((x) => x.closest('.cell').dataset.lane + ' ' + x.textContent + x.className.replace('cell-wip', '')));
  await page.click('.card:has-text("MaxQuant")');
  const option = await page.$eval('#f-stage option[value=st_prog]', (o) => o.textContent);
  await page.click('.modal-foot [data-close]');
  await page.reload(); await page.waitForTimeout(400);
  const persisted = (await page.textContent('.stage-head[data-stage=st_prog] .wip-btn')).trim();
  log({ test: 'wip:personal', gaugeOnUnlimited, rejectsZero, head, rings, cells, option, persisted, errors: page._errors });
  await ctx.close(); await L.close();
})();

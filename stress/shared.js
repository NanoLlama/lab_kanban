// Shared-storage mode with a mock window.claude db that the test can drive.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));
const board = (titles) => ({ version: 1, meta: { nextNum: titles.length + 1 }, stages: [{ id: 'st_todo', name: 'To Do' }, { id: 'st_done', name: 'Done', done: true }], projects: [],
  tasks: titles.map((t, i) => ({ id: 't_' + t, ref: 'T-00' + (i + 1), title: t, stageId: 'st_todo', priority: 'medium', start: '', due: '', order: (i + 1) * 10 })) });
const mock = (initial) => `(function(){
  var server=${JSON.stringify(JSON.stringify(initial))}, cb=null; window.__writes=[]; window.__failNext=false;
  var ref={onSnapshot:function(f){cb=f;setTimeout(function(){cb({exists:true,data:function(){return {json:server}}})},0)},
    set:function(v){return new Promise(function(res,rej){setTimeout(function(){if(window.__failNext){window.__failNext=false;var e=new Error('net');e.code='unavailable';rej(e);return}server=v.json;window.__writes.push(v.json);res();cb({exists:true,data:function(){return {json:server}}})},50)})}};
  window.__remote=function(obj){server=JSON.stringify(obj);cb({exists:true,data:function(){return {json:server}}})};
  window.__server=function(){return JSON.parse(server)};
  window.claude={use:async function(n){if(n==='db')return {doc:function(){return ref}};if(n==='user')return {can:async function(){return true}};throw new Error(n)}};
})();`;
const titles = (page) => page.evaluate(() => window.__server().tasks.map((t) => t.title));

(async () => {
  // A. Remote change arrives while a local save is debounced: other user's task is lost.
  {
    const { page, ctx } = await L.open({ claude: mock(board(['A'])) });
    await page.click('#btn-new'); await page.fill('#f-title', 'Local'); await page.click('[data-m=save]');
    await page.evaluate((b) => window.__remote(b), board(['A', 'Remote']));       // other user adds a task within the 350 ms window
    await page.waitForTimeout(800);
    log({ test: 'shared:remoteDuringDebounce', serverTasks: await titles(page), boardCards: await page.$$eval('.card h4', (h) => h.map((e) => e.textContent)) });
    await ctx.close();
  }
  // B. No overlap at all: two users with the same starting doc. Second writer silently wins.
  {
    const { page, ctx } = await L.open({ claude: mock(board(['A'])) });
    await page.evaluate((b) => window.__remote(b), board(['A', 'FromUser2']));   // user 2 saved first
    await page.waitForTimeout(100);
    // user 1 had the dialog open from before user 2's change; they now save their own edit to A
    log({ test: 'shared:remoteApplied', cards: await page.$$eval('.card h4', (h) => h.map((e) => e.textContent)) });
    await ctx.close();
  }
  // C. Edit dialog open on a task that a remote user deletes.
  {
    const { page, ctx } = await L.open({ claude: mock(board(['A', 'B'])) });
    await page.click('.card'); await page.fill('#f-title', 'A renamed');
    await page.evaluate((b) => window.__remote(b), board(['B']));
    await page.click('[data-m=save]'); await page.waitForTimeout(500);
    log({ test: 'shared:editDeletedTask', pageErrors: page._errors, modalStillOpen: !(await page.$eval('#overlay', (o) => o.hidden)), serverTasks: await titles(page) });
    await ctx.close();
  }
  // D. A failed write is never retried, and the next remote snapshot silently overwrites the unsaved local edit.
  {
    const { page, ctx } = await L.open({ claude: mock(board(['A'])) });
    await page.evaluate(() => { window.__failNext = true });
    await page.click('#btn-new'); await page.fill('#f-title', 'Unsaved work'); await page.click('[data-m=save]');
    await page.waitForTimeout(700);
    const st = await L.status(page);
    await page.waitForTimeout(3000);
    const retried = await page.evaluate(() => window.__writes.length);
    const serverAfterRetry = await titles(page);
    await page.evaluate((b) => window.__remote(b), board(['A', 'Other user']));
    await page.waitForTimeout(200);
    log({ test: 'shared:failedWrite', statusAfterFail: st, writesIn3s: retried, serverAfterRetry, cardsAfterNextRemote: await page.$$eval('.card h4', (h) => h.map((e) => e.textContent)) });
    await ctx.close();
  }
  await L.close();
})();

// Shared-storage mode. A Node-side document store backs a mock of window.claude's `db`
// (doc/collection, set/delete/get, onSnapshot with docChanges), shared by several real browser pages,
// so two "people" can edit the same board at once.
const L = require('./lib');
const log = (o) => console.log(JSON.stringify(o));

function makeServer() {
  const docs = new Map();            // path -> JSON string
  const pages = new Set();
  const stats = { writes: 0, deletes: 0, maxDocBytes: 0, failNext: 0 };
  async function broadcast(path, json) {
    await Promise.all([...pages].map((p) => p.evaluate(([path, json]) => window.__dbPush && window.__dbPush(path, json), [path, json]).catch(() => {})));
  }
  return {
    docs, stats,
    async attach(page) {
      pages.add(page);
      await page.exposeFunction('__dbWrite', async (op, path, json) => {
        if (stats.failNext > 0) { stats.failNext--; return { error: 'unavailable' }; }
        if (op === 'set') {
          if (json.length > 256 * 1024) return { error: 'invalid_argument' };
          stats.writes++; stats.maxDocBytes = Math.max(stats.maxDocBytes, json.length); docs.set(path, json);
        } else if (op === 'update') {
          if (!docs.has(path)) return { error: 'invalid_argument' };
          const merged = JSON.stringify(Object.assign(JSON.parse(docs.get(path)), JSON.parse(json)));
          stats.writes++; stats.updates = (stats.updates || 0) + 1; stats.maxDocBytes = Math.max(stats.maxDocBytes, merged.length); docs.set(path, merged); json = merged;
        } else { stats.deletes++; docs.delete(path); }
        setTimeout(() => broadcast(path, op === 'del' ? null : json), 5);
        return { ok: true };
      });
      await page.exposeFunction('__dbDump', async () => [...docs.entries()]);
      page.on('close', () => pages.delete(page));
    },
    async seed(path, obj) { docs.set(path, JSON.stringify(obj)); },
  };
}

const MOCK = `(function(){
  var cache=null, docL={}, colL={}, ready=null;
  function load(){return ready||(ready=window.__dbDump().then(function(e){cache=new Map(e)}))}
  function snapDoc(path){var j=cache.get(path);return {id:path.split('/').pop(),exists:j!=null,data:function(){return j!=null?JSON.parse(j):undefined},metadata:{fromCache:false,hasPendingWrites:false}}}
  function parentOf(path){return path.slice(0,path.lastIndexOf('/'))}
  function colDocs(col){var out=[];cache.forEach(function(v,k){if(parentOf(k)===col)out.push(snapDoc(k))});return out}
  window.__dbPush=function(path,json){
    if(!cache)return;
    var had=cache.has(path);if(json==null)cache.delete(path);else cache.set(path,json);
    (docL[path]||[]).forEach(function(f){f(snapDoc(path))});
    var col=parentOf(path);
    (colL[col]||[]).forEach(function(f){var d=snapDoc(path),ch=[{type:json==null?'removed':had?'modified':'added',doc:json==null?{id:d.id,exists:true,data:function(){return {}}}:d}];
      var docs=colDocs(col);f({docs:docs,size:docs.length,empty:!docs.length,docChanges:function(){return ch},metadata:{fromCache:false,hasPendingWrites:false}})});
  };
  function write(op,path,body){return window.__dbWrite(op,path,body==null?null:JSON.stringify(body)).then(function(r){if(r&&r.error){var e=new Error(r.error);e.code=r.error;throw e}})}
  function docRef(path){return {id:path.split('/').pop(),path:path,
    get:function(){return load().then(function(){return snapDoc(path)})},
    set:function(b){return write('set',path,b)},update:function(b){return write('update',path,b)},delete:function(){return write('del',path)},
    onSnapshot:function(f){load().then(function(){(docL[path]=docL[path]||[]).push(f);f(snapDoc(path))});return function(){docL[path]=(docL[path]||[]).filter(function(x){return x!==f})}}}}
  function colRef(col){return {path:col,doc:function(id){return docRef(col+'/'+id)},
    get:function(){return load().then(function(){var docs=colDocs(col);return {docs:docs,size:docs.length,empty:!docs.length}})},
    onSnapshot:function(f){load().then(function(){(colL[col]=colL[col]||[]).push(f);var docs=colDocs(col);
      f({docs:docs,size:docs.length,empty:!docs.length,docChanges:function(){return docs.map(function(d,i){return {type:'added',doc:d,oldIndex:-1,newIndex:i}})},metadata:{fromCache:false,hasPendingWrites:false}})});
      return function(){colL[col]=(colL[col]||[]).filter(function(x){return x!==f})}}}}
    docRef.collection=undefined;
  window.claude={use:async function(n){if(n==='db')return {doc:docRef,collection:colRef};if(n==='user')return {can:async function(){return true}};return null}};
})();`;

async function client(server, viewport) {
  const b = await L.getBrowser();
  const ctx = await b.newContext({ viewport: viewport || { width: 1400, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e)));
  await server.attach(page);
  await page.addInitScript(MOCK);
  await page.addInitScript(() => localStorage.setItem('labboard.prefs.v1', '{"abDontAsk":true,"abNoticeSeen":true}'));
  await page.goto(L.FILE);
  await page.waitForFunction(() => !document.querySelector('#view .loading') && /Saved|View/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  return { page, ctx };
}
const serverTasks = (s) => [...s.docs.entries()].filter(([k]) => k.startsWith('tasks/')).map(([, v]) => JSON.parse(v));
const titles = (s) => serverTasks(s).map((t) => t.title).sort();
const cards = (p) => p.$$eval('.card h4', (h) => h.map((e) => e.textContent).sort());
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const v1 = (titles) => ({ version: 1, meta: { nextNum: titles.length + 1 }, stages: [{ id: 'st_todo', name: 'To Do' }, { id: 'st_done', name: 'Done', done: true }], projects: [{ id: 'pr_a', name: 'Alpha', color: '#2D7FF9' }],
  tasks: titles.map((t, i) => ({ id: 't_' + i, ref: 'T-00' + (i + 1), title: t, projectId: 'pr_a', stageId: 'st_todo', priority: 'medium', order: (i + 1) * 10 })) });

async function newTask(page, title) { await page.click('#btn-new'); await page.fill('#f-title', title); await page.click('[data-m=save]'); }

(async () => {
  // A. Upgrade from the single-document layout.
  {
    const S = makeServer(); await S.seed('board/main', { json: JSON.stringify(v1(['A', 'B', 'C'])) });
    const { page, ctx } = await client(S); await settle(page, 1200);
    log({ test: 'shared:migrateV1', cards: await cards(page), serverTasks: titles(S), metaDoc: S.docs.has('board/meta'), legacyKept: S.docs.has('board/main'), errors: page._errors });
    await ctx.close();
  }
  // B. Two people, same moment: each adds a task, and they edit different fields of one task.
  {
    const S = makeServer(); await S.seed('board/main', { json: JSON.stringify(v1(['Shared task'])) });
    const a = await client(S); await settle(a.page, 1200);
    const b = await client(S); await settle(b.page, 600);
    // Both open the same task before either saves.
    await a.page.click('.card'); await b.page.click('.card');
    await a.page.fill('#f-title', 'Renamed by A');
    await b.page.click('.pri-seg label.critical');
    await Promise.all([a.page.click('[data-m=save]'), b.page.click('[data-m=save]')]);
    await Promise.all([newTask(a.page, 'Added by A'), newTask(b.page, 'Added by B')]);
    await settle(a.page, 1500);
    const st = serverTasks(S).find((t) => t.id === 't_0');
    log({ test: 'shared:concurrentEdits', server: titles(S), sharedTask: { title: st.title, priority: st.priority }, aSees: await cards(a.page), bSees: await cards(b.page), refs: serverTasks(S).map((t) => t.ref).sort(), errors: a.page._errors.concat(b.page._errors) });
    // C. Delete in A shows up in B; Undo in A brings it back for both.
    await a.page.click('.card:has-text("Added by B")'); await a.page.click('[data-m=delete]'); await a.page.click('[data-m=delete]');
    await settle(a.page, 900);
    const bAfterDelete = await cards(b.page);
    await a.page.click('#toast [data-toast-act]'); await settle(a.page, 900);
    log({ test: 'shared:deleteAndUndo', bAfterDelete, bAfterUndo: await cards(b.page), server: titles(S) });
    await a.ctx.close(); await b.ctx.close();
  }
  // C2. Renaming the board reaches the other person.
  {
    const S = makeServer(); await S.seed('board/main', { json: JSON.stringify(v1(['X'])) });
    const a = await client(S); await settle(a.page, 1000); const b = await client(S); await settle(b.page, 500);
    await a.page.click('#title-btn'); await a.page.fill('#title-in', 'Shared Lab Board'); await a.page.keyboard.press('Enter');
    await settle(a.page, 900);
    log({ test: 'shared:title', bSees: await b.page.textContent('#title-text'), bTab: await b.page.title(), serverTitle: JSON.parse(S.docs.get('board/meta')).title });
    await a.ctx.close(); await b.ctx.close();
  }
  // C3. Boards, archive and column names between two people.
  {
    const S = makeServer(); await S.seed('board/main', { json: JSON.stringify(v1(['Main card'])) });
    const a = await client(S); await settle(a.page, 1000); const b = await client(S); await settle(b.page, 500);
    const ready = (p) => p.waitForFunction(() => !document.querySelector('#view .loading'));
    // A creates a board and adds a card there.
    await a.page.click('[data-act=boards]'); await a.page.fill('#nb-name', 'Shared second board'); await a.page.click('[data-m=b-create]'); await ready(a.page);
    await newTask(a.page, 'Card on board two'); await settle(a.page, 900);
    // B sees it in the Boards list and opens it.
    await b.page.click('[data-act=boards]');
    const bList = await b.page.$$eval('.brow .bname', (n) => n.map((x) => x.textContent));
    await b.page.click('.brow:has-text("Shared second board") [data-m=b-open]'); await ready(b.page); await settle(b.page, 400);
    const bCards = await cards(b.page);
    // A renames a column and archives the card after finishing it; B follows live.
    await a.page.click('.stage-head .st-name'); await a.page.fill('.st-in', 'Queue'); await a.page.keyboard.press('Enter');
    await a.page.click('.card'); await a.page.selectOption('#f-stage', { label: 'Done' }); await a.page.click('[data-m=save]');
    await a.page.click('.card .arch'); await settle(a.page, 900);
    const bAfter = { columns: await b.page.$$eval('.stage-head h3', (h) => h.map((x) => x.textContent)), cards: await cards(b.page), archivedBtn: await b.page.textContent('#btn-archive') };
    const paths = [...S.docs.keys()].filter((k) => !k.startsWith('tasks/') && k !== 'board/main' && k !== 'board/meta').map((k) => k.replace(/b_[a-z0-9]+/g, '<id>').replace(/t_[a-z0-9]+$/, '<task>')).sort();
    // A deletes the board; B's tab closes and B lands on the first board.
    await a.page.click('[data-act=boards]'); await a.page.click('.brow:has-text("Shared second board") [data-m=b-del]'); await a.page.fill('#db-name', 'Shared second board'); await a.page.click('#db-ok');
    await settle(a.page, 1200);
    log({ test: 'shared:boards', bList, bCards, bAfter, storedPaths: [...new Set(paths)], bTabsAfterDelete: await b.page.$$eval('.btab-go', (t) => t.map((x) => x.textContent)), bToast: await b.page.textContent('#toast'), bCardsNow: await cards(b.page),
      keptForRestore: [...S.docs.keys()].filter((k) => k.startsWith('boards/')).length, trashEntry: (() => { const e = [...S.docs.entries()].find(([k, v]) => k.startsWith('boardlist/') && JSON.parse(v).deleted); return e ? JSON.parse(e[1]).title : null })(), errors: a.page._errors.concat(b.page._errors) });
    await a.ctx.close(); await b.ctx.close();
  }
  // C4. Moving a project out when the save fails: nothing is lost. A deleted board can be restored by a teammate.
  {
    const S = makeServer();
    const base = v1(['P1 card', 'P1 card 2', 'Other card']); base.projects.push({ id: 'pr_b', name: 'Beta', color: '#E0662B' }); base.tasks[2].projectId = 'pr_b';
    await S.seed('board/main', { json: JSON.stringify(base) });
    const a = await client(S); await settle(a.page, 1000); const b = await client(S); await settle(b.page, 500);
    const ready = (p) => p.waitForFunction(() => !document.querySelector('#view .loading'));
    await a.page.click('[data-act=boards]'); await a.page.check('input[name=nb-mode][value=move]'); await a.page.selectOption('#nb-proj', 'pr_a');
    const label = await a.page.textContent('#nb-go');
    S.stats.failNext = 1;
    await a.page.click('#nb-go'); await settle(a.page, 600);
    const failed = { error: await a.page.textContent('#nb-err'), aStillHas: await cards(a.page), serverStillHas: titles(S) };
    await a.page.click('#nb-go'); await ready(a.page); await settle(a.page, 900);
    const ok = { aTabs: await a.page.$$eval('.btab-go', (t) => t.map((x) => x.textContent)), aCards: await cards(a.page), mainOnServer: titles(S) };
    // A deletes the new board; B restores it from Recently deleted.
    await a.page.click('[data-act=boards]'); await a.page.click('.brow:has-text("Alpha") [data-m=b-del]'); await a.page.fill('#db-name', 'Alpha'); await a.page.click('#db-ok'); await settle(a.page, 900);
    await b.page.click('[data-act=boards]');
    const bBin = await b.page.$$eval('.trash-list .brow .bname', (n) => n.map((x) => x.textContent));
    await b.page.click('.brow:has-text("Alpha") [data-m=b-restore]'); await ready(b.page); await settle(b.page, 900);
    log({ test: 'shared:moveAndRestore', label, failed, ok, bBin, bRestoredCards: await cards(b.page), aListAfter: await (async () => { await a.page.click('[data-act=boards]'); return a.page.$$eval('#b-list > .table:not(.trash-list) .brow .bname', (n) => n.map((x) => x.textContent)) })(), errors: a.page._errors.concat(b.page._errors) });
    await a.ctx.close(); await b.ctx.close();
  }
  // D. One edit writes only what changed.
  {
    const S = makeServer(); await S.seed('board/main', { json: JSON.stringify(v1(Array.from({ length: 300 }, (_, i) => 'Task ' + i))) });
    const { page, ctx } = await client(S); await settle(page, 2500);
    const w0 = S.stats.writes;
    await page.click('.card'); await page.fill('#f-title', 'Edited'); await page.click('[data-m=save]'); await settle(page);
    log({ test: 'shared:writesPerEdit', migrationWrites: w0, writesForOneEdit: S.stats.writes - w0 });
    await ctx.close();
  }
  // E. A board far above the old 256 KiB single-document ceiling.
  {
    const S = makeServer(); const big = L.genBoard(2000, { notesLen: 400 });
    await S.seed('board/main', { json: '{}' });
    const { page, ctx } = await client(S); await settle(page, 500);
    await page.click('#btn-backup');
    await page.setInputFiles('#b-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big)) });
    await page.waitForSelector('#b-restore:not([disabled])'); await page.click('#b-restore'); await page.click('#b-restore');
    await page.waitForFunction(() => /Saved, shared/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
    log({ test: 'shared:largeBoard', boardJsonKB: Math.round(JSON.stringify(big).length / 1024), serverTaskDocs: serverTasks(S).length, largestDocKB: +(S.stats.maxDocBytes / 1024).toFixed(1), status: await L.status(page) });
    await ctx.close();
  }
  // F. A failed write retries on its own.
  {
    const S = makeServer();
    const { page, ctx } = await client(S);
    S.stats.failNext = 1;
    await newTask(page, 'Survives a failed write'); await settle(page, 700);
    const st = await L.status(page); await settle(page, 2600);
    log({ test: 'shared:retry', statusAfterFail: st, server: titles(S), status: await L.status(page) });
    await ctx.close();
  }
  await L.close();
})();

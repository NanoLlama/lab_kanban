// Automatic backup file. Served from http://localhost (a secure origin) so the test can hand the page real
// FileSystemFileHandles from the origin-private file system in place of the native "Save as" dialog,
// which a headless browser cannot show. Everything after the picker (writing, remembering the handle in
// IndexedDB, permission checks) runs through the real browser APIs.
const L = require('./lib');
const http = require('http'), fs = require('fs'), path = require('path');
const log = (o) => console.log(JSON.stringify(o));
const BOARD = path.resolve(process.env.LAB_BOARD || path.join(__dirname, '../lab-board.html'));

const PICKER = `window.showSaveFilePicker=async function(o){
  window.__pickerOpts=o;
  if(window.__pickCancel)throw new DOMException('The user aborted a request.','AbortError');
  var d=await navigator.storage.getDirectory();return d.getFileHandle('lab-board-backup.json',{create:true});
};`;
const readFile = (p) => p.evaluate(async () => {
  try { const d = await navigator.storage.getDirectory(); const h = await d.getFileHandle('lab-board-backup.json'); const t = await (await h.getFile()).text(); const j = JSON.parse(t); return { tasks: j.tasks.length, title: j.meta.title }; }
  catch (e) { return { missing: e.name } }
});
const chip = (p) => p.$eval('#ab-chip', (c) => c.hidden ? 'hidden' : c.dataset.s + ' | ' + c.textContent.trim());
const dialog = (p) => p.$eval('#overlay', (o) => o.hidden ? null : document.getElementById('modal-title').textContent);

(async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(BOARD)) }).listen(0);
  const URL = 'http://localhost:' + srv.address().port + '/';
  const b = await L.getBrowser();
  async function ctxWith(scripts) {
    const ctx = await b.newContext({ acceptDownloads: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const s of scripts) await ctx.addInitScript(s);
    const page = await ctx.newPage(); page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e)));
    return { ctx, page };
  }
  const go = async (page) => { await page.goto(URL); await page.waitForSelector('#view .empty, #view .board'); await page.waitForTimeout(700); };

  // A. First open asks; choosing a location writes the file; every change rewrites it; reload resumes silently.
  {
    const { ctx, page } = await ctxWith([PICKER]); await go(page);
    const asked = await dialog(page), browserNote = await page.textContent('#modal-body .browser-req').catch(() => null);
    await page.click('[data-m=ab-choose]'); await page.waitForTimeout(400);
    const afterChoose = { dialog: await dialog(page), chip: await chip(page), file: await readFile(page), suggested: await page.evaluate(() => window.__pickerOpts.suggestedName) };
    await page.click('[data-act=load-sample]'); await page.waitForTimeout(2000);
    const afterSample = await readFile(page);
    await page.click('#title-btn'); await page.fill('#title-in', 'Rivera Lab'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000);
    const afterRename = await readFile(page);
    await go(page);
    const reloaded = { dialog: await dialog(page), chip: await chip(page) };
    await page.click('#btn-new'); await page.fill('#f-title', 'After reload'); await page.click('[data-m=save]'); await page.waitForTimeout(2000);
    log({ test: 'ab:firstOpen', asked, browserNote, afterChoose, afterSample, afterRename, reloaded, afterReloadEdit: await readFile(page), staleDot: await page.$eval('#btn-backup', (b) => b.classList.contains('stale')), errors: page._errors });
    await ctx.close();
  }
  // B. After a browser restart permission is "prompt": the board asks to resume, one click resumes.
  {
    const { ctx, page } = await ctxWith([PICKER]); await go(page);
    await page.click('[data-m=ab-choose]'); await page.waitForTimeout(300);
    await ctx.addInitScript(() => { FileSystemHandle.prototype.queryPermission = async () => 'prompt'; FileSystemHandle.prototype.requestPermission = async () => 'granted'; });
    await go(page);
    const asked = await dialog(page), chipBefore = await chip(page);
    await page.click('[data-m=ab-resume]'); await page.waitForTimeout(300);
    await page.click('[data-act=load-sample]'); await page.waitForTimeout(2000);
    log({ test: 'ab:resumeAfterRestart', asked, chipBefore, chipAfter: await chip(page), dialogClosed: !(await dialog(page)), file: await readFile(page), errors: page._errors });
    await ctx.close();
  }
  // C. "Not now" with "Don't ask again": quiet next time, still available under Backup.
  {
    const { ctx, page } = await ctxWith([PICKER]); await go(page);
    await page.check('#ab-dont'); await page.click('[data-m=ab-later]');
    await go(page);
    const askedAgain = await dialog(page);
    await page.click('#btn-backup');
    const section = await page.textContent('#ab-sec');
    log({ test: 'ab:dontAskAgain', askedAgain, chip: await chip(page), backupDialogOffers: /Choose location/.test(section) && /Chrome or Edge/.test(section), errors: page._errors });
    await ctx.close();
  }
  // D. Cancelling the save dialog changes nothing.
  {
    const { ctx, page } = await ctxWith([PICKER, 'window.__pickCancel=true']); await go(page);
    await page.click('[data-m=ab-choose]'); await page.waitForTimeout(300);
    log({ test: 'ab:cancelPicker', dialogStillOpen: await dialog(page), chip: await chip(page), errors: page._errors });
    await ctx.close();
  }
  // E. The file is deleted or moved while the board is open: the board says so instead of failing silently.
  {
    const { ctx, page } = await ctxWith([PICKER]); await go(page);
    await page.click('[data-m=ab-choose]'); await page.waitForTimeout(300);
    await page.evaluate(async () => { FileSystemFileHandle.prototype.createWritable = async function () { throw new DOMException('A requested file or directory could not be found.', 'NotFoundError') } });
    await page.click('[data-act=load-sample]'); await page.waitForTimeout(2000);
    log({ test: 'ab:fileGone', chip: await chip(page), toast: await page.textContent('#toast'), errors: page._errors });
    // Change location fixes it.
    await page.evaluate(() => { delete FileSystemFileHandle.prototype.createWritable });
    await ctx.close();
  }
  // F. Browsers without the API (Firefox, Safari, phones): a one-time notice naming Chrome or Edge.
  {
    const { ctx, page } = await ctxWith(['window.showSaveFilePicker=undefined']); await go(page);
    const notice = await dialog(page), body = await page.textContent('#modal-body');
    await page.click('[data-m=ab-ok]'); await go(page);
    const again = await dialog(page);
    await page.click('#btn-backup');
    log({ test: 'ab:unsupportedBrowser', notice, namesBrowsers: /Chrome or Edge/.test(body), shownAgainAfterOK: again, chip: await chip(page), backupSection: (await page.textContent('#ab-sec')).replace(/\s+/g, ' ').slice(0, 120), errors: page._errors });
    await ctx.close();
  }
  // G. Download backup works when the page is opened as a plain file (no claude.ai downloads capability).
  {
    const { page, ctx } = await L.open({});
    await page.click('[data-act=load-sample]'); await page.click('#btn-backup');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-m=dl-json]')]);
    let tasks = null; if (dl) { const p = await dl.path(); tasks = JSON.parse(fs.readFileSync(p, 'utf8')).tasks.length; }
    log({ test: 'download:plainFile', filename: dl && dl.suggestedFilename(), tasks, message: await page.textContent('#b-msg') });
    await ctx.close();
  }
  srv.close(); await L.close();
})();

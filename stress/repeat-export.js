// Repeating tasks, the Excel workbook and the shareable report.
const L = require('./lib');
const fs = require('fs');
const log = (o) => console.log(JSON.stringify(o));
const today = () => L.iso(0);

(async () => {
  // 1. A weekly task moved to Done adds the next occurrence on the same rhythm and keeps a history.
  {
    const { page, ctx } = await L.open({});
    await page.click('#btn-new'); await page.fill('#f-title', 'Weekly passage'); await page.selectOption('#f-rep', '1:week');
    await page.fill('#f-start', L.iso(-2)); await page.fill('#f-due', today()); await page.click('[data-m=save]');
    await page.click('.card:has-text("Weekly passage")'); await page.selectOption('#f-stage', 'st_done'); await page.click('[data-m=save]'); await page.waitForTimeout(100);
    const cards = await page.$$eval('.card:has-text("Weekly passage")', (c) => c.map((x) => ({ done: x.classList.contains('is-done'), due: x.querySelector('.badge') && x.querySelector('.badge').textContent, repeat: !!x.querySelector('.rep') })));
    const toast = await page.textContent('#toast');
    // Moving the finished one out of Done and back again does not add another occurrence.
    const ref = (sel) => page.$eval(sel, (c) => c.querySelector('.ref').textContent);
    const first = await ref('.card.is-done:has-text("Weekly passage")'), next = await ref('.card:not(.is-done):has-text("Weekly passage")');
    await page.click('.card.is-done:has-text("Weekly passage")'); await page.selectOption('#f-stage', 'st_todo'); await page.click('[data-m=save]');
    await page.click(`.card:has(.ref:text-is("${first}"))`); await page.selectOption('#f-stage', 'st_done'); await page.click('[data-m=save]'); await page.waitForTimeout(50);
    const afterToggle = await page.$$eval('.card:has-text("Weekly passage")', (c) => c.map((x) => x.querySelector('.ref').textContent + (x.classList.contains('is-done') ? ' done' : ' open')));
    await page.click(`.card:has(.ref:text-is("${next}"))`);
    const history = (await page.textContent('#modal-body')).match(/History.*?on time/);
    await page.click('[data-close]');
    log({ test: 'repeat:weekly', cards, toast, afterToggle, history: history && history[0].replace(/\s+/g, ' '), errors: page._errors });
    await ctx.close();
  }
  // 2. Monthly on the 31st lands on the last day of a shorter month; occurrences missed while a task sat
  //    undone are skipped, so the next one is never already overdue.
  {
    const { page, ctx } = await L.open({});
    const make = async (title, rep, start, due) => { await page.click('#btn-new'); await page.fill('#f-title', title); await page.selectOption('#f-rep', rep); await page.fill('#f-start', start); await page.fill('#f-due', due); await page.click('[data-m=save]');
      await page.click(`.card:has-text("${title}")`); await page.selectOption('#f-stage', 'st_done'); await page.click('[data-m=save]'); await page.waitForTimeout(50);
      return page.$eval(`.card:not(.is-done):has-text("${title}") .badge`, (b) => b.title.replace('Deadline ', '')); };
    const monthEnd = await make('Monthly report', '1:month', '2031-01-25', '2031-01-31');
    const lateWeekly = await make('Old weekly', '1:week', L.iso(-40), L.iso(-38));
    log({ test: 'repeat:dates', monthEnd, lateWeeklyNextDue: lateWeekly, notOverdue: lateWeekly >= L.iso(0), errors: page._errors });
    await ctx.close();
  }
  // 3. Excel workbook: a real zip with a summary, all tasks, one sheet per project.
  {
    const { page, ctx } = await L.open({ claude: 'window.__dl=null;window.claude={use:async(n)=>{if(n===\"downloads\")return {save:async(o)=>{window.__dl=o}};throw new Error(\"no\")}}' });
    await page.click('[data-act=load-sample]'); await page.click('#btn-export'); await page.click('[data-m=x-xlsx]'); await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const d = window.__dl; if (!d) return null; const b = d.data, txt = new TextDecoder().decode(b);
      return { filename: d.filename, bytes: b.length, zipSig: b[0] === 0x50 && b[1] === 0x4b, sheets: (txt.match(/<sheet name="[^"]+"/g) || []).map((s) => s.slice(13, -1)) };
    });
    log({ test: 'export:xlsx', info, message: await page.textContent('#x-msg'), errors: page._errors });
    // 4. Report: whole board and one project; notes only when asked for.
    await page.selectOption('#rp-scope', 'pr_ms'); await page.click('[data-m=x-report]'); await page.waitForTimeout(100);
    const proj = await page.evaluate(() => window.__dl.data);
    await page.selectOption('#rp-scope', ''); await page.check('#rp-notes'); await page.click('[data-m=x-report]'); await page.waitForTimeout(100);
    const board = await page.evaluate(() => ({ name: window.__dl.filename, html: window.__dl.data }));
    log({ test: 'export:report', projectReportHasOtherProjects: /Western blot/.test(proj), projectTitle: (proj.match(/<h1>([^<]+)/) || [])[1], boardName: board.name,
      notesIncluded: /4 guides per gene/.test(board.html), notesHiddenByDefault: !/4 guides per gene/.test(proj), noScripts: !/<script/i.test(board.html), errors: page._errors });
    await ctx.close();
  }
  await L.close();
})();

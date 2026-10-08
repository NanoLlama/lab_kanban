// Shared helpers for the lab-board stress harness.
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file://' + path.resolve(process.env.LAB_BOARD || path.join(__dirname, '../lab-board.html'));
const DAY = 86400000;

function iso(dayOffset, base = new Date()) {
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()) + dayOffset * DAY);
  return d.toISOString().slice(0, 10);
}

// Deterministic PRNG so runs are comparable.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function genBoard(n, { notesLen = 40, projects = 8, people = 12, seed = 1 } = {}) {
  const r = rng(seed);
  const stages = [
    { id: 'st_todo', name: 'To Do', wip: null, done: false },
    { id: 'st_prog', name: 'In Progress', wip: 5, done: false },
    { id: 'st_review', name: 'In Review', wip: 3, done: false },
    { id: 'st_done', name: 'Done', wip: null, done: true },
  ];
  const pal = ['#0E9F8E', '#E0662B', '#7A5AF8', '#D63B6F', '#2D7FF9', '#B8860B', '#4C9F2F', '#6B7A8C'];
  const projs = Array.from({ length: projects }, (_, i) => ({ id: 'pr_' + i, name: 'Project ' + i, color: pal[i % 8] }));
  const names = Array.from({ length: people }, (_, i) => 'Person' + i + ' Lab');
  const pri = ['critical', 'high', 'medium', 'low'];
  const note = 'x'.repeat(notesLen);
  const tasks = Array.from({ length: n }, (_, i) => {
    const st = stages[Math.floor(r() * 4)];
    const s = Math.floor(r() * 120) - 60;
    return {
      id: 't_' + i, ref: 'T-' + String(i + 1).padStart(3, '0'), title: 'Task number ' + i + ' assay run',
      desc: note, projectId: projs[Math.floor(r() * projects)].id, stageId: st.id,
      priority: pri[Math.floor(r() * 4)], assignee: names[Math.floor(r() * people)],
      start: iso(s), due: iso(s + 1 + Math.floor(r() * 30)), blocked: r() < 0.05,
      order: (i + 1) * 10, createdAt: new Date().toISOString(), doneAt: st.done ? new Date().toISOString() : '',
    };
  });
  return { version: 1, meta: { title: 'x', nextNum: n + 1, sample: false, lastBackupAt: '', updatedAt: '' }, stages, projects: projs, tasks };
}

let browser;
async function getBrowser() { return browser || (browser = await chromium.launch()); }

// Opens the board. `data` seeds localStorage; `claude` is an init-script string that defines window.claude.
// Tests other than the auto-backup suite start with the auto-backup prompt switched off.
const QUIET = { abDontAsk: true, abNoticeSeen: true };
async function open({ data, claude, viewport, prefs, clock, autoBackup } = {}) {
  prefs = autoBackup ? prefs : Object.assign({}, QUIET, prefs || {});
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: viewport || { width: 1400, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  page.on('dialog', (d) => { page._errors.push('dialog:' + d.message()); d.dismiss(); });
  if (clock) await page.clock.install({ time: clock });
  await page.addInitScript(([d, p]) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      if (d) localStorage.setItem('labboard.data.v1', d);
      if (p) localStorage.setItem('labboard.prefs.v1', p);
    }
  }, [data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null, prefs ? JSON.stringify(prefs) : null]);
  if (claude) await page.addInitScript(claude);
  const t0 = Date.now();
  await page.goto(FILE);
  await page.waitForFunction(() => !document.querySelector('#view .loading'), null, { timeout: 120000 });
  page._loadMs = Date.now() - t0;
  return { page, ctx };
}

// Times a synchronous UI action inside the page (handlers are synchronous, so this is render time).
async function timeIt(page, fnSrc) {
  return page.evaluate((src) => { const t = performance.now(); (0, eval)(src); return +(performance.now() - t).toFixed(1); }, fnSrc);
}

async function status(page) { return page.$eval('#status', (e) => e.dataset.s + ' | ' + e.textContent.trim()); }

module.exports = { QUIET, FILE, DAY, iso, genBoard, open, timeIt, status, getBrowser, close: async () => browser && browser.close() };

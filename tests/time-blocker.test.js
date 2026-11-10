// Unit tests for the day planner's pure logic. Run: node --test 'tests/*.test.js'
// The logic lives in <script id="tb-core"> inside lab-board.html (and the same copy in time-blocker.html);
// it is loaded here as it is, with no copy.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function coreSource(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = html.match(/<script id="tb-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tb-core script not found in ' + file);
  return m[1];
}
function loadCore(file) {
  const ctx = { module: { exports: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(coreSource(file), ctx, { filename: file + '#tb-core' });
  return ctx.module.exports;
}
// The board (with its Day view) is the main app; the stand-alone time blocker carries the same core.
const C = loadCore('lab-board.html');
const B = (id, start, end, extra) => Object.assign({ id, start, end, focus: { kind: 'adhoc', title: id }, status: 'planned' }, extra);
// Objects from the vm context have another realm's prototypes; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

test('time formatting and parsing', () => {
  assert.equal(C.fmtHM(0), '00:00');
  assert.equal(C.fmtHM(570), '09:30');
  assert.equal(C.fmtHM(1440), '24:00');
  assert.equal(C.fmtHM(-20), '00:00');
  assert.equal(C.parseHM('9:30'), 570);
  assert.equal(C.parseHM('09:05'), 545);
  assert.equal(C.parseHM('0930'), 570);
  assert.equal(C.parseHM('24:00'), 1440);
  for (const bad of ['24:01', '9:60', '25:00', '', 'abc', '9', null]) assert.equal(C.parseHM(bad), null, String(bad));
  assert.equal(C.fmtDur(45), '45 min');
  assert.equal(C.fmtDur(60), '1 h');
  assert.equal(C.fmtDur(90), '1 h 30 min');
  assert.equal(C.fmtHours(390), '6.5 h');
  assert.equal(C.fmtHours(0), '0.0 h');
});

test('snapping', () => {
  assert.equal(C.snapMin(547, 15), 540);
  assert.equal(C.snapMin(553, 15), 555);
  assert.equal(C.snapMin(553, 15, 'floor'), 540);
  assert.equal(C.snapMin(541, 15, 'ceil'), 555);
  assert.equal(C.snapMin(541, 5), 540);
  assert.equal(C.snapMin(1439, 30), 1440);
  assert.equal(C.snapMin(-7, 10), 0);
  assert.equal(C.snapMin(2000, 15), 1440);
});

test('fixRange clamps, swaps and enforces a minimum length', () => {
  assert.deepEqual(plain(C.fixRange(600, 540, 15)), { start: 540, end: 600 });
  assert.deepEqual(plain(C.fixRange(-30, 30, 15)), { start: 0, end: 30 });
  assert.deepEqual(plain(C.fixRange(540, 545, 15)), { start: 540, end: 555 });
  assert.deepEqual(plain(C.fixRange(1435, 1440, 15)), { start: 1425, end: 1440 });
  assert.deepEqual(plain(C.fixRange(1500, 1600, 15)), { start: 1425, end: 1440 });
});

test('overlap layout: separate, touching, overlapping, chains and nesting', () => {
  // Separate and touching blocks do not overlap and use one full-width column.
  let L = C.layoutBlocks([B('a', 540, 600), B('b', 600, 660), B('c', 700, 720)]);
  for (const k of ['a', 'b', 'c']) assert.deepEqual(plain(L[k]), { col: 0, cols: 1, overlap: false }, k);
  // Two overlapping blocks sit side by side.
  L = C.layoutBlocks([B('a', 540, 630), B('b', 600, 660)]);
  assert.deepEqual(plain(L.a), { col: 0, cols: 2, overlap: true });
  assert.deepEqual(plain(L.b), { col: 1, cols: 2, overlap: true });
  // A chain a-b, b-c: c reuses a's column once a has ended; the cluster has 2 columns.
  L = C.layoutBlocks([B('a', 540, 600), B('b', 570, 660), B('c', 610, 700)]);
  assert.equal(L.a.col, 0); assert.equal(L.b.col, 1); assert.equal(L.c.col, 0);
  assert.ok(['a', 'b', 'c'].every((k) => L[k].cols === 2 && L[k].overlap));
  // Three at once need three columns; a later separate block starts a new cluster.
  L = C.layoutBlocks([B('a', 540, 660), B('b', 560, 600), B('c', 570, 590), B('d', 700, 760)]);
  assert.deepEqual([L.a.col, L.b.col, L.c.col], [0, 1, 2]);
  assert.ok(['a', 'b', 'c'].every((k) => L[k].cols === 3));
  assert.deepEqual(plain(L.d), { col: 0, cols: 1, overlap: false });
  // Nested: the long block comes first (its column), the short one beside it.
  L = C.layoutBlocks([B('inner', 600, 630), B('outer', 540, 720)]);
  assert.equal(L.outer.col, 0); assert.equal(L.inner.col, 1);
  // Order of input does not change the result.
  const blocks = [B('x', 540, 600), B('y', 550, 580), B('z', 590, 650), B('w', 640, 700)];
  assert.deepEqual(plain(C.layoutBlocks(blocks)), plain(C.layoutBlocks(blocks.slice().reverse())));
  assert.deepEqual(plain(C.layoutBlocks([])), {});
});

test('next free slot', () => {
  const bl = [B('a', 540, 600), B('b', 630, 690)];
  assert.equal(C.nextFreeSlot(bl, 480, 60, 1440), 480);
  assert.equal(C.nextFreeSlot(bl, 540, 30, 1440), 600);
  assert.equal(C.nextFreeSlot(bl, 540, 60, 1440), 690);
  assert.equal(C.nextFreeSlot(bl, 560, 15, 1440), 600);
  assert.equal(C.nextFreeSlot([B('a', 0, 1440)], 0, 15, 1440), null);
  assert.equal(C.nextFreeSlot([], 1430, 30, 1440), null);
});

test('day stats', () => {
  const day = { blocks: [
    B('a', 540, 600, { focus: { kind: 'inbox', title: 'x', inboxId: 'i_1' }, status: 'done' }),
    B('b', 600, 690),
    B('c', 700, 730, { focus: { kind: 'none', title: '' } }),
    B('d', 800, 860, { focus: { kind: 'inbox', title: 'y', inboxId: 'i_2' }, status: 'skipped' }),
  ] };
  assert.deepEqual(plain(C.dayStats(day)), { planned: 60 + 90 + 30, focus: 60, done: 1, total: 4 });
  assert.deepEqual(plain(C.dayStats(null)), { planned: 0, focus: 0, done: 0, total: 0 });
});

test('normalize rejects what is not a time blocker', () => {
  assert.throws(() => C.normalize(null), /not a time blocker backup/);
  assert.throws(() => C.normalize([1, 2]), /not a time blocker backup/);
  assert.throws(() => C.normalize({ hello: 1 }), /not a time blocker backup/);
  assert.throws(() => C.normalize({ stages: [], projects: [], tasks: [] }), /Lab Task Board backup/);
});

test('normalize repairs blocks, settings and the inbox', () => {
  const long = 'x'.repeat(400);
  const s = C.normalize({
    settings: { dayStart: 1430, dayEnd: 30, snap: 7, defaultLen: 3, weekStartsOn: 5, boardSource: 'cloud', notify: 'yes' },
    days: {
      '2026-11-09': { note: 'top 3', blocks: [
        { id: 'b_a', start: 630, end: 540, focus: { kind: 'adhoc', title: long, notes: 'n', color: '#ZZZZZZ' } },  // reversed, long title, bad color
        { id: 'b_a', start: 700, end: 702, focus: { kind: 'inbox' } },          // duplicate id, too short, inbox without id
        { id: 'bad id', start: -50, end: 2000, focus: { kind: 'weird', title: 'All day' }, status: 'nope' },
        { start: 'x', end: 10 },                                                   // dropped
        { id: 'b_c', start: 543, end: 557, focus: { kind: 'board' } },             // board without a ref
        { id: 'b_d', start: 900, end: 960, focus: { kind: 'adhoc', title: 'Old color', color: '#0E9F8E' } },
      ] },
      '2026-02-30': { blocks: [{ start: 1, end: 100 }] },                          // impossible date
      '2026-11-10': { note: '', blocks: [] },                                      // empty day
    },
    inbox: [{ id: 'i_1', title: '  Email   triage ' }, { title: '' }, { id: 'i_1', title: 'dup' }, 'junk'],
    templates: [{ name: '', blocks: [{ start: 60, end: 120, focus: { kind: 'none' } }] }],
  });
  // Out-of-range settings fall back to their defaults.
  assert.deepEqual(plain(s.settings), { dayStart: 420, dayEnd: 1140, snap: 15, defaultLen: 60, weekStartsOn: 1, notify: true, boardSource: 'auto', defaultBoardId: 'main' });
  // In range, hours are whole hours and the day ends after it starts.
  assert.deepEqual(plain(C.normalize({ settings: { dayStart: 510, dayEnd: 500, snap: 30, defaultLen: 20 } }).settings).dayStart, 480);
  const st = C.normalize({ settings: { dayStart: 510, dayEnd: 500, snap: 30, defaultLen: 20 } }).settings;
  assert.deepEqual([st.dayStart, st.dayEnd, st.snap, st.defaultLen], [480, 540, 30, 30]);
  assert.deepEqual(Object.keys(s.days), ['2026-11-09']);
  const bl = s.days['2026-11-09'].blocks;
  assert.equal(bl.length, 5);
  const ids = bl.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.match(id, /^b_\w+$/));
  const all = bl.find((b) => b.focus.title === 'All day');
  assert.deepEqual([all.start, all.end, all.status, all.focus.kind], [0, 1440, 'planned', 'adhoc']);
  const rev = bl.find((b) => b.focus.notes === 'n');
  assert.deepEqual([rev.start, rev.end, rev.focus.title.length, rev.focus.color], [540, 630, 300, '']);
  const short = bl.find((b) => b.start === 700);
  assert.deepEqual([short.end, short.focus.kind, short.focus.title], [705, 'adhoc', 'Untitled block']);
  const board = bl.find((b) => b.start === 545);
  assert.deepEqual([board.end, board.focus.kind, board.focus.ref], [555, 'adhoc', null]);
  assert.equal(bl.find((b) => b.start === 900).focus.color, '#5fc4b4');
  // Sorted by start time.
  assert.deepEqual(plain(bl.map((b) => b.start)), plain(bl.map((b) => b.start).slice().sort((a, b) => a - b)));
  assert.deepEqual(plain(s.inbox.map((x) => x.title)), ['Email triage', 'dup']);
  assert.notEqual(s.inbox[0].id, s.inbox[1].id);
  assert.equal(s.templates[0].name, 'Template');
  assert.equal(s.templates[0].blocks[0].focus.title, '');
});

test('normalize is idempotent and round-trips its own output exactly', () => {
  const raw = { meta: { title: 'Mine', lastBackupAt: '2026-11-01T10:00:00.000Z', customColors: ['#123456', 'bad'] },
    days: { '2026-11-09': { note: 'n', blocks: [{ id: 'b_1', start: 540, end: 600, focus: { kind: 'none', title: 'Lunch' }, status: 'done', outcome: 'ok', createdAt: '2026-11-09T08:00:00.000Z' }] } },
    inbox: [{ id: 'i_1', title: 'A', createdAt: '2026-11-09T08:00:00.000Z' }] };
  const once = C.normalize(raw);
  const twice = C.normalize(JSON.parse(JSON.stringify(once)));
  assert.equal(C.canon(twice), C.canon(once));
  assert.deepEqual(plain(once.meta.customColors), ['#123456']);
});

test('changing the snap setting never moves stored blocks', () => {
  const day = { blocks: [{ id: 'b_1', start: 545, end: 610, focus: { kind: 'adhoc', title: 'x' } }] };
  for (const snap of [5, 10, 15, 30]) {
    const s = C.normalize({ settings: { snap }, days: { '2026-11-09': day } });
    const b = s.days['2026-11-09'].blocks[0];
    assert.deepEqual([b.start, b.end], [545, 610], 'snap ' + snap);
  }
});

test('the board and the stand-alone time blocker carry the same core', () => {
  assert.equal(coreSource('lab-board.html'), coreSource('time-blocker.html'));
});

// The board's sample data, built by the board's own buildSample().
function sampleBoard() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'lab-board.html'), 'utf8');
  const m = html.match(/<script>\s*(function buildSample[\s\S]*?if\(typeof module!=='undefined'\) module\.exports=buildSample;)/);
  const ctx = { module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  return plain(ctx.module.exports('2026-11-10'));
}

test('toTaskRef carries a card over from the board', () => {
  const b = sampleBoard();
  const t = b.tasks.find((x) => x.ref === 'T-003');
  t.att = [{ id: 'a_1', kind: 'link', name: 'Protocol', url: 'https://example.org/p' }, { id: 'a_2', kind: 'file', name: 'gel.png' }];
  const r = plain(C.toTaskRef(b, 'main', t));
  assert.equal(r.schema, 'labboard.taskref/1');
  assert.deepEqual([r.boardId, r.boardTitle, r.taskId, r.ref, r.title], ['main', 'Lab Task Board', t.id, 'T-003', 'Lentivirus packaging and titer']);
  assert.deepEqual([r.projectId, r.projectName, r.projectColor], ['pr_crispr', 'CRISPR knockout screen', '#5fc4b4']);
  assert.deepEqual([r.stageId, r.stageName, r.stageDone], ['st_prog', 'In Progress', false]);
  assert.deepEqual([r.priority, r.assignee, r.start, r.due, r.blocked], ['critical', 'Patel', t.start, t.due, false]);
  assert.deepEqual(r.links, [{ name: 'Protocol', url: 'https://example.org/p' }], 'links only; files are never copied');
  assert.ok(r.pulledAt && r.sourceUpdatedAt === b.meta.updatedAt);
  const done = plain(C.toTaskRef(b, 'main', b.tasks.find((x) => x.stageId === 'st_done')));
  assert.equal(done.stageDone, true);
  // A card pointing at a stage that no longer exists reads as the first stage, as on the board.
  const lost = plain(C.toTaskRef(b, 'main', Object.assign({}, t, { stageId: 'st_gone', projectId: 'pr_gone' })));
  assert.deepEqual([lost.stageId, lost.projectName], ['st_todo', '']);
});

test('normTaskRef checks and caps a snapshot', () => {
  assert.equal(C.normTaskRef(null), null);
  assert.equal(C.normTaskRef({ title: 'no id' }), null);
  assert.equal(C.normTaskRef({ taskId: 't_1', schema: 'labboard.taskref/9' }), null, 'unknown schema versions are refused');
  const r = plain(C.normTaskRef({ taskId: 't_1', title: 'x'.repeat(400), priority: 'urgent', due: '2026-02-30', color: 'red', projectColor: '#0E9F8E',
    links: [{ name: 'ok', url: 'https://a.b/c' }, { name: 'bad', url: 'javascript:alert(1)' }], blocked: 1, pulledAt: 'yesterday' }));
  assert.equal(r.title.length, 300);
  assert.equal(r.priority, 'medium');
  assert.equal(r.due, '');
  assert.equal(r.color, '');
  assert.equal(r.projectColor, '#5fc4b4', 'old palette colors are re-tuned like the board does');
  assert.deepEqual(r.links, [{ name: 'ok', url: 'https://a.b/c' }]);
  assert.equal(r.blocked, true);
  assert.equal(r.pulledAt, '');
  assert.equal(r.boardId, 'main');
  assert.deepEqual(plain(C.normTaskRef(r)), r, 'idempotent');
});

test('a board block keeps its snapshot through normalize; sameRef ignores only timestamps', () => {
  const b = sampleBoard();
  const ref = plain(C.toTaskRef(b, 'main', b.tasks[2]));
  const st = C.normalize({ version: 1, days: { '2026-11-10': { blocks: [{ id: 'b_1', start: 540, end: 600, focus: { kind: 'board', title: 'stale', ref } }] } } });
  const f = plain(st.days['2026-11-10'].blocks[0].focus);
  assert.equal(f.kind, 'board');
  assert.equal(f.title, ref.title, 'the title follows the snapshot');
  assert.deepEqual(f.ref, ref);
  const later = Object.assign({}, ref, { pulledAt: new Date(Date.now() + 5000).toISOString(), sourceUpdatedAt: '' });
  assert.equal(C.sameRef(ref, later), true);
  assert.equal(C.sameRef(ref, Object.assign({}, ref, { due: '2027-01-01' })), false);
  assert.equal(C.sameRef(ref, Object.assign({}, ref, { links: [{ name: 'n', url: 'https://x.y/' }] })), false);
  // Without a usable snapshot a board block falls back to a free-text block.
  const bad = C.normalize({ version: 1, days: { '2026-11-10': { blocks: [{ id: 'b_2', start: 540, end: 600, focus: { kind: 'board', title: 'Kept title', ref: { nope: 1 } } }] } } });
  assert.deepEqual(plain(bad.days['2026-11-10'].blocks[0].focus).kind, 'adhoc');
  assert.equal(bad.days['2026-11-10'].blocks[0].focus.title, 'Kept title');
});

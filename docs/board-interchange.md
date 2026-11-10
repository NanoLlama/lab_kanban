# Board interchange: `TaskRef` (`labboard.taskref/1`)

A `TaskRef` is a snapshot of one card from a Lab Task Board. The board's Day view keeps one on every time block that works on a card. Any other tool can use it to hand a card over, too.

The functions live in `<script id="tb-core">`, which is identical in `lab-board.html` and `time-blocker.html`:

- `toTaskRef(board, boardId, task)` builds a TaskRef.
- `normTaskRef(x)` checks and caps a TaskRef.
- `sameRef(a, b)` compares two TaskRefs.

## Shape

```js
{
  schema: 'labboard.taskref/1',
  boardId: 'main',              // the board's registry id ('main' is the first board)
  boardTitle: 'Lab Task Board',
  taskId: 't_ab12cd3',          // the link key
  ref: 'T-012',                 // display only; refs can repeat across boards
  title: '', desc: '',
  projectId: '', projectName: '', projectColor: '#hex' | '',
  stageId: '', stageName: '', stageDone: false,
  priority: 'critical' | 'high' | 'medium' | 'low',
  assignee: '',
  start: 'YYYY-MM-DD' | '', due: 'YYYY-MM-DD' | '',
  blocked: false,
  color: '#hex' | '',           // the card's own color, if it has one
  links: [{ name, url }],       // link attachments only; files are never copied
  archived: false,
  pulledAt: 'ISO',              // when the snapshot was taken
  sourceUpdatedAt: 'ISO'        // the board's meta.updatedAt at that moment
}
```

## Rules

- **Identity.** Match on `taskId`, then use `boardId` to break ties. The sample board's ids (`t_1` … `t_20`) repeat across boards made from the sample, and so do `ref`s.
- **Checking.** `normTaskRef` does the following:
  - refuses anything without a `taskId`, or with a `schema` other than `labboard.taskref/1`;
  - caps lengths the way the board's `normTask` does (title 300, description 20,000);
  - checks dates with `validDate`, colors with `HEX` (re-tuning old palette colors), the priority against the board's list, and link URLs with the board's `linkTarget`.
  - It is idempotent.
- **Freshness.** Whenever a card's board is open, the Day view shows the card as it is now and quietly refreshes the stored snapshot. `sameRef` ignores `pulledAt` and `sourceUpdatedAt`, so a refresh happens only when something a person would notice has changed.
- **Missing cards.** When the card's board is open but the card is gone or archived, the block keeps its snapshot and shows "Not on the board". When the card's board is not open, the block shows its snapshot along with that board's title.
- **Drag and drop.** Use MIME type `application/x-labboard-taskref+json`, with the TaskRef as JSON. Also set `text/plain` to `T-012 Title`. The Day view's timeline accepts drops of this type from anywhere.

## Where the day plan is kept

The plan is personal. It is not part of any board, of a board's backup, or of a shared board.

- It is kept in the board's IndexedDB database `labboard`, store `kv`, under key `planner`, as a JSON string. If IndexedDB is not available, it falls back to localStorage key `labboard.planner.v1`.
- While automatic backup to a folder is on, the plan is also written as `_time-blocker.json` next to the boards' files.
  - An empty plan is never written there.
  - A browser with an empty plan that finds plans in the folder offers to load them. If the person declines and starts a new plan, the folder's previous file is first kept as `_time-blocker-before-<date>.json`.
- Plans made in the stand-alone `time-blocker.html` in the same browser are copied in once.
  - Its database is opened without a version and read only, so it is never created or changed.
- **Day plans → Plans** downloads and restores a plan file (`day-plans-<date>.json`). It also accepts backups from the stand-alone time blocker.

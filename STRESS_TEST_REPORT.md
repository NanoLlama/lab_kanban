# Lab Task Board: stress test report

Target: `lab-board.html` (the single-file board: Board and Timelines views, local or shared storage).
Method: headless Chromium (Playwright) drove the real page. Tests seeded data, used the real UI (file input, dialogs, drag events, keyboard), and mocked `window.claude` for the shared-storage and download paths. The harness is in [`stress/`](stress/) and can be re-run against any copy of the file.

The first commit on this branch is the file exactly as provided; the second applies the fixes below, so `git diff HEAD~1 -- lab-board.html` shows every change.

## Summary

| # | Area | Finding (original file) | Severity | Fixed |
|---|------|-------------------------|----------|-------|
| 1 | Shared sync | A colleague's change that arrives during the 350 ms save debounce is dropped and then overwritten | **High** (silent data loss) | Yes, task-level 3-way merge |
| 2 | Shared sync | A failed write is never retried; the next remote update silently discards the unsaved edit | **High** | Yes, backoff retry plus merge |
| 3 | Shared sync | Saving a task that someone else deleted while the dialog was open throws `TypeError`, and the dialog sticks | High | Yes, the user's version is restored |
| 4 | Dialogs | Esc, or a text selection that ends on the backdrop, closes the task dialog and discards the typing without warning | High (common) | Yes |
| 5 | Dates | Chrome date inputs accept 5-digit years (`20260-01-15`). The board shows "Jan 15", then the deadline silently vanishes on reload | Medium | Yes, range check plus `min`/`max` |
| 6 | Timeline | A typo year such as 2999 builds 72k DOM nodes and a 4.6M px wide strip; 9999 builds 594k nodes and overflows Chrome's 33.5M px limit | Medium | Yes, years limited to 1970–2199, window capped at 3 years |
| 7 | Layout | A long unbroken title has quadratic layout cost: 8k chars took 1.5 s, and a 1 MB title from a backup froze the tab for over 30 s | Medium | Yes, lengths capped on import |
| 8 | Reorder | Ordering by averaging neighbors breaks after 55 drops in the same spot (float precision), so cards stop landing where dropped | Medium | Yes, cell renumbered on each drop |
| 9 | Date rollover | "Today" is computed once. Past midnight, a due-today task still says "Due today" and the overdue count stays 0 | Medium | Yes, rechecked every minute and on tab focus |
| 10 | Example data | "Remove example data" also deletes example tasks the user edited | Medium | Yes, edited tasks and used projects kept |
| 11 | Example data | The sample task "Chase supplier…" has its deadline before its start, so any edit to it fails validation | Low | Yes |
| 12 | Import | `meta.nextNum: "abc"` makes the next task `T-NaN` | Low | Yes |
| 13 | Import | `projectId: "constructor"` (any `Object.prototype` name) passes validation; the task disappears in Project swimlanes | Low | Yes, prototype-free maps |
| 14 | Import | `2026-02-30` and `0000-00-00` pass validation ("Overdue 46333d"); opening the task blanks the field and silently erases the date on save | Low | Yes, real calendar dates only |
| 15 | Import | `null` entries in `stages`/`tasks` produce the raw error "Cannot read properties of null" | Low | Yes, skipped |
| 16 | Storage | Over about 5 MB, local saves fail with only a small grey status; on reload everything since is gone | Medium | Partly: loud warning to back up (see recommendations) |
| 17 | CSV export | Cells starting with `=`, `+`, `-`, `@` run as formulas in Excel or Sheets (CSV injection) | Medium (security) | Yes, prefixed with `'` |
| 18 | Accessibility | Tab leaves the open dialog (no focus trap); cards can only change stage by mouse drag | Medium | Yes, focus trap plus **Alt+←/→** moves a card |
| 19 | People | `Patel`, `patel` and `Patel ` become three people (filter, swimlanes) | Low | Yes, on new edits |
| 20 | People | Emoji names produce half a surrogate pair as the avatar initial | Low | Yes |
| 21 | Perf | Every search keystroke rebuilds the whole board: 150–600 ms at 3k–10k tasks | Low–Med | Yes, debounced above 500 tasks |

**Passed without changes:** XSS. An `<img onerror>` payload went in every user string (title, notes, assignee, ref, stage name, project name, plus a hostile project color) and was rendered through every view and dialog. It never fired. `esc()` is applied consistently and colors are regex-checked. Malformed JSON and missing stages are rejected with clear messages. No horizontal page scroll at 375 px width.

## Scale results (original file, local storage)

JS time for each action. Layout and paint come on top of these numbers.

| Tasks | Backup size | Load | DOM nodes | Regroup swimlanes | Search keystroke | Timeline | Save round-trip |
|------:|----:|----:|----:|----:|----:|----:|----:|
| 100 | 32 KB | 0.3 s | 1.3k | 14 ms | 10 ms | 11 ms | 0.7 s |
| 1,000 | 317 KB | 0.3 s | 11k | 79 ms | 30–70 ms | 56 ms | 0.8 s |
| 3,000 | 0.96 MB | 0.6 s | 33k | 100 ms | 155–190 ms | 126 ms | 1.4 s |
| 5,000 | 1.6 MB | 1.0 s | 55k | 215 ms | 140–350 ms | 228 ms | 1.6 s |
| 10,000 | 3.2 MB | 1.8 s | 111k | 290 ms | 380–620 ms | 526 ms | 2.3 s |

A real lab board (hundreds of tasks) is comfortably fast. Typing starts to lag past about 2,000 tasks, and the localStorage ceiling (about 5 MB) is reached around 10–15k tasks with short notes, or around 600 tasks with long protocol notes. The 800-task, 8 KB-note test (6.3 MB) failed to save.

## Before and after (same harness)

| Test | Original | Fixed |
|------|----------|-------|
| Remote add during local debounce | server `[A, Local]`, "Remote" lost | `[A, Local, Remote]` |
| Save a remotely deleted task | `TypeError`, dialog stuck | restored, toast shown |
| Failed write | "retry by editing", 0 retries | retried after 2 s, saved |
| Esc with typed text | closes, text lost | toast, second Esc closes |
| Drag-select out of the title field | dialog closes | stays open |
| Tab ×30 in dialog | focus escapes | trapped |
| Due `20260-01-15` via form | shown as "Jan 15", gone after reload | inline error: "Check the year" |
| Timeline, due 2190 | (n/a) | 14.6k px, "1 task falls outside the 3-year window" note |
| Timeline, due 9999 | 594k nodes, 1.9 s JS + layout | date rejected at import |
| 1 MB title in backup | tab hangs over 30 s | capped at 300 chars, instant |
| 80 consecutive reorders | wrong order at drop 55 | correct through 80 |
| Clock +2 h past midnight | "Due today", 0 overdue | "Overdue 1d", 1 overdue |
| Edit sample task, remove examples | edit deleted | kept |
| `nextNum: "abc"` | `T-NaN` | `T-002` |
| CSV `=HYPERLINK(…)` | raw formula | `'=HYPERLINK(…)` |
| Assignee `😀 Smith` initials | `\uD83D` + `S` | `😀S` |

## What changed in `lab-board.html`

- **`normalize()`**: skips non-object entries; uses prototype-free lookup maps; validates real calendar dates (1970–2199) and fixes start > due; caps lengths (title 300, notes 20k, names 40/60); sanitizes `meta` (numeric `nextNum`, only known keys); rejects non-finite `order`.
- **Shared persistence**: `mergeStates(base, local, remote)` merges whole tasks, stages, projects and meta. Whatever this browser changed since the last synced copy wins; everything else comes from the remote copy. Remote snapshots are no longer ignored while a save is pending. The echo of the in-flight write is recognized. Failed writes retry at 2 s, 4 s … up to 30 s.
- **Task dialog**: `min`/`max` on date inputs plus `validDate()` checks; a stage or project that disappeared falls back safely; a remotely deleted task is restored instead of crashing; saving an example task clears its `sample` flag; assignees are trimmed, whitespace-collapsed and matched case-insensitively to existing names.
- **Dialogs**: dirty check (`formSnap`) before Esc or backdrop close; the backdrop only closes on a click that also started on it; Tab focus trap.
- **Board**: drops renumber the target cell (10, 20, 30 …); Alt+←/→ moves a focused card between stages; search is debounced at 200 ms above 500 tasks.
- **Timeline**: window capped at 1,100 days (anchored 90 days before today when today is in range) with out-of-range bars pinned to the edge plus a note; dates outside the current year show the year.
- **Misc**: `TODAY` refreshed every minute and on `visibilitychange`; CSV formula escaping; code-point-safe initials; corrected sample task dates; louder storage-full toast.

## Recommendations not implemented (bigger design choices)

1. **Store tasks as separate shared documents** (e.g. `board/main` for stages, projects and meta, plus `tasks/{id}`) instead of one JSON blob. The merge above closes the data-loss window, but whole-board writes still grow with board size: 3.2 MB per save at 10k tasks. Per-task docs make each save tiny and conflicts field-local.
2. **Local mode beyond about 5 MB**: move local storage to IndexedDB (hundreds of MB) and keep localStorage only for prefs. Until then, the new toast tells the user to back up.
3. **Touch drag**: HTML5 drag-and-drop does not fire on iOS Safari or most mobile browsers. On phones, the only way to move a card is the Stage field in the dialog. A small pointer-events drag (long-press to pick up) would fix this.
4. **Rendering at scale**: render only changed cells, or virtualize long cells, if boards are expected to pass about 3k tasks. Collapsed lanes already help.
5. **Deleting a project deletes its tasks.** The button says so, but a "move tasks to No project" option (the default in most tools) plus a one-step **Undo** toast for deletes would remove the riskiest click in the app.
6. **`<!doctype html>`**: the file has none, so opened directly it renders in quirks mode (`document.compatMode = BackCompat`). If it is only ever published as an Artifact, the host adds the document skeleton and this is moot. If it is also shared as a raw file, add the doctype line at the top.
7. **Stage removal text** counts tasks against the saved stages, and stage moves made before Apply can change which stage receives them. Consider showing the destination name from the draft at Apply time.

## Re-running the harness

```bash
cd stress
npm install            # installs playwright (Chromium must be available)
npm run all            # perf, robustness, shared-sync, long-title layout
LAB_BOARD=/path/to/other-copy.html node robust.js   # test a different copy
```

Each test prints one JSON line. `perf.js` takes a few minutes at 10k tasks. On the original file, `robust.js` stalls on the 1 MB-title import, which is finding 7.

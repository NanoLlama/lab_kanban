# Lab Task Board: stress test report

Target: `lab-board.html` (the single-file board: Board and Timelines views, local or shared storage).
Method: headless Chromium (Playwright) drove the real page. Tests seeded data, used the real UI (file input, dialogs, drag events, keyboard), and mocked `window.claude` for the shared-storage and download paths. The harness is in [`stress/`](stress/) and can be re-run against any copy of the file.

The first commit on this branch is the file exactly as provided. Round 1 fixes are in the second commit and the round 2 work in the third, so `git log -p -- lab-board.html` walks through every change.

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

## Round 2: the recommendations, implemented

All seven recommendations from round 1 are now built, plus a larger color system. Every item is covered by a test in `stress/` (results below are from the final file).

### 1. Shared storage: one document per task
A finding while building this: the shared store caps each document at **256 KiB**. The original saved the whole board as one document, so a shared board stopped saving at roughly **800 tasks** (less with long notes).

- Layout: `board/meta` (stages, projects, settings, saved colors) plus `tasks/{id}` (one task each).
- **Upgrade is automatic.** The first client to open an old board copies `board/main` into the new layout and leaves the old document untouched as a fallback.
- Saves write only what changed. Existing documents get an `update()` holding just the changed fields, so two people editing different fields of one task at the same moment both keep their change. New tasks and deletes are written individually, 6 at a time, with progress shown in the status.
- Incoming changes are merged per task and per field against the last server copy. Duplicate task numbers (two people creating a task at the same instant) are renumbered the same way on every client.
- Subscriptions reconnect by themselves after a dropped connection, and deletions that happened during the gap are detected.

| Shared test (2 live browser clients + mock store) | Result |
|---|---|
| Open a board saved by the old version | upgraded: 3/3 tasks, settings doc created, old doc kept |
| A renames a task while B changes its priority, both save at once | server: "Renamed by A" **and** "critical" |
| A and B each add a task at the same moment | both kept, refs unique (T-001, T-002, T-003) |
| A deletes a task, then presses Undo | gone for B, then back for B |
| Writes for one card edit on a 300-task board | **1** document (was the whole board) |
| 2,000-task board (1.3 MB) | saved; largest document 0.7 KB |
| Write fails once | retried after 2 s, saved |

### 2. Local storage: IndexedDB
Boards saved in this browser now live in IndexedDB (no practical size limit), with localStorage used only when IndexedDB is unavailable. Existing localStorage boards move over on first load. The 6.3 MB board that could not be saved in round 1 now saves and reloads all 800 tasks.

### 3. Touch drag
Press and hold a card for about a third of a second, then drag it. Near the edge, the board scrolls sideways and the page scrolls up or down. A quick swipe still scrolls and a tap still opens the card. The tested sequence (phone viewport, real touch events): swipe does not move the card → tap opens it → hold lifts it → drag across to an off-screen column → it lands there, with no stray dialog or ghost left behind. Keyboard users still have **Alt+←/→**.

### 4. Rendering at scale
- The board remembers the markup of every header and cell. When the layout is unchanged, only the cells whose content changed are replaced, so an edit or a drop touches one or two cells, and keyboard focus survives.
- Each cell shows its first 40 cards, then a **Show N more** button. A drop below the last visible card lands where expected, not at the very end.
- Tasks are bucketed in one pass instead of one pass per lane, stage and header. Stage and project lookups use indexes.
- Each project's timeline shows its first 150 rows, then **Show all**.

| Tasks | Load (old → new) | Page elements | Save one card | Filter toggle | Regroup |
|---:|---|---|---|---|---|
| 1,000 | 0.37 → 0.22 s | 11.2k → 7.3k | 192 → 14 ms | 20 → 16 ms | 42 → 30 ms |
| 3,000 | 0.65 → 0.21 s | 33.3k → 7.3k | 415 → 24 ms | 126 → 22 ms | 101 → 54 ms |
| 5,000 | 0.91 → 0.26 s | 55.4k → 7.3k | 605 → 20 ms | 96 → 26 ms | 181 → 58 ms |
| 10,000 | 1.92 → 0.33 s | 110.7k → 7.3k | **3,548 → 40 ms** | 203 → 38 ms | 312 → 67 ms |

### 5. Safer deletes, with Undo
- **Deleting a project** asks what happens to its tasks: *Keep, move to No project* or *Delete them too*. The dialog lists what Apply will do.
- **Undo** (10 seconds, in the toast) after deleting a task, deleting projects, removing stages, removing example data, and restoring a backup. In shared mode, Undo is written back to everyone like any other change.

### 6. `<!doctype html>`
Added, so the file renders in standards mode when opened directly (`compatMode: CSS1Compat`). A host that wraps the page is unaffected.

### 7. Stage removal
Removing a stage now asks where its tasks should go (a dropdown of the other stages) and lists the plan under the rows ("Removing Review: its tasks go to Doing"). Chains are followed: a stage that receives tasks and is then removed passes them on. The task count includes tasks redirected into a stage.

### New: color palette and custom colors
- **24-color palette** (the original 8 first, so existing boards keep their colors), chosen to stay distinct and readable in light and dark themes.
- **Custom**: a native color picker (live preview while dragging) plus a hex field that accepts `#1a2b3c`, `1a2b3c` or `#abc`.
- **Saved colors**: any custom color used on the board is offered in every picker, for everyone on a shared board (up to 16, newest first).
- **Per-card color**: a task can override its project color (*Card color* in the task dialog, with *Use project color* to go back). The card tint and its timeline bar use the override, while the project chip keeps the project color, so cards still read by project. The CSV export gains a `color` column.

## Round 3: resizable columns and an editable title

### Resizable columns
- Drag the right edge of any column header to resize that column. The swimlane label column on the left resizes the same way. A blue line marks the edge on hover and while dragging.
- **Double-click** the edge to return that column to automatic width. Keyboard: Tab to the edge, then **←/→** (20 px; with **Shift**, 60 px), and **Delete** resets.
- Stage columns stay between 160 and 900 px and the label column between 90 and 400 px. Resized columns keep their width; the rest share the remaining space.
- Widths are a **per-person view setting** saved in that browser, so each person sizes the board for their own screen without changing anyone else's. They survive edits, regrouping and reloads.
- The test exposed one usability bug, fixed: the grab zone first overhung into the next column's header, which painted over half of it.

### Editable board title
- Click the title (a pencil appears on hover) to rename the board. **Enter** or clicking away saves, **Esc** cancels, and an empty title falls back to "Lab Task Board".
- The browser tab title follows it. The title is part of the board data: it is shared with everyone on a shared board, included in backups, and kept when example data is loaded. View-only users see it but can't edit it.

| Test | Result |
|---|---|
| Drag "To Do" edge +125 px | 300 → 420 px; neighbor unchanged |
| Drag far past the minimum | stops at 160 px |
| Edit a card, then reload | width kept (420 → 420, then 500 after keys, 500 after reload) |
| Double-click the edge | back to automatic width |
| Rename, Esc, blur, empty | saved / cancelled / saved / default restored |
| Rename on client A | client B's header and tab title update |
| `<img onerror>` as a title | shown as text, not run |

## Round 4: automatic backup file

**Works only in Chrome or Edge on a computer** (Windows, macOS, Linux, ChromeOS). It relies on the File System Access API, which Firefox, Safari and mobile browsers don't offer.

- **On opening**, the board asks *Set up automatic backup*. **Choose location…** opens the system Save dialog (suggested name `lab-board-backup.json`). Browsers only open that dialog from a click, which is why there is a prompt rather than the dialog opening by itself.
- After that, the board rewrites the file about 1.5 seconds after every change: your own edits and, on a shared board, teammates' edits. Pending changes are also written when the tab is hidden or closed.
- The chosen file is remembered in this browser. After a browser restart, Chrome or Edge needs one click to allow writing again (*Resume automatic backup?*), unless you picked **Allow on every visit**.
- A header chip shows the state: **Auto-backup on** (green) / **paused** (amber, click to resume) / **error** (red, e.g. the file was moved or deleted) / **off**. *Backup → Automatic backup file* has Change location, Resume and Turn off.
- **Not now** asks again next time; tick **Don't ask again** to stop. In other browsers a one-time notice explains that it needs Chrome or Edge and points to *Download backup*.
- A file in a cloud-synced folder (Dropbox, OneDrive, Google Drive, iCloud Drive) also protects against losing the computer. Restore it with *Backup → Restore from a backup*.
- **Fixed alongside:** *Download backup* and *Export tasks (.csv)* didn't work when the board was opened as a plain file ("Downloads are not available in this view"). They now fall back to a normal browser download.

| Test (`stress/autobackup.js`) | Result |
|---|---|
| First open | prompt shown, labelled "Works only in Chrome or Edge on a computer" |
| Choose location | file written immediately (empty board) |
| Load 20 example tasks / rename / reload and add a task | file follows: 20 tasks → new title → 21 tasks; no prompt after reload |
| Browser restart (permission back to "ask") | *Resume automatic backup?* → one click → writing again |
| Not now + Don't ask again | no prompt next time; still offered under Backup |
| Cancel the Save dialog | nothing changes |
| File deleted while open | red chip + "The backup file was moved or deleted. Choose a location again." |
| Firefox/Safari-like browser | one-time notice naming Chrome or Edge; chip hidden |
| Download backup from a plain-file page | `lab-board-backup-YYYY-MM-DD.json` with all 20 tasks |

How it was tested: headless Chrome can't show the native Save dialog, so the test hands the page a real browser file handle in its place. Writing, remembering the handle and permission checks run through the real browser APIs. Opened as a plain `file://` page, Chrome allows the picker (it returned "user cancelled", not a security error). One step still needs a person: a real save to your disk in desktop Chrome or Edge.

## Round 5: multiple boards as tabs, column names, archiving

### Multiple boards, open as tabs
- Each board is fully separate: its own columns, projects, cards, title, column widths and automatic-backup file. A board for one project never mixes with another.
- **Tabs** across the top show the open boards; click one to switch. **×** closes a tab without deleting the board (the last open tab can't be closed). Open tabs and the active tab are remembered.
- **+ Boards** opens the Boards panel:
  - **New board**, starting *empty with the standard columns*, *with the same columns as the current board*, or **by moving one project and its cards out of the current board** (to split an existing mixed board).
  - **All boards**: open any board in a tab, or delete one (two clicks; deleting cannot be undone, so the panel says to back it up first).
- Switching boards first writes the board being left, so a change made a split second before switching is kept (tested).
- **Backup → Restore** can now also **open a backup as a new board** instead of replacing the current one.
- Storage: the existing board stays where it was (nothing to migrate). New boards are stored next to it, in this browser or in the shared store (`boards/<id>`, `boards/<id>/tasks/*`, listed in `boardlist/<id>`). On a shared board, everyone sees new boards appear, and a board deleted by one person closes in everyone else's tabs with a notice.

### Rename columns in place
Click a column's name (To Do, In Progress, …), type, and press Enter. Esc cancels, and an empty name keeps the old one. The **Stages** button still offers the full editor (names, order, WIP limits, which columns count as done, add/remove).

### Archive finished cards (optional, never automatic)
- Cards in a *done* column show an **archive** icon (on hover, or always on touch screens). The done column's header has an icon that archives the cards it currently shows. A finished card's dialog has an **Archive** button, which saves any edits first.
- Archived cards leave the board, the timeline, WIP counts and filters, but are **kept**: they stay in backups, the automatic backup file and CSV exports (new `archived` column).
- **Archived (N)** in the header lists them, with search, **Restore** (back to its column) and **Delete** (two clicks, with Undo). Every archive action has Undo for 10 seconds.

| Test (`stress/boards.js`, `stress/shared.js`) | Result |
|---|---|
| Move "Western blot optimization" to a new board | new tab with its 4 cards; first board keeps the other 16 |
| Add a card, switch tabs instantly, switch back | card kept |
| Column width in board A | board B unaffected (400 vs 300 px) |
| Reload | same tabs, same active board, each board's own cards |
| Close a tab, reopen from Boards | board and cards intact |
| Delete a board | gone from the list and tabs; app switches to another board |
| Restore a backup "as a new board" | new tab with the backup's own columns and cards; other boards untouched |
| Archive one card / Undo / archive a whole done column | 20 → 19 → 20 → 17 cards on the board; "Archived 3" |
| Archive dialog: search, Restore, Delete | finds by text; Restore puts it back in Done; delete leaves the rest |
| After reload / in the backup | archived cards still archived and present in the backup |
| Rename "To Do" → "Backlog"; Esc; blank name | renamed / unchanged / unchanged; Stages dialog agrees; survives reload |
| Two people: A creates a board and adds a card | B sees the board in its list, opens it and sees the card |
| A renames a column and archives a card | B's board updates live ("Queue", card gone, "Archived 1") |
| A deletes the board | B's tab closes with "This board was deleted by someone else"; no documents left behind |

Speed is unchanged: at 10,000 tasks, saving one card takes about 20 ms and page load 0.33 s.

## Round 6: confirmations and safety nets

The **×** on a tab only ever *closed* the tab (the board stayed under + Boards), but nothing said so. Real board deletion took two quick clicks in the Boards panel and erased the data immediately. Both are now guarded, and the rest of the app was audited for other ways to lose data.

| Where data could be lost | Before | Now |
|---|---|---|
| **Delete a board** | two clicks, erased at once | confirmation window with the board's card, archived-card and project counts; **type the board name** to enable *Delete board*; **Download a backup first** button; the board goes to **Recently deleted** for 30 days (Restore any time, from the notice or + Boards), then is erased. *Erase now* in the bin takes two clicks. |
| Close a tab (×) | silent | notice: "Tab closed. The board and its cards are kept under + Boards." with **Reopen** |
| Replace a board from a backup | one click after choosing the file | a second click, after the button spells out what is replaced ("…replace all 12 cards in “X” with the 40 in the file"), plus Undo |
| Remove example data | one click (Undo only) | confirmation window stating how many example cards go and that your own cards stay, plus Undo |
| Move a project to a new board | cards left the old board *before* the new board was saved | the new board is written first; if that fails, nothing changes and an error says so. The button reads "Move N cards to a new board". |
| Stages / Projects *Apply* | Undo only when something was removed | Undo after every Apply (e.g. un-ticking "Counts as done" clears completion dates; Undo brings them back) |
| Closing the page right after an edit | a pending save could be lost | the save is written immediately when the page is hidden or closed, and the browser warns ("Leave site?") while a save is still in flight |
| Same board open in two browser tabs | the tab that saved last silently overwrote the other | each tab picks up the other's saves (and new or deleted boards) within a moment |
| Browser clearing storage on low disk | possible | the board asks the browser to keep its data (Chrome/Edge decide silently; skipped in Firefox, which would show a prompt) |

Already safe and unchanged: deleting a card (two clicks + Undo), deleting a project (choose keep/delete cards + Undo), removing a stage (choose where its cards go + Undo), permanently deleting an archived card (two clicks + Undo), Esc/backdrop on a dialog with edits (asks first).

| Test (`stress/safety.js`, `stress/shared.js`) | Result |
|---|---|
| Close a tab, then Reopen from the notice | board and its card back |
| Delete dialog | counts shown; button disabled until the exact name (any capitalisation) is typed; backup file downloaded; Esc with a typed name asks first |
| Delete, then Restore from the bin | tab and card back |
| Erase now | needs a second click ("cannot be undone"); stored data removed |
| Board deleted 31 days ago | erased on next load |
| Remove example data: Cancel / confirm | 20 cards stay / removed, Undo offered |
| Replace from backup | first click only arms; second replaces; Undo offered |
| Un-tick "Counts as done", then Undo | completion dates 2 → 0 → 2 |
| Two browser tabs on one board | each sees the other's new card; both survive a reload; a board made in one tab appears in the other |
| Close the page right after saving a card | browser asked to warn; card saved |
| Shared: moving a project when the save fails | error shown; cards still on the original board, locally and on the server |
| Shared: A deletes a board, B restores it from Recently deleted | B sees and restores it with its cards |

## Known limits
- Shared mode assumes a collection subscription delivers every task. The store documents queries as suited to "hundreds to low thousands" of documents and caps a database at 25,000. Past a few thousand tasks, archive Done tasks into a backup.
- Two people saving the **same field** of the same task at the same instant: the last write wins (there are no transactions).
- Undo restores the whole board as it was before the action, so a change someone else made during those 10 seconds would be rolled back too. A deleted board is restorable for 30 days; after that (or after *Erase now*) only a backup brings it back.
- Two browser tabs on one board now pick up each other's saves, but if both save within the same fraction of a second, a card edited in both keeps this tab's version.

## Re-running the harness

```bash
cd stress
npm install            # installs playwright (Chromium must be available)
npm run all            # perf, robustness, shared-sync (2 clients), features, long-title layout
LAB_BOARD=/path/to/other-copy.html node robust.js   # test a different copy
```

Each test prints one JSON line. `perf.js` takes a few minutes at 10k tasks (`SIZES=100,1000 node perf.js` for a quick run). On the original file, `robust.js` stalls on the 1 MB-title import, which is finding 7.

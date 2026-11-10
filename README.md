# lab_kanban
development of a lab kanban board for project management

## Lab Task Board with a Day view (`lab-board.html`)

One file that you open in a browser; there's nothing to install. It has three views:

- **Board:** the kanban board.
- **Timelines:** each project's tasks laid out over time.
- **Day:** a time-blocked plan for your day, built on the board's own cards.

### The Day view

- **Plan your cards:** the panel lists the open board's tasks. You can search them, filter by person, and hide done tasks (hidden by default).
  - To schedule a task, drag it onto the timeline, or press **Block** to put it at the next free time.
  - Drawing on the timeline opens a block editor already set to **Board task**, with a searchable list of the board's tasks.
  - From any card's dialog, **Plan time** opens the Day view with a new block for that card. If the card has unsaved edits, they are saved first. The button also shows how much time is already planned for the card.
- **Stays in step with the board:** a block shows its card as it is now: title, color, and "Done on board" when the card is finished.
  - Blocks for cards on another board show that board's name.
  - A deleted or archived card says "Not on the board" and keeps its last details.
  - On the board, a card with time planned today shows a small clock badge.
- **Done:** tick the box on a block to mark it done.
  - The block turns green and its title is struck through.
  - For a card, the toast offers **Move T-012 to Done**. One click moves the card, and the board's Undo can put it back. Nothing on the board changes without that click.
- **Other things:**
  - **Other task** is for free-text blocks, such as email triage or a seminar.
  - The **Inbox** keeps things you plan often that aren't board tasks.
  - **Nothing** is for lunch or buffers.
  - Each day has a note.
- **Editing blocks:** drag a block to move it, or drag its top or bottom edge to resize it. Hold Alt for 5-minute steps. Overlapping blocks sit side by side and are flagged. Most changes offer Undo.
- **Keyboard (Day view):**
  - N new block, T today, ←/→ change day, / search the panel, ? all shortcuts.
  - On a selected block: arrows move it, Shift+arrows resize it, X marks it done, Enter edits it, Delete removes it.
- **Your plan is personal:** it stays in this browser. It isn't part of any board, a board's backup or a shared board, so viewers of a shared board can plan too.
  - **Plans** downloads or restores it.
  - While the board backs up automatically to a folder, the plan is also saved there as `_time-blocker.json`. A new browser with an empty plan offers to load the plans it finds there instead of overwriting them.
- **Moving over from the stand-alone time blocker:** plans made in `time-blocker.html` in the same browser are brought into the Day view the first time it opens.

`docs/board-interchange.md` describes the card snapshot that blocks keep (`labboard.taskref/1`).

## Stand-alone time blocker (`time-blocker.html`)

This is the earlier, separate day planner. It doesn't link to the board's cards. The board's Day view replaces it, and plans move over automatically. It is kept for now. Its backups can be restored under **Day → Plans**.

## Tests

- `node --test 'tests/*.test.js'`: the planner's pure logic, including the card snapshots, checked against the board's sample data.
- In the browser (needs Playwright): `node stress/fusion.js` covers the Day view inside the board, and `node stress/timeblocker.js` covers the stand-alone page. `npm run all` in `stress/` runs the board's full suite.

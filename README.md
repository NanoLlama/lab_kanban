# lab_kanban
development of a lab kanban board for project management

## Time blocker (`time-blocker.html`)

A one-file day planner that sits next to `lab-board.html`. Open it in a browser; nothing to install.

- **Plan a day:** drag on empty time to draw a block, or click for a block of the default length. Drag a block to move it and drag its top or bottom edge to resize it; hold Alt for 5-minute steps. Overlapping blocks sit side by side and are flagged.
- **Keyboard:** N new block, T today, ←/→ change day, / add to inbox, ? all shortcuts. On a focused block: arrows move it, Shift+arrows resize it, Enter edits it, Delete removes it. Most changes offer Undo.
- **Inbox:** a list of tasks you reuse. Drag an item onto the timeline, or press **Block** to put it at the next free time.
- **Saving:** in this browser (IndexedDB). **Backup** downloads or restores a JSON file.
- **Automatic backup** (Chrome or Edge on a computer): choose a folder once and the time blocker rewrites `_time-blocker.json` there a moment after every change. If the board already backs up to a folder, that folder is offered first, so both sets of files sit together. After a browser restart, the browser asks once to allow writing again. Pause, resume, change folder or turn it off under **Backup**.
- The time blocker reads the board's theme choice and backup folder but never writes the board's storage.

Tests: `node --test 'tests/*.test.js'` (core logic) and `node stress/timeblocker.js` (in the browser, needs Playwright).

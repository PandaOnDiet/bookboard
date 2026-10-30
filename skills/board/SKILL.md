---
name: board
description: Keeps the project's pinned notes and task board in .board/board.md up to date. Use when the user adds, lists, parks or finishes a task or note ("add a task", "note this", "pin this", "park that", "mark it done", "what's pending"), and whenever you finish work that matches an open task on the board.
---

# Project board

The board is one Markdown file per project: `.board/board.md` at the project root.
The user edits it by hand too, so keep its shape exactly and never drop their text.

## Shape

```markdown
# Board

## Pinned notes
- Note text _(YYYY-MM-DD)_

## To do
- [ ] Task title _(added YYYY-MM-DD)_

## In progress
- [ ] Task title _(started YYYY-MM-DD)_

## Parked
- [ ] Task title — why it is parked _(parked YYYY-MM-DD)_

## Done
- [x] Task title _(done YYYY-MM-DD)_
```

If the file does not exist, create it with exactly these five sections, empty.

## Use the board tool first

When the `mcp__bookboard__board` tool is listed, change the board only through it (`list`, `add`, `note`, `move` with `to`, `unpin`), naming an item by a few of its words (`match`). It keeps the shape below, and the Bookboard panel updates at once. Each prompt already carries the board as it stands; read it before saying what is open. Edit the file by hand only when the tool is not there.

Titles: short and concrete, one line, the key words in **bold** (for example `Fix **sign-in redirect** losing \`returnTo\``). Never paste a whole reply as a title.

## Rules

- **Add a task**: append to `## To do`.
- **Start work on a task**: move it to `## In progress`.
- **Finish work**: when the work for an open task is really finished (and tested if it is code), move it to `## Done` with today's date and tell the user in one line: "Ticked: <task>". Do not tick a task whose work is only partly done.
- **Park**: move to `## Parked` with the reason the user gave, or "no reason given".
- **Unpark**: move back to `## To do`.
- **Notes**: "note this" or "pin this" adds to `## Pinned notes`. Pinned notes are standing instructions for this project: follow them.
- **Matching**: match a task by its words, not exact text. If two tasks could match, ask which one.
- **Listing**: show the board compactly, open sections first, Done last (last 5 only unless asked).
- Use today's date in `YYYY-MM-DD`. Keep each change small; never rewrite sections you did not touch.

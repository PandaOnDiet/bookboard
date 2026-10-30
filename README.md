# Bookboard

Pinned notes and a task board for each project, kept in `.board/board.md`, for
Claude Code. Claude reads the board at the start of every prompt and changes it
through its own tool, and a panel beside the chat shows it live.

Two plugins, one marketplace:

- **bookboard**: slash commands, the `board` skill and a SessionStart hook. Works
  in the terminal, the desktop app and the VS Code extension.
- **bookboard-pane**: the panel (To do and Notes tabs, Start / Done / Park
  buttons, add fields, a folder picker for multi-folder VS Code workspaces),
  the `board` tool Claude uses, and the board summary sent with each prompt.
  Built on Claude Code's plugin hooks API, which is early access: it needs
  Claude Code **2.1.310 or newer**.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install bookboard --marketplace PandaOnDiet/bookboard
/plugin install bookboard-pane --marketplace PandaOnDiet/bookboard
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install bookboard --marketplace PandaOnDiet/bookboard
claude plugin install bookboard-pane --marketplace PandaOnDiet/bookboard
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace
with `PandaOnDiet/bookboard`, then add both plugins.

## Use

- `/bookboard:note <text>` · `/bookboard:notes`
- `/bookboard:task <text>` · `/bookboard:tasks`
- `/bookboard:park <task> [because …]` · `/bookboard:done <task>`
- `/bookboard:capsule`: the board as text to paste into a new chat; nothing is written
- Plain words work too ("add a task…", "park that", "mark it done").
- With the panel: Claude starts a task when it begins it and ticks it when the
  work is finished; under each of Claude's replies, **📌 Note** and **＋ Task**
  put the reply in the panel's field to trim, and **📋 Board** opens and closes
  the panel.

The board is plain Markdown; edit it by hand whenever you like.

## Good to know

- Pinned notes are treated as standing instructions for that project.
- The folder picker reads VS Code's own list of the open workspace's folders
  (VS Code stable on Windows, macOS and Linux); you can also type a path.
- Debugging: set `BOOKBOARD_DEBUG` to a file path and the panel logs what it
  does there. Off by default.
- The SessionStart hook needs Node on the PATH.

## Develop

```
claude --plugin-dir ./ --plugin-dir ./pane
claude plugin test pane
```

## License

MIT

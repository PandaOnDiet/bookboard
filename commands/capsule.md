---
description: Copy this project's board into a new chat (no file is written)
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js" --capsule`

Show the text above to the user exactly as printed, inside one code block so it can be copied and pasted into a new chat. Do not change it, summarise it, or write it to a file. After the block, say in one line that pasting it into a new chat carries the board over.

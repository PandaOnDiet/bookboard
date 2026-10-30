import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

const PANE = 'bookboard'
const TOOL = 'mcp__bookboard-pane__board'
const SECTIONS = ['Pinned notes', 'To do', 'In progress', 'Parked', 'Done'] as const
type Section = typeof SECTIONS[number]
const EMPTY = '# Board\n\n' + SECTIONS.map(s => '## ' + s + '\n').join('\n')

const board = atom({ plugin: 'bookboard-pane', key: 'board' } as const, '', { shape: 'board-1' })
const project = atom({ plugin: 'bookboard-pane', key: 'project' } as const, '', { shape: 'project-1' })
// The workspace's folders, found once per session (see findFolders).
const folders = atom({ plugin: 'bookboard-pane', key: 'folders' } as const, [] as string[], { shape: 'folders-1' })
// What is typed in each field, kept as it is typed: VS Code hands onSubmit an empty value.
const drafts = atom({ plugin: 'bookboard-pane', key: 'drafts' } as const, {} as Record<string, string>, { shape: 'drafts-1' })
// Claude's final reply of each turn (newest last), so its buttons go under that reply only.
// Items whose long text is shown whole ("more" pressed), by section and place.
const expanded = atom({ plugin: 'bookboard-pane', key: 'expanded' } as const, [] as string[], { shape: 'expanded-1' })
// Which half of the panel is shown: the tasks or the pinned notes.
const tab = atom({ plugin: 'bookboard-pane', key: 'tab' } as const, 'todo' as 'todo' | 'notes', { shape: 'tab-1' })
const replies = atom({ plugin: 'bookboard-pane', key: 'replies' } as const, [] as string[], { shape: 'replies-1' })

const clean = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase()
// '' = the folder this chat started in, resolved to the session's project root.
const rootOf = async ($: Engine, dir: string) => clean(dir || (await $.session.root()))
const fileOf = async ($: Engine, dir: string) => (await rootOf($, dir)) + '/.board/board.md'
const nameOf = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() || 'This folder'
const today = () => new Date().toISOString().slice(0, 10)

// Off unless BOOKBOARD_DEBUG names a file: then each event is appended there, the last 300 lines kept.
async function log($: Engine, msg: string) {
  const file = await $.env.get('BOOKBOARD_DEBUG')
  if (!file) return
  let old = ''
  try { old = await $.fs.read(file) } catch {}
  const lines = (old + new Date().toISOString() + ' ' + msg + '\n').split('\n')
  try { await $.fs.write(file, lines.slice(-301).join('\n')) } catch {}
}
// Every control goes through this, so a failure is logged and shown instead of doing nothing.
const press = ($: Engine, name: string, fn: () => Promise<unknown>) => async () => {
  await log($, 'press ' + name)
  try { await fn() } catch (err) {
    await log($, 'press ' + name + ' failed: ' + String(err))
    $.ui.toast('Bookboard: ' + name + ' failed: ' + String(err))
  }
}
async function openPane($: Engine, why: string) {
  const opened = await $.ui.open({ id: PANE, title: 'Bookboard' })
  await log($, 'open (' + why + ') surfaces=' + JSON.stringify(await $.session.surfaces()) + ' -> ' + JSON.stringify(opened))
}

// Plugins are not told the editor's workspace folders, so read them where VS Code keeps them:
// the newest workspaceStorage entry whose .code-workspace file lists this session's folder.
// ponytail: VS Code stable only (not Insiders or VSCodium); a typed path covers anything this misses.
async function storeDir($: Engine) {
  const home = clean((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '')
  const xdg = clean((await $.env.get('XDG_CONFIG_HOME')) || '') || (home && home + '/.config')
  const appData = clean((await $.env.get('APPDATA')) || '')
  const dirs = [appData, home && home + '/Library/Application Support', xdg].filter(Boolean)
  for (const dir of dirs) {
    try { return { dir: dir + '/Code/User/workspaceStorage', entries: [...(await $.fs.list(dir + '/Code/User/workspaceStorage'))] } } catch {}
  }
  return null
}
async function findFolders($: Engine) {
  const root = await $.session.root()
  const found = await storeDir($)
  if (!found) return []
  const { dir: store, entries } = found
  for (const ent of entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 10)) {
    try {
      const ws = JSON.parse(await $.fs.read(store + '/' + ent.name + '/workspace.json')).workspace
      if (!ws) continue
      // file:///d%3A/x on Windows, file:///home/x elsewhere.
      const file = decodeURIComponent(ws).replace(/^file:\/\//, '').replace(/^\/([a-zA-Z]:)/, '$1')
      const base = file.slice(0, file.lastIndexOf('/'))
      const list: string[] = JSON.parse(await $.fs.read(file)).folders.map((f: { path: string }) => resolve(base, f.path))
      if (list.some(f => same(f, root))) return list
    } catch {}
  }
  return []
}
function resolve(base: string, p: string) {
  const parts: string[] = []
  for (const seg of clean(/^[a-zA-Z]:|^\//.test(p) ? p : base + '/' + p).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return (/^\//.test(p) || (!/^[a-zA-Z]:/.test(p) && /^\//.test(base)) ? '/' : '') + parts.join('/')
}

// The board as items, each remembering its own line so a move finds it again.
type Item = { sec: Section; line: string; title: string }
function parse(text: string) {
  const out: Item[] = []
  let sec: Section | '' = ''
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^## (.+?)\s*$/)
    if (h) { const name = h[1] ?? ''; sec = (SECTIONS as readonly string[]).includes(name) ? name as Section : ''; continue }
    if (!sec || !/^- /.test(line)) continue
    out.push({ sec, line, title: line.replace(/^- (\[[ x]\] )?/, '').replace(/\s*_\(.*?\)_\s*$/, '') })
  }
  return out
}

function addLine(text: string, section: Section, line: string) {
  const lines = (text || EMPTY).split(/\r?\n/)
  let i = lines.findIndex(l => l.trim() === '## ' + section)
  if (i < 0) { lines.push('', '## ' + section); i = lines.length - 1 }
  let j = i + 1
  while (j < lines.length && !(lines[j] ?? '').startsWith('## ')) j++
  while (j > i + 1 && !(lines[j - 1] ?? '').trim()) j--
  lines.splice(j, 0, line)
  return lines.join('\n')
}

function removeLine(text: string, line: string) {
  const lines = text.split(/\r?\n/)
  const i = lines.indexOf(line)
  if (i >= 0) lines.splice(i, 1)
  return lines.join('\n')
}

// The line shapes the board skill writes (skills/board/SKILL.md).
function lineFor(to: Section, title: string) {
  const t = title
  switch (to) {
    case 'To do': return `- [ ] ${t} _(added ${today()})_`
    case 'In progress': return `- [ ] ${t} _(started ${today()})_`
    case 'Parked': return `- [ ] ${t.includes(' — ') ? t : t + ' — no reason given'} _(parked ${today()})_`
    case 'Done': return `- [x] ${t} _(done ${today()})_`
    case 'Pinned notes': return `- ${t} _(${today()})_`
  }
}

async function reload($: Engine) {
  const file = await fileOf($, await read($, project))
  let text = ''
  try { text = await $.fs.read(file) } catch { text = '' }
  await log($, 'reload ' + file + ' (' + text.length + ' chars)')
  await update($, board, () => text)
  return text
}

async function save($: Engine, text: string) {
  const file = await fileOf($, await read($, project))
  await $.fs.write(file, text)
  await log($, 'save ' + file + ' (' + text.length + ' chars)')
  await update($, board, () => text)
}

// Cuts at a word boundary, so a long item never pushes its buttons away.
const clip = (t: string, n: number) => t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…'

// A reply made into one line: headings end in a colon, list and quote marks go, inline
// **bold** and `code` stay so the keywords still stand out.
function flatten(md: string) {
  const parts = md.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(```|---|\|)/.test(l))
    .map(l => /^#{1,6}\s/.test(l) ? l.replace(/^#{1,6}\s+/, '').replace(/[:.]?$/, ':') : l.replace(/^([-*+>]|\d+[.)])\s+/, ''))
  return clip(parts.join(' ').replace(/\s+/g, ' ').trim(), 500)
}

// The item a few words name: the one holding them as typed, else the one holding every word.
function findItem(items: Item[], match: string) {
  const m = match.toLowerCase().trim()
  const hits = items.filter(i => i.title.toLowerCase().includes(m))
  if (hits.length) return hits
  const words = m.split(/\s+/).filter(Boolean)
  return items.filter(i => words.every(w => i.title.toLowerCase().includes(w)))
}

// The board in a few lines, for Claude: what is open, what is parked, the standing notes.
function summary(text: string, name: string) {
  const items = parse(text)
  const line = (s: Section) => {
    const got = items.filter(i => i.sec === s)
    return got.length ? `${s}: ` + got.slice(0, 12).map(i => clip(i.title, 100)).join('; ') + (got.length > 12 ? ` (+${got.length - 12} more)` : '') : `${s}: none`
  }
  return [`Bookboard for ${name} (.board/board.md), as it stands now:`,
    line('In progress'), line('To do'), line('Parked'), line('Pinned notes'),
    `Pinned notes are standing instructions. Change the board only with the ${TOOL} tool (list, add, note, move, unpin): start a task when you begin it, mark it Done only when it is really finished. Keep titles short and concrete; put the key words in **bold**.`].join('\n')
}

// Re-read before every change so an edit Claude or the person made meanwhile is kept.
async function move($: Engine, item: Item, to: Section | null) {
  const cur = await reload($)
  if (!cur.split(/\r?\n/).includes(item.line)) { $.ui.toast('That item changed on disk; the board is refreshed.'); return }
  const rest = removeLine(cur, item.line)
  // Leaving Parked drops the park reason ("title — why"); any other dash in a title stays.
  const title = item.sec === 'Parked' && to !== 'Parked' ? item.title.split(' — ')[0] ?? item.title : item.title
  await save($, to ? addLine(rest, to, lineFor(to, title)) : rest)
}

// The submitted text, else what was typed into that field.
async function take($: Engine, key: string, value: string) {
  const text = value.trim() ? value : (await read($, drafts))[key] ?? ''
  await log($, 'submit ' + key + ' value=' + value.length + ' draft=' + text.length)
  await update($, drafts, d => ({ ...d, [key]: '' }))
  return text
}

async function add($: Engine, to: Section, value: string) {
  const title = value.replace(/\s+/g, ' ').trim().slice(0, 1000)
  if (!title) { $.ui.toast('Type something first.'); return }
  await save($, addLine(await reload($), to, lineFor(to, title)))
}

type BoardCall = { action?: string; title?: string; match?: string; to?: string; reason?: string }
// What Claude's board tool does; every answer is a sentence it can act on.
async function serve($: Engine, a: BoardCall) {
  const name = nameOf(await rootOf($, await read($, project)))
  const text = await reload($)
  if (a.action === 'list' || !a.action) return text ? summary(text, name) : `No board in ${name} yet. Add a task to create it.`
  if (a.action === 'add' || a.action === 'note') {
    if (!a.title?.trim()) return 'Give a title.'
    await add($, a.action === 'add' ? 'To do' : 'Pinned notes', a.title)
    return `Added to ${a.action === 'add' ? 'To do' : 'Pinned notes'}: ${a.title.trim()}`
  }
  if (a.action === 'move' || a.action === 'unpin') {
    const to = a.action === 'unpin' ? null : SECTIONS.find(s => s.toLowerCase() === (a.to ?? '').toLowerCase())
    if (to === undefined) return `Say where to move it: one of ${SECTIONS.join(', ')}.`
    const items = parse(text).filter(i => a.action === 'unpin' ? i.sec === 'Pinned notes' : i.sec !== 'Pinned notes')
    const hits = findItem(items, a.match ?? '')
    if (!a.match?.trim() || !hits.length) return `No item matches "${a.match ?? ''}". The board:\n` + summary(text, name)
    if (hits.length > 1) return `"${a.match}" matches ${hits.length} items; name one: ` + hits.map(h => `[${h.sec}] ${clip(h.title, 80)}`).join('; ')
    const item = hits[0]!
    const title = to === 'Parked' && a.reason ? (item.sec === 'Parked' ? item.title.split(' — ')[0] : item.title) + ' — ' + a.reason : item.title
    await move($, { ...item, title }, to)
    return to ? `Moved to ${to}: ${clip(item.title, 100)}` : `Unpinned: ${clip(item.title, 100)}`
  }
  return 'Unknown action. Use list, add, note, move or unpin.'
}

async function useProject($: Engine, dir: string) {
  await update($, project, () => dir)
  await reload($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board-check', description: 'Report what this window can draw for the board' })
    await $.command.register({ name: 'show-board', description: "Show a project's pinned notes and tasks (optional: a folder path)" })
    // A tool that fails to register must not take the panel down with it.
    await $.tool.register({
      name: 'board',
      isDeferred: false,
      description: "The project's task board and pinned notes (.board/board.md), the one the person sees in the Bookboard panel. "
        + 'Use it to read the board (list) and to change it: add a task, pin a note, move a task (To do, In progress, Parked, Done), unpin a note. '
        + 'Name an item with a few of its words (match). Start a task when you begin it; mark it Done only when the work is really finished.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'note', 'move', 'unpin'] },
          title: { type: 'string', description: 'For add and note: short and concrete, key words in **bold**.' },
          match: { type: 'string', description: 'For move and unpin: a few words of the item.' },
          to: { type: 'string', enum: SECTIONS.filter(s => s !== 'Pinned notes'), description: 'For move.' },
          reason: { type: 'string', description: 'For a move to Parked: why.' },
        },
        required: ['action'],
      },
    }).catch(err => log($, 'tool.register failed: ' + String(err)))
    // Every chat starts on its own folder; nothing carries over from other windows.
    await update($, project, () => '')
    await update($, folders, () => [])
    await update($, replies, () => [])
    await update($, expanded, () => [])
    await log($, 'session.start root=' + (await $.session.root()) + ' cwd=' + (await $.session.cwd()))
    await reload($)
    await openPane($, 'start')
    const found = await findFolders($)
    await log($, 'workspace folders: ' + JSON.stringify(found))
    await update($, folders, () => found)
    return next(e)
  })

  // VS Code attaches after session.start, when an open there has nowhere to go: open again once it does.
  on('session.attach', async ($, e, next) => {
    const ran = await next(e)
    await log($, 'attach ' + e.surface + ' ' + e.clientId)
    await openPane($, 'attach ' + e.surface)
    return ran
  })

  // A close (the X or the Board button) redraws the replies, so their Board button reads "open" again.
  on('ui.close', async ($, e, next) => {
    const ran = await next(e)
    if (e.id === PANE) $.ui.invalidate('ui.render')
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await reload($)
    const text = (ran.text ?? '').trim()
    if (text) {
      await update($, replies, list => [...list, text].slice(-50))
      $.ui.invalidate('ui.render')
    }
    return ran
  })

  // Under each final reply: pin it or add it as a task (the panel opens with it in the field to trim),
  // and under the newest one a button that opens and closes the panel.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const block = e.props.text.trim()
    const list = await read($, replies)
    const at = list.findIndex(r => r === block || (block.length > 20 && r.endsWith(block)))
    if (!block || e.props.isSummary || at < 0) return drawn
    const { Box, Button } = $.ui.resolve(e)
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    const prefill = (key: string) => press($, 'reply ' + key, async () => {
      await update($, drafts, d => ({ ...d, [key]: flatten(list[at] ?? '') }))
      await update($, tab, () => key === 'newnote' ? 'notes' : 'todo')
      await reload($)
      await openPane($, 'reply')
      $.ui.invalidate('ui.render')
    })
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row" gap={1}>
          <Button key={'note:' + at} plain dimColor label="📌 Note" onPress={prefill('newnote')} />
          <Button key={'task:' + at} plain dimColor label="＋ Task" onPress={prefill('newtask')} />
          {at === list.length - 1 && <Button key="toggle" plain dimColor label={isOpen ? '📋 Close board' : '📋 Board'}
            onPress={press($, 'toggle', async () => {
              if (isOpen) await $.ui.close({ id: PANE })
              else { await reload($); await openPane($, 'toggle') }
              $.ui.invalidate('ui.render')
            })} />}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'board-check' }, async $ => {
    const surfaces = await $.session.surfaces()
    const opened = await $.ui.open({ id: PANE, title: 'Bookboard' })
    const panes = await $.ui.panes()
    return { text: 'surfaces: ' + JSON.stringify(surfaces) + ' | open: ' + JSON.stringify(opened) + ' | panes: ' + JSON.stringify(panes) + ' | folders: ' + JSON.stringify(await read($, folders)) }
  })

  on('command.run', { command: 'show-board' }, async ($, e) => {
    if (e.args.trim()) await useProject($, e.args.trim().replace(/^"|"$/g, ''))
    await reload($)
    await openPane($, 'command')
    return { text: 'Board pane opened.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const text = await serve($, e as unknown as BoardCall)
    await log($, 'tool ' + JSON.stringify(e).slice(0, 200) + ' -> ' + text.slice(0, 80))
    // The engine takes a plugin tool's result as text (or content blocks), not as an MCP envelope.
    return { result: text }
  })

  // Every prompt carries the board as it stands, so Claude works from the real status.
  on('prompt.submit', async ($, e, next) => {
    const text = await reload($)
    if (!text) return next(e)
    const name = nameOf(await rootOf($, await read($, project)))
    return next({ ...e, context: [...(e.context ?? []), summary(text, name)] })
  })

  // A shell command that touches the board file refreshes the panel too.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\.board/.test(e.command)) await reload($)
    return ran
  })

  // Keep the pane fresh when Claude edits a board file.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\.board[\\/]board\.md$/.test(e.file_path)) await reload($)
    return ran
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\.board[\\/]board\.md$/.test(e.file_path)) await reload($)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    // The phone app draws no text field or dropdown; there the board is buttons only.
    const Input = 'Input' in ui ? ui.Input : null
    const Select = 'Select' in ui ? ui.Select : null
    const typed = await read($, drafts)
    const keep = (key: string) => (v: string) => { void update($, drafts, d => ({ ...d, [key]: v })) }
    const text = await read($, board)
    const dir = await read($, project)
    const here = await $.session.root()
    const current = await rootOf($, dir)
    const name = nameOf(current)
    const items = text ? parse(text) : []
    const of = (s: Section) => items.filter(i => i.sec === s)
    await log($, 'render pane on ' + e.surface + ' (' + text.length + ' chars)')

    // Folder picker: this chat's folder, the workspace's folders, and any typed one.
    const list = [clean(here), ...(await read($, folders)).filter(f => !same(f, here))]
    if (dir && !list.some(f => same(f, current))) list.push(current)
    const picker = (
      <Box flexDirection="column" gap={1}>
        {Select && list.length > 1
          ? <Select key="folder" label="Board for" value={list.find(f => same(f, current))}
              options={list.map(f => ({ value: f, label: same(f, here) ? nameOf(f) + ' (this chat)' : nameOf(f) }))}
              onSelect={v => press($, 'folder', () => useProject($, same(v, here) ? '' : v))()} />
          : <Text dimColor>Board for {name}</Text>}
        {Input && <Input key="path" value={typed.path ?? ''} placeholder="Or type a folder path…" submitLabel="use" onInput={keep('path')}
          onSubmit={v => press($, 'path', async () => { const t = (await take($, 'path', v)).trim().replace(/^"|"$/g, ''); if (t) await useProject($, t) })()} />}
      </Box>
    )

    const header = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text size="heading" weight="bold">{name}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" plain dimColor label="↻ Refresh" onPress={press($, 'refresh', () => reload($))} />
          <Button key="hide" plain dimColor label="Close" onPress={press($, 'close', () => $.ui.close({ id: PANE }))} />
        </Box>
      </Box>
    )

    if (!text) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {picker}
          <Text dimColor>No board in {name} yet.</Text>
          <Button key="create" variant="primary" label="Create the board" onPress={press($, 'create', () => save($, EMPTY))} />
        </Box>
      )
    }

    // Each row: the title, then the moves that make sense from its section.
    const moves: Record<Section, [string, Section | null][]> = {
      'In progress': [['✓ Done', 'Done'], ['Park', 'Parked'], ['Back', 'To do']],
      'To do': [['▶ Start', 'In progress'], ['✓ Done', 'Done'], ['Park', 'Parked']],
      'Parked': [['Unpark', 'To do']],
      'Done': [['Reopen', 'To do']],
      'Pinned notes': [['Unpin', null]],
    }
    // Keys name the place, never the text: a long title made keys too long and broke the row.
    const open = await read($, expanded)
    const row = (item: Item, i: number) => {
      const id = item.sec.replace(/\s/g, '') + ':' + i
      const isWhole = open.includes(id)
      const shown = isWhole ? item.title : clip(item.title, 140)
      const md = item.sec === 'Done' ? '~~' + shown + '~~' : shown
      return (
        <Box key={'row:' + id} flexDirection="column">
          <Markdown key={'md:' + id} text={md} dimColor={item.sec === 'Done' || item.sec === 'Parked'} />
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {moves[item.sec].map(([label, to]) => (
              <Button key={label.replace(/\W/g, '') + ':' + id} plain dimColor={label !== '✓ Done' && label !== '▶ Start'} label={label}
                onPress={press($, label + ' ' + clip(item.title, 60), () => move($, item, to))} />
            ))}
            {shown !== item.title || isWhole
              ? <Button key={'more:' + id} plain dimColor label={isWhole ? 'less' : 'more'}
                  onPress={press($, 'more', () => update($, expanded, l => isWhole ? l.filter(x => x !== id) : [...l, id]))} />
              : null}
          </Box>
        </Box>
      )
    }
    const card = (s: Section, shown: Item[], extra?: string) => (
      <Box key={'sec:' + s} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
        <Text weight="semibold">{s} <Text dimColor>{of(s).length}{extra ?? ''}</Text></Text>
        {shown.length ? shown.map(row) : <Text dimColor>Nothing here.</Text>}
      </Box>
    )
    const done = of('Done')
    const shown = await read($, tab)
    const tabButton = (id: 'todo' | 'notes', label: string) => (
      <Button key={'tab:' + id} variant={shown === id ? 'primary' : 'secondary'} dimColor={shown !== id} label={label}
        onPress={press($, 'tab ' + id, () => update($, tab, () => id))} />
    )

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {picker}
        <Box flexDirection="row" gap={1}>
          {tabButton('todo', '☑ To do ' + (of('To do').length + of('In progress').length))}
          {tabButton('notes', '📌 Notes ' + of('Pinned notes').length)}
        </Box>
        {shown === 'notes'
          ? <Box key="notes" flexDirection="column" gap={1}>
              {Input && <Input key="newnote" value={typed.newnote ?? ''} placeholder="Pin a note…" submitLabel="pin" onInput={keep('newnote')}
                onSubmit={v => press($, 'add note', async () => add($, 'Pinned notes', await take($, 'newnote', v)))()} />}
              {card('Pinned notes', of('Pinned notes'))}
            </Box>
          : <Box key="todo" flexDirection="column" gap={1}>
              {Input && <Input key="newtask" value={typed.newtask ?? ''} placeholder="Add a task…" submitLabel="add" onInput={keep('newtask')}
                onSubmit={v => press($, 'add task', async () => add($, 'To do', await take($, 'newtask', v)))()} />}
              {card('In progress', of('In progress'))}
              {card('To do', of('To do'))}
              {of('Parked').length > 0 && card('Parked', of('Parked'))}
              {done.length > 0 && card('Done', done.slice(-5).reverse(), done.length > 5 ? ' · last 5' : '')}
            </Box>}
      </Box>
    )
  })
}

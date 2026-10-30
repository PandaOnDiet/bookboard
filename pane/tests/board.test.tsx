import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'bookboard-pane',
  component: 'Pane',
  requestId: 'bookboard',
  surface: 'vscode',
  props: { title: 'Bookboard', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const BOARD = 'D:/Proj/.board/board.md'
const START = '# Board\n\n## Pinned notes\n\n## To do\n- [ ] Write spec _(added 2026-10-01)_\n\n## In progress\n\n## Parked\n\n## Done\n'

// An in-memory disk with a VS Code workspace that lists D:/Proj and ../Other.
function engine(on: any, files: Record<string, string>) {
  const pane = { isOpen: false }
  files['C:/AppData/Code/User/workspaceStorage/abc/workspace.json'] = JSON.stringify({ workspace: 'file:///D%3A/Work/Combined.code-workspace' })
  files['D:/Work/Combined.code-workspace'] = JSON.stringify({ folders: [{ path: 'D:/Proj' }, { path: '../Other' }] })
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: { tool: 'mcp__bookboard-pane__board' } }))
  on('ui.open', () => { pane.isOpen = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { pane.isOpen = false; return { value: undefined } })
  on('ui.panes', () => ({ value: pane.isOpen ? [{ id: 'bookboard', title: 'Bookboard', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  on('session.root', () => ({ value: 'D:\\Proj' }))
  on('session.cwd', () => ({ value: 'D:\\Proj' }))
  on('env.get', () => ({ value: 'C:\\AppData' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  // The engine hands paths over in Windows form; the fake disk keys them with /.
  const at = (p: string) => p.replace(/\\/g, '/')
  on('fs.read', (_: any, e: any) => (at(e.path) in files ? { value: files[at(e.path)] } : { deny: 'ENOENT' }))
  on('fs.write', (_: any, e: any) => { files[at(e.path)] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => at(e.path).endsWith('workspaceStorage')
    ? { value: [{ name: 'abc', kind: 'directory', size: 0, mtimeMs: 1, isLink: false }] }
    : { deny: 'ENOENT' })
  return pane
}

test('tasks are added, started, finished and pinned from the panel', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  await ui.input({ key: 'newtask', text: 'Ship it' })
  expect(files[BOARD]).toContain('## To do\n- [ ] Write spec _(added 2026-10-01)_\n- [ ] Ship it _(added ')

  const start = (await ui.findAll({ type: 'Button' })).find(b => b.text === '▶ Start' && b.key === 'Start:Todo:0')
  await ui.press({ key: String(start?.key) })
  expect(files[BOARD]).toMatch(/## In progress\n- \[ \] Write spec _\(started \d{4}-\d\d-\d\d\)_/)

  const done = (await ui.findAll({ type: 'Button' })).find(b => b.text === '✓ Done' && b.key === 'Done:Inprogress:0')
  await ui.press({ key: String(done?.key) })
  expect(files[BOARD]).toMatch(/## Done\n- \[x\] Write spec _\(done /)
  expect(files[BOARD]).not.toContain('started')

  await ui.press({ key: 'tab:notes' })
  await ui.input({ key: 'newnote', text: 'Use pnpm' })
  expect(files[BOARD]).toMatch(/## Pinned notes\n- Use pnpm _\(/)
  await ui.unmount()
})

test('the last reply gets Note, Task and a Board button that closes and reopens the panel', async ($, on) => {
  const pane = engine(on, { [BOARD]: START })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{e.props.text}</Text> })
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  await $.turn.complete({ reason: 'answer', answer: 'Use the cache  for reads', durationMs: 1, isAborted: false } as any)

  const reply = await $.ui.mount({ plugin: 'bookboard-pane', component: 'AssistantMessage', surface: 'vscode', props: { text: 'Use the cache  for reads', isFirstOfReply: true } } as any)
  expect((await reply.find({ key: 'toggle' }))?.text).toBe('📋 Close board')
  await reply.press({ key: 'toggle' })
  expect(pane.isOpen).toBe(false)
  expect((await reply.find({ key: 'toggle' }))?.text).toBe('📋 Board')
  await reply.press({ key: 'toggle' })
  expect(pane.isOpen).toBe(true)

  // Note puts the reply in the panel's field to trim; Enter pins it.
  await reply.press({ key: 'note:0' })
  const panel = await $.ui.mount(PANE)
  expect((await panel.find({ key: 'newnote' }))?.props.value).toBe('Use the cache for reads')
  await reply.unmount()
  await panel.unmount()

  // An older block that is not a final reply gets no buttons.
  const other = await $.ui.mount({ plugin: 'bookboard-pane', component: 'AssistantMessage', surface: 'vscode', props: { text: 'Looking at the files', isFirstOfReply: true } } as any)
  expect(await other.find({ key: 'note:0' })).toBeFalsy()
  await other.unmount()
})

test('the workspace folders are offered and picking one switches the board', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const sel = await ui.find({ key: 'folder' })
  expect(JSON.stringify(sel?.props.options)).toContain('D:/Other')
  await ui.select({ key: 'folder', value: 'D:/Other' })
  expect(await ui.find({ type: 'Text', text: /No board in Other yet/ })).toBeTruthy()
  await ui.press({ key: 'create' })
  expect(files['D:/Other/.board/board.md']).toContain('## To do')
  await ui.unmount()
})

test('a submit that arrives empty still adds what was typed (as VS Code sends it)', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab:notes' })
  await ui.input({ key: 'newnote', text: 'Keep it small', kind: 'change' })
  await ui.input({ key: 'newnote', text: '' })
  expect(files[BOARD]).toMatch(/## Pinned notes\n- Keep it small _\(/)
  await ui.unmount()
})

const LONG = 'Rework the onboarding flow so that **sign-in** keeps the `returnTo` path and the user never lands on a blank page after the redirect finishes, including the mobile deep-link case, the expired-session case and the case where two tabs race each other on the same callback'

test('a long task is clipped with "more" and keeps its Start button', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START.replace('## To do\n', '## To do\n- [ ] ' + LONG + ' _(added 2026-10-01)_\n') }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.filter(b => b.text === '▶ Start')).toHaveLength(2)
  expect(buttons.every(b => String(b.key ?? '').length <= 64)).toBe(true)
  const shown = await ui.find({ type: 'Markdown', text: /Rework the onboarding/ })
  expect(String(shown?.props.text).length).toBeLessThan(170)
  expect(String(shown?.props.text)).toContain('**sign-in**')
  const more = buttons.find(b => b.text === 'more')
  await ui.press({ key: String(more?.key) })
  expect(String((await ui.find({ type: 'Markdown', text: /Rework the onboarding/ }))?.props.text)).toContain('race each other')
  await ui.unmount()
})

test('Claude reads and changes the board through its own tool, and the panel follows', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const TOOL = 'mcp__bookboard-pane__board'
  const listed = await $.tool.call({ tool: TOOL, action: 'list' } as any)
  expect(JSON.stringify(listed)).toContain('Write spec')
  await $.tool.call({ tool: TOOL, action: 'add', title: 'Fix login' } as any)
  expect(files[BOARD]).toMatch(/## To do\n- \[ \] Write spec .*\n- \[ \] Fix login _\(added /)
  await $.tool.call({ tool: TOOL, action: 'move', match: 'write SPEC', to: 'In progress' } as any)
  expect(files[BOARD]).toMatch(/## In progress\n- \[ \] Write spec _\(started /)
  expect(await ui.find({ type: 'Markdown', text: /Fix login/ })).toBeTruthy()
  const missing = await $.tool.call({ tool: TOOL, action: 'move', match: 'nothing like this', to: 'Done' } as any)
  expect(JSON.stringify(missing)).toContain('No item matches')
  await ui.unmount()
})

test('every prompt carries the board as it stands, so Claude knows the real status', async ($, on) => {
  engine(on, { [BOARD]: START.replace('## In progress\n', '## In progress\n- [ ] Ship v2 _(started 2026-10-02)_\n') })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const sent = await $.prompt.submit({ text: 'what next?' } as any)
  const ctx = ((sent as any).context ?? []).join('\n')
  expect(ctx).toContain('In progress: Ship v2')
  expect(ctx).toContain('To do: Write spec')
  expect(ctx).toContain('mcp__bookboard-pane__board')
})

test('a shell command that writes the board refreshes the panel', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  on('tool.call', { tool: 'Bash' }, () => { files[BOARD] += '- [ ] Added by shell _(added 2026-10-03)_\n'; return { result: { stdout: '', stderr: '', interrupted: false } } })
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await $.tool.call({ tool: 'Bash', command: 'echo x >> .board/board.md' } as any)
  expect(await ui.find({ type: 'Markdown', text: /Added by shell/ })).toBeTruthy()
  await ui.unmount()
})

test('a reply sent to a note keeps its keywords and drops list and heading marks', async ($, on) => {
  engine(on, { [BOARD]: START })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{e.props.text}</Text> })
  const reply = '## Plan\n\n- **Cache** the `reads` first.\n- Then retry writes.'
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  await $.turn.complete({ reason: 'answer', answer: reply, durationMs: 1, isAborted: false } as any)
  const msg = await $.ui.mount({ plugin: 'bookboard-pane', component: 'AssistantMessage', surface: 'vscode', props: { text: reply, isFirstOfReply: true } } as any)
  await msg.press({ key: 'note:0' })
  const panel = await $.ui.mount(PANE)
  expect((await panel.find({ key: 'newnote' }))?.props.value).toBe('Plan: **Cache** the `reads` first. Then retry writes.')
  await msg.unmount()
  await panel.unmount()
})

test('the panel switches between a Notes tab and a To do tab', async ($, on) => {
  engine(on, { [BOARD]: START.replace('## Pinned notes\n', '## Pinned notes\n- Use **pnpm** _(2026-10-01)_\n') })
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  // To do is the default tab: tasks and their field, no notes.
  expect((await ui.find({ key: 'tab:todo' }))?.text).toBe('☑ To do 1')
  expect((await ui.find({ key: 'tab:notes' }))?.text).toBe('📌 Notes 1')
  expect(await ui.find({ key: 'newtask' })).toBeTruthy()
  expect(await ui.find({ key: 'newnote' })).toBeFalsy()
  expect(await ui.find({ type: 'Markdown', text: /Write spec/ })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', text: /pnpm/ })).toBeFalsy()

  await ui.press({ key: 'tab:notes' })
  expect(await ui.find({ key: 'newnote' })).toBeTruthy()
  expect(await ui.find({ key: 'newtask' })).toBeFalsy()
  expect(await ui.find({ type: 'Markdown', text: /pnpm/ })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', text: /Write spec/ })).toBeFalsy()

  await ui.press({ key: 'tab:todo' })
  expect(await ui.find({ key: 'newtask' })).toBeTruthy()
  await ui.unmount()
})

test('the board tool answers in plain text, as the real engine requires', async ($, on) => {
  engine(on, { [BOARD]: START })
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const ran: any = await $.tool.call({ tool: 'mcp__bookboard-pane__board', action: 'list' } as any)
  expect(typeof ran.result).toBe('string')
  expect(ran.result).toContain('To do: Write spec')
})

test('a title with a dash stays whole; unparking drops only the park reason', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  const TOOL = 'mcp__bookboard-pane__board'
  await $.tool.call({ tool: TOOL, action: 'add', title: 'MCP server — next release' } as any)
  expect(files[BOARD]).toContain('- [ ] MCP server — next release _(added ')
  await $.tool.call({ tool: TOOL, action: 'move', match: 'write spec', to: 'Parked', reason: 'waiting on design' } as any)
  expect(files[BOARD]).toContain('- [ ] Write spec — waiting on design _(parked ')
  await $.tool.call({ tool: TOOL, action: 'move', match: 'write spec', to: 'To do' } as any)
  expect(files[BOARD]).toMatch(/- \[ \] Write spec _\(added /)
  await $.tool.call({ tool: TOOL, action: 'move', match: 'MCP server', to: 'In progress' } as any)
  expect(files[BOARD]).toContain('- [ ] MCP server — next release _(started ')
})

test('nothing is logged unless BOOKBOARD_DEBUG names a file', async ($, on) => {
  const files: Record<string, string> = { [BOARD]: START }
  engine(on, files)
  await $.session.start({ cwd: 'D:/Proj', surface: 'vscode', isInteractive: true })
  expect(Object.keys(files).filter(k => /\.log$/.test(k))).toHaveLength(0)
})

test('workspace folders are found on macOS and Linux too', async ($, on) => {
  const files: Record<string, string> = {
    [BOARD]: START,
    '/home/p/.config/Code/User/workspaceStorage/abc/workspace.json': JSON.stringify({ workspace: 'file:///home/p/work/all.code-workspace' }),
    '/home/p/work/all.code-workspace': JSON.stringify({ folders: [{ path: '/home/p/proj' }, { path: '../other' }] }),
  }
  // The test host runs on Windows and puts its drive in front of /home; a Linux machine does not.
  const at = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/home\/)/, '')
  on('command.register', () => ({ value: {} }))
  on('tool.register', () => ({ value: { tool: 'mcp__bookboard-pane__board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  on('session.root', () => ({ value: '/home/p/proj' }))
  on('session.cwd', () => ({ value: '/home/p/proj' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/p' : undefined }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', (_: any, e: any) => (at(e.path) in files ? { value: files[at(e.path)] } : { deny: 'ENOENT' }))
  on('fs.write', (_: any, e: any) => { files[at(e.path)] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => at(e.path) === '/home/p/.config/Code/User/workspaceStorage'
    ? { value: [{ name: 'abc', kind: 'directory', size: 0, mtimeMs: 1, isLink: false }] }
    : { deny: 'ENOENT' })
  await $.session.start({ cwd: '/home/p/proj', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(JSON.stringify((await ui.find({ key: 'folder' }))?.props.options)).toContain('/home/p/other')
  await ui.unmount()
})

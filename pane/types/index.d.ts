declare module 'claude-code' {
  interface PluginState {
    'bookboard-pane': { board: Shaped<string>; project: Shaped<string>; folders: Shaped<string[]>; replies: Shaped<string[]>; expanded: Shaped<string[]>; tab: Shaped<'todo' | 'notes'>; drafts: Shaped<Record<string, string>> }
  }
}

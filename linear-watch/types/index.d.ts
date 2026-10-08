export type Issue = { id: string; title: string; status: string; statusType: string; url: string }

declare module 'claude-code' {
  interface PluginState {
    'linear-watch': { open: Issue[] }
  }
}

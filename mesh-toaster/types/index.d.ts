export type Mail = { id: string; from: string; peer: string; subject: string }

declare module 'claude-code' {
  interface PluginState {
    'mesh-toaster': { unseen: Mail[]; lift: number }
  }
}

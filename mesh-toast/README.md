# mesh-toast

Shows a toast in Claude Code when a new message comes to your cortex mesh inbox.

## What it does

- Every minute, it reads your mesh inbox with `cortex-mesh.py inbox --peek`.
- For each new message, it shows a toast for 10 seconds with the sender and the subject.
- It shows each message one time in a session. After a restart, a message that is still in
  your inbox shows one more time.

It uses `--peek`, so it never marks a message as read on the mesh. The message stays in your
inbox until you or your agent read it.

## Requirements

- The `cortex-join` plugin, installed and joined (`/cortex-join`). The mod uses its
  `cortex-mesh.py` script.
- Tailscale connected, so the mesh can be reached.

When the mesh cannot be reached, the mod shows nothing and tries again one minute later.

## Install

```
/plugin install mesh-toast --marketplace Mark-Hickey/claude-mods
```

`mesh-toaster` shows the same mail as a toaster above the prompt. You can use one of the two
mods, or both.

## Develop

```sh
claude plugin validate mesh-toast
claude plugin test mesh-toast
```

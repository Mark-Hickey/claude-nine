# mesh-toaster

A small toaster above the Claude Code prompt that shows your cortex mesh mail.

## What it does

- With no new mail, the toaster is empty and dim.
- When new mail comes, a toast comes up out of the toaster, with the sender and the subject
  of the message next to it.
- Push **Got it** to put the toast down. This changes only the toaster. The message stays
  unread on the mesh.

Every minute, it reads your mesh inbox with `cortex-mesh.py inbox --peek`. It uses `--peek`, so
it never marks a message as read on the mesh.

## Requirements

- The `cortex-join` plugin, installed and joined (`/cortex-join`). The mod uses its
  `cortex-mesh.py` script.
- Tailscale connected, so the mesh can be reached.

## Install

```
/plugin install mesh-toaster --marketplace Mark-Hickey/claude-mods
```

The toaster shares the rows above the prompt with other mods. `linear-watch` folds its cards to
one line when there are not sufficient rows for the two mods.

## Develop

```sh
claude plugin validate mesh-toaster
claude plugin test mesh-toaster
```

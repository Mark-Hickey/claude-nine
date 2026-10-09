# claude-mods

My Claude Code mods. Each mod is a separate plugin in its own folder, with its own README.
Install only the mods you want.

| Mod | What it does |
|---|---|
| [`linear-watch`](linear-watch/) | Linear Watch and PR Watch. Your Linear tickets and their linked PRs above the prompt, checked every hour. `/tickets` and `/prs` open panes with CI, reviews, merge state and the next action. |
| [`mesh-toast`](mesh-toast/) | A toast for each new cortex mesh message. It never marks a message as read. |
| [`mesh-toaster`](mesh-toaster/) | A toaster above the prompt. A toast comes up from it when mesh mail comes. |
| [`repo-sync`](repo-sync/) | Every 14 hours, updates the repos in `~/projects` by fast-forward only, and tells you what changed. |

## Install a mod

This repo is a Claude Code marketplace. In a terminal session of Claude Code, install one mod
with its name:

```
/plugin install linear-watch --marketplace Mark-Hickey/claude-mods
```

Type `y` to add the marketplace, then select a scope. The repo is private, so `gh` must be signed
in with access to it.

## Try a mod without installing it

```sh
claude --plugin-dir ./linear-watch
```

## Check a mod

```sh
claude plugin validate linear-watch
claude plugin test linear-watch
```

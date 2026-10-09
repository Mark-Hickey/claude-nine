# claude-mods

Mods for [Claude Code](https://claude.com/claude-code) that keep your work in view while you code:
your Linear tickets, the state of your pull requests, your cortex mesh mail, and your local repos.

Each mod is a separate plugin with its own folder and README. Install only the mods you want.

| Mod | Version | What it gives you |
|---|---|---|
| [**linear-watch**](linear-watch/) | 0.6.0 | Your Linear tickets and their PRs above the prompt. `/tickets` and `/prs` panes with CI, reviews, merge state, stages and the next action. |
| [**mesh-toast**](mesh-toast/) | 0.1.0 | A toast for each new cortex mesh message. |
| [**mesh-toaster**](mesh-toaster/) | 0.1.0 | A small toaster above the prompt. A toast comes up from it when mesh mail comes. |
| [**repo-sync**](repo-sync/) | 0.1.0 | Every 14 hours, updates your repos in `~/projects` by fast-forward only, and tells you what changed. |

---

## linear-watch

Linear Watch and PR Watch. It checks every hour and shows only what changed.

**Above the prompt**, two cards. The small marks under each name show the stages (`✓` done,
`●` now, `○` not yet):

```
╭──────────────────────────────────────────╮ ╭──────────────────────────────────────────╮
│ ◆ Linear Watch             1 open ticket │ │ ⑂ PR Watch             2 pull requests   │
│ ──────────────────────────────────────── │ │ ──────────────────────────────────────── │
│ ◆ OPS-1608                     IN REVIEW │ │ ● site#152                         READY │
│   ✓✓●○ onboard rolematrix: fix false…    │ │   ✓✓✓●○ Your operator can merge         │
│ ──────────────────────────────────────── │ │ ✓ unsigned-onboard#7              MERGED │
│ /tickets for details                     │ │   ✓✓✓✓✓ Merged                          │
╰──────────────────────────────────────────╯ │ ──────────────────────────────────────── │
                                             │ /prs for details                     [⌄] │
                                             ╰──────────────────────────────────────────╯
```

**`/prs`** opens PR Watch. PRs are in groups by who must act next:

```
Pull Requests                              2 tracked · 5m ago

WAITING ON OTHERS · 1
╭──────────────────────────────────────────────────────────╮
│ ● site#152                                         READY │
│   CI passed · Approved by todie                          │
│   ✓ Open → ✓ CI → ✓ Review → ● Merge → ○ Merged          │
│   ⚑ Next: Operator merges                                │
╰──────────────────────────────────────────────────────────╯

e: expand  r: refresh  k: keys  q: close
```

- **Honest states.** A PR is `READY` only when its checks pass, its reviews approve it, and GitHub
  says it can merge. Drafts, requested changes, conflicts, branch rules and a branch behind its
  base all count. When GitHub does not answer, the PR shows `UNKNOWN`.
- **Stages.** Each ticket shows its real path through Linear (`✓ Backlog → ✓ Todo → ● In Review
  → ○ Done · for 4d`). Each PR shows `Open → CI → Review → Merge → Merged`.
- **Fits any width.** The cards and panes use the space they have. A pane docked at the side
  stays inside its edge. On a narrow terminal, the lines become shorter.
- **Quiet.** A toast comes only for a real change. When other mods need the rows above the
  prompt, the cards fold to one line.

Needs: a Linear connector in Claude Code, and the `gh` CLI signed in. [Full README →](linear-watch/)

## mesh-toast and mesh-toaster

Two ways to see new cortex mesh mail. Use one, or both.

```
  ▗▄▄▖ ▗▄▄▖
  ▐██▌ ▐██▌
  ▐██▌ ▐██▌
 ╭─▐██▌─▐██▌─╮
 │           │▪  mesh: 1 new · chris: Mesh round-trip test from cortex lane
 ╰┬─────────┬╯  [Got it]
```

- **mesh-toast** shows a toast for each new message, for 10 seconds.
- **mesh-toaster** keeps a toaster above the prompt. It is empty and dim when there is no mail.
  When mail comes, a toast comes up from it. **Got it** puts the toast down.

The two mods read the inbox with `--peek`, so they never mark a message as read.
Needs: the `cortex-join` plugin, joined, and Tailscale connected.
[mesh-toast →](mesh-toast/) · [mesh-toaster →](mesh-toaster/)

## repo-sync

```
🔄 Repos updated: unsigned-gg/site: +4, cerebral-work/cortex: +12 · left alone: Mark-Hickey/notes: uncommitted changes
```

Every 14 hours, it updates each repo in `~/projects/<owner>/<repo>`, safely:

- It updates only by fast-forward.
- It does not touch a repo that has uncommitted changes or unpushed commits. It tells you why.
- It never deletes, resets, rebases or pushes.

Needs: `repo-sync/bin/repo-sync` copied to `~/.local/bin/`. [Full README →](repo-sync/)

---

## Install

This repo is a Claude Code plugin marketplace. In a terminal session of Claude Code, install a
mod by its name:

```
/plugin install linear-watch --marketplace Mark-Hickey/claude-mods
```

Type `y` to add the marketplace, then select a scope. Do this again for each mod you want. The
repo is private, so your GitHub sign-in must have access to it.

### Requirements

| Mod | Needs |
|---|---|
| linear-watch | A Linear connector (the claude.ai connector, or the `design` plugin's Linear server) · `gh` signed in |
| mesh-toast | `cortex-join` plugin, joined · Tailscale connected |
| mesh-toaster | `cortex-join` plugin, joined · Tailscale connected |
| repo-sync | `repo-sync` script in `~/.local/bin/` · `git` |

## Try a mod without installing it

```sh
claude --plugin-dir ./linear-watch
```

## Develop

Each mod is a hooks module in TypeScript. Claude Code loads it from `hooks/hooks.json`.

```sh
claude plugin validate linear-watch   # check the manifest and the hooks module
claude plugin test linear-watch       # run the mod's tests
```

```
.claude-plugin/marketplace.json   lists the four mods, so each installs on its own
linear-watch/                     hooks/model.ts rules · hooks/view.tsx cards · hooks/register.tsx hooks
mesh-toast/
mesh-toaster/
repo-sync/                        bin/repo-sync is the script the mod runs
```

Tests: linear-watch 45, mesh-toaster 5, repo-sync 3, mesh-toast 2. All pass.

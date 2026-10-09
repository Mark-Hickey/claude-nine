# linear-watch

Linear Watch and PR Watch for Claude Code. It shows the Linear tickets assigned to you and the
GitHub pull requests linked to them, above the prompt. It checks every hour.

## What it shows

**Above the prompt.** Two cards, side by side when the terminal has 100 columns or more:

- **Linear Watch:** each open ticket, its title and its Linear status (for example `IN REVIEW`).
- **PR Watch:** each linked PR, what its state means for you (for example "Your operator can
  merge") and a status word (`READY`, `REVIEW`, `FAILING`, `MERGED` and others).

On a narrow terminal, the two cards become one card. Push `⌄` (or `e`) to fold the cards to one
line. When other mods (for example `mesh-toaster`) need the rows above the prompt, the cards fold
to one line automatically, so all mods stay visible.

**`/prs`** opens the PR Watch pane. PRs are in groups by who must act next: *Needs you*, *Waiting
on others*, *Done*. Each PR card shows:

- CI result. Each failed check is a link to its log.
- Reviews: who approved, who asked for changes, who must still review.
- Merge state from GitHub (for example "Blocked by branch rules" or "GitHub allows the merge").
- The next action and who does it (for example "You fix CI" or "Operator merges").
- The linked ticket and a link to the PR.

**`/tickets`** opens the Linear Tickets pane: each ticket as a card with its PRs.

In both panes: `e` expand or compact, `r` refresh, `k` show the key of symbols, `q` or Escape
close. `/tickets compact` and `/tickets expand` set the view above the prompt. The mod keeps your
choices between sessions.

## How it decides a PR state

A PR is **Ready** only when its checks pass, its reviews approve it, and GitHub says it can merge.
Passing CI alone is not enough. The mod also looks at draft state, requested changes, merge
conflicts, branch protection and a branch that is behind its base. If GitHub does not answer,
the PR shows **Unknown**. The mod does not guess.

A ready PR in your own GitHub account is yours to merge. In all other repos your operator merges
it (handbook rule 3).

## Notifications

A toast comes only for a real change: a new ticket, a ticket status change, a new linked PR, an
approval, requested changes, failed checks, a merge or a close. Checks that start on each push
show only in the pane. A check with no changes shows nothing. When more than 3 changes come at
the same time, you get one toast for all of them. When Linear does not answer two times in a row,
you get one toast, and the cards show `⚠ stale` with the last good data.

## Requirements

- A Linear connector in Claude Code: the claude.ai Linear connector, or the Linear server of the
  `design` plugin. The mod tries both.
- The `gh` CLI, signed in (`gh auth status`). The mod reads PR states with `gh pr view`.

## Install

```
/plugin install linear-watch --marketplace Mark-Hickey/claude-mods
```

## Develop

```sh
claude plugin validate linear-watch
claude plugin test linear-watch
```

`hooks/model.ts` has the rules (PR states, who acts, changes). `hooks/view.tsx` draws the cards.
`hooks/register.tsx` reads Linear and GitHub and connects the hooks.

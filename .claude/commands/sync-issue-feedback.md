Sync with issue #$ARGUMENTS via the github MCP.

1. Fetch the issue and any linked PR.
2. Read all comments newer than your last activity on the issue
   (your most recent issue comment, PR comment, or commit on the
   feature branch).

For each new comment, react as follows:

- **Question or request for clarification** → answer it as an issue
  (or PR) comment. Do not change code.

- **Scope change or revised direction (no code yet)** → update the
  plan in a new comment, mark what changed and why. Do not start
  implementing unless I explicitly say "go".

- **Explicit go-ahead to implement** → create a feature branch
  `feat/spec-NNNN-<short-slug>` (use the SPEC number from the issue
  title). Implement in logical commits, push, open a PR linked to
  the issue (`Closes #$ARGUMENTS` in the PR body). Reply on the
  issue with the PR link.

- **PR review feedback** → address it on the same feature branch
  with new commits, push, then reply on the PR comment thread.

Do not merge. Do not close the issue. Wait for me.

# Bug Fix Workflow

You are working on a GitHub issue as a bug fix. The issue is: $ARGUMENTS

## Async clarification protocol

This workflow is asynchronous, including when Claude Code runs in Plan Mode. When you need input from me — clarifying questions OR plan confirmation — DO NOT prompt me interactively, and DO NOT use Plan Mode's default behavior of presenting the plan in the terminal. Instead, post a comment on the issue, print a short summary in the terminal, and STOP. I'll tell you when the response is in the issue; you then fetch the latest comments and continue.

## Steps

1. **Read the issue**: Fetch the issue details using `gh issue view <number>`. Read all existing issue comments — they may contain prior context, earlier answers, or upstream discussion.

2. **Clarify ambiguities (if any)**: If anything in the issue is ambiguous, underspecified, or has multiple plausible interpretations:
   - Post a single comment on the issue with all open questions.
   - Header: `## 🤖 Coding agent: clarifying questions`
   - Number the questions; one per item; phrase them so a yes/no or short answer is possible where feasible.
   - In the terminal, print: `Posted N questions on issue #<number>: <issue URL>. Waiting for answers — tell me when they're in the issue.` Then STOP.
   - When I signal the answers are in, fetch the latest issue comments, find them, incorporate, and continue.

3. **Plan (always)**: Post your implementation plan as an issue comment, even for small fixes.
   - Header: `## 🤖 Coding agent: implementation plan`
   - Cover: which files you'll touch, what the change is in each, what tests you'll add or modify, any assumptions you're making.
   - Keep it proportional — a one-file fix gets a three-line plan, a multi-file fix gets correspondingly more.
   - In the terminal, print: `Posted plan on issue #<number>: <issue URL>. Waiting for confirmation — tell me when reviewed.` Then STOP.
   - When I signal the plan is approved (with or without refinements in the issue), fetch the latest comments, incorporate any refinements, and proceed.

4. **Create a branch**: Branch from the current `main`:
   - Format: `fix/issue-<number>-<short-description>`
   - Derive the short description from the issue title (lowercase, kebab-case, max 4 words).

5. **Fix the bug**: Implement the plan. Follow existing code conventions. Write tests where appropriate.

6. **Commit**: Create a commit with a descriptive message:

fix: short description
Fixes #<number>

7. **Open a PR**: Push the branch and create a pull request:
   - Title: `fix: short description`
   - Body: briefly describe what the problem was and how it was solved. Reference the issue with `Fixes #<number>`.

8. **Summarize and stop**: In the terminal, print the PR URL and a one-line summary. Review will happen as PR comments — do not prompt for review interactively. Wait for me to tell you when there are PR comments to address.
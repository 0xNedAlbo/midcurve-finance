---
description: Plan-first pass for a RESEARCH issue. Reads the issue, posts a structured plan as a comment, waits for feedback.
argument-hint: <issue-number>
---

# Research Plan: Issue #$1

You are about to work on a RESEARCH issue. Before doing the research, post a plan as a comment so scope and detail level can be aligned with the issue author.

## Task

1. Determine the current repository (e.g. via `git remote -v`).
2. Read issue #$1 using the GitHub tools.
3. Understand scope, out-of-scope, and the desired output format from the issue body.
4. Post a plan comment with the following structure:

   - **Scope (In):** concrete paths/modules/files you will cover
   - **Scope (Out):** explicitly excluded areas (at minimum those named in the issue)
   - **Method:** the steps you will take (grep, file reads, classification, etc.)
   - **Report structure:** how the final answer will be organised
   - **What you will NOT do:** a clear negative list (no code changes, no refactoring proposals, etc.)
   - **Open questions:** points where you need clarification (scope edges, level of detail, edge cases)
   - **Risks / edge cases:** where the method might hit its limits

5. End the plan with a line that makes the handoff explicit: "Waiting for feedback on the open questions before I start."

## Constraints

- Language: English
- Markdown format
- No code changes, no commits, no branches, no PRs
- Plan only — no research work yet
- If the issue number is missing: ask, do not guess

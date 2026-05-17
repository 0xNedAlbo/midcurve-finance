---
description: Executes a RESEARCH issue and posts the answer as a comment. Plan-first is optional.
argument-hint: <issue-number>
---

# Research Answer: Issue #$1

You are answering a RESEARCH issue as a comment.

## Task

1. Determine the current repository.
2. Read issue #$1 and all existing comments.
3. If a plan was discussed and approved in the thread, follow the approved plan. Otherwise, work directly from the issue body.
4. Perform the research (grep, file reads, directory listings as needed).
5. Post the answer as a comment, using the report structure specified by the issue — or the one agreed upon in the plan.

## Answer format

- Language: English
- Markdown
- File paths and line references where useful
- Aggregate findings + counts + representative examples — no exhaustive lists, unless the issue explicitly asks for that
- Closing assessment if the issue calls for a subjective judgement

## Constraints

- No code changes, no commits, no branches, no PRs
- No refactoring proposals, unless the issue explicitly asks for them
- If the answer becomes very long: check whether it fits into one comment (GitHub accepts roughly 65,000 characters). If not: split into multiple comments, numbered ("Part 1/N").
- If the issue number is missing: ask, do not guess

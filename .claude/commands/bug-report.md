# Bug Report

Based on the bug investigation in this conversation, file a GitHub issue.

## Instructions

1. **Summarize** the findings from this conversation:
   - Root cause
   - Affected files/functions
   - Any error messages or unexpected behavior discussed

2. **File a GitHub issue** using the `gh` CLI:

### Title format
`Bug: <concise description>`

### Body format
```
## Description
<!-- What is happening? -->

## Expected Behavior
<!-- What should happen instead? -->

## Root Cause
<!-- What the investigation revealed -->

## Affected Files
<!-- Relevant files/functions -->

## Steps to Reproduce (if applicable)
<!-- Minimal reproduction path -->
```

3. Apply the `bug` label:
```bash
gh issue create \
  --title "Bug: <title>" \
  --body "<body>" \
  --label "bug"
```

4. Output the created issue URL.
# Bug Fix Workflow

You are working on a GitHub issue as a bug fix. The issue is: $ARGUMENTS

## Steps

1. **Read the issue**: Fetch the issue details using `gh issue view <number>`. Understand the problem fully before writing any code.

2. **Create a branch**: Create a branch from the current `main`:
   - Format: `fix/issue-<number>-<short-description>`
   - Derive the short description from the issue title (lowercase, kebab-case, max 4 words)

3. **Fix the bug**: Analyze the bug and implement the fix. Follow existing code conventions. Write tests where appropriate.

4. **Commit**: Create a commit with a descriptive message:
   ```
   fix: short description

   Fixes #<number>
   ```

5. **Create a PR**: Push the branch and create a pull request:
   - Title: `fix: short description`
   - Body: Briefly describe what the problem was and how it was solved. Reference the issue with `Fixes #<number>`.

Ask me to review the changes before committing.
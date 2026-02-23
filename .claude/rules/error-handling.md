# .claude/rules/error-handling.md

## Fail Early — No Defensive Fallback Code

- Never add try/catch blocks unless explicitly requested
- Let errors propagate up naturally to the caller
- No fallback values, no silent defaults, no "graceful" degradation
- No `?? defaultValue` or `|| fallback` patterns to mask missing data
- If something is null/undefined when it shouldn't be, throw — don't paper over it
- No `console.error` + `return null` patterns
- The only acceptable catch blocks are at explicit boundary layers (API route handlers, worker entry points)

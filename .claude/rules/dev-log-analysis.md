---
---

description: How to access and analyze structured application logs for debugging
paths:

- "logs/\*\*"
- "\*_/_.log"
- "packages/midcurve-services/src/logging/\*\*"

---

# Log Debugging

In development mode, structured NDJSON logs are written to a single central file at
`logs/dev.log` (repo root) in addition to stdout. All services share this file — the
multistream is configured once in `packages/midcurve-services/src/logging/logger.ts`
and propagates automatically to every child logger created via `createServiceLogger()`.

In production and test, logs go to stdout only — no file I/O.

## Useful commands

```bash
# Last 100 entries (pretty-printed)
tail -n 100 logs/dev.log | jq '.'

# Only warnings and above (level >= 40)
cat logs/dev.log | jq 'select(.level >= 40)'

# Only errors and fatals
cat logs/dev.log | jq 'select(.level >= 50)'

# Filter by service name
cat logs/dev.log | jq 'select(.service == "<name>")'

# Filter by service + minimum level
cat logs/dev.log | jq 'select(.service == "<name>" and .level >= 40)'

# Show only time, level, msg (reduced noise)
cat logs/dev.log | jq '{ time, level, service, msg }'

# Pretty-print last entry
tail -1 logs/dev.log | jq '.'
```

## Log levels (Pino)

10 trace · 20 debug · 30 info · 40 warn · 50 error · 60 fatal

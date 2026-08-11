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

## Filtering by level — read this before writing a `jq` filter

**`select(.level >= 40)` does not work here, and fails silently by matching
everything.**

This logger writes the level as a **string label**, not a number
([logger.ts](../../packages/midcurve-services/src/logging/logger.ts) —
`formatters.level(label) { return { level: label } }`), so a line reads
`{"level":"info",…}`. In `jq`, comparisons across types fall back to a total
ordering in which **every string sorts above every number**, so
`"info" >= 40` is `true`. The filter returns the whole file and reports no
error.

Measured on a real `logs/dev.log` of 562,337 lines: `select(.level >= 40)`
matched all of them. The true count of warn-and-above was 15,222.

**`select(.level == "error")` is not the fix.** It drops every warning — in the
same sample, 13,145 of the 15,222 lines the filter was supposed to surface, or
86%. That is the same silent omission pointing the other way, and it is worse
in one respect: it looks precise.

**Do not hardcode either representation.** Pino emits numeric levels by
default; this repo only gets labels because of the `formatters.level` override
above. Remove or change that formatter and every string-matching filter goes
quiet. Normalise instead.

### The filter to use

```bash
jq 'def lvl: if type=="number" then .
             elif type=="string" then {trace:10,debug:20,info:30,warn:40,error:50,fatal:60}[.] // 0
             else 0 end;
    select((.level|lvl) >= 40)' logs/dev.log
```

Correct for labels *and* numbers, and it excludes rather than crashes on lines
with a missing, null, or unrecognised level.

To avoid retyping it, hold the definition in a shell variable for the session:

```bash
LVL='def lvl: if type=="number" then . elif type=="string" then {trace:10,debug:20,info:30,warn:40,error:50,fatal:60}[.] // 0 else 0 end;'
```

then the everyday form is short:

```bash
jq "$LVL select((.level|lvl) >= 40)" logs/dev.log
```

Note the **double quotes** — the variable has to expand. The level examples
below all assume `$LVL` is set.

## Useful commands

```bash
# Last 100 entries (pretty-printed)
tail -n 100 logs/dev.log | jq '.'

# Warnings and above
jq "$LVL select((.level|lvl) >= 40)" logs/dev.log

# Errors and fatals only
jq "$LVL select((.level|lvl) >= 50)" logs/dev.log

# Filter by service name
jq 'select(.service == "<name>")' logs/dev.log

# Filter by service + minimum level
jq "$LVL select(.service == \"<name>\" and (.level|lvl) >= 40)" logs/dev.log

# Narrow to a time window (ISO prefix match — cheap and good enough)
jq 'select(.time >= "2026-08-11T11:50" and .time <= "2026-08-11T12:05")' logs/dev.log

# Show only time, level, msg (reduced noise)
jq '{ time, level, service, msg }' logs/dev.log

# Pretty-print last entry
tail -1 logs/dev.log | jq '.'
```

## Sanity-check your filter before trusting a clean result

An empty result and a broken filter look identical. Both of the level filters
corrected above returned confident, wrong answers. Before concluding "no
errors", check that the filter discriminates at all:

```bash
# Total vs matched. If these are equal, the filter is matching everything.
wc -l < logs/dev.log
jq -c "$LVL select((.level|lvl) >= 40)" logs/dev.log | wc -l

# Does it reject what it should?
printf '%s\n' '{"level":"info"}' '{"level":"warn"}' '{"level":30}' '{"level":50}' \
  | jq -c "$LVL select((.level|lvl) >= 40)"
# expect exactly: {"level":"warn"} and {"level":50}
```

`logs/dev.log` is appended to by every service at once. If `jq` reports a parse
error, an interleaved write has corrupted a line; skip the bad lines with
`jq -R 'fromjson? // empty'` rather than assuming the file is unreadable.

## Log levels (Pino)

10 trace · 20 debug · 30 info · 40 warn · 50 error · 60 fatal

The numbers are the wire format. This repo writes the **labels** instead —
which is exactly why the level filters need the normalisation above.

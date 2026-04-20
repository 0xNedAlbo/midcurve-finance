# Chrome DevTools MCP Server

Lets Claude Code inspect and drive a live Chrome browser via the Chrome
DevTools Protocol (CDP) — console logs, network requests, DOM snapshots,
performance traces, and scripted evaluation.

Uses Google's official
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
package (`npx`-installed — no repo-level dependency, no Puppeteer config).

Project-scoped via the repo's [.mcp.json](../../.mcp.json), so Claude Code
auto-discovers it when started inside this workspace.

## Connection model

This server is configured to **attach to a Chrome you launch yourself** at
`http://127.0.0.1:9222`, instead of spawning a throwaway browser. That means:

- Your dev session (the UI at localhost:3000, your logged-in wallet, open
  tabs) stays intact between Claude Code sessions.
- Claude sees exactly what you see — same cookies, same localStorage, same
  open tabs.
- Restarting the MCP server is cheap; you don't re-bootstrap a browser.

If Chrome isn't running on port 9222, the MCP will fail to start — that's
expected. Start Chrome first.

## Prerequisites

- **Node.js v20.19+** (same as the rest of the monorepo)
- **Google Chrome** (stable) or Chrome for Testing

## Launch Chrome with remote debugging

**macOS** — use a dedicated profile dir so you don't collide with your normal
Chrome:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/midcurve-chrome-debug \
  http://localhost:3000
```

**Linux:**

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/midcurve-chrome-debug \
  http://localhost:3000
```

Leave this window open for the duration of your debugging session.

### VS Code launch config (recommended)

The repo's [.vscode/launch.json](../../.vscode/launch.json) already includes a
**Debug UI on Chrome** configuration that opens Chrome on port `9222` against
an isolated `Web3DebugProfile`. You get two things in one click:

- VS Code's JavaScript debugger attached (breakpoints, step-through)
- The same Chrome exposed to `chrome-devtools-mcp` on port 9222

To use it: open the *Run and Debug* panel (⇧⌘D), pick **Debug UI on Chrome**,
press ▶. Then `claude mcp get chrome-devtools` should report Connected.

## Verify

```bash
claude mcp get chrome-devtools    # expect: Status: ✓ Connected
claude mcp list                   # chrome-devtools should appear
```

If it fails:

1. `curl http://127.0.0.1:9222/json/version` — should return JSON; if not,
   Chrome isn't listening on 9222.
2. `node --version` — must be ≥ 20.19.
3. Close any stale Chrome processes using `/tmp/midcurve-chrome-debug` and
   relaunch.

## Capabilities (tool groups)

The server exposes a rich tool set; the ones most relevant for UI debugging:

- **Pages**: list open pages, select a page, navigate, reload, screenshot
- **Console**: list console messages with source-mapped stack traces
- **Network**: list requests, read request/response headers and body
- **DOM**: accessibility / structure snapshots, element queries
- **Interaction**: click, fill, hover, keyboard input
- **Script evaluation**: run arbitrary JS in the page context (useful for
  reading React internals — see usage rule below)
- **Performance**: record traces, extract insights

Full tool reference:
<https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md>.

## Usage from Claude Code

Workflow guidance lives in
[.claude/rules/ui-debugging.md](../../.claude/rules/ui-debugging.md) — it
covers which tool to reach for and includes a React Fiber recipe for reading
component props/state via `evaluate_script`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| MCP server fails to start | Chrome not running on 9222 — launch it first |
| `connect ECONNREFUSED 127.0.0.1:9222` | Same as above |
| Tools return a stale page | Call `list_pages` + `select_page` — the dev server may have reloaded the tab |
| `npx` slow on first run | One-time package download; cached after |
| Want a headless / ephemeral Chrome instead | Remove `--browser-url=...` from [.mcp.json](../../.mcp.json) and let the MCP spawn its own |

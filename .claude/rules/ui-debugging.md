# UI Debugging via Chrome DevTools MCP

When debugging frontend behavior, UI bugs, or verifying UI changes, use the
`chrome-devtools` MCP server instead of guessing from code alone or asking the
user to paste console output. Setup and prerequisites:
[mcp/chrome-devtools/README.md](../../mcp/chrome-devtools/README.md).

## When to use it

- A UI bug is reported and you need to reproduce or inspect it.
- You just changed frontend code and want to verify the behavior in a real
  browser (not just typecheck / unit test).
- You need to see console errors, failed network requests, or the rendered
  DOM.
- You need to read React component state/props without a codebase hunt.

Do **not** use it for:

- E2E tests — we have no e2e infra and this MCP is not a substitute.
- Anything requiring wallet signatures — MCP can't sign with the user's
  wallet.

## Standard workflow

1. **Find the right tab** — `list_pages`, then `select_page` on the
   localhost:3000 entry (or wherever the UI is running). The user's existing
   Chrome session is attached, so there may be unrelated tabs.
2. **Reproduce** — `navigate_page` / `click` / `fill` to drive the UI to the
   buggy state. Prefer driving the UI over asking the user to repeat steps.
3. **Observe** — in parallel:
   - `list_console_messages` for errors/warnings (source-mapped)
   - `list_network_requests` for failed / unexpected API calls
   - `take_snapshot` for the accessibility/DOM tree
   - `take_screenshot` when visual context matters more than structure
4. **Narrow** — `get_network_request` for the body of a specific failed call;
   `evaluate_script` for programmatic reads of DOM or app state.

## Reading React component state (Fiber script-eval recipe)

There is no dedicated React DevTools MCP. When you need component
props/state, call `evaluate_script` with the snippet below. It walks the
React Fiber tree exposed on a DOM node and returns the nearest component's
`memoizedProps` and `memoizedState`.

```js
// Pass the selector of the component's root DOM node.
(selector) => {
  const el = document.querySelector(selector);
  if (!el) return { error: `no element for ${selector}` };

  // React attaches a fiber reference to DOM nodes under a key like
  // __reactFiber$<random>. Find it.
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!fiberKey) return { error: 'no fiber — is React rendered here?' };

  // Walk up until we hit a function/class component (not a host element).
  let fiber = el[fiberKey];
  while (fiber && typeof fiber.type !== 'function' && typeof fiber.type !== 'object') {
    fiber = fiber.return;
  }
  if (!fiber) return { error: 'no component fiber in ancestors' };

  const name =
    fiber.type?.displayName ||
    fiber.type?.name ||
    (typeof fiber.type === 'object' ? fiber.type?.type?.name : null) ||
    'Anonymous';

  // Stringify defensively — memoized values may contain non-serializable
  // things (functions, circular refs).
  const safe = (v) => {
    try { return JSON.parse(JSON.stringify(v)); }
    catch { return '[unserializable]'; }
  };

  return {
    component: name,
    props: safe(fiber.memoizedProps),
    state: safe(fiber.memoizedState),
  };
}
```

Only works in a **development build** where React hasn't stripped fiber
metadata — that's the case for Vite dev mode (`pnpm dev`). It will not work
against a production bundle.

For global stores (Zustand, Jotai, Redux), prefer reading the store directly
via `evaluate_script` rather than walking fibers — it's more reliable.

## Hygiene

- Close inspection tabs or return focus to the user's original tab when
  done — `select_page` the previous tab.
- Don't spam `take_screenshot` — screenshots are large; prefer
  `take_snapshot` (structured) unless you specifically need pixels.
- If the MCP returns stale data after a hot-reload, `navigate_page` to the
  same URL to force a fresh context, then re-snapshot.

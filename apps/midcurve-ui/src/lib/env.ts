declare global {
  interface Window {
    __ENV__?: {
      apiUrl: string;
    };
  }
}

export const API_URL =
  window.__ENV__?.apiUrl ??
  import.meta.env.VITE_API_URL ?? // fallback for local dev
  '';

// DELIBERATE LINT VIOLATION — verification for #92, reverted in the next commit.
// Triggers no-dupe-else-if, one of the 78 rules still at `error`. Chosen
// because tsc accepts it: the first probe used no-constant-binary-expression,
// which tsc rejects too, so the Build step failed and lint never ran.
export function lintGateProbe(x: number): string {
  if (x > 1) return 'a';
  else if (x > 1) return 'b';
  return 'c';
}

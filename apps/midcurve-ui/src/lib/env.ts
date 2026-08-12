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

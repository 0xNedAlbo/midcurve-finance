/**
 * Dashboard Referrer Storage
 *
 * Utility for storing and retrieving the last dashboard URL (with query params)
 * in sessionStorage. This allows preserving filter/sort settings when navigating
 * back from position detail pages.
 *
 * Uses sessionStorage (not localStorage) so it auto-clears when the browser tab closes.
 */

const STORAGE_KEY = "dashboard-referrer-url";

/**
 * Store the current dashboard URL in sessionStorage
 * @param url - Full URL path including query params (e.g., "/dashboard?status=closed&chain=ethereum")
 */
export function storeDashboardUrl(url: string): void {
  if (typeof window === "undefined") return; // SSR safety
  try {
    sessionStorage.setItem(STORAGE_KEY, url);
  } catch (error) {
    // Fail silently - sessionStorage might be disabled or full
    console.warn("Failed to store dashboard URL:", error);
  }
}

/**
 * Retrieve the stored dashboard URL from sessionStorage
 * @returns The stored URL or "/dashboard" as fallback
 */
export function getDashboardUrl(): string {
  if (typeof window === "undefined") return "/dashboard"; // SSR safety
  try {
    const storedUrl = sessionStorage.getItem(STORAGE_KEY);
    return storedUrl || "/dashboard";
  } catch (error) {
    // Fail silently - sessionStorage might be disabled
    console.warn("Failed to retrieve dashboard URL:", error);
    return "/dashboard";
  }
}

/**
 * Clear the stored dashboard URL from sessionStorage
 * (Optional - sessionStorage auto-clears on tab close)
 */
export function clearDashboardUrl(): void {
  if (typeof window === "undefined") return; // SSR safety
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear dashboard URL:", error);
  }
}

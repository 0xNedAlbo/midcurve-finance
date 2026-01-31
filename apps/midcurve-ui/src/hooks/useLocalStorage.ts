import { useState, useCallback } from 'react';

/**
 * Custom hook for persisting state to localStorage.
 * SSR-safe with silent error handling.
 *
 * @param key - The localStorage key
 * @param defaultValue - The default value if no stored value exists
 * @returns A tuple of [storedValue, setValue] similar to useState
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  // Initialize from localStorage or default
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to read localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Update both state and localStorage when value changes
  const setValue = useCallback(
    (value: T) => {
      setStoredValue(value);
      if (typeof window === 'undefined') return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn(`Failed to write localStorage key "${key}":`, error);
      }
    },
    [key]
  );

  return [storedValue, setValue];
}

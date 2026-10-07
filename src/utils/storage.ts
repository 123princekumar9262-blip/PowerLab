/**
 * Per-viewer progress (lessons done, best stars, prediction scores) in localStorage.
 * Storage can be unavailable (private mode, blocked site data) — every access is guarded
 * and the app works without it; progress is a convenience, never required.
 */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore: progress simply won't persist
  }
}

/**
 * Version comparison for the update check. Kept free of Electron imports so
 * it can be unit-tested.
 */

/** "v1.2.0" or "1.2" as numbers; anything unreadable counts as 0. */
function parts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
}

/** True when `latest` is a higher version than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

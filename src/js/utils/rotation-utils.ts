export const ROTATION_MIN = -360;
export const ROTATION_MAX = 360;
export const ROTATION_STEP = 0.1;

export function clampRotation(value: number): number {
  return Math.max(ROTATION_MIN, Math.min(ROTATION_MAX, value));
}

export function roundToStep(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parseAngleInput(raw: string, fallback = 0): number {
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clampRotation(roundToStep(parsed));
}

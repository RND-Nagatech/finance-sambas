export function computeSyncWindowStart(cursorInputDate, rollingDate, lookbackMinutes, initialFrom) {
  if (!cursorInputDate) return new Date(initialFrom);
  const cursor = new Date(cursorInputDate).getTime();
  const rolling = new Date(rollingDate).getTime();
  const overlap = Math.max(0, Number(lookbackMinutes) || 0) * 60 * 1000;
  if (!Number.isFinite(cursor)) return new Date(initialFrom);
  return new Date(Math.max(cursor - overlap, Number.isFinite(rolling) ? rolling : Number.NEGATIVE_INFINITY));
}

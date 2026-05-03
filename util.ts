export function parseCursorDate(cursor: string | null | undefined): Date | null {
  if (!cursor || typeof cursor !== "string") return null;
  const pipeIndex = cursor.indexOf("|");
  if (pipeIndex === -1) return null;
  const dateStr = cursor.substring(0, pipeIndex);
  if (dateStr === "undefined") return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

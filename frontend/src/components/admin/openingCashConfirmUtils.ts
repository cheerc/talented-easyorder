export function formatMonthDay(dateStr?: string): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return dateStr;
}

export function formatDiff(diff: number): string {
  if (diff > 0) return `+$${diff.toLocaleString()}`;
  if (diff < 0) return `−$${Math.abs(diff).toLocaleString()}`;
  return '$0';
}

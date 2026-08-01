export function statusColor(status: number): string {
  if (status === 0) return "text-destructive";
  if (status < 300) return "text-emerald-500";
  if (status < 400) return "text-amber-500";
  if (status < 500) return "text-orange-500";
  return "text-destructive";
}

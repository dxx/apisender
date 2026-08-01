export function formatTime(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

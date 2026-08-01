export function isRequestFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".http") || lower.endsWith(".rest");
}

export function isProtoFile(name: string): boolean {
  return name.toLowerCase().endsWith(".proto");
}

export function isPlainFile(name: string): boolean {
  if (isRequestFile(name)) return false;
  return name.toLowerCase().endsWith(".json") || isProtoFile(name);
}

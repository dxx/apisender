const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/15 text-blue-500",
  POST: "bg-emerald-500/15 text-emerald-500",
  PUT: "bg-amber-500/15 text-amber-500",
  DELETE: "bg-red-500/15 text-red-500",
  PATCH: "bg-purple-500/15 text-purple-500",
  HEAD: "bg-cyan-500/15 text-cyan-500",
  OPTIONS: "bg-gray-500/15 text-gray-500",
  WEBSOCKET: "bg-pink-500/15 text-pink-500",
  GRPC: "bg-violet-500/15 text-violet-500",
};

export function getMethodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? "bg-gray-500/15 text-gray-500";
}

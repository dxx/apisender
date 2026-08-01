function findBlockBounds(content: string, lineNumber: number): [number, number] {
  const lines = content.split("\n");
  let start = Math.max(0, lineNumber - 1);
  for (let i = lineNumber - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === "###" || /^###\s/.test(t)) {
      start = i;
      break;
    }
    if (i === 0) start = 0;
  }
  let end = lines.length;
  for (let i = lineNumber; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "###" || /^###\s/.test(t)) {
      end = i;
      break;
    }
  }
  return [start, end];
}

const METHOD_RE = /^(WEBSOCKET|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|GRPC)\b/i;

export function detectSse(content: string, lineNumber: number): boolean {
  const lines = content.split("\n");
  const [start, end] = findBlockBounds(content, lineNumber);
  const block = lines.slice(start, end).join("\n");
  return /@sse(?=\s|$)/i.test(block) || /accept\s*:\s*text\/event-stream/i.test(block);
}

export function detectWs(content: string, lineNumber: number): boolean {
  const lines = content.split("\n");
  const [start, end] = findBlockBounds(content, lineNumber);
  const block = lines.slice(start, end);
  const firstMethodLine = block.find((l) => METHOD_RE.test(l.trim()));
  return !!firstMethodLine && /^WEBSOCKET\b/i.test(firstMethodLine.trim());
}

export function detectGrpc(content: string, lineNumber: number): boolean {
  const lines = content.split("\n");
  const [start, end] = findBlockBounds(content, lineNumber);
  const block = lines.slice(start, end);
  const firstMethodLine = block.find((l) => METHOD_RE.test(l.trim()));
  return !!firstMethodLine && /^GRPC\b/i.test(firstMethodLine.trim());
}
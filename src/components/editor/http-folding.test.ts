import { HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS, collectHttpFoldRanges, selectHttpFoldControls } from "./http-folding";

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectTruthy(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

function getRange(
  ranges: ReturnType<typeof collectHttpFoldRanges>,
  kind: ReturnType<typeof collectHttpFoldRanges>[number]["kind"],
  lineFrom: number,
) {
  return ranges.find((range) => range.kind === kind && range.lineFrom === lineFrom);
}

function runRequestSectionFoldTest(): void {
  const text = [
    "### Create user",
    "POST https://api.example.com/users",
    "Content-Type: application/json",
    "Authorization: Bearer {{token}}",
    "",
    "{",
    '  "name": "Alice",',
    '  "items": [',
    '    {"value": "{not a brace}"}',
    "  ]",
    "}",
    "",
    "### List users",
    "GET https://api.example.com/users",
  ].join("\n");

  const ranges = collectHttpFoldRanges(text);
  const request = getRange(ranges, "request", 1);
  const headers = getRange(ranges, "headers", 3);
  const body = getRange(ranges, "body", 6);
  const jsonObject = getRange(ranges, "json-object", 6);
  const jsonArray = getRange(ranges, "json-array", 8);

  expectTruthy(request, "request block should be foldable from separator line");
  expectTruthy(headers, "headers should be foldable from first header line");
  expectTruthy(body, "body should be foldable from first body line");
  expectTruthy(jsonObject, "top-level JSON object should be foldable");
  expectTruthy(jsonArray, "nested JSON array should be foldable");

  expectEqual(request?.lineTo, 11, "request fold should stop before blank separator");
  expectEqual(request?.label, "接口 Create user 11 行 ...", "request placeholder should show separator title");
  expectEqual(headers?.lineTo, 4, "headers fold should cover both header lines");
  expectEqual(body?.lineTo, 11, "body fold should cover the JSON payload");
  expectEqual(jsonArray?.lineTo, 10, "JSON array fold should ignore braces inside strings");
  expectEqual(body?.label, "请求体 6 行 ...", "body placeholder should show line count");
  expectTruthy(body?.preview.includes('"items"'), "body hover preview should contain folded text");
}

function runPlainBodyFoldTest(): void {
  const text = [
    "POST https://api.example.com/raw",
    "Content-Type: text/plain",
    "",
    "literal { braces } are just text",
    "second line",
  ].join("\n");

  const ranges = collectHttpFoldRanges(text);
  const body = getRange(ranges, "body", 4);
  const jsonRanges = ranges.filter((range) => range.kind === "json-object" || range.kind === "json-array");

  expectTruthy(body, "plain text body should still be foldable as a body section");
  expectEqual(jsonRanges.length, 0, "plain text body should not expose JSON folds");
}

function runMultipartBodyFoldTest(): void {
  const text = [
    "### Upload",
    "POST https://api.example.com/upload",
    "Content-Type: multipart/form-data; boundary=boundary",
    "",
    "--boundary",
    'Content-Disposition: form-data; name="meta"',
    "",
    '{"name":"report"}',
    "--boundary--",
  ].join("\n");

  const ranges = collectHttpFoldRanges(text);
  const body = getRange(ranges, "body", 5);
  const request = getRange(ranges, "request", 1);

  expectTruthy(body, "multipart body should be foldable");
  expectEqual(body?.lineTo, 9, "multipart body fold should keep blank lines inside the body");
  expectEqual(request?.lineTo, 9, "request fold should include the whole multipart body");
}

function runMessageProtocolFoldTest(): void {
  const text = [
    "### Socket",
    "WEBSOCKET ws://example.com/socket",
    "",
    '{"type":"hello"}',
    "",
    "=== wait-for-server",
    '{"type":"ack"}',
    "",
    "### Rpc",
    "GRPC grpc://example.com/pkg.Service/Method",
    "",
    '{"id":1}',
  ].join("\n");

  const ranges = collectHttpFoldRanges(text);
  const websocketRequest = getRange(ranges, "request", 1);
  const grpcRequest = getRange(ranges, "request", 9);
  const sectionRanges = ranges.filter((range) => range.kind === "headers" || range.kind === "body");

  expectTruthy(websocketRequest, "WebSocket request block should be foldable");
  expectTruthy(grpcRequest, "gRPC request block should be foldable");
  expectEqual(websocketRequest?.lineTo, 7, "WebSocket request fold should include messages across blank lines");
  expectEqual(grpcRequest?.lineTo, 12, "gRPC request fold should include its message");
  expectEqual(sectionRanges.length, 0, "message protocols should not expose HTTP header/body folds");
}

function runGrpcStopsBeforeNextBareRequestTest(): void {
  const text = [
    "GRPC grpc://example.com/pkg.Service/Method",
    "Authorization: Bearer token",
    "",
    "{",
    '  "id": 1',
    "}",
    "",
    "GET https://api.example.com/users",
    "Accept: application/json",
  ].join("\n");

  const ranges = collectHttpFoldRanges(text);
  const grpcRequest = getRange(ranges, "request", 1);
  const nextRequest = getRange(ranges, "request", 8);

  expectTruthy(grpcRequest, "gRPC request without separator should be foldable");
  expectTruthy(nextRequest, "request after gRPC blank line should still be discovered");
  expectEqual(grpcRequest?.lineTo, 6, "gRPC request fold should stop at its body blank-line boundary");
}

/**
 * runFoldTooltipCloseDelayTest
 * 入参：无。
 * 出参：无。
 * 作用与流程：校验折叠预览关闭延迟不少于 500ms，
 * 保证鼠标从折叠占位符移动到预览框时有足够缓冲时间。
 */
function runFoldTooltipCloseDelayTest(): void {
  expectTruthy(
    HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS >= 500,
    "fold tooltip should stay open long enough for the pointer to enter the preview panel",
  );
}

/**
 * runFoldControlSelectionTest
 * 入参：无。
 * 出参：无。
 * 作用与流程：校验 gutter 折叠按钮同一行只保留一个入口，
 * 同时沿用折叠服务的区间排序，避免 body 和 JSON 顶层折叠在同一列重叠。
 */
function runFoldControlSelectionTest(): void {
  const text = [
    "### Create user",
    "POST https://api.example.com/users",
    "Content-Type: application/json",
    "",
    "{",
    '  "items": [',
    "    1",
    "  ]",
    "}",
  ].join("\n");

  const controls = selectHttpFoldControls(collectHttpFoldRanges(text));
  const lineFiveControls = controls.filter((range) => range.lineFrom === 5);

  expectEqual(lineFiveControls.length, 1, "fold control should expose one button per line");
  expectEqual(lineFiveControls[0]?.kind, "body", "body fold should be the visible control before JSON fold on the same line");
}

runRequestSectionFoldTest();
runPlainBodyFoldTest();
runMultipartBodyFoldTest();
runMessageProtocolFoldTest();
runGrpcStopsBeforeNextBareRequestTest();
runFoldTooltipCloseDelayTest();
runFoldControlSelectionTest();
console.log("http folding range tests passed");

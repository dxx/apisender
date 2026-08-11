import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
const MISSING_SIGNING_SECRET_MESSAGE = [
  "Missing updater signing private key.",
  "Add it in GitHub Repository secrets as TAURI_SIGNING_PRIVATE_KEY, using the raw one-line base64 content from .tauri-updater.key.",
  "If you used the alternate name UPDATER_SIGNING_PRIVATE_KEY, this workflow also supports it.",
  "Do not paste tauri.conf.json pubkey, .tauri-updater.key.pub, a local file path, or the decoded key text.",
].join(" ");

/**
 * 入参：GitHub Secret 中读取到的 updater 私钥字符串。
 * 出参：去除复制粘贴空白后的单行 base64 私钥。
 * 作用与流程：允许 Secret 因复制产生换行或首尾空白；拒绝解码后的明文 key、公钥或其他非 base64 内容。
 */
export function normalizeSigningSecret(secret) {
  const normalized = String(secret ?? "").replace(/\s+/g, "");

  if (!normalized) {
    throw new Error(MISSING_SIGNING_SECRET_MESSAGE);
  }

  if (!BASE64_PATTERN.test(normalized)) {
    throw new Error(
      "TAURI_SIGNING_PRIVATE_KEY must be the one-line base64 content of .tauri-updater.key. Do not paste the decoded key text.",
    );
  }

  return normalized;
}

/**
 * 入参：当前进程环境变量。
 * 出参：用于 Tauri updater 签名的私钥和密码字符串。
 * 作用与流程：优先读取工作流传入的专用变量；兼容直接传入 Tauri 官方变量名，避免 Secret 名称调整造成空值。
 */
function readSigningInputs(env) {
  const privateKey = env.UPDATER_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY;
  const password = env.UPDATER_SIGNING_PRIVATE_KEY_PASSWORD ?? env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

  return { privateKey, password };
}

/**
 * 入参：已从 base64 解码出的 updater 私钥文本。
 * 出参：无返回；校验失败时抛出明确错误。
 * 作用与流程：检查 Secret 是否真的是 Tauri updater 私钥，提前拦截误填公钥或损坏内容。
 */
export function validateDecodedSigningSecret(decodedSecret) {
  const firstLine = String(decodedSecret ?? "").split(/\r?\n/, 1)[0] ?? "";
  const lowerFirstLine = firstLine.toLowerCase();

  if (!lowerFirstLine.startsWith("untrusted comment:")) {
    throw new Error(
      "TAURI_SIGNING_PRIVATE_KEY is not a Tauri updater key. Copy the raw content from .tauri-updater.key.",
    );
  }

  if (lowerFirstLine.includes("public key")) {
    throw new Error(
      "TAURI_SIGNING_PRIVATE_KEY contains a public key. Use the private key from .tauri-updater.key instead.",
    );
  }

  if (!lowerFirstLine.includes("secret key")) {
    throw new Error(
      "TAURI_SIGNING_PRIVATE_KEY does not look like a Tauri updater private key.",
    );
  }
}

/**
 * 入参：GitHub Secret 中读取到的 updater 私钥密码。
 * 出参：传给 Tauri CLI 的密码字符串。
 * 作用与流程：兼容用户把空密码误填成 '' 或 "" 的情况；其他密码原样保留。
 */
export function normalizeSigningPassword(password) {
  const value = String(password ?? "");
  if (value === "''" || value === '""') {
    return "";
  }

  return value;
}

/**
 * 入参：GITHUB_ENV 文件路径、变量名和值。
 * 出参：无返回；会向 GITHUB_ENV 追加一个多行安全变量。
 * 作用与流程：使用随机分隔符写入环境变量，避免路径或密码中包含特殊字符时破坏 GitHub Actions 环境文件。
 */
function appendGitHubEnv(githubEnvPath, name, value) {
  const delimiter = `APISENDER_${name}_${crypto.randomUUID().replaceAll("-", "")}`;
  appendFileSync(
    githubEnvPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

/**
 * 入参：当前进程环境、GitHub 环境文件路径、临时目录和日志对象。
 * 出参：包含写入后的 key 文件路径，供测试和日志排查使用。
 * 作用与流程：读取专用 Secret，校验并写入临时 key 文件，再导出 Tauri 构建需要的签名环境变量。
 */
export function prepareUpdaterSigningKey({
  env = process.env,
  githubEnvPath = process.env.GITHUB_ENV,
  runnerTemp = process.env.RUNNER_TEMP || tmpdir(),
  logger = console,
} = {}) {
  if (!githubEnvPath) {
    throw new Error("GITHUB_ENV is not available. This script must run inside GitHub Actions.");
  }

  const signingInputs = readSigningInputs(env);
  const signingSecret = normalizeSigningSecret(signingInputs.privateKey);
  const decodedSecret = Buffer.from(signingSecret, "base64").toString("utf8");
  validateDecodedSigningSecret(decodedSecret);

  const keyPath = join(runnerTemp, "tauri-updater.key");
  writeFileSync(keyPath, signingSecret, { mode: 0o600 });
  chmodSync(keyPath, 0o600);

  const password = normalizeSigningPassword(signingInputs.password);
  if (signingInputs.password === "''" || signingInputs.password === '""') {
    logger.warn("Updater signing password was quoted as an empty string; using an actual empty password.");
  }

  appendGitHubEnv(githubEnvPath, "TAURI_SIGNING_PRIVATE_KEY", signingSecret);
  appendGitHubEnv(githubEnvPath, "TAURI_SIGNING_PRIVATE_KEY_PATH", keyPath);
  appendGitHubEnv(githubEnvPath, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", password);
  logger.log("Prepared Tauri updater signing key file.");

  return { keyPath };
}

/**
 * 入参：无；从 process.env 读取 GitHub Actions 运行环境。
 * 出参：无返回；失败时设置退出码。
 * 作用与流程：作为 CI 入口执行签名 key 准备逻辑，并把错误转换成 GitHub Actions 可读的 ::error 提示。
 */
function main() {
  try {
    prepareUpdaterSigningKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error title=Invalid updater signing key::${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

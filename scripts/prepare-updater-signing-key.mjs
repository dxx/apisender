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

function readSigningInputs(env) {
  const privateKey = env.UPDATER_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY;
  const password = env.UPDATER_SIGNING_PRIVATE_KEY_PASSWORD ?? env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

  return { privateKey, password };
}

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

export function normalizeSigningPassword(password) {
  const value = String(password ?? "");
  if (value === "''" || value === '""') {
    return "";
  }

  return value;
}

function appendGitHubEnv(githubEnvPath, name, value) {
  const delimiter = `APISENDER_${name}_${crypto.randomUUID().replaceAll("-", "")}`;
  appendFileSync(
    githubEnvPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

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

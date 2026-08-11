import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  normalizeSigningPassword,
  normalizeSigningSecret,
  prepareUpdaterSigningKey,
  validateDecodedSigningSecret,
} from "./prepare-updater-signing-key.mjs";

const privateKeyText = [
  "untrusted comment: rsign encrypted secret key",
  "RWPRIVATEKEYPAYLOAD",
  "",
].join("\n");

const publicKeyText = [
  "untrusted comment: minisign public key: 8185BD99197B9E98",
  "RWPUBLICKEYPAYLOAD",
  "",
].join("\n");

const privateKeySecret = Buffer.from(privateKeyText, "utf8").toString("base64");
const publicKeySecret = Buffer.from(publicKeyText, "utf8").toString("base64");

test("normalizeSigningSecret accepts wrapped base64 private key content", () => {
  const wrappedSecret = `\n ${privateKeySecret.slice(0, 24)}\n${privateKeySecret.slice(24)} \r\n`;

  assert.equal(normalizeSigningSecret(wrappedSecret), privateKeySecret);
});

test("normalizeSigningSecret rejects decoded private key text", () => {
  assert.throws(
    () => normalizeSigningSecret(privateKeyText),
    /one-line base64 content/,
  );
});

test("validateDecodedSigningSecret rejects public keys", () => {
  assert.throws(
    () => validateDecodedSigningSecret(publicKeyText),
    /public key/,
  );
});

test("normalizeSigningPassword treats quoted empty password as empty", () => {
  assert.equal(normalizeSigningPassword("''"), "");
  assert.equal(normalizeSigningPassword('""'), "");
  assert.equal(normalizeSigningPassword("real-password"), "real-password");
});

test("prepareUpdaterSigningKey writes a key file and GitHub env values", () => {
  const workDir = mkdtempSync(join(tmpdir(), "apisender-updater-key-"));
  const githubEnvPath = join(workDir, "github-env");

  const result = prepareUpdaterSigningKey({
    env: {
      UPDATER_SIGNING_PRIVATE_KEY: privateKeySecret,
      UPDATER_SIGNING_PRIVATE_KEY_PASSWORD: "''",
    },
    githubEnvPath,
    runnerTemp: workDir,
    logger: { log() {}, warn() {} },
  });

  assert.equal(readFileSync(result.keyPath, "utf8"), privateKeySecret);
  const githubEnv = readFileSync(githubEnvPath, "utf8");
  assert.match(githubEnv, /TAURI_SIGNING_PRIVATE_KEY<</);
  assert.match(githubEnv, /TAURI_SIGNING_PRIVATE_KEY_PATH<</);
  assert.match(githubEnv, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD<</);
});

test("prepareUpdaterSigningKey also accepts the direct Tauri private key env name", () => {
  const workDir = mkdtempSync(join(tmpdir(), "apisender-updater-key-"));
  const githubEnvPath = join(workDir, "github-env");

  const result = prepareUpdaterSigningKey({
    env: {
      TAURI_SIGNING_PRIVATE_KEY: privateKeySecret,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    },
    githubEnvPath,
    runnerTemp: workDir,
    logger: { log() {}, warn() {} },
  });

  assert.equal(readFileSync(result.keyPath, "utf8"), privateKeySecret);
  assert.match(readFileSync(githubEnvPath, "utf8"), /TAURI_SIGNING_PRIVATE_KEY<</);
});

test("prepareUpdaterSigningKey explains how to fix a missing GitHub secret", () => {
  const workDir = mkdtempSync(join(tmpdir(), "apisender-updater-key-"));

  assert.throws(
    () => prepareUpdaterSigningKey({
      env: {},
      githubEnvPath: join(workDir, "github-env"),
      runnerTemp: workDir,
      logger: { log() {}, warn() {} },
    }),
    /Repository secrets/,
  );
});

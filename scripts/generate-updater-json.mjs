import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const distDir = process.env.DIST_DIR ?? "dist";
const version = process.env.VERSION;
const repository = process.env.GITHUB_REPOSITORY;
const tagName = process.env.GITHUB_REF_NAME;

if (!version) throw new Error("VERSION is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!tagName) throw new Error("GITHUB_REF_NAME is required");

const platformArtifacts = {
  "darwin-aarch64": "macos-arm64.app.tar.gz",
  "darwin-x86_64": "macos-x64.app.tar.gz",
  "windows-x86_64": "windows-x64.msi",
  "windows-aarch64": "windows-arm64.msi",
  "linux-x86_64": "linux-x64.AppImage",
  "linux-aarch64": "linux-arm64.AppImage",
};

const files = await readdir(distDir);

function findArtifact(platform, suffix) {
  const matches = files.filter((file) => file.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one artifact for ${platform} (${suffix}), found ${matches.length}`);
  }
  return matches[0];
}

async function readSignature(fileName) {
  return (await readFile(path.join(distDir, `${fileName}.sig`), "utf8")).trim();
}

const platforms = {};
for (const [platform, suffix] of Object.entries(platformArtifacts)) {
  const fileName = findArtifact(platform, suffix);
  platforms[platform] = {
    signature: await readSignature(fileName),
    url: `https://github.com/${repository}/releases/download/${tagName}/${fileName}`,
  };
}

const latestJson = {
  version,
  notes: `apisender ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

await writeFile(path.join(distDir, "latest.json"), `${JSON.stringify(latestJson, null, 2)}\n`);

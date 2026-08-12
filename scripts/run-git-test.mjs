import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const outDir = await mkdtemp(path.join(tmpdir(), "apisender-git-test-"));
const entryName = "git-state-test.mjs";

try {
  await build({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    build: {
      emptyOutDir: true,
      outDir,
      ssr: "src/lib/git-test-suite.ts",
      rollupOptions: {
        output: {
          entryFileNames: entryName,
        },
      },
    },
    ssr: {
      noExternal: true,
    },
  });
  await import(pathToFileURL(path.join(outDir, entryName)).href);
} finally {
  await rm(outDir, { force: true, recursive: true });
}

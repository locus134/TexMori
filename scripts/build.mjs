import { build } from "esbuild";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, rm } from "node:fs/promises";
const release = process.argv.includes("--release");
await rm("dist/electron", { recursive: true, force: true });
await mkdir("dist/electron", { recursive: true });
await build({
  entryPoints: {
    main: "apps/desktop/electron/main.ts",
    preload: "apps/desktop/electron/preload.ts",
    "engine-worker": "apps/desktop/electron/engine-worker.ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: "dist/electron",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "sharp"],
  target: "node22",
  sourcemap: !release,
  minify: release,
});
await viteBuild({
  root: "apps/desktop",
  base: "./",
  plugins: [react()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});

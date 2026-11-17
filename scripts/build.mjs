import { build } from "esbuild";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir } from "node:fs/promises";
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
  sourcemap: true,
});
await viteBuild({
  root: "apps/desktop",
  base: "./",
  plugins: [react()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});

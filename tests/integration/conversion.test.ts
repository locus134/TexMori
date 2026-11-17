import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AssetService } from "../../packages/engine/src/assets";
import { ConversionService } from "../../packages/engine/src/conversion";
import { validateRequest, capabilities } from "../../packages/core/src/index";
import { inspectTexture, unwrapCcz } from "../../packages/containers/src/index";
import sharp from "sharp";
const root = process.cwd();
it("multiplies numeric RGB by Alpha only when enabled, preserving source pixels and Alpha", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-rgb-alpha-"));
  try {
    const file = path.join(dir, "source.png");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 200, g: 80, b: 20, alpha: 0.5 },
      },
    })
      .png()
      .toFile(file);
    const assets = new AssetService(),
      [asset] = await assets.import([file], new AbortController().signal);
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    for (const [codec, container] of [
      ["etc1", "pkm"],
      ["bc3", "dds"],
      ["pvrtc1_rgba_4", "pvr"],
    ] as const) {
      for (const enabled of [false, true]) {
        const outputDir = path.join(dir, codec + "-" + enabled);
        const request = validateRequest({
          operation: "encode",
          codec,
          container,
          options: enabled ? { multiplyRgbByAlpha: true } : {},
          output: { mode: "source", conflict: "skip" },
        });
        const result = await service.run(
          asset,
          request,
          outputDir,
          new AbortController().signal,
          {},
          true,
        );
        const pixels = await sharp(path.join(outputDir, "work.png"))
          .ensureAlpha()
          .raw()
          .toBuffer();
        expect([...pixels.subarray(0, 4)]).toEqual(
          enabled ? [100, 40, 10, 128] : [200, 80, 20, 128],
        );
        const original = await sharp(result.originalPath)
          .ensureAlpha()
          .raw()
          .toBuffer();
        expect([...original.subarray(0, 4)]).toEqual([200, 80, 20, 128]);
        if (codec === "bc3" && enabled) {
          const decoded = await sharp(result.previewPath)
            .ensureAlpha()
            .raw()
            .toBuffer();
          expect(decoded[0]).toBeGreaterThan(85);
          expect(decoded[0]).toBeLessThan(115);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("encodes and decodes every real format, with valid ETC PKM and BC DDS", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-matrix-"));
  const assets = new AssetService();
  try {
    const [asset] = await assets.import(
      [path.join(root, "tests/fixtures/generated/rgba.png")],
      new AbortController().signal,
    );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    for (const codec of capabilities) {
      const request = validateRequest({
        operation: "encode",
        codec: codec.id,
        container: codec.containers[0],
        sizeMode: "keep",
        options: codec.engine === "pvrtc" ? { quality: "PVRTCFASTEST" } : {},
        output: { mode: "source", conflict: "skip" },
      });
      const output = await service.run(
        asset,
        request,
        path.join(dir, codec.id),
        new AbortController().signal,
        {},
        true,
      );
      expect(inspectTexture(await readFile(output.path))).toMatchObject({
        codec: codec.id,
        width: 32,
        height: 32,
      });
      expect(output.width).toBe(32);
      expect(output.height).toBe(32);
      expect(output.encodedBytes).toBeGreaterThan(0);
      expect(await sharp(output.previewPath).metadata()).toMatchObject({
        width: 32,
        height: 32,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("preserves logical PKM dimensions after edge padding and rewraps without an encoder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-padding-"));
  const assets = new AssetService();
  try {
    const [asset] = await assets.import(
      [path.join(root, "tests/fixtures/generated/odd.png")],
      new AbortController().signal,
    );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    const request = validateRequest({
      operation: "encode",
      codec: "etc1",
      container: "pkm",
      sizeMode: "pad",
      output: { mode: "source", conflict: "skip" },
    });
    const output = await service.run(
      asset,
      request,
      dir,
      new AbortController().signal,
    );
    expect(inspectTexture(await readFile(output.path))).toMatchObject({
      width: 13,
      height: 9,
      encodedWidth: 16,
      encodedHeight: 12,
    });
    const [pvrAsset] = await assets.import(
      [path.join(root, "build/matrix/pvrtc1_rgba_4.pvr")],
      new AbortController().signal,
    );
    const noEngine = new ConversionService({
      etcpak: "/does-not-exist",
      pvrtc: "/does-not-exist",
    });
    const wrapped = await noEngine.run(
      pvrAsset,
      validateRequest({
        operation: "rewrap",
        container: "ccz",
        output: { mode: "source", conflict: "skip" },
      }),
      path.join(dir, "wrap"),
      new AbortController().signal,
    );
    expect(unwrapCcz(await readFile(wrapped.path))).toEqual(
      await readFile(pvrAsset.path),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["srgb", "linear"] as const)(
  "converts premultiplied %s input into a straight-alpha PNG working image",
  async (colorSpace) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-alpha-"));
    try {
      const file = path.join(dir, "alpha.png");
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 200, g: 80, b: 20, alpha: 0.5 },
        },
      })
        .png()
        .toFile(file);
      const assets = new AssetService(),
        [asset] = await assets.import([file], new AbortController().signal);
      const service = new ConversionService({
        etcpak: path.join(root, "build/etcpak/etcpak"),
        pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
      });
      const values: number[][] = [];
      for (const premultiply of [false, true]) {
        const request = validateRequest({
          operation: "encode",
          codec: "pvrtc1_rgba_4",
          container: "pvr",
          colorSpace,
          options: { quality: "PVRTCFASTEST", premultiply },
          output: { mode: "source", conflict: "skip" },
        });
        const result = await service.run(
          asset,
          request,
          path.join(dir, String(premultiply)),
          new AbortController().signal,
          {},
          true,
        );
        const pixels = await sharp(result.previewPath)
          .ensureAlpha()
          .raw()
          .toBuffer();
        values.push([...pixels.subarray(0, 4)]);
      }
      expect(
        Math.abs(values[1][0] - values[0][0]),
        JSON.stringify(values),
      ).toBeLessThan(22);
      expect(values[1][3]).toBe(values[0][3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it("generates full mip chains and exercises every exposed PVRTC quality and mip filter", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-mips-"));
  try {
    const assets = new AssetService(),
      [asset] = await assets.import(
        [path.join(root, "tests/fixtures/generated/rgba.png")],
        new AbortController().signal,
      );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    const { qualities } = await import("../../packages/core/src/index");
    for (const quality of qualities) {
      const request = validateRequest({
        operation: "encode",
        codec: "pvrtc1_rgba_4",
        container: "pvr",
        options: { quality, mipmaps: true, mipFilter: "linear" },
        output: { mode: "source", conflict: "skip" },
      });
      const result = await service.run(
        asset,
        request,
        path.join(dir, quality),
        new AbortController().signal,
      );
      expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
    }
    for (const mipFilter of ["nearest", "cubic"]) {
      const request = validateRequest({
        operation: "encode",
        codec: "pvrtc2_4",
        container: "pvr",
        options: { quality: "PVRTCFASTEST", mipmaps: true, mipFilter },
        output: { mode: "source", conflict: "skip" },
      });
      const result = await service.run(
        asset,
        request,
        path.join(dir, mipFilter),
        new AbortController().signal,
      );
      expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
    }
    const result = await service.run(
      asset,
      validateRequest({
        operation: "encode",
        codec: "bc3",
        container: "dds",
        options: { mipmaps: true },
        output: { mode: "source", conflict: "skip" },
      }),
      path.join(dir, "bc3"),
      new AbortController().signal,
    );
    expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

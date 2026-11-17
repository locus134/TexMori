import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AssetService } from "../src/assets";
it("scans a fixed snapshot without following directory links or reimporting output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-assets-"));
  try {
    await mkdir(path.join(dir, "输出"));
    await mkdir(path.join(dir, "sub"));
    const png = await sharp({
      create: {
        width: 13,
        height: 9,
        channels: 4,
        background: { r: 10, g: 30, b: 80, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(dir, "猫.some.png"), png);
    await writeFile(path.join(dir, "输出", "old.png"), png);
    await symlink(dir, path.join(dir, "sub", "loop"));
    await symlink(path.join(dir, "猫.some.png"), path.join(dir, "same.png"));
    const service = new AssetService();
    const assets = await service.import(
      [dir],
      new AbortController().signal,
      path.join(dir, "输出"),
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      width: 13,
      height: 9,
      alpha: true,
      container: "image",
    });
    expect(
      await service.import(
        [dir],
        new AbortController().signal,
        path.join(dir, "输出"),
      ),
    ).toHaveLength(0);
    await expect(service.import([dir], AbortSignal.abort())).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("keeps corrupt inputs as individual errors and identifies images by content", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-probe-"));
  try {
    await writeFile(path.join(dir, "broken.pkm"), "PKM 10");
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .jpeg()
      .toFile(path.join(dir, "jpeg.png"));
    const s = new AssetService();
    const assets = await s.import([dir], new AbortController().signal);
    expect(assets).toHaveLength(2);
    expect(assets.filter((a) => a.error)).toHaveLength(1);
    expect(assets.find((a) => a.name === "jpeg.png")).toMatchObject({
      container: "image",
      width: 8,
      alpha: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("registers missing inputs as visible errors without losing valid siblings", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-missing-"));
  try {
    const file = path.join(dir, "ok.png");
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "blue" },
    })
      .png()
      .toFile(file);
    const service = new AssetService(),
      result = await service.import(
        [path.join(dir, "missing.png"), file],
        new AbortController().signal,
      );
    expect(result).toHaveLength(2);
    expect([...service.assets.values()]).toHaveLength(2);
    expect([...service.assets.values()].filter((a) => a.error)).toHaveLength(1);
    expect(
      (await service.refresh(result.find((a) => a.error)!.id)).error,
    ).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

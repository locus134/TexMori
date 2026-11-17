import { it, expect } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Preferences, normalizeOutputDirectory } from "../src/preferences";
it("persists independent import/export paths across restarts without unrelated data", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cptool-preferences-"),
  );
  try {
    const file = path.join(directory, "preferences.json"),
      first = new Preferences(file);
    await first.load();
    await Promise.all([
      first.update({ importDirectory: "/input/图片" }),
      first.update({ outputDirectory: "/output/纹理" }),
    ]);
    const next = new Preferences(file);
    await next.load();
    expect(next.paths()).toEqual({
      importDirectory: "/input/图片",
      outputDirectory: "/output/纹理",
    });
    await next.update({ importDirectory: "/different" });
    expect(next.paths().outputDirectory).toBe("/output/纹理");
    expect(
      Object.keys(JSON.parse(await readFile(file, "utf8"))).sort(),
    ).toEqual(["importDirectory", "outputDirectory"]);
    await writeFile(file, "invalid JSON");
    await next.load();
    expect(next.paths()).toEqual({});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("canonicalizes existing parent aliases before appending new output subdirectories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cptool-parent-"));
  try {
    await mkdir(path.join(directory, "real"));
    await symlink(path.join(directory, "real"), path.join(directory, "alias"));
    expect(
      await normalizeOutputDirectory(
        path.join(directory, "alias", "new", "child"),
      ),
    ).toBe(
      path.join(await realpath(path.join(directory, "real")), "new", "child"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("accepts editable absolute/new output folders, expands home and rejects files/relative paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cptool-path-"));
  try {
    await mkdir(path.join(directory, "existing"));
    await writeFile(path.join(directory, "file"), "x");
    expect(await normalizeOutputDirectory("~/new folder", directory)).toBe(
      path.join(await realpath(directory), "new folder"),
    );
    expect(await normalizeOutputDirectory("")).toBeUndefined();
    await expect(normalizeOutputDirectory("relative")).rejects.toThrow();
    await expect(
      normalizeOutputDirectory(path.join(directory, "file")),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  stat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
export interface SavedPaths {
  importDirectory?: string;
  outputDirectory?: string;
}
export class Preferences {
  private value: SavedPaths = {};
  private pending: Promise<void> = Promise.resolve();
  constructor(private file: string) {}
  async load() {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.value = {};
      if (value && typeof value === "object")
        for (const key of ["importDirectory", "outputDirectory"] as const) {
          const candidate = (value as SavedPaths)[key];
          if (
            typeof candidate === "string" &&
            path.isAbsolute(candidate) &&
            !candidate.includes("\0")
          )
            this.value[key] = candidate;
        }
    } catch {
      this.value = {};
    }
  }
  paths(): SavedPaths {
    return { ...this.value };
  }
  async update(change: SavedPaths) {
    for (const [key, value] of Object.entries(change))
      if (
        !["importDirectory", "outputDirectory"].includes(key) ||
        (value !== undefined &&
          (typeof value !== "string" ||
            !path.isAbsolute(value) ||
            value.includes("\0")))
      )
        throw Error("保存的目录路径无效");
    this.value = { ...this.value, ...change };
    const snapshot = JSON.stringify(this.value, null, 2);
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = this.file + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await rename(temporary, this.file);
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      });
    await this.pending;
  }
  flush() {
    return this.pending;
  }
}
export async function normalizeOutputDirectory(
  input: string,
  home = os.homedir(),
): Promise<string | undefined> {
  if (!input.trim()) return undefined;
  if (input.includes("\0")) throw Error("输出目录路径无效");
  const value =
    input === "~"
      ? home
      : input.startsWith("~/")
        ? path.join(home, input.slice(2))
        : input;
  if (!path.isAbsolute(value)) throw Error("请输入完整的输出目录路径");
  let current = path.resolve(value);
  const missing: string[] = [];
  for (;;) {
    try {
      const info = await stat(current);
      if (!info.isDirectory()) throw Error("输出路径必须是目录");
      return path.join(await realpath(current), ...missing.reverse());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(current);
      if (parent === current) throw Error("无法访问输出目录");
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

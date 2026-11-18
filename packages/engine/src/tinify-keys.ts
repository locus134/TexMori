import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export interface TinifyKeyStatus {
  id: string;
  masked: string;
  count?: number;
  error?: string;
}
export class TinifyKeys {
  private entries: {
    id: string;
    key: string;
    count?: number;
    error?: string;
  }[] = [];
  private pending: Promise<void> = Promise.resolve();
  constructor(private file: string) {}
  async load() {
    try {
      const rows: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(rows) || rows.length > 100)
        throw Error("密钥文件格式无效");
      const entries = rows.map((row) => {
        if (
          !row ||
          typeof row.id !== "string" ||
          typeof row.key !== "string"
        )
          throw Error("密钥文件格式无效");
        const key = row.key;
        if (!/^[\x21-\x7e]{8,256}$/.test(key)) throw Error("密钥格式无效");
        return { id: row.id, key };
      });
      this.entries = entries.filter(
        (e, i) => entries.findIndex((x) => x.key === e.key) === i,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("无法读取已保存的 TinyPNG API Key，请检查本地存储文件");
    }
  }
  status(): TinifyKeyStatus[] {
    return this.entries.map(({ id, key, count, error }) => ({
      id,
      masked: "•••• " + key.slice(-4),
      count,
      error,
    }));
  }
  secrets() {
    return this.entries.map((e) => e.key);
  }
  async add(value: string) {
    const key = value.trim();
    if (!/^[\x21-\x7e]{8,256}$/.test(key))
      throw Error("API Key 应为 8–256 位无空格字符");
    if (this.entries.some((e) => e.key === key)) return;
    if (this.entries.length >= 100) throw Error("最多保存 100 个 API Key");
    const next = [...this.entries, { id: randomUUID(), key }];
    await this.save(next);
    this.entries = next;
  }
  async remove(id: string) {
    const next = this.entries.filter((e) => e.id !== id);
    await this.save(next);
    this.entries = next;
  }
  update(key: string, change: { count?: number; error?: string }) {
    const entry = this.entries.find((e) => e.key === key);
    if (entry) Object.assign(entry, change);
  }
  resetErrors() {
    this.entries.forEach((e) => {
      e.error = undefined;
    });
  }
  private async save(entries: typeof this.entries) {
    const data = JSON.stringify(
      entries.map((e) => ({
        id: e.id,
        key: e.key,
      })),
    );
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = this.file + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temporary, data, { mode: 0o600 });
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

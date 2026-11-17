import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TinifyKeys } from "../src/tinify-keys";
it("stores encrypted keys, deduplicates and restores without exposing secrets in status", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tinify-keys-"));
  const key = randomBytes(32);
  const cipher = {
    encryptString(value: string) {
      const iv = randomBytes(16),
        c = createCipheriv("aes-256-cbc", key, iv);
      return Buffer.concat([iv, c.update(value), c.final()]);
    },
    decryptString(value: Buffer) {
      const c = createDecipheriv("aes-256-cbc", key, value.subarray(0, 16));
      return Buffer.concat([
        c.update(value.subarray(16)),
        c.final(),
      ]).toString();
    },
  };
  try {
    const file = path.join(dir, "keys.json"),
      store = new TinifyKeys(file, cipher);
    await store.add("private-key-one");
    await store.add("private-key-one");
    await store.add("private-key-two");
    expect(store.secrets()).toHaveLength(2);
    expect(await readFile(file, "utf8")).not.toContain("private-key");
    expect(JSON.stringify(store.status())).not.toContain("private-key");
    const restored = new TinifyKeys(file, cipher);
    await restored.load();
    expect(restored.secrets()).toEqual(["private-key-one", "private-key-two"]);
    await restored.remove(restored.status()[0].id);
    const next = new TinifyKeys(file, cipher);
    await next.load();
    expect(next.secrets()).toEqual(["private-key-two"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

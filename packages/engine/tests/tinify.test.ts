import { expect, it } from "vitest";
import { TinifyPool, TinifyError, compressTinify } from "../src/tinify";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("uploads originals, forwards supported options, saves returned format and rejects foreign download URLs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tinify-http-"));
  try {
    const file = path.join(dir, "source.png");
    await writeFile(file, "original");
    let calls = 0;
    const request: typeof fetch = async (url, init) => {
      expect(init?.redirect).toBe("error");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Basic YXBpOnRlc3Qta2V5",
      );
      if (++calls === 1) {
        expect(url).toBe("https://api.tinify.com/shrink");
        expect(Buffer.from(init!.body as Uint8Array).toString()).toBe(
          "original",
        );
        return Response.json(
          { output: { url: "https://api.tinify.com/output/example" } },
          { status: 201, headers: { "Compression-Count": "12" } },
        );
      }
      expect(JSON.parse(init!.body as string)).toEqual({
        convert: { type: ["image/webp"] },
        resize: { method: "fit", width: 20, height: 20 },
        preserve: ["copyright"],
      });
      return new Response("compressed", {
        headers: { "Content-Type": "image/webp" },
      });
    };
    const counts: number[] = [];
    const result = await compressTinify(
      file,
      dir,
      {
        formats: ["webp"],
        resize: { method: "fit", width: 20, height: 20 },
        preserve: ["copyright"],
      },
      "test-key",
      new AbortController().signal,
      (n) => counts.push(n),
      request,
    );
    expect(result.extension).toBe("webp");
    expect(result.inputBytes).toBe(8);
    expect(result.outputBytes).toBe(10);
    expect(await readFile(result.path, "utf8")).toBe("compressed");
    expect(counts).toEqual([12]);
    const malicious: typeof fetch = async () =>
      Response.json({ output: { url: "https://evil.invalid/output/example" } });
    await expect(
      compressTinify(
        file,
        dir,
        { formats: [], preserve: [] },
        "test-key",
        new AbortController().signal,
        undefined,
        malicious,
      ),
    ).rejects.toThrow("下载地址");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects an unexpected output format when keeping the input format", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tinify-format-"));
  try {
    const file = path.join(dir, "source.png");
    await writeFile(file, "original");
    let call = 0;
    const request: typeof fetch = async () =>
      ++call === 1
        ? Response.json({
            output: { url: "https://api.tinify.com/output/example" },
          })
        : new Response("different-format", {
            headers: { "Content-Type": "image/jpeg" },
          });
    await expect(
      compressTinify(
        file,
        dir,
        { formats: [], preserve: [] },
        "test-key",
        new AbortController().signal,
        undefined,
        request,
      ),
    ).rejects.toThrow("格式");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("reports exhausted keys instead of hanging when all keys are rate limited", async () => {
  const pool = new TinifyPool(["limited-a", "limited-b"]);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      pool.run(new AbortController().signal, async () => {
        throw new TinifyError(429);
      }),
    ),
  );
  expect(results.every((r) => r.status === "rejected")).toBe(true);
});
it("aborts the active HTTP upload and never proceeds to download", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tinify-abort-"));
  try {
    const file = path.join(dir, "source.png");
    await writeFile(file, "original");
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    let calls = 0;
    const request: typeof fetch = async (_url, init) => {
      calls++;
      entered();
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        ),
      );
    };
    const result = compressTinify(
      file,
      dir,
      { formats: [], preserve: [] },
      "test-key",
      controller.signal,
      undefined,
      request,
    );
    await ready;
    controller.abort();
    await expect(result).rejects.toThrow("取消");
    expect(calls).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("leases one job per unique key, queues extras, and recovers after a failed job", async () => {
  const pool = new TinifyPool(["key-a", "key-b", "key-a"]);
  const active = new Set<string>(),
    seen: string[] = [];
  let peak = 0;
  const releases: (() => void)[] = [];
  const run = () =>
    pool.run(new AbortController().signal, async (key) => {
      expect(active.has(key)).toBe(false);
      active.add(key);
      seen.push(key);
      peak = Math.max(peak, active.size);
      await new Promise<void>((r) => releases.push(r));
      active.delete(key);
      return key;
    });
  const pending = [run(), run(), run()];
  await new Promise((r) => setTimeout(r, 0));
  expect(peak).toBe(2);
  expect(seen.length).toBe(2);
  releases.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  expect(seen.length).toBe(3);
  releases.splice(0).forEach((r) => r());
  await Promise.all(pending);
  await expect(
    pool.run(new AbortController().signal, async () => {
      throw Error("network");
    }),
  ).rejects.toThrow("network");
  expect(await pool.run(new AbortController().signal, async () => "ok")).toBe(
    "ok",
  );
});
it("disables invalid keys, reassigns work, and cancels waiting work immediately", async () => {
  const pool = new TinifyPool(["bad", "good"]),
    calls: string[] = [];
  expect(
    await pool.run(new AbortController().signal, async (key) => {
      calls.push(key);
      if (key === "bad") throw new TinifyError(401);
      return "done";
    }),
  ).toBe("done");
  expect(calls).toEqual(["bad", "good"]);
  let release!: () => void;
  const first = pool.run(
    new AbortController().signal,
    () => new Promise<void>((r) => (release = r)),
  );
  await new Promise((r) => setTimeout(r, 0));
  const controller = new AbortController();
  const waiting = pool.run(controller.signal, async () => "never");
  controller.abort();
  await expect(waiting).rejects.toThrow();
  release();
  await first;
});

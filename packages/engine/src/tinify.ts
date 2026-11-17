import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  tinifySchema,
  sourceImageFormat,
  tinifyExtension,
  type TinifyOptions,
} from "../../core/src/tinify";

export class TinifyError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "TinyPNG API Key 无效"
        : status === 429
          ? "TinyPNG 额度已用尽或请求受限"
          : `TinyPNG 请求失败（HTTP ${status}）`,
    );
  }
}
export class TinifyPool {
  private entries: { key: string; busy: boolean; disabled: boolean }[];
  private waiters = new Set<() => void>();
  constructor(keys: string[]) {
    this.entries = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].map(
      (key) => ({ key, busy: false, disabled: false }),
    );
  }
  get size() {
    return this.entries.length;
  }
  async run<T>(
    signal: AbortSignal,
    work: (key: string) => Promise<T>,
  ): Promise<T> {
    for (;;) {
      signal.throwIfAborted();
      const entry = this.entries.find((e) => !e.busy && !e.disabled);
      if (!entry) {
        if (this.entries.every((e) => e.disabled))
          throw Error("没有可用的 TinyPNG API Key，请检查配置或额度");
        await new Promise<void>((resolve, reject) => {
          const wake = () => {
            cleanup();
            resolve();
          };
          const abort = () => {
            cleanup();
            reject(Error("任务已取消"));
          };
          const cleanup = () => {
            this.waiters.delete(wake);
            signal.removeEventListener("abort", abort);
          };
          this.waiters.add(wake);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        continue;
      }
      entry.busy = true;
      try {
        return await work(entry.key);
      } catch (e) {
        if (!(e instanceof TinifyError) || ![401, 429].includes(e.status))
          throw e;
        entry.disabled = true;
      } finally {
        entry.busy = false;
        for (const wake of [...this.waiters]) wake();
      }
    }
  }
}
function outputUrl(value: unknown): string {
  if (typeof value !== "string") throw Error("TinyPNG 返回的下载地址无效");
  const url = new URL(value);
  if (
    url.origin !== "https://api.tinify.com" ||
    !url.pathname.startsWith("/output/") ||
    url.username ||
    url.password
  )
    throw Error("TinyPNG 返回的下载地址无效");
  return url.href;
}
export interface TinifyResult {
  path: string;
  extension: string;
  inputBytes: number;
  outputBytes: number;
}
export async function compressTinify(
  file: string,
  directory: string,
  raw: TinifyOptions,
  key: string,
  signal: AbortSignal,
  onCount: (count: number) => void = () => {},
  request: typeof fetch = fetch,
): Promise<TinifyResult> {
  const options = tinifySchema.parse(raw);
  if (!sourceImageFormat(file)) throw Error("TinyPNG 不支持此输入格式");
  const data = await readFile(file);
  if (data.length > 256 * 1024 * 1024) throw Error("输入文件超过 256 MiB 限制");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  const authorization = "Basic " + Buffer.from("api:" + key).toString("base64");
  const send = async (url: string, init: RequestInit) => {
    let response: Response;
    try {
      response = await request(url, {
        ...init,
        redirect: "error",
        signal: combined,
        headers: { ...init.headers, Authorization: authorization },
      });
    } catch {
      if (signal.aborted) throw Error("任务已取消");
      throw Error("TinyPNG 网络请求失败或超时，请重试");
    }
    const count = response.headers.get("Compression-Count");
    if (count !== null && /^\d+$/.test(count)) onCount(Number(count));
    if (!response.ok) {
      await response.body?.cancel();
      throw new TinifyError(response.status);
    }
    return response;
  };
  const uploaded = await send("https://api.tinify.com/shrink", {
    method: "POST",
    body: new Uint8Array(data),
  });
  const upload: unknown = await uploaded.json();
  const info = upload as { output?: { url?: unknown } };
  const url = outputUrl(uploaded.headers.get("Location") ?? info?.output?.url);
  const instructions: Record<string, unknown> = {};
  if (options.formats.length)
    instructions.convert = { type: options.formats.map((f) => "image/" + f) };
  if (options.resize) instructions.resize = options.resize;
  if (options.background)
    instructions.transform = { background: options.background };
  if (options.preserve.length) instructions.preserve = options.preserve;
  const response = await send(
    url,
    Object.keys(instructions).length
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(instructions),
        }
      : { method: "GET" },
  );
  const type = response.headers.get("Content-Type")?.split(";")[0];
  const format = ["png", "jpeg", "webp", "avif", "jxl"].find(
    (f) => type === "image/" + f,
  );
  if (!format) {
    await response.body?.cancel();
    throw Error("TinyPNG 返回了不支持的图片类型");
  }
  const source = sourceImageFormat(file);
  const expected = options.formats.length
    ? options.formats
    : [source === "heic" ? "jpeg" : source];
  if (!expected.includes(format as (typeof options.formats)[number])) {
    await response.body?.cancel();
    throw Error("TinyPNG 返回的图片格式与所选格式不符");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader) throw Error("TinyPNG 返回了空图片");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256 * 1024 * 1024) {
      await reader.cancel();
      throw Error("TinyPNG 输出超过大小限制");
    }
    chunks.push(value);
  }
  if (!length) throw Error("TinyPNG 返回了空图片");
  signal.throwIfAborted();
  const extension = tinifyExtension(format),
    target = path.join(directory, "compressed." + extension);
  await writeFile(target, Buffer.concat(chunks));
  return {
    path: target,
    extension,
    inputBytes: data.length,
    outputBytes: length,
  };
}

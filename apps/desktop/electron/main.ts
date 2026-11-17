import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  utilityProcess,
} from "electron";
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  readFile,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AssetService } from "../../../packages/engine/src/assets";
import { JobQueue, WorkScheduler } from "../../../packages/engine/src/queue";
import { PreviewCache } from "../../../packages/engine/src/preview";
import type { ConversionResult } from "../../../packages/engine/src/conversion";
import {
  capabilities,
  capability,
  validateRequest,
  type Asset,
  type ConversionRequest,
  type PlannedOutput,
  type PreviewResult,
} from "../../../packages/core/src/index";
import { planOutputs } from "../../../packages/core/src/output-plan";
import {
  generateKey,
  normalizeKey,
  cocosKeyExample,
} from "../../../packages/containers/src/index";
import type { DesktopAsset, PlanSummary } from "../src/api";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "cptool-preview",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const assets = new AssetService(),
  scheduler = new WorkScheduler(),
  keys = new Map<string, string>(),
  images = new Map<string, string>(),
  thumbnails = new Map<string, string>();
const cache = new PreviewCache<Omit<PreviewResult, "version">>(),
  plans = new Map<string, PlannedOutput[]>();
const activeWork = new Set<Promise<ConversionResult>>();
let window: BrowserWindow,
  sessionDirectory: string,
  outputDirectory: string | undefined,
  previewController = new AbortController(),
  scanController = new AbortController(),
  closing = false,
  quitting = false;
const engines = () =>
  app.isPackaged
    ? {
        etcpak: path.join(process.resourcesPath, "engines/etcpak"),
        pvrtc: path.join(process.resourcesPath, "engines/PVRTexToolCLI"),
      }
    : {
        etcpak: path.join(app.getAppPath(), "build/etcpak/etcpak"),
        pvrtc: path.join(app.getAppPath(), "build/engines/PVRTexToolCLI"),
      };
const keyFor = (ref?: string) => {
  if (!ref) return undefined;
  const key = keys.get(ref);
  if (!key) throw Error("密钥引用已失效，请重新输入");
  return key;
};
function imageUrl(file: string) {
  const token = randomUUID();
  images.set(token, file);
  return `cptool-preview://${token}/image`;
}
function displayAsset(asset: Asset): DesktopAsset {
  if (asset.container === "image" && !thumbnails.has(asset.id))
    thumbnails.set(asset.id, imageUrl(asset.path));
  return { ...asset, thumbnail: thumbnails.get(asset.id) };
}
function allAssets() {
  return [...assets.assets.values()].map(displayAsset);
}
async function work(
  asset: Asset,
  request: ConversionRequest,
  signal: AbortSignal,
  preview = false,
): Promise<ConversionResult> {
  signal.throwIfAborted();
  const resolvedKeys = {
    input: keyFor(request.inputKeyRef),
    output: request.encrypt ? keyFor(request.outputKeyRef) : undefined,
  };
  const directory = await mkdtemp(
    path.join(sessionDirectory, preview ? "preview-" : "job-"),
  );
  const pending = new Promise<ConversionResult>((resolve, reject) => {
    const child = utilityProcess.fork(
      path.join(__dirname, "engine-worker.cjs"),
      [],
      { stdio: "pipe", serviceName: "CPTool 纹理工作进程" },
    );
    let settled = false,
      hardStop: ReturnType<typeof setTimeout> | undefined;
    const finish = async (result?: ConversionResult, error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (hardStop) clearTimeout(hardStop);
      child.kill();
      if (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
        reject(error);
      } else resolve(result!);
    };
    const abort = () => {
      child.postMessage({ cancel: true });
      hardStop = setTimeout(() => finish(undefined, Error("任务已取消")), 3000);
    };
    child.on(
      "message",
      (message: { result?: ConversionResult; error?: string }) =>
        finish(
          message.result,
          message.error
            ? Error(message.error)
            : signal.aborted
              ? Error("任务已取消")
              : undefined,
        ),
    );
    child.on("exit", () => {
      if (!settled) finish(undefined, Error("工作进程意外退出"));
    });
    // Keys travel only over the private process channel, never command lines or logs.
    child.on("spawn", () => {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      child.postMessage({
        engines: engines(),
        asset,
        request,
        directory,
        keys: resolvedKeys,
        preview,
      });
    });
  });
  activeWork.add(pending);
  return pending.finally(() => activeWork.delete(pending));
}
const queue = new JobQueue(
  async (plan, signal) => {
    const current = await assets.refresh(
      plan.asset.id,
      keyFor(plan.request.inputKeyRef),
    );
    if (current.fingerprint !== plan.asset.fingerprint)
      throw Error("输入文件已改变，请重新规划批处理");
    return (await work(current, plan.request, signal)).path;
  },
  scheduler,
  async (file) => {
    const directory = path.dirname(file);
    if (path.dirname(directory) === sessionDirectory)
      await rm(directory, { recursive: true, force: true });
  },
);
queue.onChange = (jobs, running) => {
  if (!window?.isDestroyed())
    window.webContents.send("jobs", { jobs, running });
};
const idSchema = z.string().uuid();
const idsSchema = z.array(idSchema).max(10000);
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw Error("来源不被允许");
    try {
      return await fn(...args);
    } catch (error) {
      throw Error(
        error instanceof z.ZodError
          ? "请求参数无效"
          : error instanceof Error
            ? error.message
            : "操作失败",
      );
    }
  });
}
async function scan(paths: string[]) {
  scanController.abort();
  const controller = new AbortController();
  scanController = controller;
  try {
    await assets.import(paths, controller.signal, outputDirectory);
  } catch (e) {
    if (!controller.signal.aborted) throw e;
  }
  return allAssets();
}
async function existingFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  try {
    for (const e of await readdir(directory, { withFileTypes: true })) {
      if (e.name.startsWith(".cptool-")) continue;
      const file = path.join(directory, e.name);
      if (e.isDirectory()) result.push(...(await existingFiles(file)));
      else result.push(file);
    }
  } catch {}
  return result;
}
async function setup() {
  handle("capabilities", async () =>
    Promise.all(
      capabilities.map(async (c) => ({
        ...c,
        available: await access(engines()[c.engine]).then(
          () => true,
          () => false,
        ),
        reason: await access(engines()[c.engine]).then(
          () => undefined,
          () => "编码器未安装或无法访问",
        ),
      })),
    ),
  );
  handle("assets", allAssets);
  handle("import", async (directory: unknown) => {
    const isDirectory = z.boolean().parse(directory);
    const r = await dialog.showOpenDialog(window, {
      properties: isDirectory
        ? ["openDirectory", "multiSelections"]
        : ["openFile", "multiSelections"],
      filters: isDirectory
        ? undefined
        : [
            {
              name: "图片与纹理",
              extensions: [
                "png",
                "jpg",
                "jpeg",
                "webp",
                "pkm",
                "dds",
                "pvr",
                "ccz",
              ],
            },
          ],
    });
    return r.canceled ? allAssets() : scan(r.filePaths);
  });
  handle("drop", async (paths: unknown) =>
    scan(z.array(z.string().min(1).max(32768)).max(10000).parse(paths)),
  );
  handle("cancel-scan", () => scanController.abort());
  handle("remove", (ids: unknown) => {
    if (queue.running) throw Error("请先取消批处理");
    assets.clear(ids === undefined ? undefined : idsSchema.parse(ids));
    cache.clear();
    return allAssets();
  });
  handle("select-output", async () => {
    const r = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (!r.canceled) outputDirectory = await realpath(r.filePaths[0]);
    return outputDirectory;
  });
  handle("set-key", (value: unknown) => {
    const key = z.string().max(256).parse(value);
    if (!key.trim()) return undefined;
    if (keys.size >= 1024) throw Error("本次会话密钥过多，请重启应用");
    const ref = randomUUID();
    keys.set(ref, normalizeKey(key));
    return ref;
  });
  handle("generate-key", generateKey);
  handle("key-example", (ref: unknown) =>
    cocosKeyExample(keyFor(idSchema.parse(ref))!),
  );
  handle("refresh", async (id: unknown, ref: unknown) =>
    displayAsset(
      await assets.refresh(
        idSchema.parse(id),
        ref === undefined ? undefined : keyFor(idSchema.parse(ref)),
      ),
    ),
  );
  handle("cancel-preview", () => previewController.abort());
  handle("preview", async (id: unknown, raw: unknown, version: unknown) => {
    const assetId = idSchema.parse(id),
      request = validateRequest(raw),
      v = z.number().int().nonnegative().parse(version);
    previewController.abort();
    const controller = new AbortController();
    previewController = controller;
    const asset = await assets.refresh(assetId, keyFor(request.inputKeyRef));
    if (asset.error) throw Error(asset.error);
    const cacheKey = createHash("sha256")
      .update(asset.fingerprint + JSON.stringify(request))
      .digest("hex");
    return cache.request(
      cacheKey,
      v,
      () =>
        scheduler.run(
          async () => {
            let result = await work(asset, request, controller.signal, true);
            if (request.operation === "rewrap")
              result = {
                ...result,
                ...(await work(
                  asset,
                  validateRequest({
                    operation: "decode",
                    container: "png",
                    inputKeyRef: request.inputKeyRef,
                    output: request.output,
                  }),
                  controller.signal,
                  true,
                )),
                encodedBytes: result.encodedBytes,
                finalBytes: result.finalBytes,
                payloadBytes: result.payloadBytes,
              };
            const original = imageUrl(result.originalPath!),
              decoded = imageUrl(result.previewPath!);
            thumbnails.set(asset.id, original);
            return {
              original,
              result: decoded,
              width: result.width,
              height: result.height,
              originalWidth: asset.width,
              originalHeight: asset.height,
              inputBytes: asset.size,
              encodedBytes: result.encodedBytes,
              finalBytes: result.finalBytes,
              payloadBytes: result.payloadBytes,
              bpp:
                request.operation === "encode"
                  ? capability(request.codec!).bpp
                  : asset.codec
                    ? capability(asset.codec).bpp
                    : 0,
              inputLabel:
                asset.container === "image" ? "原图" : "输入纹理解码图",
            };
          },
          controller.signal,
          1,
        ),
      controller.signal,
    );
  });
  handle("plan", async (ids: unknown, raw: unknown): Promise<PlanSummary> => {
    if (queue.running) throw Error("批处理正在运行");
    const request = validateRequest(raw),
      selected = idsSchema.parse(ids);
    if (!selected.length) throw Error("没有可处理的资源");
    const input = await Promise.all(
      selected.map((id) => assets.refresh(id, keyFor(request.inputKeyRef))),
    );
    const dirs = new Set(
      request.output.mode === "directory"
        ? [outputDirectory ?? ""]
        : input.map((a) => path.dirname(a.path)),
    );
    const existing = (
      await Promise.all([...dirs].filter(Boolean).map(existingFiles))
    ).flat();
    const output = planOutputs(input, request, outputDirectory, existing),
      token = randomUUID();
    plans.clear();
    plans.set(token, output);
    return {
      id: token,
      files: output.map((p) => ({
        assetId: p.asset.id,
        name: p.asset.name,
        target: p.target,
        width: p.width,
        height: p.height,
        alphaLoss: p.alphaLoss,
        exists: p.exists,
        error: p.error,
      })),
    };
  });
  handle("start", (token: unknown) => {
    const id = idSchema.parse(token),
      items = plans.get(id);
    if (!items) throw Error("输出计划已失效，请重试");
    if (queue.running) throw Error("批处理正在运行");
    plans.delete(id);
    previewController.abort();
    void queue.start(items);
  });
  handle("cancel", () => queue.cancel());
  handle("retry", () => {
    if (queue.running) throw Error("批处理正在运行");
    previewController.abort();
    void queue.retryFailed();
  });
  handle("reveal", (id: unknown) => {
    const output = queue.jobs.find(
      (j) => j.assetId === idSchema.parse(id) && j.state === "succeeded",
    )?.output;
    if (!output) throw Error("尚无成功输出");
    shell.showItemInFolder(output);
  });
}
app.whenReady().then(async () => {
  sessionDirectory = await mkdtemp(path.join(app.getPath("temp"), "cptool-"));
  protocol.handle("cptool-preview", (request) => {
    const token = new URL(request.url).hostname,
      file = images.get(token);
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#202225",
    title: "CPTool · 纹理工作台",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await setup();
  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  window.on("close", (event) => {
    if (queue.running && !closing) {
      event.preventDefault();
      void dialog
        .showMessageBox(window, {
          type: "question",
          message: "批处理仍在运行",
          detail: "退出会取消未完成任务，已成功输出将保留。",
          buttons: ["继续处理", "取消任务并退出"],
          cancelId: 0,
          defaultId: 0,
        })
        .then(async (r) => {
          if (r.response === 1) {
            closing = true;
            queue.cancel();
            await new Promise<void>((resolve) => {
              const poll = setInterval(() => {
                if (!queue.running) {
                  clearInterval(poll);
                  resolve();
                }
              }, 50);
            });
            window.close();
          }
        });
    }
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  previewController.abort();
  scanController.abort();
  queue.cancel();
  keys.clear();
  images.clear();
  void Promise.allSettled([queue.waitForIdle(), ...activeWork])
    .then(async () => {
      if (sessionDirectory)
        await rm(sessionDirectory, { recursive: true, force: true });
    })
    .finally(() => app.exit(0));
});

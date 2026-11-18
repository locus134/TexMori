import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  writeFile,
  cp,
  rename,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import sharp from "sharp";
import { AssetService } from "../../../packages/engine/src/assets";
import { JobQueue, WorkScheduler } from "../../../packages/engine/src/queue";
import { PreviewCache } from "../../../packages/engine/src/preview";
import {
  Preferences,
  normalizeOutputDirectory,
} from "../../../packages/engine/src/preferences";
import { writeEncodingMetadata } from "../../../packages/engine/src/metadata";
import { TinifyKeys } from "../../../packages/engine/src/tinify-keys";
import {
  TinifyPool,
  TinifyError,
  compressTinify,
} from "../../../packages/engine/src/tinify";
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
    scheme: "texmori-preview",
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
let finderRegistration: Promise<void> = Promise.resolve();
let preferences: Preferences;
let tinifyKeys: TinifyKeys;
let tinifyPool: TinifyPool | undefined;
let tinifyLoadError: string | undefined;
let tinifyStorageNotice: string | undefined;
let keyUpdate: Promise<unknown> = Promise.resolve();
let outputUpdate: Promise<string | undefined> = Promise.resolve(undefined);
function updateOutputDirectory(value: string) {
  outputUpdate = outputUpdate
    .catch(() => undefined)
    .then(async () => {
      const normalized = await normalizeOutputDirectory(value);
      await preferences.update({ outputDirectory: normalized });
      outputDirectory = normalized;
      plans.clear();
      return normalized;
    });
  return outputUpdate;
}
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
  return `texmori-preview://${token}/image`;
}
function displayAsset(asset: Asset): DesktopAsset {
  if (
    asset.container === "image" &&
    !asset.localError &&
    !thumbnails.has(asset.id)
  )
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
  if (asset.localError) throw Error(asset.localError);
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
      { stdio: "pipe", serviceName: "TexMori 纹理工作进程" },
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
    if (current.error) throw Error(current.error);
    if (plan.request.operation === "tinify") {
      if (!tinifyPool) throw Error("请先添加 TinyPNG API Key");
      const directory = await mkdtemp(path.join(sessionDirectory, "tinify-"));
      try {
        return await tinifyPool.run(signal, async (key) => {
          try {
            const result = await compressTinify(
              current.path,
              directory,
              plan.request.tinify!,
              key,
              signal,
              (count) => tinifyKeys.update(key, { count, error: undefined }),
            );
            return {
              ...result,
              target: plan.target.endsWith(".auto")
                ? plan.target.slice(0, -5) + "." + result.extension
                : plan.target,
            };
          } catch (e) {
            if (e instanceof TinifyError)
              tinifyKeys.update(key, { error: e.message });
            throw e;
          }
        });
      } catch (e) {
        await rm(directory, { recursive: true, force: true });
        throw e;
      }
    }
    return scheduler.run(
      async () => (await work(current, plan.request, signal)).path,
      signal,
    );
  },
  scheduler,
  async (file) => {
    const directory = path.dirname(file);
    if (path.dirname(directory) === sessionDirectory)
      await rm(directory, { recursive: true, force: true });
  },
  async (plan, file, signal) => {
    if (plan.request.container === "png" || plan.request.operation === "tinify")
      return undefined;
    const codec =
      plan.request.operation === "encode"
        ? plan.request.codec
        : plan.asset.codec;
    return codec
      ? writeEncodingMetadata(file, codec, plan.request.container, signal)
      : "未能确定编码格式，未写入备注";
  },
  { concurrency: () => tinifyPool?.size ?? 1 },
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
  if (paths[0]) {
    const info = await stat(paths[0]).catch(() => undefined);
    if (info)
      await preferences.update({
        importDirectory: info.isDirectory()
          ? await realpath(paths[0])
          : path.dirname(await realpath(paths[0])),
      });
  }
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
      if (e.name.startsWith(".texmori-")) continue;
      const file = path.join(directory, e.name);
      if (e.isDirectory()) result.push(...(await existingFiles(file)));
      else result.push(file);
    }
  } catch {}
  return result;
}
async function setup() {
  handle("tinify-result", async (id: unknown) => {
    const asset = assets.get(idSchema.parse(id));
    const job = queue.jobs.find(
      (j) => j.assetId === asset.id && j.state === "succeeded",
    );
    if (
      !job?.output ||
      asset.localError ||
      /\.(jxl|heic|heif)$/i.test(job.output)
    )
      return undefined;
    const size = (await stat(job.output)).size;
    const metadata = await sharp(job.output)
      .metadata()
      .catch(() => undefined);
    if (!metadata?.width || !metadata.height) return undefined;
    return {
      version: 0,
      original: imageUrl(asset.path),
      result: imageUrl(job.output),
      width: metadata.width,
      height: metadata.height,
      originalWidth: asset.width,
      originalHeight: asset.height,
      inputBytes: job.inputBytes ?? asset.size,
      encodedBytes: size,
      finalBytes: size,
      payloadBytes: size,
      bpp: 0,
      inputLabel: "原图",
    };
  });
  handle("tinify-keys", () => ({
    keys: tinifyKeys.status(),
    storageError: tinifyLoadError,
    storageNotice: tinifyStorageNotice,
  }));
  const mutateKey = (action: () => Promise<void>) => {
    if (queue.running) throw Error("处理期间不能修改 API Key");
    const pending = keyUpdate
      .catch(() => {})
      .then(async () => {
        if (queue.running) throw Error("处理期间不能修改 API Key");
        if (tinifyLoadError) throw Error(tinifyLoadError);
        await action();
        plans.clear();
        return tinifyKeys.status();
      });
    keyUpdate = pending;
    return pending;
  };
  handle("tinify-add-key", (value: unknown) =>
    mutateKey(() => tinifyKeys.add(z.string().max(256).parse(value))),
  );
  handle("tinify-remove-key", (id: unknown) =>
    mutateKey(() => tinifyKeys.remove(idSchema.parse(id))),
  );
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
      defaultPath:
        preferences.paths().importDirectory ?? app.getPath("pictures"),
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
                "avif",
                "jxl",
                "heic",
                "heif",
                "astc",
                "ktx",
                "ktx2",
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
    await outputUpdate;
    const r = await dialog.showOpenDialog(window, {
      defaultPath:
        preferences.paths().outputDirectory ?? app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!r.canceled) await updateOutputDirectory(r.filePaths[0]);
    return outputDirectory;
  });
  handle("paths", () => preferences.paths());
  handle("set-output", (value: unknown) =>
    updateOutputDirectory(z.string().max(32768).parse(value)),
  );
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
    if (request.operation === "tinify")
      throw Error("TinyPNG 请开始批处理，自动预览不会上传图片");
    previewController.abort();
    const controller = new AbortController();
    previewController = controller;
    const asset = await assets.refresh(assetId, keyFor(request.inputKeyRef));
    if (asset.error || asset.localError)
      throw Error(asset.error ?? asset.localError);
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
              originalOffset: result.originalOffset,
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
    if (request.operation === "tinify") {
      await keyUpdate;
      if (!tinifyKeys.secrets().length) throw Error("请先添加 TinyPNG API Key");
    }
    if (request.output.mode === "directory") await outputUpdate;
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
  handle("start", async (token: unknown) => {
    await keyUpdate;
    const id = idSchema.parse(token),
      items = plans.get(id);
    if (!items) throw Error("输出计划已失效，请重试");
    if (queue.running) throw Error("批处理正在运行");
    plans.delete(id);
    previewController.abort();
    tinifyKeys.resetErrors();
    tinifyPool =
      items[0]?.request.operation === "tinify"
        ? new TinifyPool(tinifyKeys.secrets())
        : undefined;
    void queue.start(items);
  });
  handle("cancel", () => queue.cancel());
  handle("retry", async () => {
    await keyUpdate;
    if (queue.running) throw Error("批处理正在运行");
    previewController.abort();
    if (tinifyPool) {
      tinifyKeys.resetErrors();
      tinifyPool = new TinifyPool(tinifyKeys.secrets());
    }
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
  if (process.platform === "darwin" && app.isPackaged) {
    const bundle = path.dirname(path.dirname(process.resourcesPath));
    const marker = path.join(app.getPath("userData"), "finder-registration.json");
    const registration = JSON.stringify({ bundle, version: app.getVersion() });
    // Reimport only after installation, relocation or an app update.
    finderRegistration = (async () => {
      if (await readFile(marker, "utf8").catch(() => "") === registration &&
          await access(path.join(app.getPath("home"), "Library/Spotlight/TexMoriTexture.mdimporter")).then(() => true, () => false)) return;
      const run = promisify(execFile);
      await run(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        ["-f", bundle], { timeout: 15000 },
      );
      const spotlight = path.join(app.getPath("home"), "Library/Spotlight");
      const importer = path.join(spotlight, "TexMoriTexture.mdimporter");
      const staging = path.join(spotlight, ".texmori-importer-" + randomUUID());
      await mkdir(spotlight, { recursive: true });
      const backup = staging + ".backup";
      let saved = false;
      try {
        await cp(path.join(bundle, "Contents/Library/Spotlight/TexMoriTexture.mdimporter"), staging, { recursive: true });
        try { await rename(importer, backup); saved = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        try { await rename(staging, importer); }
        catch (error) { if (saved) { await rename(backup, importer); saved = false; } throw error; }
        if (saved) { await rm(backup, { recursive: true, force: true }); saved = false; }
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      await run("/usr/bin/mdimport", ["-r", importer], { timeout: 15000 });
      await mkdir(path.dirname(marker), { recursive: true });
      await writeFile(marker, registration);
    })().catch(() => {});
  }
  preferences = new Preferences(
    path.join(app.getPath("userData"), "preferences.json"),
  );
  await preferences.load();
  const localKeysFile = path.join(app.getPath("userData"), "tinify-keys-local.json");
  if (!(await access(localKeysFile).then(() => true, () => false)) &&
      await access(path.join(app.getPath("userData"), "tinify-keys.json")).then(() => true, () => false))
    tinifyStorageNotice = "旧版 Key 使用系统加密保存，请重新添加一次；旧记录已保留，不会访问钥匙串。";
  tinifyKeys = new TinifyKeys(localKeysFile);
  await tinifyKeys.load().catch((e) => {
    tinifyLoadError = e.message;
  });
  outputDirectory = preferences.paths().outputDirectory;
  sessionDirectory = await mkdtemp(path.join(app.getPath("temp"), "texmori-"));
  protocol.handle("texmori-preview", (request) => {
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
    title: "TexMori · 纹理工作台",
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
  void Promise.allSettled([
    finderRegistration,
    queue.waitForIdle(),
    outputUpdate,
    preferences?.flush(),
    keyUpdate,
    tinifyKeys?.flush(),
    ...activeWork,
  ])
    .then(async () => {
      if (sessionDirectory)
        await rm(sessionDirectory, { recursive: true, force: true });
    })
    .finally(() => app.exit(0));
});

import path from "node:path";
import { capability, targetDimensions } from "./capabilities";
import { validateRequest } from "./validation";
import type { Asset, ConversionRequest, PlannedOutput } from "./types";
import { sourceImageFormat, tinifyExtension } from "./tinify";
export function pathKey(file: string) {
  return path.resolve(file).normalize("NFC").toLocaleLowerCase("en-US");
}
export function planOutputs(
  assets: Asset[],
  raw: ConversionRequest,
  directory?: string,
  existing: string[] = [],
): PlannedOutput[] {
  const request = validateRequest(raw);
  if (request.output.mode === "directory" && !directory)
    throw Error("请先选择输出目录");
  if (request.operation === "tinify")
    return planTinify(assets, request, directory, existing);
  const inputPaths = new Map(assets.map((a) => [pathKey(a.path), a.id]));
  const reserved = new Set(existing.map(pathKey));
  const plans: PlannedOutput[] = [];
  for (const asset of assets) {
    const root =
      request.output.mode === "source" ? path.dirname(asset.path) : directory!;
    const relative =
      request.output.mode === "source"
        ? path.basename(asset.path)
        : asset.relativePath;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
      throw Error("输入相对路径无效");
    const suffix =
      request.container === "ccz" ? ".pvr.ccz" : "." + request.container;
    const base = relative.replace(/(?:\.pvr\.ccz|\.[^.]+)$/i, "");
    let target = path.resolve(root, base + suffix),
      key = pathKey(target),
      counter = 2;
    const originalTarget = target;
    if (request.output.conflict === "rename")
      while (reserved.has(key) || inputPaths.has(key)) {
        target = path.resolve(root, base + ` (${counter++})` + suffix);
        key = pathKey(target);
      }
    let width = asset.width,
      height = asset.height,
      error = asset.error ?? asset.localError;
    if (request.operation === "encode") {
      try {
        ({ width, height } = targetDimensions(
          width,
          height,
          request.codec!,
          request.sizeMode,
        ));
      } catch (e) {
        error = (e as Error).message;
      }
    }
    if (
      request.operation === "rewrap" &&
      !["pvr", "ccz"].includes(asset.container)
    )
      error = "只换容器需要 PVR 或 PVR.CCZ 输入";
    if (inputPaths.has(key) && inputPaths.get(key) !== asset.id)
      error = "输出会替换其他输入文件";
    const plan: PlannedOutput = {
      asset,
      request: structuredClone(request),
      target,
      width,
      height,
      alphaLoss:
        request.operation === "encode" &&
        asset.alpha &&
        !capability(request.codec!).channels.includes("A"),
      error,
      exists: existing.some((f) => pathKey(f) === pathKey(originalTarget)),
    };
    const previous = plans.find((p) => pathKey(p.target) === key);
    if (previous) {
      previous.error = plan.error =
        "多个输入映射到相同输出，请选择自动重命名或调整目录";
    }
    reserved.add(key);
    plans.push(plan);
  }
  return plans;
}
function planTinify(
  assets: Asset[],
  request: ConversionRequest,
  directory: string | undefined,
  existing: string[],
): PlannedOutput[] {
  const reserved = new Set(existing.map(pathKey));
  const inputs = new Set(assets.map((a) => pathKey(a.path)));
  const plans: PlannedOutput[] = [];
  const owners = new Map<string, PlannedOutput>();
  for (const asset of assets) {
    const source = sourceImageFormat(asset.path);
    const formats = request.tinify!.formats.length
      ? request.tinify!.formats
      : [source === "heic" ? "jpeg" : (source ?? "png")];
    const extensions = formats.map(tinifyExtension);
    const root =
      request.output.mode === "source" ? path.dirname(asset.path) : directory!;
    const relative =
      request.output.mode === "source"
        ? path.basename(asset.path)
        : asset.relativePath;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
      throw Error("输入相对路径无效");
    const base = relative.replace(/\.[^.]+$/, "") + ".tiny";
    let stem = base,
      n = 2;
    const targets = () =>
      extensions.map((ext) => path.resolve(root, stem + "." + ext));
    if (request.output.conflict === "rename")
      while (
        targets().some(
          (t) => reserved.has(pathKey(t)) || inputs.has(pathKey(t)),
        )
      )
        stem = base + ` (${n++})`;
    const candidates = targets();
    let error = asset.error;
    if (!source || asset.container !== "image")
      error = "TinyPNG 需要 PNG/JPEG/WebP/AVIF/JXL/HEIC 图片输入";
    if (candidates.some((t) => inputs.has(pathKey(t))))
      error = "输出会替换输入文件，请选择自动重命名";
    const plan: PlannedOutput = {
      asset,
      request: structuredClone(request),
      target: path.resolve(
        root,
        stem + "." + (extensions.length === 1 ? extensions[0] : "auto"),
      ),
      width: request.tinify?.resize?.width ?? asset.width,
      height: request.tinify?.resize?.height ?? asset.height,
      alphaLoss: asset.alpha && formats.includes("jpeg"),
      error,
      exists: candidates.some((t) => reserved.has(pathKey(t))),
    };
    for (const t of candidates) {
      const key = pathKey(t),
        previous = owners.get(key);
      if (previous)
        previous.error = plan.error =
          "多个输入映射到相同输出，请选择自动重命名";
      reserved.add(key);
      owners.set(key, plan);
    }
    plans.push(plan);
  }
  return plans;
}

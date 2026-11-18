import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  capability,
  defaultQuality,
  targetDimensions,
  validateRequest,
  type Asset,
  type ConversionRequest,
} from "../../core/src/index";
import {
  inspectTexture,
  makePvr,
  levelBytes,
  writePkm,
  wrapCcz,
  unwrapCcz,
} from "../../containers/src/index";
import { extendedToPvr, writeBc7Ktx } from "../../containers/src/extended";
import { runProcess } from "./process-runner";
export interface EnginePaths {
  etcpak: string;
  pvrtc: string;
}
export interface ConversionResult {
  path: string;
  originalPath?: string;
  previewPath?: string;
  originalOffset?: { left: number; top: number };
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  encodedBytes: number;
  finalBytes: number;
  payloadBytes: number;
}
const pvrFormats: Record<string, string> = {
  pvrtc1_rgb_2: "PVRTCI_2BPP_RGB",
  pvrtc1_rgba_2: "PVRTCI_2BPP_RGBA",
  pvrtc1_rgb_4: "PVRTCI_4BPP_RGB",
  pvrtc1_rgba_4: "PVRTCI_4BPP_RGBA",
  pvrtc2_2: "PVRTCII_2BPP",
  pvrtc2_4: "PVRTCII_4BPP",
};
export class ConversionService {
  constructor(private engines: EnginePaths) {}
  private async decode(
    bytes: Buffer,
    directory: string,
    signal: AbortSignal,
  ): Promise<string> {
    const initial = inspectTexture(bytes);
    if (initial.container === "dds" && initial.codec.startsWith("pvrtc")) {
      const pvr = makePvr(initial.codec, initial.width, initial.height, bytes.subarray(initial.dataOffset), initial.colorSpace);
      pvr.writeUInt32LE(initial.mipmaps, 44);
      pvr.writeUInt32LE(initial.premultiplied ? 2 : 0, 4);
      return this.decode(pvr, directory, signal);
    }
    if (["astc", "ktx", "ktx2"].includes(initial.container)) {
      return this.decode(extendedToPvr(bytes), directory, signal);
    }
    const info = inspectTexture(bytes),
      input = path.join(directory, "decode-input.pvr"),
      output = path.join(directory, "decoded.png");
    const pvrtc = capability(info.codec).engine === "pvrtc";
    let ew = info.encodedWidth,
      eh = info.encodedHeight;
    if (pvrtc) {
      await writeFile(input, bytes);
      const decoded = path.join(directory, "decoded-rgba.pvr");
      await runProcess(
        this.engines.pvrtc,
        [
          "-i",
          input,
          "-o",
          decoded,
          "-f",
          `r8g8b8a8,UBN,${info.colorSpace === "srgb" ? "sRGB" : "lRGB"}`,
        ],
        signal,
      );
      const raw = await readFile(decoded),
        offset = 52 + raw.readUInt32LE(48);
      ew = raw.readUInt32LE(28);
      eh = raw.readUInt32LE(24);
      if (
        raw.length < offset + ew * eh * 4 ||
        ew !== info.width ||
        eh !== info.height
      )
        throw Error("解码器返回了无效的 RGBA 工作图");
      await sharp(raw.subarray(offset, offset + ew * eh * 4), {
        raw: { width: ew, height: eh, channels: 4 },
      })
        .png()
        .toFile(output);
    } else {
      // CPU decoder operates on full 4×4 blocks. Rewrap only the base level
      // at padded dimensions, then crop to the container's logical dimensions.
      ew = Math.ceil(info.width / 4) * 4;
      eh = Math.ceil(info.height / 4) * 4;
      await writeFile(
        input,
        makePvr(
          info.codec,
          ew,
          eh,
          bytes.subarray(
            info.dataOffset,
            info.dataOffset + levelBytes(info.codec, ew, eh),
          ),
          info.colorSpace,
        ),
      );
      await runProcess(this.engines.etcpak, ["-v", input, output], signal);
    }
    if (info.premultiplied) {
      const { data, info: rawInfo } = await sharp(output)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const fromSrgb = (v: number) =>
        v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const toSrgb = (v: number) =>
        v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      for (let i = 0; i < data.length; i += 4)
        for (let channel = 0; channel < 3; channel++) {
          const alpha = data[i + 3] / 255,
            value = data[i + channel] / 255;
          const straight =
            alpha === 0
              ? 0
              : Math.min(
                  1,
                  (info.colorSpace === "srgb" ? fromSrgb(value) : value) /
                    alpha,
                );
          data[i + channel] = Math.round(
            255 * (info.colorSpace === "srgb" ? toSrgb(straight) : straight),
          );
        }
      await writeFile(
        output,
        await sharp(data, {
          raw: { width: rawInfo.width, height: rawInfo.height, channels: 4 },
        })
          .png()
          .toBuffer(),
      );
    }
    if (info.width !== ew || info.height !== eh) {
      const cropped = await sharp(output)
        .extract({ left: 0, top: 0, width: info.width, height: info.height })
        .png()
        .toBuffer();
      await writeFile(output, cropped);
    }
    return output;
  }
  async run(
    asset: Asset,
    raw: ConversionRequest,
    directory: string,
    signal: AbortSignal,
    keys: { input?: string; output?: string } = {},
    preview = false,
  ): Promise<ConversionResult> {
    const request = validateRequest(raw);
    signal.throwIfAborted();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let bytes: Buffer = await readFile(asset.path);
    signal.throwIfAborted();
    if (bytes.length > 256 * 1024 * 1024) throw Error("输入文件超过 256 MiB");
    if (["CCZ!", "CCZp"].includes(bytes.subarray(0, 4).toString()))
      bytes = unwrapCcz(bytes, keys.input);
    if (request.operation === "rewrap") {
      const info = inspectTexture(bytes);
      if (info.container !== "pvr") throw Error("只换容器需要 PVR 输入");
      const output =
        request.container === "ccz"
          ? wrapCcz(
              bytes,
              request.cczLevel,
              request.encrypt ? keys.output : undefined,
            )
          : bytes;
      const file = path.join(
        directory,
        "result." + (request.container === "ccz" ? "pvr.ccz" : "pvr"),
      );
      await writeFile(file, output);
      return {
        path: file,
        width: info.width,
        height: info.height,
        encodedWidth: info.encodedWidth,
        encodedHeight: info.encodedHeight,
        encodedBytes: bytes.length,
        finalBytes: output.length,
        payloadBytes: info.payloadBytes,
      };
    }
    let originalPath: string;
    if (asset.container === "image") {
      originalPath = path.join(directory, "original.png");
      // Fixed policy: normalize profiled color images to sRGB; Linear means numeric
      // channel interpretation after normalization, including mip filtering.
      await sharp(bytes, { limitInputPixels: 16384 * 16384 })
        .rotate()
        .toColourspace("srgb")
        .ensureAlpha()
        .png()
        .toFile(originalPath);
    } else originalPath = await this.decode(bytes, directory, signal);
    signal.throwIfAborted();
    const metadata = await sharp(originalPath).metadata(),
      ow = metadata.width!,
      oh = metadata.height!;
    if (request.operation === "decode") {
      return {
        path: originalPath,
        originalPath,
        previewPath: originalPath,
        width: ow,
        height: oh,
        encodedWidth: ow,
        encodedHeight: oh,
        encodedBytes: bytes.length,
        finalBytes: (await stat(originalPath)).size,
        payloadBytes: inspectTexture(bytes).payloadBytes,
      };
    }
    const c = capability(request.codec!),
      dimensions = targetDimensions(ow, oh, c.id, request.sizeMode);
    let image = sharp(originalPath);
    if (request.options.multiplyRgbByAlpha) {
      const { data, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        for (let channel = 0; channel < 3; channel++)
          data[i + channel] = Math.round((data[i + channel] * alpha) / 255);
      }
      image = sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      });
    }
    const anchor = request.padAnchor ?? "center";
    const extraWidth = dimensions.width - ow, extraHeight = dimensions.height - oh;
    const left = request.sizeMode !== "pad-pot" || anchor.includes("left") ? 0
      : anchor.includes("right") ? extraWidth : Math.floor(extraWidth / 2);
    const top = request.sizeMode !== "pad-pot" || anchor.startsWith("top") ? 0
      : anchor.startsWith("bottom") ? extraHeight : Math.floor(extraHeight / 2);
    if (dimensions.width !== ow || dimensions.height !== oh) {
      if (request.sizeMode === "pad" || request.sizeMode === "pad-pot")
        image = image.extend({
          top,
          left,
          right: extraWidth - left,
          bottom: extraHeight - top,
          ...(request.sizeMode === "pad-pot"
            ? { background: { r: 0, g: 0, b: 0, alpha: 0 } }
            : { extendWith: "copy" as const }),
        });
      else
        image = image.resize(dimensions.width, dimensions.height, {
          fit: "fill",
          kernel: "lanczos3",
        });
    }
    const work = path.join(directory, "work.png");
    await image.png().toFile(work);
    let native = path.join(
      directory,
      "encoded." + (c.id.startsWith("bc") ? "dds" : "pvr"),
    );
    if (c.engine === "etcpak") {
      const args = [
        "-c",
        c.id,
        "-h",
        c.id.startsWith("bc") ? "dds" : "pvr",
      ];
      if (request.options.dither) args.push("-d");
      if (request.options.mipmaps) args.push("-m");
      if (request.options.heuristics === false)
        args.push("--disable-heuristics");
      if (request.colorSpace === "linear") args.push("--linear");
      args.push(work, native);
      await runProcess(this.engines.etcpak, args, signal);
    } else {
      const args = [
        "-i",
        work,
        "-o",
        native,
        "-ics",
        request.colorSpace === "srgb" ? "sRGB" : "lRGB",
        "-f",
        `${c.id.startsWith("astc_") ? c.id.toUpperCase() : pvrFormats[c.id]},UBN,${request.colorSpace === "srgb" ? "sRGB" : "lRGB"}`,
        "-q",
        request.options.quality ?? defaultQuality(c.id),
      ];
      if (request.options.mipmaps) args.push("-m");
      if (request.options.mipFilter)
        args.push("-mfilter", request.options.mipFilter);
      if (request.options.premultiply) args.push("-p");
      await runProcess(this.engines.pvrtc, args, signal);
    }
    signal.throwIfAborted();
    if (c.id.startsWith("bc") && request.container !== "dds") {
      const normalized = path.join(directory, "encoded.pvr");
      const source = await readFile(native);
      const texture = inspectTexture(source);
      const pvr = makePvr(c.id, texture.width, texture.height, source.subarray(texture.dataOffset), texture.colorSpace);
      pvr.writeUInt32LE(texture.mipmaps, 44);
      pvr.writeUInt32LE(texture.premultiplied ? 2 : 0, 4);
      await writeFile(normalized, pvr);
      native = normalized;
    }
    const nativeBytes = await readFile(native),
      info = inspectTexture(nativeBytes);
    let final: Buffer = nativeBytes;
    if (request.container === "pkm") {
      const logical =
        request.sizeMode === "pad" ? { width: ow, height: oh } : dimensions;
      final = writePkm(
        c.id,
        logical.width,
        logical.height,
        dimensions.width,
        dimensions.height,
        nativeBytes.subarray(info.dataOffset),
      );
    } else if (request.container === "ccz")
      final = wrapCcz(
        nativeBytes,
        request.cczLevel,
        request.encrypt ? keys.output : undefined,
      );
    const file = path.join(
      directory,
      "result." + (request.container === "ccz" ? "pvr.ccz" : request.container),
    );
    if (["astc", "ktx", "ktx2"].includes(request.container) || (request.container === "dds" && c.engine === "pvrtc")) {
      if (c.id === "bc7" && ["ktx", "ktx2"].includes(request.container)) {
        await writeFile(file, writeBc7Ktx(nativeBytes, request.container === "ktx2"));
      } else await runProcess(this.engines.pvrtc, ["-i", native, "-o", file], signal);
      final = await readFile(file);
      inspectTexture(final);
    } else await writeFile(file, final);
    let previewPath: string | undefined;
    if (preview) {
      const previewDirectory = path.join(directory, "preview");
      await mkdir(previewDirectory, { mode: 0o700 });
      previewPath = await this.decode(
        request.container === "pkm" ? final : nativeBytes,
        previewDirectory,
        signal,
      );
    }
    const resultInfo =
      request.container === "pkm" ? inspectTexture(final) : info;
    return {
      path: file,
      originalPath,
      previewPath,
      originalOffset: request.sizeMode === "pad-pot" ? { left, top } : undefined,
      width: resultInfo.width,
      height: resultInfo.height,
      encodedWidth: dimensions.width,
      encodedHeight: dimensions.height,
      encodedBytes: nativeBytes.length,
      finalBytes: final.length,
      payloadBytes: info.payloadBytes,
    };
  }
}

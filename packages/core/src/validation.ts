import { z } from "zod";
import { capability, codecQualities } from "./capabilities";
import type { ConversionRequest } from "./types";
import { tinifySchema } from "./tinify";
const schema = z
  .object({
    operation: z.enum(["encode", "decode", "rewrap", "tinify"]),
    tinify: tinifySchema.optional(),
    codec: z.string().optional(),
    container: z.enum(["png", "pkm", "dds", "pvr", "ccz", "astc", "ktx", "ktx2"]),
    options: z
      .object({
        multiplyRgbByAlpha: z.boolean().optional(),
        dither: z.boolean().optional(),
        heuristics: z.boolean().optional(),
        mipmaps: z.boolean().optional(),
        quality: z.string().optional(),
        mipFilter: z.enum(["nearest", "linear", "cubic"]).optional(),
        premultiply: z.boolean().optional(),
      })
      .strict()
      .default({}),
    sizeMode: z.enum(["keep", "pad", "pad-pot", "resize"]).default("keep"),
    padAnchor: z.enum(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]).default("center"),
    colorSpace: z.enum(["srgb", "linear"]).default("srgb"),
    cczLevel: z.number().int().min(0).max(9).default(6),
    encrypt: z.boolean().default(false),
    inputKeyRef: z.string().max(100).optional(),
    outputKeyRef: z.string().max(100).optional(),
    output: z
      .object({
        mode: z.enum(["source", "directory"]),
        conflict: z.enum(["skip", "overwrite", "rename"]),
      })
      .strict(),
  })
  .strict();
export function validateRequest(value: unknown): ConversionRequest {
  const r = schema.parse(value);
  const active = Object.keys(r.options);
  if (r.operation === "tinify") {
    if (
      r.codec ||
      active.length ||
      r.encrypt ||
      r.inputKeyRef ||
      r.outputKeyRef ||
      r.container !== "png" ||
      r.sizeMode !== "keep"
    )
      throw Error("TinyPNG 压缩不能包含本地编码、加密或纹理参数");
    r.tinify ??= tinifySchema.parse({});
    return r as ConversionRequest;
  }
  if (r.tinify) throw Error("当前操作不支持 TinyPNG 参数");
  if (r.operation === "encode") {
    const c = capability(r.codec ?? "");
    if (!c.containers.includes(r.container)) throw Error("编码与容器不匹配");
    if (c.available === false) throw Error(c.reason ?? "编码器不可用");
    const allowed = ["mipmaps", "multiplyRgbByAlpha"];
    if (["etc1", "bc1"].includes(c.id)) allowed.push("dither");
    if (["etc2_rgb", "etc2_rgba"].includes(c.id)) allowed.push("heuristics");
    if (c.engine === "pvrtc")
      allowed.push("quality", "mipFilter", "premultiply");
    if (active.some((k) => !allowed.includes(k)))
      throw Error("包含当前编码不支持的参数");
    if (["pkm", "astc"].includes(r.container) && r.options.mipmaps)
      throw Error("当前容器不支持 Mipmap");
    if (["astc", "ktx", "ktx2"].includes(r.container) && r.options.premultiply)
      throw Error("当前容器不保存预乘 Alpha 标记，请使用 PVR / DDS");
    if (r.options.quality && !codecQualities(c.id).includes(r.options.quality))
      throw Error("不支持的质量档位");
    if (r.options.mipFilter && !r.options.mipmaps)
      throw Error("Mipmap 滤镜需要先启用 Mipmap");
    if (r.options.premultiply && !c.channels.includes("A"))
      throw Error("当前编码不保留 Alpha");
    if (r.options.multiplyRgbByAlpha && r.options.premultiply)
      throw Error("RGB 乘以 Alpha 与编码器预乘不能同时启用，避免重复相乘");
  } else {
    if (r.codec || active.length) throw Error("解码和容器转换不能包含编码参数");
    if (r.operation === "decode" && r.container !== "png")
      throw Error("解码输出必须为 PNG");
    if (r.operation === "rewrap" && !["pvr", "ccz"].includes(r.container))
      throw Error("只换容器仅支持 PVR 与 CCZ");
  }
  if (r.encrypt && (r.container !== "ccz" || !r.outputKeyRef))
    throw Error("加密输出需要 CCZ 容器和加密密钥");
  if (r.container !== "ccz" && (r.encrypt || r.outputKeyRef))
    throw Error("非 CCZ 输出不能设置加密参数");
  return r as ConversionRequest;
}

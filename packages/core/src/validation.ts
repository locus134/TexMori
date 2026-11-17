import { z } from "zod";
import { capability, qualities } from "./capabilities";
import type { ConversionRequest } from "./types";
const schema = z
  .object({
    operation: z.enum(["encode", "decode", "rewrap"]),
    codec: z.string().optional(),
    container: z.enum(["png", "pkm", "dds", "pvr", "ccz"]),
    options: z
      .object({
        dither: z.boolean().optional(),
        heuristics: z.boolean().optional(),
        mipmaps: z.boolean().optional(),
        quality: z.string().optional(),
        mipFilter: z.enum(["nearest", "linear", "cubic"]).optional(),
        premultiply: z.boolean().optional(),
      })
      .strict()
      .default({}),
    sizeMode: z.enum(["keep", "pad", "resize"]).default("keep"),
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
  if (r.operation === "encode") {
    const c = capability(r.codec ?? "");
    if (!c.containers.includes(r.container)) throw Error("编码与容器不匹配");
    if (c.available === false) throw Error(c.reason ?? "编码器不可用");
    const allowed = ["mipmaps"];
    if (["etc1", "bc1"].includes(c.id)) allowed.push("dither");
    if (["etc2_rgb", "etc2_rgba"].includes(c.id)) allowed.push("heuristics");
    if (c.engine === "pvrtc")
      allowed.push("quality", "mipFilter", "premultiply");
    if (active.some((k) => !allowed.includes(k)))
      throw Error("包含当前编码不支持的参数");
    if (r.container === "pkm" && r.options.mipmaps)
      throw Error("PKM 不支持 Mipmap");
    if (r.options.quality && !qualities.includes(r.options.quality))
      throw Error("不支持的质量档位");
    if (r.options.mipFilter && !r.options.mipmaps)
      throw Error("Mipmap 滤镜需要先启用 Mipmap");
    if (r.options.premultiply && !c.channels.includes("A"))
      throw Error("当前编码不保留 Alpha");
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

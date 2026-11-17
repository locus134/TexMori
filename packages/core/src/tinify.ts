import { z } from "zod";
import { tinifyFormats, type TinifyFormat } from "./tinify-formats";
export { tinifyFormats, type TinifyFormat } from "./tinify-formats";
export const tinifySchema = z
  .object({
    formats: z
      .array(z.enum(tinifyFormats))
      .max(5)
      .default([])
      .transform((v) => [...new Set(v)]),
    resize: z
      .object({
        method: z.enum(["scale", "fit", "cover", "thumb"]),
        width: z.number().int().min(1).max(150000).optional(),
        height: z.number().int().min(1).max(150000).optional(),
      })
      .strict()
      .optional(),
    background: z
      .string()
      .regex(/^#[\da-fA-F]{6}$/)
      .optional(),
    preserve: z
      .array(z.enum(["copyright", "creation", "location"]))
      .max(3)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.formats.includes("jpeg") && !v.background)
      ctx.addIssue({
        code: "custom",
        message: "转换为 JPEG 请选择透明背景填充颜色",
      });
    if (v.resize) {
      const { method, width, height } = v.resize;
      if (method === "scale" ? !!width === !!height : !width || !height)
        ctx.addIssue({
          code: "custom",
          message: "等比缩放需填写宽或高之一，其他方式需同时填写宽和高",
        });
      if (width && height && width * height > 256000000)
        ctx.addIssue({ code: "custom", message: "目标尺寸超过 256 百万像素" });
    }
  });
export type TinifyOptions = z.infer<typeof tinifySchema>;
export const tinifyExtension = (format: string) =>
  format === "jpeg" ? "jpg" : format;
export function sourceImageFormat(
  file: string,
): TinifyFormat | "heic" | undefined {
  const ext = file.toLowerCase().split(".").pop();
  if (ext === "jpg") return "jpeg";
  if (ext === "heic" || ext === "heif") return "heic";
  return tinifyFormats.find((f) => f === ext);
}

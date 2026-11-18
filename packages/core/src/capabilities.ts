import type { CodecCapability, CodecId } from "./types";
const astcBlocks = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]] as const;
export const capabilities: CodecCapability[] = [
  ...astcBlocks.map(([width, height], index): CodecCapability => ({
    id: `astc_${width}x${height}` as CodecId,
    label: `ASTC ${width}×${height} RGBA`,
    engine: "pvrtc",
    channels: "RGBA",
    bpp: 128 / (width * height),
    blockWidth: width,
    blockHeight: height,
    containers: ["pvr", "ccz"],
    pvrFormat: 27 + index,
  })),
  {
    id: "etc1",
    label: "ETC1 RGB",
    engine: "etcpak",
    channels: "RGB",
    bpp: 4,
    containers: ["pkm"],
    pvrFormat: 6,
    pkmFormat: 0,
  },
  {
    id: "etc2_r",
    label: "EAC R11",
    engine: "etcpak",
    channels: "R",
    bpp: 4,
    containers: ["pkm"],
    pvrFormat: 25,
    pkmFormat: 4,
  },
  {
    id: "etc2_rg",
    label: "EAC RG11",
    engine: "etcpak",
    channels: "RG",
    bpp: 8,
    containers: ["pkm"],
    pvrFormat: 26,
    pkmFormat: 5,
  },
  {
    id: "etc2_rgb",
    label: "ETC2 RGB",
    engine: "etcpak",
    channels: "RGB",
    bpp: 4,
    containers: ["pkm"],
    pvrFormat: 22,
    pkmFormat: 1,
  },
  {
    id: "etc2_rgba",
    label: "ETC2 RGBA",
    engine: "etcpak",
    channels: "RGBA",
    bpp: 8,
    containers: ["pkm"],
    pvrFormat: 23,
    pkmFormat: 3,
  },
  {
    id: "bc1",
    label: "BC1 RGB",
    engine: "etcpak",
    channels: "RGB",
    bpp: 4,
    containers: ["dds"],
    pvrFormat: 7,
  },
  {
    id: "bc3",
    label: "BC3 RGBA",
    engine: "etcpak",
    channels: "RGBA",
    bpp: 8,
    containers: ["dds"],
    pvrFormat: 11,
  },
  {
    id: "bc4",
    label: "BC4 R",
    engine: "etcpak",
    channels: "R",
    bpp: 4,
    containers: ["dds"],
    pvrFormat: 12,
  },
  {
    id: "bc5",
    label: "BC5 RG",
    engine: "etcpak",
    channels: "RG",
    bpp: 8,
    containers: ["dds"],
    pvrFormat: 13,
  },
  {
    id: "bc7",
    label: "BC7 RGBA",
    engine: "etcpak",
    channels: "RGBA",
    bpp: 8,
    containers: ["dds"],
    pvrFormat: 15,
  },
  {
    id: "pvrtc1_rgb_2",
    label: "PVRTC1 RGB 2bpp",
    engine: "pvrtc",
    channels: "RGB",
    bpp: 2,
    containers: ["pvr", "ccz"],
    pvrFormat: 0,
  },
  {
    id: "pvrtc1_rgba_2",
    label: "PVRTC1 RGBA 2bpp",
    engine: "pvrtc",
    channels: "RGBA",
    bpp: 2,
    containers: ["pvr", "ccz"],
    pvrFormat: 1,
  },
  {
    id: "pvrtc1_rgb_4",
    label: "PVRTC1 RGB 4bpp",
    engine: "pvrtc",
    channels: "RGB",
    bpp: 4,
    containers: ["pvr", "ccz"],
    pvrFormat: 2,
  },
  {
    id: "pvrtc1_rgba_4",
    label: "PVRTC1 RGBA 4bpp",
    engine: "pvrtc",
    channels: "RGBA",
    bpp: 4,
    containers: ["pvr", "ccz"],
    pvrFormat: 3,
  },
  {
    id: "pvrtc2_2",
    label: "PVRTC2 2bpp",
    engine: "pvrtc",
    channels: "RGBA",
    bpp: 2,
    containers: ["pvr", "ccz"],
    pvrFormat: 4,
  },
  {
    id: "pvrtc2_4",
    label: "PVRTC2 4bpp",
    engine: "pvrtc",
    channels: "RGBA",
    bpp: 4,
    containers: ["pvr", "ccz"],
    pvrFormat: 5,
  },
];
for (const c of capabilities) {
  if (!c.containers.includes("pvr")) c.containers.push("pvr", "ccz");
  c.containers.push("ktx");
  if (c.id !== "etc1") c.containers.push("ktx2");
  if (c.id.startsWith("astc_")) c.containers.push("astc");
  // Legacy PowerVR DDS stores PVRTC1 using PTC2 / PTC4 FourCC codes.
  if (c.id.startsWith("pvrtc1")) c.containers.push("dds");
}
export function codecLabel(c: CodecCapability) {
  return c.label.replace(/ \d+bpp$/, "") + " (" + Number(c.bpp.toFixed(2)) + "bpp)";
}
export function containerLabel(container: string) {
  return container === "ccz" ? "PVR.CCZ (.pvr.ccz)" : container.toUpperCase() + " (." + container + ")";
}
export const qualities = [
  "PVRTCFASTEST",
  "PVRTCFAST",
  "PVRTCLOW",
  "PVRTCNORMAL",
  "PVRTCHIGH",
  "PVRTCVERYHIGH",
  "PVRTCTHOROUGH",
  "PVRTCBEST",
];
export const astcQualities = ["ASTCVERYFAST", "ASTCFAST", "ASTCMEDIUM", "ASTCTHOROUGH", "ASTCEXHAUSTIVE"];
export function codecFamily(c: CodecCapability): string {
  return c.label.match(/^[A-Z]+/)?.[0] ?? c.label;
}
capabilities.sort((a, b) => codecFamily(a).localeCompare(codecFamily(b), "en") || a.label.localeCompare(b.label, "en", { numeric: true }));
export function codecQualities(id: CodecId | string) {
  return id.startsWith("astc_") ? astcQualities : qualities;
}
export function defaultQuality(id: CodecId | string) {
  return id.startsWith("astc_") ? "ASTCMEDIUM" : "PVRTCNORMAL";
}
export function capability(id: CodecId | string) {
  const result = capabilities.find((c) => c.id === id);
  if (!result) throw Error("不支持的编码格式");
  return result;
}
export function targetDimensions(
  width: number,
  height: number,
  id: CodecId,
  mode: "keep" | "pad" | "pad-pot" | "resize",
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384
  )
    throw Error("纹理尺寸超出范围（1–16384）");
  const c = capability(id);
  let w = width,
    h = height;
  if (c.blockWidth && c.blockHeight) {
    if (mode === "pad" || mode === "resize") {
      w = Math.ceil(width / c.blockWidth) * c.blockWidth;
      h = Math.ceil(height / c.blockHeight) * c.blockHeight;
    }
  } else if (id.startsWith("pvrtc1")) {
    w = 2 ** Math.ceil(Math.log2(Math.max(width, c.bpp === 2 ? 16 : 8)));
    h = 2 ** Math.ceil(Math.log2(Math.max(height, 8)));
  } else {
    const blockW = c.engine === "pvrtc" && c.bpp === 2 ? 8 : 4;
    w = Math.ceil(width / blockW) * blockW;
    h = Math.ceil(height / 4) * 4;
  }
  if (mode === "pad-pot") {
    w = 2 ** Math.ceil(Math.log2(w));
    h = 2 ** Math.ceil(Math.log2(h));
  }
  if (mode === "keep" && (w !== width || h !== height))
    throw Error(
      `尺寸不符合 ${c.label} 要求，需要 ${w} × ${h}；请选择补齐或缩放`,
    );
  return { width: w, height: h };
}

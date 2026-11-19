export type Container = "png" | "pkm" | "dds" | "pvr" | "ccz" | "astc" | "ktx" | "ktx2";
export type CodecId =
  | "astc_4x4"
  | "astc_5x4"
  | "astc_5x5"
  | "astc_6x5"
  | "astc_6x6"
  | "astc_8x5"
  | "astc_8x6"
  | "astc_8x8"
  | "astc_10x5"
  | "astc_10x6"
  | "astc_10x8"
  | "astc_10x10"
  | "astc_12x10"
  | "astc_12x12"
  | "etc1"
  | "etc2_r"
  | "etc2_rg"
  | "etc2_rgb"
  | "etc2_rgba"
  | "bc1"
  | "bc3"
  | "bc4"
  | "bc5"
  | "bc7"
  | "pvrtc1_rgb_2"
  | "pvrtc1_rgba_2"
  | "pvrtc1_rgb_4"
  | "pvrtc1_rgba_4"
  | "pvrtc2_2"
  | "pvrtc2_4";
export interface CodecCapability {
  id: CodecId;
  label: string;
  engine: "etcpak" | "pvrtc";
  blockWidth?: number;
  blockHeight?: number;
  channels: string;
  bpp: number;
  containers: Container[];
  pvrFormat: number;
  pkmFormat?: number;
  available?: boolean;
  reason?: string;
}
export interface EncodingOptions {
  cleanTransparentRgb?: boolean;
  alphaThreshold?: number;
  multiplyRgbByAlpha?: boolean;
  dither?: boolean;
  heuristics?: boolean;
  mipmaps?: boolean;
  quality?: string;
  mipFilter?: "nearest" | "linear" | "cubic";
  premultiply?: boolean;
}
export interface ConversionRequest {
  operation: "encode" | "decode" | "rewrap" | "tinify";
  tinify?: import("./tinify").TinifyOptions;
  codec?: CodecId;
  container: Container;
  options: EncodingOptions;
  sizeMode: "keep" | "pad" | "pad-pot" | "resize";
  padAnchor?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
  colorSpace: "srgb" | "linear";
  cczLevel: number;
  encrypt: boolean;
  inputKeyRef?: string;
  outputKeyRef?: string;
  output: {
    mode: "source" | "directory";
    conflict: "skip" | "overwrite" | "rename";
  };
}
export interface Asset {
  id: string;
  name: string;
  path: string;
  root: string;
  relativePath: string;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  container: Container | "image" | "unsupported";
  codec?: CodecId;
  alpha: boolean;
  size: number;
  fingerprint: string;
  encrypted: boolean;
  error?: string;
  localError?: string;
}
export type JobState =
  "pending" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export interface PlannedOutput {
  asset: Asset;
  request: ConversionRequest;
  target: string;
  width: number;
  height: number;
  alphaLoss: boolean;
  warning?: string;
  error?: string;
  exists: boolean;
}
export interface Job {
  id: string;
  assetId: string;
  name: string;
  state: JobState;
  output?: string;
  error?: string;
  warning?: string;
  inputBytes?: number;
  outputBytes?: number;
  startedAt?: number;
  finishedAt?: number;
}
export interface PreviewResult {
  originalOffset?: { left: number; top: number };
  version: number;
  original: string;
  result: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  inputBytes: number;
  encodedBytes: number;
  finalBytes: number;
  payloadBytes: number;
  bpp: number;
  inputLabel: string;
}

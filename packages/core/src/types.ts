export type Container = "png" | "pkm" | "dds" | "pvr" | "ccz";
export type CodecId =
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
  channels: string;
  bpp: number;
  containers: Container[];
  pvrFormat: number;
  pkmFormat?: number;
  available?: boolean;
  reason?: string;
}
export interface EncodingOptions {
  multiplyRgbByAlpha?: boolean;
  dither?: boolean;
  heuristics?: boolean;
  mipmaps?: boolean;
  quality?: string;
  mipFilter?: "nearest" | "linear" | "cubic";
  premultiply?: boolean;
}
export interface ConversionRequest {
  operation: "encode" | "decode" | "rewrap";
  codec?: CodecId;
  container: Container;
  options: EncodingOptions;
  sizeMode: "keep" | "pad" | "resize";
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
  startedAt?: number;
  finishedAt?: number;
}
export interface PreviewResult {
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

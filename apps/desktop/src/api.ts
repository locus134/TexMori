import type {
  Asset,
  CodecCapability,
  ConversionRequest,
  Job,
  PreviewResult,
} from "../../../packages/core/src/index";
export type DesktopAsset = Asset & { thumbnail?: string };
export interface PlanSummary {
  id: string;
  files: {
    assetId: string;
    name: string;
    target: string;
    width: number;
    height: number;
    alphaLoss: boolean;
    exists: boolean;
    error?: string;
  }[];
}
export interface DesktopApi {
  capabilities(): Promise<CodecCapability[]>;
  assets(): Promise<DesktopAsset[]>;
  importFiles(directory?: boolean): Promise<DesktopAsset[]>;
  dropFiles(files: File[]): Promise<DesktopAsset[]>;
  cancelScan(): Promise<void>;
  remove(ids?: string[]): Promise<DesktopAsset[]>;
  selectOutput(): Promise<string | undefined>;
  setKey(value: string): Promise<string | undefined>;
  generateKey(): Promise<string>;
  keyExample(ref: string): Promise<string>;
  refresh(id: string, inputKeyRef?: string): Promise<DesktopAsset>;
  preview(
    id: string,
    request: ConversionRequest,
    version: number,
  ): Promise<PreviewResult>;
  cancelPreview(): Promise<void>;
  plan(ids: string[], request: ConversionRequest): Promise<PlanSummary>;
  start(id: string): Promise<void>;
  cancel(): Promise<void>;
  retry(): Promise<void>;
  reveal(id: string): Promise<void>;
  onJobs(
    listener: (state: { jobs: Job[]; running: boolean }) => void,
  ): () => void;
}
declare global {
  interface Window {
    cptool: DesktopApi;
  }
}

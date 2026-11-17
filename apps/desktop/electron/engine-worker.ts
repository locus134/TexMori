import {
  ConversionService,
  type EnginePaths,
} from "../../../packages/engine/src/conversion";
import type {
  Asset,
  ConversionRequest,
} from "../../../packages/core/src/index";
const port = process.parentPort!;
const controller = new AbortController();
port.on(
  "message",
  async ({
    data,
  }: {
    data: {
      cancel?: boolean;
      engines: EnginePaths;
      asset: Asset;
      request: ConversionRequest;
      directory: string;
      keys: { input?: string; output?: string };
      preview: boolean;
    };
  }) => {
    if (data.cancel) {
      controller.abort();
      return;
    }
    try {
      const result = await new ConversionService(data.engines).run(
        data.asset,
        data.request,
        data.directory,
        controller.signal,
        data.keys,
        data.preview,
      );
      port.postMessage({ result });
    } catch (error) {
      port.postMessage({
        error: error instanceof Error ? error.message : "转换失败",
      });
    }
  },
);

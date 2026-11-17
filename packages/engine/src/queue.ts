import { randomUUID } from "node:crypto";
import type { Job, PlannedOutput } from "../../core/src/index";
import { publishFile } from "./publish";
import { access } from "node:fs/promises";
export interface ProcessedFile {
  path: string;
  target?: string;
  inputBytes?: number;
  outputBytes?: number;
}
type Work<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
  signal: AbortSignal;
  priority: number;
};
export class WorkScheduler {
  private pending: Work<unknown>[] = [];
  private active = false;
  run<T>(run: () => Promise<T>, signal: AbortSignal, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        run,
        resolve: resolve as (v: unknown) => void,
        reject,
        signal,
        priority,
      });
      this.pending.sort((a, b) => a.priority - b.priority);
      void this.drain();
    });
  }
  private async drain() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.pending.length) {
        const job = this.pending.shift()!;
        if (job.signal.aborted) {
          job.reject(Error("任务已取消"));
          continue;
        }
        try {
          job.resolve(await job.run());
        } catch (e) {
          job.reject(e);
        }
      }
    } finally {
      this.active = false;
    }
  }
}
export class JobQueue {
  jobs: Job[] = [];
  running = false;
  private controller = new AbortController();
  private plans: PlannedOutput[] = [];
  private completion: Promise<void> = Promise.resolve();
  onChange: (jobs: Job[], running: boolean) => void = () => {};
  constructor(
    private convert: (
      plan: PlannedOutput,
      signal: AbortSignal,
    ) => Promise<string | ProcessedFile>,
    private scheduler: WorkScheduler,
    private cleanup: (file: string) => Promise<void> = async () => {},
    private decorate?: (
      plan: PlannedOutput,
      file: string,
      signal: AbortSignal,
    ) => Promise<string | undefined>,
    private options?: { concurrency: () => number },
  ) {}
  private emit() {
    this.onChange(structuredClone(this.jobs), this.running);
  }
  async start(plans: PlannedOutput[]) {
    if (this.running) throw Error("批处理正在运行");
    this.plans = structuredClone(plans);
    this.jobs = plans.map((p) => ({
      id: randomUUID(),
      assetId: p.asset.id,
      name: p.asset.name,
      state: "pending",
    }));
    this.completion = this.execute();
    await this.completion;
  }
  cancel() {
    this.controller.abort();
  }
  waitForIdle() {
    return this.completion;
  }
  async retryFailed() {
    if (this.running) throw Error("批处理正在运行");
    for (const job of this.jobs)
      if (job.state === "failed") job.state = "pending";
    this.completion = this.execute();
    await this.completion;
  }
  private async execute() {
    this.running = true;
    this.controller = new AbortController();
    this.emit();
    try {
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < this.jobs.length) {
          const i = nextIndex++;
          const job = this.jobs[i],
            plan = this.plans[i];
          if (job.state !== "pending") continue;
          if (this.controller.signal.aborted) {
            job.state = "cancelled";
            job.finishedAt = Date.now();
            this.emit();
            continue;
          }
          job.state = "running";
          job.startedAt = Date.now();
          job.error = undefined;
          this.emit();
          let temporary: string | undefined;
          try {
            if (plan.error) throw Error(plan.error);
            if (
              plan.request.operation === "tinify" &&
              plan.request.output.conflict === "skip" &&
              !plan.target.endsWith(".auto") &&
              (await access(plan.target).then(
                () => true,
                () => false,
              ))
            ) {
              job.state = "skipped";
              job.finishedAt = Date.now();
              this.emit();
              continue;
            }
            const signal = this.controller.signal;
            const result = this.options
              ? await this.convert(plan, signal)
              : await this.scheduler.run(
                  () => this.convert(plan, signal),
                  signal,
                );
            temporary = typeof result === "string" ? result : result.path;
            const target =
              typeof result === "string"
                ? plan.target
                : (result.target ?? plan.target);
            if (typeof result !== "string") {
              job.inputBytes = result.inputBytes;
              job.outputBytes = result.outputBytes;
            }
            const published = await publishFile(
              temporary,
              target,
              plan.request.output.conflict,
              signal,
              this.decorate
                ? async (file) => {
                    job.warning = await this.decorate!(plan, file, signal);
                  }
                : undefined,
            );
            job.state = published ? "succeeded" : "skipped";
            if (published) job.output = target;
          } catch (e) {
            job.state = this.controller.signal.aborted ? "cancelled" : "failed";
            job.error = e instanceof Error ? e.message : "任务失败";
          } finally {
            if (temporary) await this.cleanup(temporary).catch(() => {});
          }
          job.finishedAt = Date.now();
          this.emit();
        }
      };
      const concurrency = Math.max(
        1,
        Math.min(
          this.jobs.length || 1,
          Math.floor(this.options?.concurrency() ?? 1),
        ),
      );
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      this.running = false;
      this.emit();
    }
  }
}

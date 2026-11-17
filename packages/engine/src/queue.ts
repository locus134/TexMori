import { randomUUID } from "node:crypto";
import type { Job, PlannedOutput } from "../../core/src/index";
import { publishFile } from "./publish";
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
    ) => Promise<string>,
    private scheduler: WorkScheduler,
    private cleanup: (file: string) => Promise<void> = async () => {},
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
      for (let i = 0; i < this.jobs.length; i++) {
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
          const signal = this.controller.signal;
          temporary = await this.scheduler.run(
            () => this.convert(plan, signal),
            signal,
          );
          const published = await publishFile(
            temporary,
            plan.target,
            plan.request.output.conflict,
            signal,
          );
          job.state = published ? "succeeded" : "skipped";
          if (published) job.output = plan.target;
        } catch (e) {
          job.state = this.controller.signal.aborted ? "cancelled" : "failed";
          job.error = e instanceof Error ? e.message : "任务失败";
        } finally {
          if (temporary) await this.cleanup(temporary).catch(() => {});
        }
        job.finishedAt = Date.now();
        this.emit();
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }
}

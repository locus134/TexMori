import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JobQueue, WorkScheduler } from "../src/queue";
import { validateRequest, type PlannedOutput } from "../../core/src/index";
it("does not upload a cloud job when its target already exists and skip is selected", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tinify-skip-"));
  try {
    const target = path.join(dir, "a.tiny.png");
    await writeFile(target, "keep");
    let uploads = 0;
    const queue = new JobQueue(
      async () => {
        uploads++;
        throw Error("should not upload");
      },
      new WorkScheduler(),
      undefined,
      undefined,
      { concurrency: () => 2 },
    );
    const plan = {
      asset: { id: "a", name: "a.png" },
      target,
      request: validateRequest({
        operation: "tinify",
        container: "png",
        output: { mode: "source", conflict: "skip" },
      }),
    } as PlannedOutput;
    await queue.start([plan]);
    expect(uploads).toBe(0);
    expect(queue.jobs[0].state).toBe("skipped");
    expect(await readFile(target, "utf8")).toBe("keep");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("runs cloud tasks concurrently, cancels all active tasks and leaves queued tasks unstarted", async () => {
  let active = 0,
    peak = 0,
    started = 0;
  let ready!: () => void;
  const bothStarted = new Promise<void>((r) => (ready = r));
  const queue = new JobQueue(
    async (_plan, signal) => {
      started++;
      active++;
      peak = Math.max(peak, active);
      if (active === 2) ready();
      try {
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(Error("cancelled")), {
            once: true,
          }),
        );
      } finally {
        active--;
      }
      return "/never";
    },
    new WorkScheduler(),
    undefined,
    undefined,
    { concurrency: () => 2 },
  );
  const plans = ["a", "b", "c"].map(
    (id) =>
      ({
        asset: { id, name: id },
        request: validateRequest({
          operation: "decode",
          container: "png",
          output: { mode: "source", conflict: "skip" },
        }),
        target: "/never/" + id,
      }) as PlannedOutput,
  );
  const done = queue.start(plans);
  await bothStarted;
  queue.cancel();
  await done;
  expect(peak).toBe(2);
  expect(started).toBe(2);
  expect(active).toBe(0);
  expect(queue.jobs.map((j) => j.state)).toEqual([
    "cancelled",
    "cancelled",
    "cancelled",
  ]);
});
it("continues after a failed file and retries only failed jobs", async () => {
  const dir = await mkdtemp(
    path.join(
      await import("node:fs/promises").then((m) => m.realpath(os.tmpdir())),
      "texmori-queue-",
    ),
  );
  try {
    let fail = true;
    const calls: string[] = [];
    const source = path.join(dir, "encoded");
    await writeFile(source, "result");
    const plans = ["a", "b"].map(
      (id) =>
        ({
          asset: { id, name: id },
          target: path.join(dir, id),
          request: validateRequest({
            operation: "decode",
            container: "png",
            output: { mode: "source", conflict: "overwrite" },
          }),
        }) as PlannedOutput,
    );
    const queue = new JobQueue(async (p) => {
      calls.push(p.asset.id);
      if (p.asset.id === "a" && fail) throw Error("bad input");
      return source;
    }, new WorkScheduler());
    await queue.start(plans);
    expect(queue.jobs.map((j) => j.state)).toEqual(["failed", "succeeded"]);
    fail = false;
    await queue.retryFailed();
    expect(calls).toEqual(["a", "b", "a"]);
    expect(queue.jobs.map((j) => j.state)).toEqual(["succeeded", "succeeded"]);
    expect((await readFile(plans[0].target)).toString()).toBe("result");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("serializes encoder work and cancels pending tasks without starting them", async () => {
  const scheduler = new WorkScheduler(),
    controller = new AbortController();
  const order: string[] = [];
  let release!: () => void;
  const first = scheduler.run(async () => {
    order.push("first");
    await new Promise<void>((r) => (release = r));
  }, new AbortController().signal);
  const second = scheduler.run(async () => {
    order.push("second");
  }, controller.signal);
  controller.abort();
  release();
  await first;
  await expect(second).rejects.toThrow();
  expect(order).toEqual(["first"]);
});
it("cancels an active job and never publishes it or starts the next job", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r)),
    calls: string[] = [];
  const plans = ["first", "second"].map(
    (id) =>
      ({
        asset: { id, name: id },
        target: "/unused/" + id,
        request: validateRequest({
          operation: "decode",
          container: "png",
          output: { mode: "source", conflict: "overwrite" },
        }),
      }) as PlannedOutput,
  );
  const queue = new JobQueue(async (plan, signal) => {
    calls.push(plan.asset.id);
    started();
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(Error("cancelled")), {
        once: true,
      }),
    );
    return "/never-published";
  }, new WorkScheduler());
  const pending = queue.start(plans);
  await ready;
  queue.cancel();
  await pending;
  expect(calls).toEqual(["first"]);
  expect(queue.jobs.map((j) => j.state)).toEqual(["cancelled", "cancelled"]);
});
it("does not report idle until per-job cleanup is finished", async () => {
  const dir = await mkdtemp(
    path.join(
      await import("node:fs/promises").then((m) => m.realpath(os.tmpdir())),
      "texmori-cleanup-",
    ),
  );
  try {
    const source = path.join(dir, "source");
    await writeFile(source, "done");
    let release!: () => void, cleaning!: () => void;
    const ready = new Promise<void>((r) => (cleaning = r));
    const plan = {
      asset: { id: "a", name: "a" },
      target: path.join(dir, "out"),
      request: validateRequest({
        operation: "decode",
        container: "png",
        output: { mode: "source", conflict: "overwrite" },
      }),
    } as PlannedOutput;
    const queue = new JobQueue(
      async () => source,
      new WorkScheduler(),
      async () => {
        cleaning();
        await new Promise<void>((r) => (release = r));
      },
    );
    const pending = queue.start([plan]);
    await ready;
    expect(queue.running).toBe(true);
    release();
    await queue.waitForIdle();
    await pending;
    expect(queue.running).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

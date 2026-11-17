import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
const launchApp = () =>
  electron.launch(
    process.env.CPTOOL_PACKAGED_PATH
      ? {
          executablePath: process.env.CPTOOL_PACKAGED_PATH,
          args: [],
          cwd: process.cwd(),
        }
      : { args: ["."], cwd: process.cwd() },
  );
test("imports, previews actual ETC output, batches to a chosen folder and switches valid parameters", async () => {
  const output = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "cptool-desktop-"),
  );
  const application = await launchApp();
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("纹理工作台", { exact: true })).toBeVisible();
    await application.evaluate(
      async ({ dialog }, input) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [input],
        });
      },
      path.join(process.cwd(), "tests/fixtures/generated/rgba.png"),
    );
    await page.getByRole("button", { name: "导入图片" }).click();
    await expect(
      page.getByRole("heading", { name: "rgba.png", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("预览已更新", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("img", { name: "编码结果" })).toBeVisible();
    await page.getByRole("button", { name: "100%", exact: true }).click();
    const pixels = await page
      .getByRole("img", { name: "编码结果" })
      .evaluate((image) => ({
        width: image.getBoundingClientRect().width,
        dpr: window.devicePixelRatio,
      }));
    expect(pixels.width * pixels.dpr).toBeCloseTo(32, 1);
    await page.getByRole("button", { name: "适应窗口", exact: true }).click();
    await page.getByLabel("编码格式").selectOption("bc7");
    await expect(page.getByLabel("输出容器")).toHaveValue("dds");
    await expect(page.getByLabel("抖动")).toHaveCount(0);
    await page.getByLabel("编码格式").selectOption("etc1");
    await expect(page.getByLabel("Mipmap")).toBeDisabled();
    await page.getByLabel("输出位置").selectOption("directory");
    await application.evaluate(async ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, output);
    await page.getByRole("button", { name: "选择输出目录" }).click();
    await page.getByRole("button", { name: "开始批处理" }).click();
    await page.getByRole("button", { name: "确认并开始" }).click();
    await expect(page.getByText("批处理完成", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("预览已更新", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    expect(
      (await readFile(path.join(output, "rgba.pkm"))).subarray(0, 6).toString(),
    ).toBe("PKM 10");
    await page.screenshot({ path: "build/workbench.png" });
    await page.setViewportSize({ width: 840, height: 680 });
    await page.screenshot({ path: "build/workbench-narrow.png" });
  } finally {
    await application.close();
    await rm(output, { recursive: true, force: true });
  }
});
test("encrypts real PVRTC CCZ, imports it with a session key, decodes and rewraps it", async () => {
  const output = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "cptool-ccz-desktop-"),
  );
  const application = await launchApp();
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("纹理工作台", { exact: true })).toBeVisible();
    await application.evaluate(
      async ({ dialog }, input) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [input],
        });
      },
      path.join(process.cwd(), "tests/fixtures/generated/rgba.png"),
    );
    const input = await page.evaluate(async () => {
      const assets = await window.cptool.importFiles();
      return assets[0].id;
    });
    await application.evaluate(async ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, output);
    await page.evaluate(() => window.cptool.selectOutput());
    await page.evaluate(async (id) => {
      const ref = await window.cptool.setKey(
        "123456789abcdef013579bdf2468ace0",
      );
      const plan = await window.cptool.plan([id], {
        operation: "encode",
        codec: "pvrtc1_rgba_4",
        container: "ccz",
        options: { quality: "PVRTCFASTEST" },
        sizeMode: "keep",
        colorSpace: "srgb",
        cczLevel: 6,
        encrypt: true,
        outputKeyRef: ref,
        output: { mode: "directory", conflict: "overwrite" },
      });
      await new Promise<void>((resolve, reject) => {
        const stop = window.cptool.onJobs(({ jobs, running }) => {
          if (!running) {
            stop();
            jobs.some((j) => j.state === "failed")
              ? reject(Error(jobs[0].error))
              : resolve();
          }
        });
        window.cptool.start(plan.id).catch(reject);
      });
    }, input);
    const ccz = path.join(output, "rgba.pvr.ccz");
    expect((await readFile(ccz)).subarray(0, 4).toString()).toBe("CCZp");
    await application.evaluate(async ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, ccz);
    await page.evaluate(async () => {
      const assets = await window.cptool.importFiles(),
        asset = assets.find((a) => a.container === "ccz")!,
        ref = await window.cptool.setKey("123456789abcdef013579bdf2468ace0");
      const unlocked = await window.cptool.refresh(asset.id, ref);
      if (unlocked.width !== 32) throw Error("Wrong decrypted dimensions");
      for (const operation of ["decode", "rewrap"] as const) {
        const plan = await window.cptool.plan([asset.id], {
          operation,
          container: operation === "decode" ? "png" : "pvr",
          options: {},
          sizeMode: "keep",
          colorSpace: "srgb",
          cczLevel: 6,
          encrypt: false,
          inputKeyRef: ref,
          output: { mode: "directory", conflict: "overwrite" },
        });
        await new Promise<void>((resolve, reject) => {
          const stop = window.cptool.onJobs(({ jobs, running }) => {
            if (!running) {
              stop();
              jobs.some((j) => j.state === "failed")
                ? reject(Error(jobs[0].error))
                : resolve();
            }
          });
          window.cptool.start(plan.id).catch(reject);
        });
      }
    });
    expect(
      (await readFile(path.join(output, "rgba.png")))
        .subarray(0, 8)
        .toString("hex"),
    ).toBe("89504e470d0a1a0a");
    expect(
      (await readFile(path.join(output, "rgba.pvr"))).readUInt32LE(0),
    ).toBe(0x03525650);
    expect(
      await page.evaluate(() => ({
        node: typeof (window as unknown as { require?: unknown }).require,
        bridge: typeof window.cptool.preview,
      })),
    ).toEqual({ node: "undefined", bridge: "function" });
  } finally {
    await application.close();
    await rm(output, { recursive: true, force: true });
  }
});

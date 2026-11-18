import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile, copyFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const launchIsolated = (dir: string) => electron.launch({
  executablePath: process.env.TEXMORI_PACKAGED_PATH,
  args: process.env.TEXMORI_PACKAGED_PATH ? ["--user-data-dir=" + dir] : [".", "--user-data-dir=" + dir],
  cwd: process.cwd(),
});
test("shows real Tinify options and batches through the key pool without automatic uploads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-tinify-ui-"));
  const app = await launchIsolated(dir);
  try {
    await app.evaluate(
      ({ dialog }, input) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [input],
        });
        const globals = globalThis as unknown as {
          fetch: typeof fetch;
          uploads: number;
        };
        globals.uploads = 0;
        globals.fetch = async (url) => {
          if (String(url).endsWith("/shrink")) {
            globals.uploads++;
            return Response.json(
              { output: { url: "https://api.tinify.com/output/test" } },
              { status: 201, headers: { "Compression-Count": "1" } },
            );
          }
          const fs = process.getBuiltinModule("fs")!;
          return new Response(fs.readFileSync(input), {
            headers: { "Content-Type": "image/png" },
          });
        };
      },
      path.join(process.cwd(), "tests/fixtures/generated/rgba.png"),
    );
    const page = await app.firstWindow();
    await page.getByLabel("操作", { exact: true }).selectOption("tinify");
    await expect(
      page.getByText("TinyPNG 云端处理", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByLabel("TinyPNG 尺寸处理")).toBeVisible();
    await page.getByLabel("TinyPNG 尺寸处理").selectOption("fit");
    await expect(page.getByLabel("目标宽度")).toBeVisible();
    await expect(page.getByLabel("目标高度")).toBeVisible();
    await page.getByLabel("TinyPNG 尺寸处理").selectOption("keep");
    await page.getByLabel("输出格式策略").selectOption("convert");
    await page.getByRole("checkbox", { name: "JPEG", exact: true }).check();
    await expect(page.getByLabel("透明背景填充")).toBeVisible();
    await page.getByLabel("输出格式策略").selectOption("keep");
    await expect(page.getByLabel("质量", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "导入图片" }).click();
    await expect(
      page.getByRole("heading", { name: "rgba.png", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("开始批处理后显示云端压缩结果", { exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { uploads: number }).uploads,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "开始批处理", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("API Key");
    await page.getByLabel("新的 TinyPNG API Key").fill("test-only-key-123456");
    await page
      .getByRole("button", { name: "添加 API Key", exact: true })
      .click();
    await expect(
      page.getByText("1 个 Key · 最多并行 1 个任务", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("输出位置").selectOption("directory");
    await page
      .getByRole("textbox", { name: "导出目录路径" })
      .fill(path.join(dir, "output"));
    await page.getByRole("button", { name: "开始批处理", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "图片将上传至 TinyPNG",
    );
    await page.getByRole("button", { name: "确认并开始", exact: true }).click();
    await expect(page.getByText("批处理完成", { exact: true })).toBeVisible();
    expect(
      (await readFile(path.join(dir, "output/rgba.tiny.png")))
        .subarray(0, 8)
        .toString("hex"),
    ).toBe("89504e470d0a1a0a");
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { uploads: number }).uploads,
      ),
    ).toBe(1);
    expect(
      await readFile(path.join(dir, "tinify-keys-local.json"), "utf8"),
    ).toContain("test-only-key");
    await page.screenshot({ path: "build/tinify-workbench.png" });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("two unique keys process three files in parallel and publish the chosen format with the correct extension", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-tinify-parallel-"));
  const fixture = path.join(process.cwd(), "tests/fixtures/generated/rgba.png");
  for (const name of ["a", "b", "c"])
    await copyFile(fixture, path.join(dir, name + ".png"));
  const app = await electron.launch({
    args: [".", "--user-data-dir=" + path.join(dir, "profile")],
    cwd: process.cwd(),
  });
  try {
    await app.evaluate(
      ({ dialog }, args) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [args.directory],
        });
        const state = globalThis as unknown as {
          fetch: typeof fetch;
          stats: {
            active: number;
            peak: number;
            uploads: number;
            overlap: boolean;
          };
        };
        state.stats = { active: 0, peak: 0, uploads: 0, overlap: false };
        const busy = new Set<string>();
        let token = 0;
        const fs = process.getBuiltinModule("fs")!;
        state.fetch = async (url, init) => {
          const key = (init!.headers as Record<string, string>).Authorization;
          if (String(url).endsWith("/shrink")) {
            if (busy.has(key)) state.stats.overlap = true;
            busy.add(key);
            state.stats.active++;
            state.stats.uploads++;
            state.stats.peak = Math.max(state.stats.peak, state.stats.active);
            await new Promise((r) => setTimeout(r, 100));
            return Response.json(
              { output: { url: "https://api.tinify.com/output/" + ++token } },
              { status: 201 },
            );
          }
          await new Promise((r) => setTimeout(r, 100));
          state.stats.active--;
          busy.delete(key);
          return new Response(fs.readFileSync(args.fixture), {
            headers: { "Content-Type": "image/png" },
          });
        };
      },
      { directory: dir, fixture },
    );
    const page = await app.firstWindow();
    await page.getByLabel("操作", { exact: true }).selectOption("tinify");
    for (const key of [
      "test-parallel-key-1111",
      "test-parallel-key-2222",
      "test-parallel-key-1111",
    ]) {
      await page.getByLabel("新的 TinyPNG API Key").fill(key);
      await page
        .getByRole("button", { name: "添加 API Key", exact: true })
        .click();
      await expect(page.getByLabel("新的 TinyPNG API Key")).toHaveValue("");
    }
    await expect(
      page.getByText("2 个 Key · 最多并行 2 个任务", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("输出格式策略").selectOption("convert");
    await page.getByRole("checkbox", { name: "WEBP", exact: true }).check();
    await page.getByRole("button", { name: "导入目录", exact: true }).click();
    await expect(
      page.getByRole("listbox", { name: "资源列表" }).getByRole("option"),
    ).toHaveCount(3);
    await page.getByRole("button", { name: "开始批处理", exact: true }).click();
    await page.getByRole("button", { name: "确认并开始", exact: true }).click();
    await expect(page.getByText("批处理完成", { exact: true })).toBeVisible();
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { stats: unknown }).stats,
      ),
    ).toEqual({ active: 0, peak: 2, uploads: 3, overlap: false });
    for (const name of ["a", "b", "c"])
      expect(
        (await readFile(path.join(dir, name + ".tiny.png")))
          .subarray(0, 8)
          .toString("hex"),
      ).toBe("89504e470d0a1a0a");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps legacy encrypted records untouched and persists local keys across restart",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"texmori-local-keys-ui-"));
 const legacy=JSON.stringify([{id:"legacy",encrypted:"test-ciphertext-not-a-real-key"}]);
 await writeFile(path.join(dir,"tinify-keys.json"),legacy);
 let app=await launchIsolated(dir);
 try{
  let page=await app.firstWindow();await page.getByLabel("操作",{exact:true}).selectOption("tinify");
  await expect(page.getByText(/旧版 Key 使用系统加密保存/)).toBeVisible();
  await page.getByLabel("新的 TinyPNG API Key").fill("test-only-local-key");
  await page.getByRole("button",{name:"添加 API Key",exact:true}).click();
  await expect(page.getByText("Key 1 · •••• -key",{exact:true})).toBeVisible();
  expect(await readFile(path.join(dir,"tinify-keys.json"),"utf8")).toBe(legacy);
  expect((await stat(path.join(dir,"tinify-keys-local.json"))).mode & 0o777).toBe(0o600);
  await app.close();app=await launchIsolated(dir);
  page=await app.firstWindow();await page.getByLabel("操作",{exact:true}).selectOption("tinify");
  await expect(page.getByText("Key 1 · •••• -key",{exact:true})).toBeVisible();
  await expect(page.getByText(/旧版 Key 使用系统加密保存/)).toHaveCount(0);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  rm,
  realpath,
  writeFile,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { runProcess } from "../../packages/engine/src/process-runner";
import os from "node:os";
let preferenceBackup: { file: string; data: Buffer | undefined } | undefined;
const launchApp = async () => {
  const application = await electron.launch(
    process.env.TEXMORI_PACKAGED_PATH
      ? {
          executablePath: process.env.TEXMORI_PACKAGED_PATH,
          args: [],
          cwd: process.cwd(),
        }
      : { args: ["."], cwd: process.cwd() },
  );
  if (!preferenceBackup) {
    const directory = await application.evaluate(({ app }) =>
      app.getPath("userData"),
    );
    const file = path.join(directory, "preferences.json");
    preferenceBackup = {
      file,
      data: await readFile(file).catch(() => undefined),
    };
  }
  return application;
};
test.afterEach(async () => {
  if (preferenceBackup) {
    if (preferenceBackup.data)
      await writeFile(preferenceBackup.file, preferenceBackup.data);
    else await rm(preferenceBackup.file, { force: true });
    preferenceBackup = undefined;
  }
});
test("imports, previews actual ETC output, batches to a chosen folder and switches valid parameters", async () => {
  const output = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "texmori-desktop-"),
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
    const multiply = page.getByRole("checkbox", {
      name: "压缩前 RGB 乘以 Alpha",
      exact: true,
    });
    await expect(multiply).not.toBeChecked();
    await multiply.check();
    await expect(multiply).toBeChecked();
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
    expect(
      (
        await runProcess("/usr/bin/xattr", [
          "-p",
          "com.texmori.codec",
          path.join(output, "rgba.pkm"),
        ])
      ).stdout.trim(),
    ).toBe("etc1");
    await page.screenshot({ path: "build/workbench.png" });
    await page.setViewportSize({ width: 840, height: 680 });
    await page.screenshot({ path: "build/workbench-narrow.png" });
  } finally {
    await application.close();
    await rm(output, { recursive: true, force: true });
  }
});
test("remembers import/export folders separately across restart and edits output above the picker button", async () => {
  const directory = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "texmori-paths-desktop-"),
  );
  const input = path.join(directory, "导入 图片"),
    output = path.join(directory, "导出 纹理");
  await mkdir(input);
  await mkdir(output);
  await copyFile(
    path.join(process.cwd(), "tests/fixtures/generated/rgba.png"),
    path.join(input, "rgba.png"),
  );
  let application = await launchApp();
  try {
    let page = await application.firstWindow();
    await expect(page.getByText("纹理工作台", { exact: true })).toBeVisible();
    await application.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      },
      path.join(input, "rgba.png"),
    );
    await page.getByRole("button", { name: "导入图片" }).click();
    await page.getByLabel("输出位置").selectOption("directory");
    const field = page.getByRole("textbox", { name: "导出目录路径" });
    await field.fill(output);
    await field.press("Tab");
    await expect
      .poll(() => page.evaluate(() => window.texmori.paths()))
      .toEqual({ importDirectory: input, outputDirectory: output });
    const fieldBox = await field.boundingBox(),
      buttonBox = await page
        .getByRole("button", { name: "选择输出目录" })
        .boundingBox();
    expect(fieldBox!.y).toBeLessThan(buttonBox!.y);
    await field.fill("relative path");
    await page.getByRole("button", { name: "开始批处理" }).click();
    await expect(page.getByRole("alert")).toContainText("完整");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const editedOutput = path.join(directory, "新建导出", "child");
    await application.evaluate((_electron, target) => {
      const fileSystem = process.getBuiltinModule("fs/promises")!,
        original = fileSystem.stat;
      fileSystem.stat = (async (...args: Parameters<typeof original>) => {
        if (String(args[0]).startsWith(target))
          await new Promise((resolve) => setTimeout(resolve, 150));
        return original(...args);
      }) as typeof original;
    }, editedOutput);
    await field.fill(editedOutput);
    await page.getByRole("button", { name: "开始批处理" }).click();
    await expect(
      page.getByRole("dialog").locator(".plan-row .path"),
    ).toHaveAttribute("title", path.join(editedOutput, "rgba.pkm"));
    await page.getByRole("button", { name: "确认并开始" }).click();
    await expect(page.getByText("批处理完成", { exact: true })).toBeVisible();
    expect(
      (await readFile(path.join(editedOutput, "rgba.pkm")))
        .subarray(0, 6)
        .toString(),
    ).toBe("PKM 20");
    await application.close();
    application = await launchApp();
    page = await application.firstWindow();
    await expect(page.getByText("纹理工作台", { exact: true })).toBeVisible();
    await page.getByLabel("输出位置").selectOption("directory");
    await expect(
      page.getByRole("textbox", { name: "导出目录路径" }),
    ).toHaveValue(editedOutput);
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async (...args: unknown[]) => ({
        canceled: false,
        filePaths: [(args.at(-1) as { defaultPath: string }).defaultPath],
      });
    });
    const restored = await page.evaluate(async () => ({
      assets: await window.texmori.importFiles(true),
      output: await window.texmori.selectOutput(),
    }));
    expect(restored.assets[0].path).toBe(path.join(input, "rgba.png"));
    expect(restored.output).toBe(editedOutput);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("encrypts real PVRTC CCZ, imports it with a session key, decodes and rewraps it", async () => {
  const output = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "texmori-ccz-desktop-"),
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
      const assets = await window.texmori.importFiles();
      return assets[0].id;
    });
    await application.evaluate(async ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, output);
    await page.evaluate(() => window.texmori.selectOutput());
    await page.evaluate(async (id) => {
      const ref = await window.texmori.setKey(
        "123456789abcdef013579bdf2468ace0",
      );
      const plan = await window.texmori.plan([id], {
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
        const stop = window.texmori.onJobs(({ jobs, running }) => {
          if (!running) {
            stop();
            jobs.some((j) => j.state === "failed")
              ? reject(Error(jobs[0].error))
              : resolve();
          }
        });
        window.texmori.start(plan.id).catch(reject);
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
      const assets = await window.texmori.importFiles(),
        asset = assets.find((a) => a.container === "ccz")!,
        ref = await window.texmori.setKey("123456789abcdef013579bdf2468ace0");
      const unlocked = await window.texmori.refresh(asset.id, ref);
      if (unlocked.width !== 32) throw Error("Wrong decrypted dimensions");
      for (const operation of ["decode", "rewrap"] as const) {
        const plan = await window.texmori.plan([asset.id], {
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
          const stop = window.texmori.onJobs(({ jobs, running }) => {
            if (!running) {
              stop();
              jobs.some((j) => j.state === "failed")
                ? reject(Error(jobs[0].error))
                : resolve();
            }
          });
          window.texmori.start(plan.id).catch(reject);
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
        bridge: typeof window.texmori.preview,
      })),
    ).toEqual({ node: "undefined", bridge: "function" });
  } finally {
    await application.close();
    await rm(output, { recursive: true, force: true });
  }
});

test("expands to POT with nine canvas anchors and exports the visible canvas dimensions", async()=>{
 const output=await mkdtemp(path.join(await realpath(os.tmpdir()),"texmori-pot-ui-"));
 const application=await launchApp();
 try{
  const page=await application.firstWindow();
  await application.evaluate(async({dialog},input)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});},path.join(process.cwd(),"tests/fixtures/generated/odd.png"));
  await page.getByRole("button",{name:"导入图片"}).click();
  await expect(page.getByRole("heading",{name:"odd.png",exact:true})).toBeVisible();
  await page.getByLabel("尺寸处理",{exact:true}).selectOption("pad-pot");
  await expect(page.getByRole("radio",{name:"居中",exact:true})).toBeChecked();
  for(const name of ["左上","上中","右上","左中","居中","右中","左下","下中","右下"]){
   const radio=page.getByRole("radio",{name,exact:true});await radio.check();await expect(radio).toBeChecked();
  }
  await expect(page.getByText("预览已更新",{exact:true})).toBeVisible({timeout:30000});
  await page.getByLabel("输出位置").selectOption("directory");
  await application.evaluate(async({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},output);
  await page.getByRole("button",{name:"选择输出目录"}).click();
  await expect(page.getByText("预览已更新",{exact:true})).toBeVisible({timeout:30000});
  await page.screenshot({path:"build/pot-anchor-workbench.png"});
  await page.getByRole("button",{name:"开始批处理"}).click();
  await page.getByRole("button",{name:"确认并开始"}).click();
  await expect(page.getByText("批处理完成",{exact:true})).toBeVisible({timeout:30000});
  const file=await readFile(path.join(output,"odd.pkm"));
  expect(file.readUInt16BE(12)).toBe(16);expect(file.readUInt16BE(14)).toBe(16);
 }finally{await application.close();await rm(output,{recursive:true,force:true});}
});

test("groups formats alphabetically with separators and previews ASTC", async () => {
  const application = await launchApp();
  try {
    const page = await application.firstWindow();
    const select = page.getByLabel("编码格式", {exact:true});
    await expect(select.locator("option")).toHaveCount(30);
    await expect(select.locator("hr")).toHaveCount(4);
    const families = await select.locator("option").evaluateAll(nodes => [...new Set(nodes.map(n => n.textContent!.match(/^[A-Z]+/)![0]))]);
    expect(families).toEqual(["ASTC","BC","EAC","ETC","PVRTC"]);
    await select.selectOption("astc_6x6");
    await expect(page.getByLabel("质量",{exact:true})).toHaveValue("ASTCMEDIUM");
    await page.getByLabel("质量",{exact:true}).selectOption("ASTCVERYFAST");
    await application.evaluate(async ({dialog}, input) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[input]}); }, path.join(process.cwd(),"tests/fixtures/generated/odd.png"));
    await page.getByRole("button",{name:"导入图片"}).click();
    await expect(page.getByText("预览已更新",{exact:true})).toBeVisible({timeout:30000});
    await expect(page.getByRole("img",{name:"编码结果"})).toBeVisible();
    await page.screenshot({path:"build/astc-workbench.png"});
    await select.selectOption("pvrtc1_rgba_4");
    await expect(page.getByLabel("质量",{exact:true})).toHaveValue("PVRTCNORMAL");
    await select.selectOption("astc_6x6");
    await expect(page.getByLabel("质量",{exact:true})).toHaveValue("ASTCVERYFAST");
  } finally { await application.close(); }
});

test("refreshes compatible containers and shows extensions and bpp", async () => {
 const app=await launchApp();
 try {
  const page=await app.firstWindow(),codec=page.getByLabel("编码格式",{exact:true}),container=page.getByLabel("输出容器",{exact:true});
  await codec.selectOption("astc_6x6");
  await expect(codec.locator("option:checked")).toHaveText("ASTC 6×6 RGBA (3.56bpp)");
  await expect(container.locator("option")).toHaveText(["PVR (.pvr)","PVR.CCZ (.pvr.ccz)","KTX (.ktx)","KTX2 (.ktx2)","ASTC (.astc)"]);
  await page.getByLabel("Mipmap",{exact:false}).check();
  await container.selectOption("astc");
  await expect(page.getByLabel("Mipmap",{exact:false})).toBeDisabled();
  await expect(page.getByLabel("Mipmap",{exact:false})).not.toBeChecked();
  await container.selectOption("ktx2");
  await codec.selectOption("bc1");
  await expect(container).toHaveValue("ktx2");
  await expect(codec.locator("option:checked")).toHaveText("BC1 RGB (4bpp)");
  await expect(container.locator('option[value="astc"]')).toHaveCount(0);
  await codec.selectOption("etc1");
  await expect(container).toHaveValue("pkm");
  await expect(container.locator('option[value="ktx2"]')).toHaveCount(0);
 } finally {await app.close();}
});

test("defaults transparent RGB cleanup on and edits its alpha threshold", async()=>{
 const app=await launchApp();
 try {
  const page=await app.firstWindow(),cleanup=page.getByRole("checkbox",{name:"清理透明像素 RGB",exact:true}),threshold=page.getByRole("spinbutton",{name:"Alpha 阈值",exact:true});
  await expect(cleanup).toBeChecked();await expect(threshold).toHaveValue("0");
  await threshold.fill("64");await expect(threshold).toHaveValue("64");
  await cleanup.uncheck();await expect(threshold).toBeDisabled();
  await cleanup.check();await expect(threshold).toHaveValue("64");
  await page.getByLabel("编码格式",{exact:true}).selectOption("bc3");
  await expect(cleanup).toBeChecked();await expect(threshold).toHaveValue("0");
  await page.getByLabel("编码格式",{exact:true}).selectOption("etc2_rgba");
  await expect(threshold).toHaveValue("64");
  await app.evaluate(async({dialog},input)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});},path.join(process.cwd(),"tests/fixtures/generated/rgba.png"));
  await page.getByRole("button",{name:"导入图片"}).click();
  await expect(page.getByText("预览已更新",{exact:true})).toBeVisible({timeout:30000});
  await page.screenshot({path:"build/transparent-rgb-workbench.png"});
 }finally{await app.close();}
});

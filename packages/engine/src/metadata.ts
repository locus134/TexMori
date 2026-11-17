import { writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { capability, type CodecId, type Container } from "../../core/src/index";
import { runProcess } from "./process-runner";
export async function writeEncodingMetadata(
  file: string,
  codec: CodecId,
  container: Container,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (process.platform !== "darwin") return "此平台暂不支持文件备注";
  const comment = `编码格式：${capability(codec).label} (${codec})\n容器：${container === "ccz" ? "PVR.CCZ" : container.toUpperCase()}`;
  const escaped = comment
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const plist = path.join(path.dirname(file), `.texmori-${randomUUID()}.plist`);
  try {
    signal?.throwIfAborted();
    await writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><string>${escaped}</string></plist>`,
      { mode: 0o600 },
    );
    await runProcess(
      "/usr/bin/plutil",
      ["-convert", "binary1", plist],
      signal,
      10000,
    );
    await runProcess(
      "/usr/bin/xattr",
      [
        "-wx",
        "com.apple.metadata:kMDItemFinderComment",
        (await readFile(plist)).toString("hex"),
        file,
      ],
      signal,
      10000,
    );
    await runProcess(
      "/usr/bin/xattr",
      ["-w", "com.texmori.codec", codec, file],
      signal,
      10000,
    );
    await runProcess(
      "/usr/bin/xattr",
      ["-w", "com.texmori.container", container, file],
      signal,
      10000,
    );
    return undefined;
  } catch (e) {
    if (signal?.aborted) throw e;
    return "编码成功，但文件系统未能保存编码格式备注";
  } finally {
    await rm(plist, { force: true }).catch(() => {});
  }
}

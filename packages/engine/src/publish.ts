import {
  copyFile,
  link,
  unlink,
  rename,
  mkdir,
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
async function noSymlink(file: string) {
  let current = path.resolve(file);
  for (;;) {
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("输出路径不能经过符号链接");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function publishFile(
  source: string,
  target: string,
  conflict: "skip" | "overwrite" | "rename",
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  await noSymlink(target);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.cptool-${randomUUID()}.tmp`,
  );
  try {
    await copyFile(source, temporary);
    const fd = await open(temporary, "r+");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
    signal.throwIfAborted();
    await noSymlink(target);
    if (conflict === "overwrite") await rename(temporary, target);
    else
      try {
        await link(temporary, target);
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code === "EEXIST" &&
          conflict === "skip"
        )
          return false;
        throw e;
      }
    return true;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

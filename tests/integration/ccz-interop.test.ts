import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { wrapCcz } from "../../packages/containers/src/index";
import { runProcess } from "../../packages/engine/src/process-runner";
it("is read byte-for-byte by original Cocos ZipUtils across encryption thresholds and keys", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cptool-cocos-"));
  try {
    for (const size of [100, 1500, 2200, 17000])
      for (const key of [
        undefined,
        "123456789abcdef013579bdf2468ace0",
        "abcdef011234567889abcdef13579bdf",
      ]) {
        const data = randomBytes(size),
          input = path.join(dir, "input.ccz"),
          output = path.join(dir, "output.pvr");
        await writeFile(input, wrapCcz(data, 6, key));
        await runProcess(
          path.join(process.cwd(), "build/cocos-reference/verify-cocos"),
          [input, output, ...(key ? [key] : [])],
        );
        expect(await readFile(output)).toEqual(data);
      }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

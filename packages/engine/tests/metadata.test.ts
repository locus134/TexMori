import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeEncodingMetadata } from "../src/metadata";
import { publishFile } from "../src/publish";
import { runProcess } from "../src/process-runner";
it.skipIf(process.platform !== "darwin")(
  "adds readable encoding metadata to the published file without modifying its bytes",
  async () => {
    const directory = await mkdtemp(
      path.join(
        await import("node:fs/promises").then((m) => m.realpath(os.tmpdir())),
        "texmori-metadata-",
      ),
    );
    try {
      const source = path.join(directory, "encoded"),
        target = path.join(directory, "output.pkm"),
        data = Buffer.from("payload remains unchanged");
      await writeFile(source, data);
      await publishFile(
        source,
        target,
        "overwrite",
        new AbortController().signal,
        async (temporary) => {
          expect(
            await writeEncodingMetadata(temporary, "etc2_rgba", "pkm"),
          ).toBeUndefined();
        },
      );
      expect(await readFile(target)).toEqual(data);
      expect(
        (
          await runProcess("/usr/bin/xattr", ["-p", "com.texmori.codec", target])
        ).stdout.trim(),
      ).toBe("etc2_rgba");
      const comment = (
        await runProcess("/usr/bin/xattr", [
          "-px",
          "com.apple.metadata:kMDItemFinderComment",
          target,
        ])
      ).stdout.replace(/\s/g, "");
      const plist = path.join(directory, "comment.plist");
      await writeFile(plist, Buffer.from(comment, "hex"));
      expect(
        (
          await runProcess("/usr/bin/plutil", [
            "-convert",
            "xml1",
            "-o",
            "-",
            plist,
          ])
        ).stdout,
      ).toContain("ETC2 RGBA");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

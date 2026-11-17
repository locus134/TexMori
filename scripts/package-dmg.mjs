import { mkdir, rm, cp, symlink, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const stage = path.resolve("build/dmg-stage"),
  target = path.resolve(`release/CPTool-${pkg.version}-macOS-arm64.dmg`);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp("release/mac-arm64/CPTool.app", path.join(stage, "CPTool.app"), {
  recursive: true,
  verbatimSymlinks: true,
});
await symlink("/Applications", path.join(stage, "Applications"));
const pending=path.resolve(`build/CPTool-${pkg.version}-pending.dmg`);
await rm(pending, { force: true });
execFileSync('codesign',['--verify','--deep','--strict',path.join(stage,'CPTool.app')],{stdio:'pipe'});
let method = "hdiutil create";
try {
  execFileSync(
    "hdiutil",
    [
      "create",
      "-volname",
      "CPTool",
      "-srcfolder",
      stage,
      "-fs",
      "HFS+",
      "-format",
      "UDBZ",
      "-ov",
      pending,
    ],
    { stdio: "pipe", timeout: 180000 },
  );
} catch (error) {
  // User-space hybrid creation also works on hosts that prohibit image mounting.
  await rm(pending, { force: true });
  const raw = path.resolve("build/CPTool-uncompressed.dmg");
  await rm(raw, { force: true });
  method = "hdiutil makehybrid + convert";
  try {
    execFileSync(
      "hdiutil",
      [
        "makehybrid",
        "-hfs",
        "-hfs-volume-name",
        "CPTool",
        "-o",
        raw,
        "-ov",
        stage,
      ],
      { stdio: "pipe", timeout: 180000 },
    );
    execFileSync("hdiutil", ["convert", raw, "-format", "UDBZ", "-o", pending], {
      stdio: "pipe",
      timeout: 180000,
    });
  } catch (fallback) {
    throw Error(
      `DMG creation failed. create: ${String(error.stderr ?? error.message).slice(-500)}; fallback: ${String(fallback.stderr ?? fallback.message).slice(-500)}`,
    );
  } finally {
    await rm(raw, { force: true });
  }
}
const verification = execFileSync("hdiutil", ["verify", pending], {
  encoding: "utf8",
  timeout: 60000,
});
await (await import('node:fs/promises')).rename(pending,target);
await writeFile(
  "build/dmg-verification.json",
  JSON.stringify({ target, method, format:'UDBZ', verification }, null, 2),
);
console.log(`Created and verified ${target} (${method})`);

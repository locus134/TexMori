import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFixtures } from "./fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = path.join(root, "build/matrix");
await mkdir(dir, { recursive: true });
await writeFixtures(path.join(root, "tests/fixtures/generated"));
const etc = path.join(root, "build/etcpak/etcpak");
const pvr = path.join(root, "build/engines/PVRTexToolCLI");
const formats = [
  ["etc1", 6],
  ["etc2_r", 25],
  ["etc2_rg", 26],
  ["etc2_rgb", 22],
  ["etc2_rgba", 23],
  ["bc1", 7],
  ["bc3", 11],
  ["bc4", 12],
  ["bc5", 13],
  ["bc7", 15],
  ["pvrtc1_rgb_2", 0, "PVRTCI_2BPP_RGB"],
  ["pvrtc1_rgba_2", 1, "PVRTCI_2BPP_RGBA"],
  ["pvrtc1_rgb_4", 2, "PVRTCI_4BPP_RGB"],
  ["pvrtc1_rgba_4", 3, "PVRTCI_4BPP_RGBA"],
  ["pvrtc2_2", 4, "PVRTCII_2BPP"],
  ["pvrtc2_4", 5, "PVRTCII_4BPP"],
];
const report = [];
for (const [id, pixelFormat, pvrtc] of formats) {
  const target = path.join(dir, `${id}.pvr`);
  const decoded = path.join(dir, `${id}.png`);
  const input = path.join(root, "tests/fixtures/generated/rgba.png");
  const binary = pvrtc ? pvr : etc;
  const args = pvrtc
    ? [
        "-i",
        input,
        "-o",
        target,
        "-f",
        `${pvrtc},UBN,sRGB`,
        "-q",
        "PVRTCNORMAL",
      ]
    : ["-c", id, "-h", "pvr", input, target];
  try {
    execFileSync(binary, args, { timeout: 30000, stdio: "pipe" });
    const bytes = await readFile(target);
    if (
      bytes.readUInt32LE(0) !== 0x03525650 ||
      bytes.readUInt32LE(8) !== pixelFormat ||
      bytes.readUInt32LE(24) !== 32 ||
      bytes.readUInt32LE(28) !== 32
    )
      throw Error("Unexpected PVR header");
    // PVRTexTool is independent of etcpak for all ten etcpak outputs.
    // PVRTC uses the vendor decoder; independent Cocos/GPU acceptance remains separate.
    let decodeInput = target;
    if (id === "bc7") {
      decodeInput = path.join(dir, "bc7-independent-rgba.pvr");
      execFileSync(
        path.join(root, "build/bc7-independent/verify-bc7"),
        [target, decodeInput],
        { timeout: 30000, stdio: "pipe" },
      );
    }
    const decodeArgs = [
      "-i",
      decodeInput,
      "-noout",
      "-d",
      decoded,
      "-f",
      "r8g8b8a8",
    ];
    execFileSync(pvr, decodeArgs, { timeout: 30000, stdio: "pipe" });
    const png = await readFile(decoded);
    if (png.readUInt32BE(16) !== 32 || png.readUInt32BE(20) !== 32)
      throw Error("Decoded dimensions mismatch");
    report.push({
      id,
      success: true,
      command: [binary, ...args],
      decodeCommand: [pvr, ...decodeArgs],
      pixelFormat,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      decoder: pvrtc
        ? "vendor (independent loading pending)"
        : id === "bc7"
          ? "bc7decomp (independent)"
          : "PVRTexTool (independent)",
    });
  } catch (error) {
    report.push({ id, success: false, error: String(error) });
  }
}
await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
console.log(
  report
    .map(
      (r) =>
        `${r.success ? "PASS" : "FAIL"} ${r.id}${r.success ? ` ${r.bytes} bytes` : " " + r.error.slice(0, 180)}`,
    )
    .join("\n"),
);
if (report.some((r) => !r.success)) process.exitCode = 1;

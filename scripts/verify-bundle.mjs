import { execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
const app = process.argv[2] ?? "release/mac-arm64/CPTool.app",
  resources = path.join(app, "Contents/Resources");
const report = { app, architecture: "arm64", minimumMacOS: "13.0", checks: [] };
for (const name of ["etcpak", "PVRTexToolCLI"]) {
  const binary = path.join(resources, "engines", name);
  await access(binary);
  const architecture = execFileSync("file", [binary], { encoding: "utf8" }),
    dependencies = execFileSync("otool", ["-L", binary], { encoding: "utf8" });
  if (
    !architecture.includes("arm64") ||
    dependencies.includes("/opt/homebrew") ||
    dependencies.includes("/usr/local/")
  )
    throw Error(`Nonportable ${name}`);
  report.checks.push({ name, architecture, dependencies });
}
for (const file of [
  "licenses/THIRD_PARTY_NOTICES.md",
  "licenses/PowerVR-Tools-License.html",
  "licenses/components/etcpak-LICENSE.txt",
])
  await access(path.join(resources, file));
execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "pipe",
});
report.signing = "ad-hoc; not Developer ID signed or notarized";
report.cleanMachineVerified = false;
await writeFile(
  "build/bundle-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(
  "Bundle architecture, dependencies, notices and ad-hoc signature verified.",
);

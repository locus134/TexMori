import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  cp,
  access,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
await mkdir("build/icon.iconset", { recursive: true });
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const image = await sharp("apps/desktop/resources/icon.svg")
    .resize(size)
    .png()
    .toBuffer();
  if (size <= 512)
    await writeFile(`build/icon.iconset/icon_${size}x${size}.png`, image);
  if (size >= 32)
    await writeFile(
      `build/icon.iconset/icon_${size / 2}x${size / 2}@2x.png`,
      image,
    );
}
execFileSync("iconutil", [
  "-c",
  "icns",
  "build/icon.iconset",
  "-o",
  "build/icon.icns",
]);
await mkdir("build/licenses", { recursive: true });
await cp("etcpak/LICENSE.txt", "build/licenses/etcpak-LICENSE.txt");
const tracy = "build/etcpak/.cpm-cache/tracy/462f/LICENSE";
await cp(tracy, "build/licenses/Tracy-LICENSE.txt");
let pngLicense;
for (const file of [
  "/opt/homebrew/opt/libpng/share/doc/libpng/LICENSE",
  "/opt/homebrew/opt/libpng/LICENSE",
  "/opt/homebrew/opt/libpng/share/doc/libpng/libpng-LICENSE.txt",
])
  try {
    pngLicense = await readFile(file);
    break;
  } catch {}
if (!pngLicense) {
  const r = await fetch(
    "https://raw.githubusercontent.com/pnggroup/libpng/v1.6.58/LICENSE",
  );
  if (!r.ok) throw Error("libpng license unavailable");
  pngLicense = Buffer.from(await r.arrayBuffer());
}
await writeFile("build/licenses/libpng-LICENSE.txt", pngLicense);
const lines = [
  "# Third-party notices",
  "",
  "This product includes components of the PowerVR Tools Software from Imagination Technologies Limited",
  "",
  "PowerVR Tools is distributed only as an integrated component under its bundled EULA (PowerVR-Tools-License.html). No endorsement is implied.",
  "",
  "Native components: etcpak (BSD-style), Tracy (BSD-3-Clause), libpng (libpng license), system zlib. Full notices accompany this file.",
  "",
  "## JavaScript and image runtime dependencies",
  "",
];
const seen = new Set();
async function collect(directory) {
  const file = path.join(directory, "package.json");
  let info;
  try {
    info = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return;
  }
  const key = `${info.name}@${info.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  lines.push(
    `- ${key} — ${typeof info.license === "string" ? info.license : JSON.stringify(info.license ?? "See bundled license")}`,
  );
  const target = path.join("build/licenses", info.name.replaceAll("/", "-"));
  await mkdir(target, { recursive: true });
  if (info.name.startsWith("@img/sharp-libvips"))
    for (const file of ["README.md", "versions.json"])
      await cp(path.join(directory, file), path.join(target, file));
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (
      entry.isFile() &&
      /license|copying|notice|third.party/i.test(entry.name)
    )
      await cp(path.join(directory, entry.name), path.join(target, entry.name));
  for (const dep of Object.keys({
    ...info.dependencies,
    ...info.optionalDependencies,
  })) {
    const local = path.join(directory, "node_modules", dep),
      top = path.join("node_modules", dep);
    try {
      await access(local);
      await collect(local);
    } catch {
      await collect(top);
    }
  }
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const dep of Object.keys(pkg.dependencies))
  await collect(path.join("node_modules", dep));
lines.push(
  "",
  "Electron and Chromium third-party notices are included by the Electron distribution.",
  "Image runtime packages include libvips and its associated component notices; source and license references are retained in their bundled notices.",
  "",
);
await writeFile("THIRD_PARTY_NOTICES.md", lines.join("\n"));
await cp('apps/desktop/resources/licenses','build/licenses/legal-texts',{recursive:true});
console.log(`Prepared icon and notices for ${seen.size} runtime packages.`);

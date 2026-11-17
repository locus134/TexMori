import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = path.join(root, "build/etcpak-source");
await mkdir(source, { recursive: true });
await cp(path.join(root, "etcpak"), source, {
  recursive: true,
  filter: (file) => !file.split(path.sep).includes(".git"),
});
let cmake = await readFile(path.join(source, "CMakeLists.txt"), "utf8");
cmake = cmake
  .replace("GIT_TAG master", "GIT_TAG 5d542dc09f3d9378d005092a4ad446bd405f819a")
  .replace(
    "pkg_check_modules(PNG REQUIRED libpng)",
    "find_package(PNG REQUIRED)",
  )
  .replace(
    "Tracy::TracyClient ${PNG_LIBRARIES}",
    "Tracy::TracyClient PNG::PNG",
  );
await writeFile(path.join(source, "CMakeLists.txt"), cmake);
const pngPrefix = execFileSync("pkg-config", ["--variable=prefix", "libpng"], {
  encoding: "utf8",
}).trim();
execFileSync(
  "cmake",
  [
    "-S",
    source,
    "-B",
    path.join(root, "build/etcpak"),
    "-DCMAKE_BUILD_TYPE=Release",
    "-DMARCH_NATIVE=OFF",
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0",
    `-DPNG_LIBRARY=${pngPrefix}/lib/libpng16.a`,
    `-DPNG_PNG_INCLUDE_DIR=${pngPrefix}/include`,
  ],
  { stdio: "inherit" },
);
execFileSync("cmake", ["--build", path.join(root, "build/etcpak"), "-j", "8"], {
  stdio: "inherit",
});

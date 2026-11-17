import { mkdir, writeFile, access, cp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const url = 'https://pvr-sdk-live.s3.us-east-1.amazonaws.com/sdk/OFFLINE/PVRTexToolSetup-2023_R1.pkg';
const archive = path.join(root, 'build/downloads/PVRTexToolSetup-2023_R1.pkg');
await mkdir(path.dirname(archive), { recursive: true });
try { await access(archive); } catch {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const expanded = path.join(root, 'build/pvr-package');
try { await access(expanded); } catch {
  execFileSync('pkgutil', ['--expand-full', archive, expanded]);
}
const binary = path.join(expanded, 'PVRTexTool.pkg/Payload/CLI/macOS/PVRTexToolCLI');
await mkdir(path.join(root, 'build/engines'), { recursive: true });
await cp(binary, path.join(root, 'build/engines/PVRTexToolCLI'));
await cp(path.join(expanded, 'Resources/license.html'), path.join(root, 'build/engines/PowerVR-Tools-License.html'));
const report = {
  url, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
  version: execFileSync(binary, ['-help'], { encoding: 'utf8' }).split('\n').slice(0, 2),
  architecture: execFileSync('file', [binary], { encoding: 'utf8' }),
  dependencies: execFileSync('otool', ['-L', binary], { encoding: 'utf8' }),
};
await writeFile(path.join(root, 'build/pvrtc-probe.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version: report.version, archiveSha256: report.archiveSha256 }));

import { readdir, lstat, stat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { capability, type Asset } from "../../core/src/index";
import { inspectTexture, unwrapCcz } from "../../containers/src/index";
const supported = /\.(png|jpe?g|webp|pkm|dds|pvr|ccz)$/i;
export class AssetService {
  readonly assets = new Map<string, Asset>();
  private seen = new Set<string>();
  clear(ids?: string[]) {
    for (const [id, asset] of this.assets)
      if (!ids || ids.includes(id)) {
        this.assets.delete(id);
        this.seen.delete(asset.path);
      }
  }
  get(id: string) {
    const asset = this.assets.get(id);
    if (!asset) throw Error("资源不存在，请重新导入");
    return asset;
  }
  async import(
    paths: string[],
    signal: AbortSignal,
    outputDirectory?: string,
  ): Promise<Asset[]> {
    const result: Asset[] = [];
    const excluded = outputDirectory
      ? await realpath(outputDirectory).catch(() =>
          path.resolve(outputDirectory),
        )
      : undefined;
    const registerError = (file: string, root: string) => {
      const asset: Asset = {
        id: randomUUID(),
        name: path.basename(file),
        path: path.resolve(file),
        root,
        relativePath: path.relative(root, file),
        container: "unsupported",
        width: 0,
        height: 0,
        encodedWidth: 0,
        encodedHeight: 0,
        alpha: false,
        size: 0,
        fingerprint: "",
        encrypted: false,
        error: "无法读取输入文件或目录",
      };
      this.assets.set(asset.id, asset);
      result.push(asset);
    };
    const visitUnsafe = async (file: string, root: string) => {
      signal.throwIfAborted();
      const ls = await lstat(file);
      if (ls.isSymbolicLink()) {
        const s = await stat(file).catch(() => null);
        if (!s || s.isDirectory()) return;
      }
      const resolved = await realpath(file);
      if (ls.isDirectory()) {
        if (
          excluded &&
          excluded !== root &&
          (resolved === excluded || resolved.startsWith(excluded + path.sep))
        )
          return;
        for (const entry of await readdir(resolved, { withFileTypes: true })) {
          if (entry.name.startsWith(".texmori-")) continue;
          await visit(path.join(resolved, entry.name), root);
        }
        return;
      }
      if (!supported.test(file) || this.seen.has(resolved)) return;
      this.seen.add(resolved);
      const asset = await this.probe(resolved, root);
      this.assets.set(asset.id, asset);
      result.push(asset);
    };
    const visit = async (file: string, root: string) => {
      try {
        await visitUnsafe(file, root);
      } catch (e) {
        if (signal.aborted) throw e;
        registerError(file, root);
      }
    };
    for (const file of paths) {
      signal.throwIfAborted();
      try {
        const resolved = await realpath(file),
          s = await stat(resolved);
        await visit(file, s.isDirectory() ? resolved : path.dirname(resolved));
      } catch (e) {
        if (signal.aborted) throw e;
        registerError(file, path.dirname(path.resolve(file)));
      }
    }
    return result;
  }
  async probe(
    file: string,
    root: string,
    key?: string,
    id: string = randomUUID(),
  ): Promise<Asset> {
    const s = await stat(file);
    const asset: Asset = {
      id,
      name: path.basename(file),
      path: file,
      root,
      relativePath: path.relative(root, file),
      container: "unsupported",
      width: 0,
      height: 0,
      encodedWidth: 0,
      encodedHeight: 0,
      alpha: false,
      size: s.size,
      fingerprint: createHash("sha256")
        .update(`${file}:${s.size}:${s.mtimeMs}`)
        .digest("hex"),
      encrypted: false,
    };
    try {
      if (s.size > 256 * 1024 * 1024) throw Error("输入文件超过 256 MiB 限制");
      const data = await readFile(file),
        sig = data.subarray(0, 4).toString();
      if (sig === "CCZp" || sig === "CCZ!") {
        asset.container = "ccz";
        asset.encrypted = sig === "CCZp";
        if (asset.encrypted && !key) {
          asset.error = "需要输入加密密钥";
          return asset;
        }
        const t = inspectTexture(unwrapCcz(data, key));
        if (t.container !== "pvr") throw Error("CCZ 内容不是受支持的 PVR");
        Object.assign(asset, t, {
          container: "ccz",
          alpha: capability(t.codec).channels.includes("A"),
        });
      } else if (
        sig === "PKM " ||
        sig === "DDS " ||
        (data.length >= 4 && data.readUInt32LE(0) === 0x03525650)
      ) {
        const t = inspectTexture(data);
        Object.assign(asset, t, {
          alpha: capability(t.codec).channels.includes("A"),
        });
      } else {
        const metadata = await sharp(data, {
          limitInputPixels: 16384 * 16384,
        }).metadata();
        if (
          !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
          (metadata.pages ?? 1) > 1
        )
          throw Error("只支持 PNG/JPEG/WebP 静态图片");
        const rotated = metadata.orientation && metadata.orientation >= 5;
        asset.width = (rotated ? metadata.height : metadata.width) ?? 0;
        asset.height = (rotated ? metadata.width : metadata.height) ?? 0;
        asset.encodedWidth = asset.width;
        asset.encodedHeight = asset.height;
        asset.container = "image";
        asset.alpha = !!metadata.hasAlpha;
      }
    } catch (e) {
      asset.error = e instanceof Error ? e.message : "输入文件损坏";
    }
    return asset;
  }
  async refresh(id: string, key?: string) {
    const a = this.get(id);
    let next: Asset;
    try {
      next = await this.probe(a.path, a.root, key, id);
    } catch {
      next = { ...a, error: "无法读取输入文件或目录" };
    }
    this.assets.set(id, next);
    return next;
  }
}

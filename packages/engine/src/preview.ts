export class PreviewCache<T extends object> {
  private latest = 0;
  private entries = new Map<string, T>();
  clear() {
    this.entries.clear();
    this.latest++;
  }
  async request(
    key: string,
    version: number,
    build: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T & { version: number }> {
    if (!Number.isSafeInteger(version) || version < this.latest)
      throw Error("预览请求已过期");
    this.latest = version;
    signal.throwIfAborted();
    const result = this.entries.get(key) ?? (await build());
    signal.throwIfAborted();
    if (version !== this.latest) throw Error("预览请求已过期");
    this.entries.set(key, result);
    if (this.entries.size > 12)
      this.entries.delete(this.entries.keys().next().value!);
    return { ...result, version };
  }
}

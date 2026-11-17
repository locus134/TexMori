import { useEffect, useState } from "react";
import { tinifyFormats } from "../../../../packages/core/src/tinify-formats";
import type { TinifyOptions } from "../../../../packages/core/src/tinify";
import type { TinifyKeyStatus } from "../api";
const api = window.texmori;
export function TinifySettings({
  value,
  onChange,
  running,
  onError,
}: {
  value: TinifyOptions;
  onChange: (value: TinifyOptions) => void;
  running: boolean;
  onError: (e: unknown) => void;
}) {
  const [keys, setKeys] = useState<TinifyKeyStatus[]>([]),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [storageError, setStorageError] = useState(""),
    [encrypted, setEncrypted] = useState(true);
  const [convert, setConvert] = useState(value.formats.length > 0);
  useEffect(() => {
    let live = true;
    api
      .tinifyKeys()
      .then((state) => {
        if (live) {
          setKeys(state.keys);
          setStorageError(state.storageError ?? "");
          setEncrypted(state.encrypted);
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [running]);
  const change = (p: Partial<TinifyOptions>) => onChange({ ...value, ...p });
  async function add() {
    setBusy(true);
    try {
      setKeys(await api.addTinifyKey(draft));
      setDraft("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      setKeys(await api.removeTinifyKey(id));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="tinify-settings">
        <h3>TinyPNG API Key</h3>
        <p className="tinify-note">
          {keys.length} 个 Key · 最多并行 {keys.length} 个任务
        </p>
        <p className="tinify-note">
          每个 Key 同时处理一个文件；同一账户的 Key 共享额度。
        </p>
        {storageError && (
          <p role="alert" className="failed">
            {storageError}
          </p>
        )}
        {!encrypted && (
          <p role="alert" className="warning">
            系统安全存储不可用，暂时无法添加 Key。
          </p>
        )}
        <ul className="tinify-key-list">
          {keys.map((key, i) => (
            <li key={key.id}>
              <div>
                <strong>
                  Key {i + 1} · {key.masked}
                </strong>
                <small>
                  {key.error ??
                    (key.count === undefined
                      ? "使用后更新用量"
                      : `本月已使用 ${key.count} 次（UTC）`)}
                </small>
              </div>
              <button
                aria-label={`删除 API Key ${i + 1}`}
                disabled={running || busy}
                onClick={() => void remove(key.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        <label>
          新的 API Key
          <input
            aria-label="新的 TinyPNG API Key"
            type="password"
            value={draft}
            maxLength={256}
            autoComplete="off"
            spellCheck={false}
            disabled={running || busy || !encrypted || !!storageError}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && !busy) void add();
            }}
          />
        </label>
        <button
          disabled={
            running || busy || !draft.trim() || !encrypted || !!storageError
          }
          onClick={() => void add()}
        >
          {busy ? "保存中…" : "添加 API Key"}
        </button>
        <small>通过系统安全存储加密保存在本机，仅显示末四位。</small>
      </section>
      <section className="tinify-settings">
        <h3>云端压缩参数</h3>
        <p className="tinify-note">
          图片将上传至 TinyPNG。压缩质量由服务自动优化，无质量等级参数。
        </p>
        <label>
          输出格式策略
          <select
            aria-label="输出格式策略"
            value={convert ? "convert" : "keep"}
            onChange={(e) => {
              const next = e.target.value === "convert";
              setConvert(next);
              change({ formats: next ? ["png"] : [], background: undefined });
            }}
          >
            <option value="keep">保持原格式（HEIC 输出 JPEG）</option>
            <option value="convert">指定格式 / 自动选择最小格式</option>
          </select>
        </label>
        {convert && (
          <fieldset className="tinify-formats">
            <legend>输出格式（多选时返回最小者）</legend>
            {tinifyFormats.map((format) => (
              <label key={format} className="check">
                <input
                  type="checkbox"
                  checked={value.formats.includes(format)}
                  onChange={(e) => {
                    const formats = e.target.checked
                      ? [...value.formats, format]
                      : value.formats.filter((f) => f !== format);
                    if (!formats.length) return;
                    change({
                      formats,
                      ...(formats.includes("jpeg")
                        ? { background: value.background ?? "#ffffff" }
                        : { background: undefined }),
                    });
                  }}
                />
                {format.toUpperCase()}
              </label>
            ))}
          </fieldset>
        )}
        {value.formats.includes("jpeg") && (
          <label>
            透明背景填充
            <input
              aria-label="透明背景填充"
              type="color"
              value={value.background ?? "#ffffff"}
              onChange={(e) => change({ background: e.target.value })}
            />
          </label>
        )}
        <label>
          尺寸处理
          <select
            aria-label="TinyPNG 尺寸处理"
            value={value.resize?.method ?? "keep"}
            onChange={(e) => {
              const method = e.target.value as
                "keep" | NonNullable<TinifyOptions["resize"]>["method"];
              change({
                resize:
                  method === "keep"
                    ? undefined
                    : method === "scale"
                      ? { method, width: 1024 }
                      : { method, width: 1024, height: 1024 },
              });
            }}
          >
            <option value="keep">保持原尺寸</option>
            <option value="scale">等比缩放 · 指定宽或高</option>
            <option value="fit">适应范围 · 保持比例</option>
            <option value="cover">智能裁剪 · 填满范围</option>
            <option value="thumb">智能缩略图 · 主体优先</option>
          </select>
        </label>
        {value.resize?.method === "scale" && (
          <label>
            缩放依据
            <select
              aria-label="缩放依据"
              value={value.resize.width !== undefined ? "width" : "height"}
              onChange={(e) =>
                change({
                  resize: {
                    method: "scale",
                    [e.target.value]:
                      value.resize?.width ?? value.resize?.height ?? 1024,
                  },
                })
              }
            >
              <option value="width">宽度</option>
              <option value="height">高度</option>
            </select>
          </label>
        )}
        {value.resize && (
          <div className="tinify-dimensions">
            {(["width", "height"] as const)
              .filter(
                (axis) =>
                  value.resize?.method !== "scale" ||
                  value.resize[axis] !== undefined,
              )
              .map((axis) => (
                <label key={axis}>
                  {axis === "width" ? "目标宽度" : "目标高度"}
                  <input
                    aria-label={axis === "width" ? "目标宽度" : "目标高度"}
                    type="number"
                    min={1}
                    max={150000}
                    step={1}
                    value={value.resize?.[axis] ?? ""}
                    onChange={(e) =>
                      change({
                        resize: {
                          ...value.resize!,
                          [axis]:
                            e.target.value === "" ? 0 : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
          </div>
        )}
        {value.resize && (
          <small>不会放大图片。服务端根据原始尺寸决定最终尺寸。</small>
        )}
        <fieldset className="tinify-formats">
          <legend>保留元数据（默认移除）</legend>
          {(["copyright", "creation", "location"] as const).map((key, i) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={value.preserve.includes(key)}
                disabled={
                  key === "location" &&
                  value.formats.length === 1 &&
                  value.formats[0] === "png"
                }
                onChange={(e) =>
                  change({
                    preserve: e.target.checked
                      ? [...value.preserve, key]
                      : value.preserve.filter((k) => k !== key),
                  })
                }
              />
              {["版权", "创建时间", "GPS 位置（PNG 不支持）"][i]}
            </label>
          ))}
        </fieldset>
        <small>
          压缩通常计 1 次；调整尺寸或转换格式的派生请求额外计 1
          次，保留元数据不额外计数。
        </small>
        <small>输出名称添加 .tiny 后缀；多格式输出在完成后确定扩展名。</small>
      </section>
    </>
  );
}

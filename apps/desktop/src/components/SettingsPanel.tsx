import type {
  CodecCapability,
  ConversionRequest,
} from "../../../../packages/core/src/index";
import { codecFamily, codecQualities, defaultQuality, codecLabel, containerLabel, usesEncoderPremultiply } from "../../../../packages/core/src/capabilities";
import { Fragment, useState } from "react";
import { TinifySettings } from "./TinifySettings";
export function KeyInput({
  label,
  value,
  onChange,
  onCommit,
  onGenerate,
  onExample,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onGenerate?: () => void;
  onExample?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="key-control">
      <label>
        {label}
        <input
          aria-label={label}
          type={visible ? "text" : "password"}
          value={value}
          placeholder="32 位十六进制密钥"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      </label>
      <div className="inline-actions">
        <button onClick={() => setVisible(!visible)}>
          {visible ? "隐藏" : "显示"}
        </button>
        <button
          disabled={!value}
          onClick={() => navigator.clipboard.writeText(value)}
        >
          复制
        </button>
        {onGenerate && <button onClick={onGenerate}>生成</button>}
        {onExample && (
          <button disabled={!value} onClick={onExample}>
            Cocos 示例
          </button>
        )}
      </div>
      <small>仅在当前会话保存</small>
    </div>
  );
}
export function SettingsPanel({
  running,
  onError,
  request,
  capabilities,
  onChange,
  onCodec,
  output,
  onOutput,
  onOutputDraft,
  onOutputBlur,
  inputKey,
  setInputKey,
  commitInputKey,
  outputKey,
  setOutputKey,
  commitOutputKey,
  generateOutputKey,
  copyExample,
}: {
  running: boolean;
  onError: (e: unknown) => void;
  request: ConversionRequest;
  capabilities: CodecCapability[];
  onChange: (p: Partial<ConversionRequest>) => void;
  onCodec: (id: string) => void;
  output?: string;
  onOutput: () => void;
  onOutputDraft: (value: string) => void;
  onOutputBlur: () => void;
  inputKey: string;
  setInputKey: (s: string) => void;
  commitInputKey: () => void;
  outputKey: string;
  setOutputKey: (s: string) => void;
  commitOutputKey: () => void;
  generateOutputKey: () => void;
  copyExample: () => void;
}) {
  const c = capabilities.find((c) => c.id === request.codec),
    encode = request.operation === "encode";
  const encoderPremultiply = usesEncoderPremultiply(c, request.container);
  const premultiplyLabel = encoderPremultiply ? "预乘 alpha（编码器）" : "预乘 alpha";
  const option = (key: string, value: unknown) =>
    onChange({ options: { ...request.options, [key]: value } });
  return (
    <aside className="settings-panel">
      <div className="panel-heading">
        <h2>输出设置</h2>
        <span>
          {request.operation === "tinify" ? "TinyPNG 云端处理" : "本地处理"}
        </span>
      </div>
      <section>
        <label>
          操作
          <select
            aria-label="操作"
            value={request.operation}
            onChange={(e) =>
              onChange({
                operation: e.target.value as ConversionRequest["operation"],
              })
            }
          >
            <option value="encode">编码 / 重新编码</option>
            <option value="decode">解码为 PNG</option>
            <option value="rewrap">只换 PVR / CCZ 容器</option>
            <option value="tinify">TinyPNG 压缩 / 格式转换</option>
          </select>
        </label>
        {encode && (
          <label>
            编码格式
            <select
              aria-label="编码格式"
              value={request.codec}
              onChange={(e) => onCodec(e.target.value)}
            >
              {capabilities.map((c, index) => (
                <Fragment key={c.id}>
                {index > 0 && codecFamily(c) !== codecFamily(capabilities[index - 1]) && <hr />}
                <option
                  key={c.id}
                  value={c.id}
                  disabled={c.available === false}
                >
                  {codecLabel(c)}
                  {c.available === false ? " · 不可用" : ""}
                </option>
                </Fragment>
              ))}
            </select>
          </label>
        )}
        {request.operation !== "tinify" && (
          <label>
            输出容器
            <select
              aria-label="输出容器"
              value={request.container}
              disabled={request.operation === "decode"}
              onChange={(e) =>
                onChange({
                  container: e.target.value as ConversionRequest["container"],
                  encrypt: false,
                  outputKeyRef: undefined,
                })
              }
            >
              {(encode
                ? (c?.containers ?? [])
                : request.operation === "decode"
                  ? ["png"]
                  : ["pvr", "ccz"]
              ).map((v) => (
                <option key={v} value={v}>
                  {containerLabel(v)}
                </option>
              ))}
            </select>
          </label>
        )}
        {encode && request.container === "astc" && <small>.astc 仅保存单层纹理，不记录 sRGB / Linear，加载时需指定色彩空间。</small>}
        {encode && request.container === "dds" && c?.id.startsWith("pvrtc") && <small>PVRTC 的 DDS 使用 PowerVR 扩展，加载器需支持 PTC2 / PTC4。</small>}
        {c && encode && (
          <div className="format-note">
            <span>{c.channels}</span>
            <span>{Number(c.bpp.toFixed(2))} bpp</span>
            <span>{c.engine === "pvrtc" ? "PVRTexTool" : "etcpak"}</span>
          </div>
        )}
      </section>
      {request.operation === "tinify" && (
        <TinifySettings
          value={request.tinify ?? { formats: [], preserve: [] }}
          onChange={(tinify) => onChange({ tinify })}
          running={running}
          onError={onError}
        />
      )}
      {encode && (
        <section>
          <h3>编码参数</h3>
          <div className="transparent-rgb-control" title="压缩前将 Alpha 小于或等于阈值的像素 RGB 置为 (0,0,0)，Alpha 保持不变，原文件不会修改">
            <label className="check">
              <input
                aria-label="清理透明像素 RGB"
                type="checkbox"
                checked={request.options.cleanTransparentRgb !== false}
                onChange={(e) => option("cleanTransparentRgb", e.target.checked)}
              />
              清理透明像素 RGB
            </label>
            <label className="alpha-threshold">
              <span>Alpha ≤</span>
              <input
                aria-label="Alpha 阈值"
                type="number"
                min="0"
                max="255"
                step="1"
                value={request.options.alphaThreshold ?? 0}
                disabled={request.options.cleanTransparentRgb === false}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (Number.isFinite(value)) option("alphaThreshold", Math.max(0, Math.min(255, Math.round(value))));
                  else if (!e.target.value) option("alphaThreshold", 0);
                }}
              />
            </label>
          </div>
          <label
            className="check"
            title={encoderPremultiply
              ? "由编码器预乘 Alpha，并在 PVR 输出中记录预乘标记"
              : "压缩前按通道执行 RGB × Alpha / 255，Alpha 保持不变，原文件不会修改"}
          >
            <input
              type="checkbox"
              checked={!!(request.options.premultiply || request.options.multiplyRgbByAlpha)}
              onChange={(e) => {
                const options = { ...request.options };
                delete options.premultiply;
                delete options.multiplyRgbByAlpha;
                if (e.target.checked) options[encoderPremultiply ? "premultiply" : "multiplyRgbByAlpha"] = true;
                onChange({ options });
              }}
            />
            {premultiplyLabel}
          </label>
          {["etc1", "bc1"].includes(request.codec!) && (
            <label className="check">
              <input
                aria-label="抖动"
                type="checkbox"
                checked={!!request.options.dither}
                onChange={(e) => option("dither", e.target.checked)}
              />
              抖动
            </label>
          )}
          {["etc2_rgb", "etc2_rgba"].includes(request.codec!) && (
            <label className="check">
              <input
                type="checkbox"
                checked={request.options.heuristics !== false}
                onChange={(e) => option("heuristics", e.target.checked)}
              />
              启发式模式选择
            </label>
          )}
          <label
            className="check"
            title={
              ["pkm", "astc"].includes(request.container) ? "PKM 只能保存单层纹理" : undefined
            }
          >
            <input
              aria-label="Mipmap"
              type="checkbox"
              disabled={["pkm", "astc"].includes(request.container)}
              checked={!!request.options.mipmaps}
              onChange={(e) => {
                const next = { ...request.options, mipmaps: e.target.checked };
                if (!e.target.checked) delete next.mipFilter;
                onChange({ options: next });
              }}
            />
            Mipmap{["pkm", "astc"].includes(request.container) && <small>当前容器不支持</small>}
          </label>
          {c?.engine === "pvrtc" && (
            <>
              <label>
                质量
                <select
                  aria-label="质量"
                  value={request.options.quality ?? defaultQuality(c.id)}
                  onChange={(e) => option("quality", e.target.value)}
                >
                  {codecQualities(c.id).map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </label>
              {request.options.mipmaps && (
                <label>
                  Mipmap 滤镜
                  <select
                    value={request.options.mipFilter ?? "linear"}
                    onChange={(e) => option("mipFilter", e.target.value)}
                  >
                    <option value="nearest">最近邻</option>
                    <option value="linear">线性</option>
                    <option value="cubic">立方</option>
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            输入色彩空间
            <select
              value={request.colorSpace}
              onChange={(e) =>
                onChange({ colorSpace: e.target.value as "srgb" | "linear" })
              }
            >
              <option value="srgb">sRGB · 颜色纹理</option>
              <option value="linear">Linear · 线性数据</option>
            </select>
          </label>
          <small>
            图片先统一为 sRGB 工作图；Linear 将其通道数值按线性数据解释。
          </small>
          <label>
            尺寸处理
            <select
              aria-label="尺寸处理"
              value={request.sizeMode}
              onChange={(e) =>
                onChange({
                  sizeMode: e.target.value as ConversionRequest["sizeMode"],
                })
              }
            >
              <option value="keep">保持尺寸</option>
              <option value="pad">边缘复制补齐</option>
              <option value="pad-pot">透明扩展至 POT（2 的幂）</option>
              <option value="resize">缩放至合法尺寸</option>
            </select>
          </label>
          {request.sizeMode === "pad-pot" && (
            <div>
              <fieldset className="pot-anchor" aria-describedby="pot-anchor-help">
                <legend>画布对齐</legend>
                <div className="pot-anchor-grid">
                  {([
                    ["top-left", "左上", "↖"], ["top", "上中", "↑"], ["top-right", "右上", "↗"],
                    ["left", "左中", "←"], ["center", "居中", "●"], ["right", "右中", "→"],
                    ["bottom-left", "左下", "↙"], ["bottom", "下中", "↓"], ["bottom-right", "右下", "↘"],
                  ] as const).map(([value, label, symbol]) => (
                    <label key={value} title={label}>
                      <input type="radio" name="pot-anchor" aria-label={label}
                        checked={(request.padAnchor ?? "center") === value}
                        onChange={() => onChange({ padAnchor: value })} />
                      <span aria-hidden="true">{symbol}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            <small id="pot-anchor-help">
              按所选方向对齐，新增区域透明填充，不缩放。输出宽高向上扩展至 2 的幂。
              {c && !c.channels.includes("A") && "当前编码不保留 Alpha，填充区域将不透明。"}
            </small>
            </div>
          )}
        </section>
      )}
      {request.container === "ccz" && (
        <section>
          <h3>CCZ 包装</h3>
          <label>
            压缩等级 <span className="numeric">{request.cczLevel}</span>
            <input
              aria-label="CCZ 压缩等级"
              type="range"
              min="0"
              max="9"
              value={request.cczLevel}
              onChange={(e) => onChange({ cczLevel: +e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={request.encrypt}
              onChange={(e) => onChange({ encrypt: e.target.checked })}
            />
            内容加密
          </label>
          {request.encrypt && (
            <KeyInput
              label="输出加密密钥"
              value={outputKey}
              onChange={setOutputKey}
              onCommit={commitOutputKey}
              onGenerate={generateOutputKey}
              onExample={copyExample}
            />
          )}
        </section>
      )}
      {request.operation !== "tinify" && (
        <details>
          <summary>加密输入</summary>
          <KeyInput
            label="输入解密密钥"
            value={inputKey}
            onChange={setInputKey}
            onCommit={commitInputKey}
          />
        </details>
      )}
      <section>
        <h3>输出位置</h3>
        <label>
          输出位置
          <select
            aria-label="输出位置"
            value={request.output.mode}
            onChange={(e) =>
              onChange({
                output: {
                  ...request.output,
                  mode: e.target.value as "source" | "directory",
                },
              })
            }
          >
            <option value="source">原目录</option>
            <option value="directory">指定目录 · 保留层级</option>
          </select>
        </label>
        {request.output.mode === "directory" && (
          <>
            <label>
              目录路径
              <input
                aria-label="导出目录路径"
                type="text"
                value={output ?? ""}
                placeholder="输入完整目录路径"
                title={output}
                spellCheck={false}
                onChange={(e) => onOutputDraft(e.target.value)}
                onBlur={onOutputBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <button className="full-width" onClick={onOutput}>
              选择输出目录
            </button>
          </>
        )}
        <label>
          目标已存在
          <select
            value={request.output.conflict}
            onChange={(e) =>
              onChange({
                output: {
                  ...request.output,
                  conflict: e.target.value as "skip" | "overwrite" | "rename",
                },
              })
            }
          >
            <option value="skip">跳过（默认）</option>
            <option value="overwrite">覆盖目标文件</option>
            <option value="rename">自动重命名</option>
          </select>
        </label>
        <small>保留源图片。覆盖仅替换目标文件。</small>
      </section>
    </aside>
  );
}

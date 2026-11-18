import type {
  CodecCapability,
  ConversionRequest,
  Job,
  PreviewResult,
} from "../../../packages/core/src/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  capability,
  targetDimensions,
} from "../../../packages/core/src/capabilities";
import type { DesktopAsset, PlanSummary } from "./api";
import { AssetList } from "./components/AssetList";
import { SettingsPanel } from "./components/SettingsPanel";
import { PreviewCanvas } from "./components/PreviewCanvas";
const api = window.texmori;
const initial: ConversionRequest = {
  operation: "encode",
  codec: "etc2_rgba",
  container: "pkm",
  options: {},
  sizeMode: "keep",
  padAnchor: "center",
  colorSpace: "srgb",
  cczLevel: 6,
  encrypt: false,
  output: { mode: "source", conflict: "skip" },
};
function bytes(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1048576).toFixed(2)} MiB`;
}
export function App() {
  const [assets, setAssets] = useState<DesktopAsset[]>([]),
    [selected, setSelected] = useState<string>(),
    [caps, setCaps] = useState<CodecCapability[]>([]),
    [request, setRequest] = useState(initial),
    [outputDraft, setOutputDraft] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]),
    [running, setRunning] = useState(false),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PreviewResult>(),
    [previewState, setPreviewState] = useState<
      "empty" | "stale" | "loading" | "current"
    >("empty"),
    [plan, setPlan] = useState<PlanSummary>(),
    [planning, setPlanning] = useState(false);
  const [inputKey, setInputKey] = useState(""),
    [outputKey, setOutputKey] = useState(""),
    [inputRef, setInputRef] = useState<string>(),
    [outputRef, setOutputRef] = useState<string>(),
    [showList, setShowList] = useState(true),
    [showSettings, setShowSettings] = useState(true);
  const version = useRef(0),
    outputRevision = useRef(0),
    saved = useRef(new Map<string, Partial<ConversionRequest>>()),
    review = useRef<HTMLDialogElement>(null);
  const asset = assets.find((a) => a.id === selected);
  const effective = useMemo(
    () => ({
      ...request,
      inputKeyRef: request.operation === "tinify" ? undefined : inputRef,
      outputKeyRef: request.encrypt ? outputRef : undefined,
    }),
    [request, inputRef, outputRef],
  );
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "操作失败");
  useEffect(() => {
    api.capabilities().then(setCaps).catch(fail);
    api.assets().then(setAssets).catch(fail);
    api
      .paths()
      .then((paths) => {
        if (outputRevision.current === 0)
          setOutputDraft(paths.outputDirectory ?? "");
      })
      .catch(fail);
    return api.onJobs(({ jobs, running }) => {
      setJobs(jobs);
      setRunning(running);
    });
  }, []);
  useEffect(() => {
    const v = ++version.current;
    void api.cancelPreview();
    if (!selected) {
      setPreview(undefined);
      setPreviewState("empty");
      return;
    }
    setPreviewState("stale");
    if (running) return;
    if (effective.operation === "tinify") {
      setPreview(undefined);
      let live = true;
      api
        .tinifyResult(selected)
        .then((result) => {
          if (live) {
            setPreview(result);
            setPreviewState(result ? "current" : "empty");
          }
        })
        .catch(fail);
      return () => {
        live = false;
      };
    }
    let live = true;
    const timer = setTimeout(() => {
      setPreviewState("loading");
      setError("");
      api
        .preview(selected, effective, v)
        .then((result) => {
          if (live && version.current === v) {
            setPreview(result);
            setPreviewState("current");
          }
        })
        .catch((e) => {
          if (live && version.current === v) {
            setPreviewState("stale");
            fail(e);
          }
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected, effective, running]);
  useEffect(() => {
    if (plan && !review.current?.open) review.current?.showModal();
  }, [plan]);
  async function importFiles(directory = false, files?: File[]) {
    setScanning(true);
    setError("");
    try {
      const next = files
        ? await api.dropFiles(files)
        : await api.importFiles(directory);
      setAssets(next);
      if (!selected || !next.some((a) => a.id === selected))
        setSelected(next[0]?.id);
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
    }
  }
  function onCodec(id: string) {
    if (request.codec)
      saved.current.set(request.codec, {
        container: request.container,
        options: request.options,
      });
    const c = capability(id),
      previous = saved.current.get(id);
    setRequest((r) => {
      const container = c.containers.includes(r.container) ? r.container : previous?.container ?? c.containers[0];
      const options = { ...previous?.options };
      if (["pkm", "astc"].includes(container)) {
        delete options.mipmaps;
        delete options.mipFilter;
      }
      if (["astc", "ktx", "ktx2"].includes(container)) delete options.premultiply;
      return { ...r, codec: c.id, container, options, encrypt: false, outputKeyRef: undefined };
    });
  }
  function change(p: Partial<ConversionRequest>) {
    setRequest((r) => {
      if (p.operation && p.operation !== r.operation) {
        if (p.operation === "tinify")
          return {
            ...r,
            ...p,
            codec: undefined,
            container: "png",
            options: {},
            sizeMode: "keep",
            encrypt: false,
            tinify: { formats: [], preserve: [] },
          };
        if (p.operation === "encode")
          return {
            ...r,
            ...p,
            tinify: undefined,
            codec: "etc2_rgba",
            container: "pkm",
            options: {},
            encrypt: false,
          };
        return {
          ...r,
          ...p,
          tinify: undefined,
          codec: undefined,
          container: p.operation === "decode" ? "png" : "ccz",
          options: {},
          encrypt: false,
        };
      }
      if (p.container) {
        const options = { ...r.options, ...p.options };
        if (["pkm", "astc"].includes(p.container)) {
          delete options.mipmaps;
          delete options.mipFilter;
        }
        if (["astc", "ktx", "ktx2"].includes(p.container)) delete options.premultiply;
        return { ...r, ...p, options };
      }
      return { ...r, ...p };
    });
  }
  async function commitInput() {
    try {
      const ref = await api.setKey(inputKey);
      setInputRef(ref);
      if (selected) {
        const updated = await api.refresh(selected, ref);
        setAssets((old) => old.map((a) => (a.id === updated.id ? updated : a)));
      }
    } catch (e) {
      fail(e);
    }
  }
  async function commitOutput() {
    try {
      setOutputRef(await api.setKey(outputKey));
    } catch (e) {
      fail(e);
    }
  }
  async function generateOutput() {
    try {
      const value = await api.generateKey();
      setOutputKey(value);
      setOutputRef(await api.setKey(value));
    } catch (e) {
      fail(e);
    }
  }
  async function start() {
    setError("");
    setPlanning(true);
    try {
      if (request.output.mode === "directory") await commitOutputDirectory();
      const result = await api.plan(
        assets.map((a) => a.id),
        effective,
      );
      setPlan(result);
    } catch (e) {
      fail(e);
    } finally {
      setPlanning(false);
    }
  }
  async function commitOutputDirectory() {
    const revision = outputRevision.current;
    const next = await api.setOutputDirectory(outputDraft);
    if (revision === outputRevision.current) setOutputDraft(next ?? "");
    return next;
  }
  async function chooseOutputDirectory() {
    await commitOutputDirectory();
    const next = await api.selectOutput();
    outputRevision.current++;
    setOutputDraft(next ?? "");
  }
  async function confirm() {
    if (!plan) return;
    try {
      await api.start(plan.id);
      review.current?.close();
      setPlan(undefined);
    } catch (e) {
      fail(e);
    }
  }
  async function remove(all = false) {
    try {
      const next = await api.remove(
        all ? undefined : selected ? [selected] : [],
      );
      setAssets(next);
      if (!next.some((a) => a.id === selected)) setSelected(next[0]?.id);
    } catch (e) {
      fail(e);
    }
  }
  const completed = jobs.filter(
      (j) => !["pending", "running"].includes(j.state),
    ).length,
    failed = jobs.filter((j) => j.state === "failed").length;
  const finished = jobs.length > 0 && !running && completed === jobs.length;
  const dimensions = useMemo(() => {
    if (!asset || request.operation !== "encode") return "";
    try {
      const d = targetDimensions(
        asset.width,
        asset.height,
        request.codec!,
        request.sizeMode,
      );
      return `${asset.width} × ${asset.height} → ${d.width} × ${d.height}`;
    } catch (e) {
      return (e as Error).message;
    }
  }, [asset, request.codec, request.sizeMode, request.operation]);
  const alphaLoss =
    !!asset?.alpha &&
    request.operation === "encode" &&
    !capability(request.codec!).channels.includes("A");
  return (
    <div
      className="app-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!running && !scanning)
          void importFiles(false, [...e.dataTransfer.files]);
      }}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol">▦</span>
          <strong>TexMori</strong>
          <span className="app-name">纹理工作台</span>
        </div>
        <span className="engine-indicator">
          <i />
          {request.operation === "tinify"
            ? "TinyPNG 云端处理"
            : "双内核 · 本地处理"}
        </span>
      </header>
      <nav className="main-toolbar" aria-label="资源操作">
        <button onClick={() => importFiles()} disabled={scanning || running}>
          ＋ 导入图片
        </button>
        <button
          onClick={() => importFiles(true)}
          disabled={scanning || running}
        >
          导入目录
        </button>
        <span className="toolbar-separator" />
        <button onClick={() => remove()} disabled={!selected || running}>
          移除
        </button>
        <button
          onClick={() => remove(true)}
          disabled={!assets.length || running}
        >
          清空
        </button>
        <div className="toolbar-spacer" />
        <button
          className="collapse-control"
          aria-pressed={showList}
          onClick={() => setShowList(!showList)}
        >
          资源
        </button>
        <button
          className="collapse-control"
          aria-pressed={showSettings}
          onClick={() => setShowSettings(!showSettings)}
        >
          参数
        </button>
      </nav>
      <main
        className={
          "workbench " +
          (!showList ? "hide-list " : "") +
          (!showSettings ? "hide-settings" : "")
        }
      >
        {showList && (
          <AssetList
            assets={assets}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setPreview(undefined);
            }}
            jobs={jobs}
          />
        )}
        <section className="center-panel">
          <div className="document-heading">
            <div>
              <h1 title={asset?.path}>{asset?.name ?? "尚未选择纹理"}</h1>
              <p title={asset?.path}>
                {asset
                  ? `${asset.codec ?? "图片"} · ${asset.width || "—"} × ${asset.height || "—"} · ${bytes(asset.size)}`
                  : "导入资源，选择编码，检查输出"}
              </p>
            </div>
            <span
              className={
                "status-tag " + (previewState === "current" ? "current" : "")
              }
            >
              {scanning
                ? "扫描中…"
                : request.operation === "tinify" && previewState !== "current"
                  ? "云端压缩 · 按需上传"
                  : previewState === "current"
                    ? request.operation === "tinify"
                      ? "上次压缩结果"
                      : "预览已更新"
                    : previewState === "loading"
                      ? "编码预览中"
                      : asset
                        ? "预览已过期"
                        : "等待导入"}
            </span>
          </div>
          <PreviewCanvas
            preview={preview}
            stale={previewState === "stale"}
            loading={previewState === "loading"}
          />
          {request.operation === "tinify" && !preview && (
            <p className="tinify-preview-note">
              {jobs.some(
                (j) => j.assetId === selected && j.state === "succeeded",
              )
                ? "此图片暂不支持本地预览，可通过“显示输出”查看文件。"
                : asset?.localError
                  ? "本地预览不可用，仍可提交 TinyPNG 云端处理。"
                  : "开始批处理后显示云端压缩结果"}
            </p>
          )}
          {!assets.length && (
            <div className="empty-import">
              <button className="primary" onClick={() => importFiles()}>
                选择文件
              </button>
              <span>或将图片、纹理及目录拖入窗口</span>
            </div>
          )}
          <div className="preview-metadata">
            {preview ? (
              <>
                <span>
                  输入 <b>{bytes(preview.inputBytes)}</b>
                </span>
                <span>
                  {request.operation === "tinify" ? "压缩文件" : "编码文件"}{" "}
                  <b>{bytes(preview.encodedBytes)}</b>
                </span>
                <span>
                  最终文件 <b>{bytes(preview.finalBytes)}</b>
                </span>
                <span>
                  {request.operation === "tinify" ? (
                    "TinyPNG 压缩结果"
                  ) : (
                    <>
                      纹理载荷 <b>{bytes(preview.payloadBytes)}</b> ·{" "}
                      {preview.bpp} bpp
                    </>
                  )}
                </span>
                <span
                  className={
                    preview.finalBytes > preview.inputBytes ? "warning" : ""
                  }
                >
                  磁盘体积 {preview.finalBytes > preview.inputBytes ? "+" : ""}
                  {(
                    (preview.finalBytes / preview.inputBytes - 1) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              </>
            ) : (
              <span>真实结果生成后显示文件大小与纹理载荷</span>
            )}
          </div>
          {(dimensions || alphaLoss) && (
            <div className="dimension-info">
              <span className="numeric">{dimensions}</span>
              {alphaLoss && (
                <span className="warning">目标编码不保留 Alpha</span>
              )}
            </div>
          )}
        </section>
        {showSettings && (
          <SettingsPanel
            running={running}
            onError={fail}
            request={request}
            capabilities={caps}
            onChange={change}
            onCodec={onCodec}
            output={outputDraft}
            onOutput={() => void chooseOutputDirectory().catch(fail)}
            onOutputDraft={(value) => {
              outputRevision.current++;
              setOutputDraft(value);
            }}
            onOutputBlur={() => void commitOutputDirectory().catch(fail)}
            inputKey={inputKey}
            setInputKey={(value) => {
              setInputKey(value);
              setInputRef(undefined);
              setPreview(undefined);
            }}
            commitInputKey={commitInput}
            outputKey={outputKey}
            setOutputKey={(value) => {
              setOutputKey(value);
              setOutputRef(undefined);
            }}
            commitOutputKey={commitOutput}
            generateOutputKey={generateOutput}
            copyExample={() => {
              if (outputRef)
                api
                  .keyExample(outputRef)
                  .then((s) => navigator.clipboard.writeText(s))
                  .then(() => setNotice("Cocos 密钥调用示例已复制"))
                  .catch(fail);
            }}
          />
        )}
      </main>
      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="message" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>关闭</button>
        </div>
      )}
      <footer className="queue-bar">
        <div className="queue-summary">
          <span className={"queue-dot " + (running ? "active" : "")} />
          <strong>
            {scanning
              ? "正在扫描"
              : running
                ? "正在批处理"
                : finished
                  ? failed
                    ? "批处理结束"
                    : "批处理完成"
                  : "准备就绪"}
          </strong>
          <span className="numeric">
            {jobs.length
              ? `${completed} / ${jobs.length} 个文件${failed ? ` · ${failed} 个失败` : ""}`
              : `${assets.length} 个资源`}
          </span>
          {running && (
            <progress
              max={jobs.length}
              value={completed}
              aria-label="批处理进度"
            />
          )}
        </div>
        <div className="queue-actions">
          <button
            disabled={running || !failed}
            onClick={() => api.retry().catch(fail)}
          >
            重试失败
          </button>
          <button
            disabled={
              !selected ||
              !jobs.some(
                (j) => j.assetId === selected && j.state === "succeeded",
              )
            }
            onClick={() => selected && api.reveal(selected).catch(fail)}
          >
            显示输出
          </button>
          {running || scanning ? (
            <button
              className="danger"
              onClick={() =>
                scanning
                  ? api.cancelScan().catch(fail)
                  : api.cancel().catch(fail)
              }
            >
              取消{scanning ? "扫描" : "任务"}
            </button>
          ) : (
            <button
              className="primary"
              disabled={!assets.length || planning}
              onClick={start}
            >
              {planning ? "检查输出…" : "开始批处理"}
            </button>
          )}
        </div>
      </footer>
      <dialog
        ref={review}
        className="review-dialog"
        onCancel={() => setPlan(undefined)}
      >
        <h2>检查本次输出</h2>
        <p>
          共 {plan?.files.length ?? 0} 个文件。源图片会保留，已存在目标按“
          {request.output.conflict === "skip"
            ? "跳过"
            : request.output.conflict === "overwrite"
              ? "覆盖"
              : "自动重命名"}
          ”处理。
        </p>
        {request.operation === "tinify" && (
          <p className="warning">
            图片将上传至 TinyPNG，并使用 API 额度。源图保留，输出文件名添加
            .tiny 后缀。
            {request.tinify?.formats.length ? "格式转换额外消耗压缩计数。" : ""}
            {request.tinify?.resize
              ? "尺寸调整额外消耗压缩计数。最终尺寸由服务端确定。"
              : ""}
          </p>
        )}
        <div className="plan-list">
          {plan?.files.map((file) => (
            <div key={file.assetId} className="plan-row">
              <strong>{file.name}</strong>
              <span className="path" title={file.target}>
                {file.target}
              </span>
              <small
                className={
                  file.error ? "failed" : file.alphaLoss ? "warning" : ""
                }
              >
                {file.error ??
                  `${request.operation === "tinify" ? "最终尺寸与格式由服务端确定" : `${file.width} × ${file.height}`}${file.alphaLoss ? (request.operation === "tinify" ? " · 不透明输出将填充背景" : " · 将丢失 Alpha") : ""}${file.exists ? " · 目标已存在" : ""}`}
              </small>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button
            onClick={() => {
              review.current?.close();
              setPlan(undefined);
            }}
          >
            返回检查
          </button>
          <button
            className="primary"
            disabled={!plan?.files.some((f) => !f.error)}
            onClick={confirm}
          >
            确认并开始
          </button>
        </div>
      </dialog>
    </div>
  );
}

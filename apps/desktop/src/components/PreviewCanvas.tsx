import { useEffect, useRef, useState } from "react";
import type { PreviewResult } from "../../../../packages/core/src/index";
const channels = ["RGBA", "RGB", "R", "G", "B", "A"];
export function PreviewCanvas({
  preview,
  stale,
  loading,
}: {
  preview?: PreviewResult;
  stale: boolean;
  loading: boolean;
}) {
  const [mode, setMode] = useState<"split" | "slide">("split"),
    [channel, setChannel] = useState("RGBA"),
    [zoom, setZoom] = useState<number | "fit">("fit"),
    [fit, setFit] = useState(1),
    [offset, setOffset] = useState({ x: 0, y: 0 }),
    [divider, setDivider] = useState(50);
  const area = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; ox: number; oy: number } | undefined>(
      undefined,
    );
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setZoom("fit");
  }, [preview?.originalWidth, preview?.originalHeight]);
  useEffect(() => {
    if (!area.current || !preview) return;
    const update = () => {
      const rect = area.current!.getBoundingClientRect();
      setFit(
        Math.max(
          0.01,
          Math.min(
            (rect.width / (mode === "split" ? 2 : 1) - 48) /
              Math.max(preview.originalWidth, preview.width),
            (rect.height - 80) /
              Math.max(preview.originalHeight, preview.height),
            16 / window.devicePixelRatio,
          ),
        ),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(area.current);
    update();
    return () => observer.disconnect();
  }, [preview, mode]);
  const scale = zoom === "fit" ? fit : zoom / window.devicePixelRatio;
  const image = (src: string, label: string, w: number, h: number, original = false) => {
    // Both images use the encoded canvas as their coordinate system. Apply the
    // actual encoder offset, including its rounding for odd padding amounts.
    const placement = original ? preview?.originalOffset : undefined;
    const dx = placement && preview ? placement.left + w / 2 - preview.width / 2 : 0;
    const dy = placement && preview ? placement.top + h / 2 - preview.height / 2 : 0;
    return (
    <div
      className="texture-frame checker"
      style={{
        width: w,
        height: h,
        transform: `translate(${offset.x + dx * scale}px,${offset.y + dy * scale}px) scale(${scale})`,
      }}
    >
      <img
        src={src}
        alt={label}
        draggable={false}
        className="texture-image"
        style={{ filter: channel === "RGBA" ? "none" : `url(#channel-${channel})` }}
      />
    </div>
    );
  };
  return (
    <div className="preview-workspace">
      <div className="preview-toolbar">
        <div className="segmented">
          <button
            aria-pressed={mode === "split"}
            onClick={() => setMode("split")}
          >
            并排
          </button>
          <button
            aria-pressed={mode === "slide"}
            onClick={() => setMode("slide")}
          >
            滑动对比
          </button>
        </div>
        <select
          aria-label="查看通道"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {channels.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="zoom-actions">
          <button
            onClick={() => {
              setZoom("fit");
              setOffset({ x: 0, y: 0 });
            }}
          >
            适应窗口
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            100%
          </button>
          <span className="numeric">
            {Math.round(scale * window.devicePixelRatio * 100)}%
          </span>
        </div>
      </div>
      <svg className="filter-definitions" aria-hidden="true">
        <defs>
          {channels
            .filter((c) => c !== "RGBA")
            .map((c) => (
              <filter
                id={"channel-" + c}
                key={c}
                colorInterpolationFilters="sRGB"
              >
                <feColorMatrix
                  type="matrix"
                  values={
                    c === "RGB"
                      ? "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1"
                      : Array.from({ length: 4 }, (_, row) =>
                          row === 3
                            ? "0 0 0 0 1"
                            : ["R", "G", "B", "A"]
                                .map((x) => (x === c ? "1" : "0"))
                                .join(" ") + " 0",
                        ).join(" ")
                  }
                />
              </filter>
            ))}
        </defs>
      </svg>
      <div
        ref={area}
        className={"preview-area " + mode}
        tabIndex={0}
        aria-label="纹理对比视口，可拖动平移，滚轮缩放"
        onWheel={(e) => {
          if (preview)
            setZoom(
              Math.max(
                0.03,
                Math.min(
                  32,
                  scale * window.devicePixelRatio * (e.deltaY > 0 ? 0.9 : 1.1),
                ),
              ),
            );
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).tagName === "INPUT") return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            ox: offset.x,
            oy: offset.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setOffset({
              x: drag.current.ox + e.clientX - drag.current.x,
              y: drag.current.oy + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => (drag.current = undefined)}
        onPointerCancel={() => (drag.current = undefined)}
        onKeyDown={(e) => {
          const delta = 24;
          if (e.key === "ArrowLeft")
            setOffset((o) => ({ ...o, x: o.x + delta }));
          if (e.key === "ArrowRight")
            setOffset((o) => ({ ...o, x: o.x - delta }));
          if (e.key === "ArrowUp") setOffset((o) => ({ ...o, y: o.y + delta }));
          if (e.key === "ArrowDown")
            setOffset((o) => ({ ...o, y: o.y - delta }));
        }}
      >
        {preview ? (
          <>
            <div className="preview-pane">
              <span className="pane-label">
                {preview.inputLabel}
                <span className="numeric">
                  {preview.originalWidth} × {preview.originalHeight}
                </span>
              </span>
              {image(
                preview.original,
                preview.inputLabel,
                preview.originalWidth,
                preview.originalHeight,
                true,
              )}
            </div>
            <div
              className={"preview-pane result-pane"}
              style={
                mode === "slide"
                  ? { clipPath: `inset(0 0 0 ${divider}%)` }
                  : undefined
              }
            >
              <span className="pane-label">
                编码结果
                <span className="numeric">
                  {preview.width} × {preview.height}
                </span>
              </span>
              {image(preview.result, "编码结果", preview.width, preview.height)}
            </div>
            {mode === "slide" && (
              <>
                <div className="divider-line" style={{ left: `${divider}%` }} />
                <input
                  className="comparison-slider"
                  aria-label="对比分界线"
                  type="range"
                  min="0"
                  max="100"
                  value={divider}
                  onChange={(e) => setDivider(+e.target.value)}
                />
              </>
            )}
            {preview.width !== preview.originalWidth ||
            preview.height !== preview.originalHeight ? (
              <span className="dimension-warning">
                {preview.originalOffset
                  ? "画布尺寸已改变；原图按扩展位置对齐"
                  : "画布尺寸已改变；图像分别以中心对齐"}
              </span>
            ) : null}
          </>
        ) : (
          <div className="preview-placeholder">
            <span className="pixel-mark">▦</span>
            <h2>检查每一个像素</h2>
            <p>选择资源，查看真实编码结果与原图的差异</p>
          </div>
        )}
        {(stale || loading) && (
          <span className="preview-status">
            {loading ? "正在生成真实预览…" : "预览已过期"}
          </span>
        )}
      </div>
    </div>
  );
}

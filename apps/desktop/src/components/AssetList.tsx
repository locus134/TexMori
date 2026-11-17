import type { Job } from "../../../../packages/core/src/index";
import type { DesktopAsset } from "../api";
export const stateLabels: Record<string, string> = {
  pending: "待处理",
  running: "处理中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
};
export function AssetList({
  assets,
  selected,
  onSelect,
  jobs,
}: {
  assets: DesktopAsset[];
  selected?: string;
  onSelect: (id: string) => void;
  jobs: Job[];
}) {
  return (
    <aside className="asset-panel">
      <div className="panel-heading">
        <h2>资源</h2>
        <span className="numeric">{assets.length} 个</span>
      </div>
      <div className="asset-list" role="listbox" aria-label="资源列表">
        {assets.map((a) => {
          const job = jobs.find((j) => j.assetId === a.id);
          return (
            <button
              key={a.id}
              role="option"
              aria-selected={selected === a.id}
              className={"asset-row " + (selected === a.id ? "selected" : "")}
              onClick={() => onSelect(a.id)}
              title={a.path}
            >
              <div className="thumbnail checker">
                {a.thumbnail ? (
                  <img src={a.thumbnail} alt="" />
                ) : (
                  <span>{a.container === "unsupported" ? "?" : "▧"}</span>
                )}
              </div>
              <div className="asset-copy">
                <strong>{a.name}</strong>
                <span className="numeric">
                  {a.width
                    ? `${a.width} × ${a.height}`
                    : a.encrypted
                      ? "加密纹理"
                      : "无法读取"}{" "}
                  ·{" "}
                  {a.codec ??
                    (a.container === "image"
                      ? "图片"
                      : a.container.toUpperCase())}
                </span>
                <small className={job?.state ?? (a.error ? "failed" : "")}>
                  {job ? stateLabels[job.state] : (a.error ?? "待处理")}
                </small>
              </div>
            </button>
          );
        })}
      </div>
      <div className="asset-hint">
        拖入文件或目录
        <br />
        PNG · JPEG · WebP · PKM · DDS · PVR
      </div>
    </aside>
  );
}

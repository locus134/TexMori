import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi } from "../src/api";
const api: DesktopApi = {
  capabilities: () => ipcRenderer.invoke("capabilities"),
  assets: () => ipcRenderer.invoke("assets"),
  importFiles: (directory = false) => ipcRenderer.invoke("import", directory),
  dropFiles: (files) =>
    ipcRenderer.invoke(
      "drop",
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),
  remove: (ids) => ipcRenderer.invoke("remove", ids),
  selectOutput: () => ipcRenderer.invoke("select-output"),
  setKey: (value) => ipcRenderer.invoke("set-key", value),
  generateKey: () => ipcRenderer.invoke("generate-key"),
  keyExample: (ref) => ipcRenderer.invoke("key-example", ref),
  refresh: (id, ref) => ipcRenderer.invoke("refresh", id, ref),
  preview: (id, request, version) =>
    ipcRenderer.invoke("preview", id, request, version),
  cancelPreview: () => ipcRenderer.invoke("cancel-preview"),
  plan: (ids, request) => ipcRenderer.invoke("plan", ids, request),
  start: (id) => ipcRenderer.invoke("start", id),
  cancel: () => ipcRenderer.invoke("cancel"),
  retry: () => ipcRenderer.invoke("retry"),
  reveal: (id) => ipcRenderer.invoke("reveal", id),
  onJobs: (listener) => {
    const handler = (_event: unknown, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on("jobs", handler);
    return () => ipcRenderer.removeListener("jobs", handler);
  },
};
contextBridge.exposeInMainWorld("cptool", api);

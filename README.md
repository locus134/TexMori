# CPTool

面向游戏资源工作流的跨平台纹理压缩桌面工具，首期开发和验收 macOS。界面使用 React + 手写 CSS，以 etcpak 和 PVRTC 专用编码器组成双内核。

已实现首个可运行 macOS 桌面版本：真实纹理预览、16 种编码、PNG 解码、重新编码、PVR/CCZ 转换与批处理。正式发布验收尚未全部完成，见[验收记录](docs/validation/acceptance.md)。

## 使用

本机构建的应用位于 `release/mac-arm64/CPTool.app`；ZIP 位于 `release/CPTool-0.1.0-macOS-arm64.zip`。目标平台为 Apple Silicon、macOS 13 或更高版本。当前使用本地 ad-hoc 签名，未进行 Developer ID 签名或公证。

导入图片或目录，选择操作、编码和输出位置，检查真实预览后开始批处理。预览的 100% 按设备像素比例显示。输入和输出加密密钥独立，默认仅在本次会话保存。

## 开发

构建使用 Node.js 24（Electron 安装工具要求至少 22.12）。安装依赖后依次运行：

```sh
npm ci
node scripts/engines/build-etcpak.mjs
node scripts/engines/probe-pvrtc.mjs
node scripts/engines/prepare-bc7-verifier.mjs
node scripts/engines/prepare-cocos-verifier.mjs
npm test
npm run typecheck
npm run dev
```

`etcpak/` 需为 `config/engines.lock.json` 中记录的上游 commit，构建机需有 CMake、clang 和 libpng 开发文件。构建运行时可放在 `build/`，不属于安装后应用依赖。`npm run package:mac` 生成本地签名 ZIP；当前机器未验证 DMG 生成。

## 工程文档

- [实施计划](docs/superpowers/plans/2026-11-17-cptool-implementation.md)：任务、接口、测试与发布关卡。
- [产品与工程设计规格](docs/superpowers/specs/2026-11-17-cptool-design.md)：功能范围、格式能力、交互、架构、输出规则及验收要求。
- [开发阶段与验收清单](docs/engineering-roadmap.md)：工程推进顺序、前置验证和交付证据。

## 已确认的核心需求

- 导入图片或目录，预览原图与实际压缩结果，批量编码、解码和转换。
- 覆盖 etcpak 当前全部 10 种编码格式，随格式刷新有效参数。
- ETC/EAC 输出 PKM，BC 默认输出 DDS，PVRTC 输出 PVR 或 PVR.CCZ。
- PVR.CCZ 支持普通压缩和与 TexturePacker/Cocos 兼容的密钥加密。
- 支持原目录输出及指定目录输出，兼顾未来 Windows/Linux。

`etcpak/` 为已有的上游内核源码目录。新增工程与适配层应放在其外部，确有必要的内核补丁单独记录。

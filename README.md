# TexMori

面向游戏资源工作流的跨平台纹理压缩桌面工具，首期开发和验收 macOS。界面使用 React + 手写 CSS，以 etcpak 和 PVRTexTool 组成双内核。

已实现首个可运行 macOS 桌面版本：真实纹理预览、16 种编码、PNG 解码、重新编码、PVR/CCZ 转换与批处理。正式发布验收尚未全部完成，见[验收记录](docs/validation/acceptance.md)。

## 使用

本机构建的应用位于 `release/mac-arm64/TexMori.app`；DMG 位于 `release/TexMori-0.1.5-macOS-arm64.dmg`。目标平台为 Apple Silicon、macOS 13 或更高版本。当前使用本地 ad-hoc 签名，未进行 Developer ID 签名或公证。

导入图片或目录，选择操作、编码和输出位置，检查真实预览后开始批处理。预览的 100% 按设备像素比例显示。输入和输出加密密钥独立，默认仅在本次会话保存。

## 开发

### TinyPNG 云端压缩

在“操作”中选择“TinyPNG 压缩 / 格式转换”，添加一个或多个 API Key。Key 去重后每个 Key 同时处理一个文件，失效或额度耗尽的 Key 在本轮停用，其他 Key 继续工作。Key 明文保存在本机应用数据目录，文件仅当前用户可读写；同一 TinyPNG 账户的多个 Key 共享账户额度。

支持 PNG、JPEG、WebP、AVIF、JXL，以及 HEIC/HEIF 输入（默认输出 JPEG）。可保持原格式、指定输出格式或在多个候选格式中选择体积最小者，并设置尺寸调整、透明背景填充和保留元数据。压缩质量由 TinyPNG 自动决定。图片仅在确认批处理后上传，自动预览不会调用 API。调整尺寸或转换格式会额外消耗压缩计数，界面会提示。

输出文件名增加 `.tiny`，保留原图，沿用输出目录及重名策略。JXL、HEIC/HEIF 在本机无法预览时仍可上传处理，API 返回错误会显示为任务失败。输入文件沿用本工具 256 MiB 大小限制。

API 参数参考：[TinyPNG 官方文档](https://tinypng.com/developers/reference)。

### 本机构建

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

`etcpak/` 需为 `config/engines.lock.json` 中记录的上游 commit，构建机需有 CMake、clang 和 libpng 开发文件。构建运行时可放在 `build/`，不属于安装后应用依赖。`npm run package:mac` 生成精简的 arm64 应用及 UDBZ 压缩 DMG，使用本地 ad-hoc 签名。镜像包含应用和 Applications 快捷入口。

## 工程文档

- [实施计划](docs/superpowers/plans/2026-11-17-texmori-implementation.md)：任务、接口、测试与发布关卡。
- [产品与工程设计规格](docs/superpowers/specs/2026-11-17-texmori-design.md)：功能范围、格式能力、交互、架构、输出规则及验收要求。
- [开发阶段与验收清单](docs/engineering-roadmap.md)：工程推进顺序、前置验证和交付证据。

## 已确认的核心需求

- 导入图片或目录，预览原图与实际压缩结果，批量编码、解码和转换。
- 覆盖 etcpak 当前全部 10 种编码格式，随格式刷新有效参数。
- 输出容器随编码刷新：所有编码支持 PVR、PVR.CCZ、KTX；除 ETC1 外支持 KTX2。ETC/EAC 还支持 PKM，BC 支持 DDS，ASTC 支持原生 `.astc`；PVRTC1 的 DDS 使用 PowerVR 扩展。
- 容器名附带文件后缀，编码名附带 bpp；切换编码时保留兼容容器，切换容器时清理不适用参数。
- `.astc` 只存单层纹理，不保存色彩空间；KTX/KTX2 当前支持普通 2D GPU 压缩纹理及 Mipmap，暂不支持数组、立方体及超压缩输入。
- ASTC 支持全部 14 种 2D 块尺寸（4×4 至 12×12）、5 档质量、Mipmap 和解码预览；复用内置 PVRTexTool。
- 编码格式按 ASTC、BC、EAC、ETC、PVRTC 分组排序，组间以分割线分隔。
- PVR.CCZ 支持普通压缩和与 TexturePacker/Cocos 兼容的密钥加密。
- 支持原目录输出及指定目录输出，兼顾未来 Windows/Linux。

`etcpak/` 为已有的上游内核源码目录。新增工程与适配层应放在其外部，确有必要的内核补丁单独记录。

## 0.1.1 更新

- 压缩前可选择 RGB 乘以 Alpha，默认关闭，预览与批处理一致，原文件保留。
- 压缩输出附加可读的编码格式备注和扩展属性，不改动容器标准结构。
- 分别保存上次导入和导出目录；导出路径在选择按钮上方，可直接编辑。
- 精简运行依赖、调试映射、多余语言与非目标架构，应用约 306 → 274 MiB。

## 0.1.2 更新

安装并启动一次后，在 Finder 中选中文件，按 ⌘I，展开“更多信息”，可查看纹理编码、RGB/RGBA 等通道、Alpha 通道、尺寸、容器、bpp 和 Mip 层数。已实际验证 ETC1 RGB、ETC2 RGB、ETC2 RGBA 三种 PKM。

应用在当前用户的 `~/Library/Spotlight/TexMoriTexture.mdimporter` 安装元数据导入器，升级或移动应用时更新注册；系统索引完成后显示信息。关闭 Spotlight 索引的目录不会显示这些字段。普通 PKM/PVR/DDS/CCZ 从文件头识别，已有纹理也适用；加密 CCZ 没有导出记录时无法读取编码。卸载集成可删除该 importer。

`npm run test:finder` 编译并测试原生解析器，需要 macOS Xcode Command Line Tools。

## 0.1.3 更新

“尺寸处理”新增“透明扩展至 POT（2 的幂）”，保留原图像素，将画布宽高向上扩展为符合编码最小尺寸的 2 的幂，例如 300×500 → 512×512。九宫格选择原图对齐位置，默认居中；奇数余量多出的 1 像素放在右侧或下侧。新增区域透明，RGB 等不保留 Alpha 的编码会丢失透明度。预览、批处理和 PKM 逻辑尺寸使用完整扩展后的画布。

## 0.1.4 更新

TinyPNG API Key 改为明文保存到应用数据目录的 `tinify-keys-local.json`（macOS 默认 `~/Library/Application Support/texmori/`），不再调用钥匙串。文件权限为 0600；目录不是缓存，避免系统清理造成 Key 丢失。界面仅显示末四位。旧版加密文件保留且不自动解密，升级后需重新添加 Key。

## 0.1.5 更新

预览棋盘格仅显示在图片实际边界内，图片外统一为深灰纯色。并排、滑动对比及缩放和平移均使用相同规则，透明边缘与图片外区域可明确区分。

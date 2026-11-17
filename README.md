# CPTool

面向游戏资源工作流的跨平台纹理压缩桌面工具，首期开发和验收 macOS。界面使用 React + 手写 CSS，以 etcpak 和 PVRTC 专用编码器组成双内核。

设计规格已确认，实施计划待审阅；尚未生成应用代码或可运行安装包。

## 工程文档

- [实施计划](docs/superpowers/plans/2026-11-17-cptool-implementation.md)：任务、接口、测试与发布关卡，审阅通过后在当前对话执行。
- [产品与工程设计规格](docs/superpowers/specs/2026-11-17-cptool-design.md)：功能范围、格式能力、交互、架构、输出规则及验收要求。
- [开发阶段与验收清单](docs/engineering-roadmap.md)：工程推进顺序、前置验证和交付证据。

## 已确认的核心需求

- 导入图片或目录，预览原图与实际压缩结果，批量编码、解码和转换。
- 覆盖 etcpak 当前全部 10 种编码格式，随格式刷新有效参数。
- ETC/EAC 输出 PKM，BC 默认输出 DDS，PVRTC 输出 PVR 或 PVR.CCZ。
- PVR.CCZ 支持普通压缩和与 TexturePacker/Cocos 兼容的密钥加密。
- 支持原目录输出及指定目录输出，兼顾未来 Windows/Linux。

`etcpak/` 为已有的上游内核源码目录。新增工程与适配层应放在其外部，确有必要的内核补丁单独记录。

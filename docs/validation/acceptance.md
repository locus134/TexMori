# CPTool 0.1.0 开发验收

日期：2026-11-17。状态：功能开发版本可运行；正式发布关卡未全部完成，不归档实施计划和规格。

## 已验证

- 本机：Apple Silicon arm64、macOS 26.6.2；应用最低目标 macOS 13.0，由 Electron45 二进制实际 minos 确定。PVRTexTool 包同时含 Intel，但本应用未宣称 universal。
- 16 种真实编码输出、基础层解码预览、ETC/EAC PKM、BC DDS、6 种 PVRTC PVR；内核基线详见 `engine-baseline.md`。
- 8 个 PVRTC 质量档位、三种 Mipmap 滤镜及完整 Mip 链；sRGB/Linear 预乘 Alpha 工作图反预乘；R/RG 保留对应通道值。
- PKM 原始逻辑尺寸与编码尺寸独立保存；补齐后裁回；损坏与非法尺寸在调用原生解码器前拒绝。
- 普通/加密 CCZ 的字节一致性和跨加密阈值案例，由未修改的原版 Cocos ZipUtils 方法独立解包验证。参考 commit：`e4b6a5ef8fcdc99a7ebea606312b67fe4c534b9f`。
- 扫描去重、不跟随目录符号链接、排除输出子树；缺失/损坏输入显示文件级错误；取消扫描同步已有快照。
- 大小写/Unicode/多根路径规划、完整 `.pvr.ccz` 后缀；跳过、覆盖、重命名；临时输出验证后发布，失败保留旧目标。
- 队列串行、取消、失败重试、等待发布与清理后退出；密钥编辑立即使旧引用失效，密钥不进入命令行和日志。
- 两条真实 Electron 流程：导入→预览→ETC 批处理；加密 PVRTC CCZ 生成→重新导入→PNG 解码→PVR 换容器。另验证 100% 设备像素比例、无渲染层 Node 接口及参数切换。
- 打包后的 `.app` 在本机移除开发工具 PATH、Node/DYLD 注入变量后重复通过上述两条流程。此项证明打包资源路径可用，不等同于另一台干净机器。
- 独立代码审阅发现的四项 Important 问题均完成复现与修复：预乘 Alpha、退出发布清理、导入错误丢失、PVRTC1 非幂次输入。
- 完整 npm 依赖审计为 0 漏洞；Vitest 更新为 5.1.0，打包工具使用兼容的 minimatch 修复版本。

## 验证命令与证据

```sh
npm test
npm run typecheck
npm run build
npm run test:desktop
npm run package:mac
node scripts/verify-bundle.mjs
```

核心与集成测试当前 34 项；开发版与安装包各有两条桌面测试。当前执行输出保存在 `build/packaged-desktop.log`、`build/package.log`、`build/bundle-verification.json`；工作台截图在 `build/workbench.png` 与 `build/workbench-narrow.png`。这些是本地构建证据，不纳入源代码版本库。

## 发布仍待验证

- 真正无开发依赖的另一台 Mac，以及 macOS 13 最低系统。
- 完整 Cocos 图形引擎加载并显示压缩纹理；当前独立 ZipUtils 工具只证明原版解密与解包互操作。
- PVRTC GPU 加载/显示（特别是 PVRTC2 的目标图形接口支持），不以 PNG 解码预览冒充 GPU 验收。
- 原版 Cocos 在同一进程切换不同密钥：该版本重新派生时保留旧派生数组，本项目不模仿此状态缺陷；现有独立验证每次新进程加载一把密钥。
- Developer ID 签名、公证，以及对外分发前完整许可证与 LGPL 对应源代码/再链接条件审查。当前 ad-hoc 签名仅用于本机构建测试。
- Windows/Linux、Intel Mac 和 universal 安装包。

用户已批准不安装或运行 TexturePacker。不把尚未取得的 TexturePacker 生成样本兼容性写成已验收。

## 实施裁定

- 新建根仓库的功能分支，在用户指定目录开发；无已有主分支改动需要另建工作树。etcpak 保持独立。若后续需要隔离，可建立工作树。
- 单 npm 工程保留 core/containers/engine 模块边界，暂不发布 workspace 包；若出现独立消费者再加入包清单，成本为构建边界调整。
- 输出路径由主进程选取并规范化，拒绝新增符号链接穿越；测试使用 realpath 临时目录以匹配实际授权路径。
- 应用下限从内核构建目标提升为 macOS 13.0，以实际 Electron 二进制要求为准；最低系统运行仍需实机确认。
- PVRTC 解码先得到同色彩空间 RGBA PVR，再生成 PNG，避免工具 PNG 导出隐式转换；像素测试覆盖 sRGB/Linear 与反预乘。

没有遗留 Minor 代码审阅项；上述发布证据缺口不视为已完成。

## 本地交付文件

- 应用：`release/mac-arm64/CPTool.app`
- ZIP：`release/CPTool-0.1.0-macOS-arm64.zip`（125.0 MiB）
- SHA-256：`f9447c56ec3f564d97fe9146974fa4dc2d6e6e0b7764fda638695c1078a2c9a5`
- 本次最终安装包：2/2 桌面流程、架构与依赖检查、ad-hoc 签名校验通过。

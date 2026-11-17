# 内核基线 — 2026-11-17

- etcpak commit: 3d716e1550023dc5ff8b602636af8b76584e0b66；Tracy 固定到 v0.11.1 commit，构建副本替换 find_package(PNG)，上游未改。
- 静态链接 libpng 1.6.58；动态依赖仅系统 zlib、libc++、libSystem。arm64 Release，部署目标 12.0，未在 macOS 12 实机验收。
- PVRTexToolCLI 5.5 / SDK 2023_R1，官方 pkg，universal arm64/x86_64；arm64 实测可运行，运行仅依赖系统库。
- 16 个模式真实编码/解码通过，报告生成于 build/matrix/report.json；etcpak 的前 9 模式由 PVRTexTool 独立解码，BC7 由固定版本 bc7decomp 独立解码；PVRTC 使用官方解码路径，GPU 加载待验收。
- PVRTC1 要求 POT；PVRTC2 2bpp 宽高分别按 8×4 块约束，4bpp 按 4×4；PVRTC1 小纹理使用最小载荷块。矩形 POT 可被该编码器编码，不代表所有旧 iOS 使用端支持。
- 编码命令：etcpak -c <id> -h <pvr|dds> <input.png> <output>；解码：etcpak -v <input> <output.png>。
- PVRTC：PVRTexToolCLI -i <input.png> -o <output.pvr> -f <PVRTCI_2BPP_RGB|PVRTCI_2BPP_RGBA|PVRTCI_4BPP_RGB|PVRTCI_4BPP_RGBA|PVRTCII_2BPP|PVRTCII_4BPP>,UBN,sRGB -q PVRTCNORMAL。
- PVRTC 解码：PVRTexToolCLI -i <input.pvr> -noout -d <output.png> -f r8g8b8a8；Mipmap: -m；滤镜: -mfilter nearest|linear|cubic；预乘: -p。
- 用户已批准以独立格式校验和 Cocos 加载取代 TexturePacker 运行；不再运行 TexturePacker，不宣称已验证其生成的输入样本。

官方来源：[历史下载](https://developer.imaginationtech.com/downloads/previous-releases/)。许可以下载包 Resources/license.html 为准，不能使用 SDK 的 MIT 条款代替工具许可。

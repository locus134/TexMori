# CPTool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可安装的 macOS 纹理工具，完成真实预览、16 种编码、解码、转码及兼容 TexturePacker/Cocos 的 CCZ 转换。

**Architecture:** Electron 主进程持有文件权限、密钥和任务；React 通过窄 preload 接口操作资源 ID。core 定义能力与输出计划，containers 处理文件格式，engine 串行运行真实编码器。先完成原生内核验证关卡，再据实冻结平台与能力参数。

**Tech Stack:** Electron、React、TypeScript、Vite、手写 CSS、Node.js、Vitest、Playwright、CMake/C++20、etcpak、经过验证的 PVRTC 编码器。

**Spec:** `docs/superpowers/specs/2026-11-17-cptool-design.md`（2026-11-17 用户确认）。

## Global Constraints

- 首期平台为 macOS；界面和业务逻辑不硬编码 Finder、路径分隔符或 macOS 凭据接口。
- 界面使用中文，编码名保留通用英文。
- 样式采用手写 CSS 和统一变量；不使用 Tailwind。
- PKM 只保存单层纹理；选择 PKM 时禁用 Mipmap。首期不将 KTX/KTX2 作为用户可选输出。
- 默认保留源图片。
- 目标存在时提供跳过、覆盖、自动重命名；默认跳过。
- 默认只在当前会话保存。
- 原生编码在独立进程完成；主进程不做阻塞像素处理。
- 不以 ETC 或其他算法冒充 PVRTC；不能合法内置时提交替代编码器或正式安装依赖方案供用户决定，不静默缩减范围。
- 规格全部章节为验收依据；本文不能通过简化步骤删减规格要求。

## Review Focus

1. 大小写等价、Unicode、多根目录和 `.pvr.ccz` 名称冲突：执行前完整报告，不能覆盖其他输入（任务 6）。
2. 文件头伪造、超大解压长度、截断和非普通 2D 纹理：拒绝并给出结构化错误，不能无限分配内存（任务 4）。
3. 取消、磁盘失败和同路径转码：保留已有目标，不发布半文件（任务 6、7）。
4. 切换输入、密钥和参数时旧预览晚到：不得覆盖当前预览或复用其他密钥的解密缓存（任务 8）。
5. 开发机具有 Homebrew/Rosetta 而目标机器没有：安装包明确依赖并完成干净环境验证（任务 1、10）。

## 执行方式与关卡

用户已选定并批准：由当前助手在当前对话中逐项执行。任务完成记录测试命令、退出状态和证据路径；失败则修复后继续，不把未运行的验收勾选为完成。2026-11-17 后续批准不再运行 TexturePacker，相关样本验收改为独立格式与原版 Cocos 路径；未完成完整图形加载时保留待验收状态。

当前根目录没有 `.git`，`etcpak/` 有独立仓库。执行时建立根工程版本管理，先忽略 `etcpak/` 和构建产物；以版本锁记录上游 URL、commit 和补丁哈希，不把嵌套仓库误加入根仓库。仅提交本任务文件，不改写上游历史。

任务 1 是阻断关卡。PVRTC 版本、许可、架构、质量枚举、尺寸限制和最低 macOS 尚无实测值，不能现在编造命令或版本。任务 1 产出冻结清单后，补充本计划对应的确切编码器命令与约束，再进入任务 2。若需要改变已确认设计，提交具体差异供用户决定。

## 文件与接口责任

| 路径 | 责任 |
|---|---|
| `scripts/engines/` | 原生构建、探测、格式矩阵验证 |
| `config/engines.lock.json` | 版本、架构、校验和、依赖及经过验证的能力 |
| `packages/core/src/` | 共享模型、能力表、无副作用校验与输出规划 |
| `packages/containers/src/` | PKM/PVR/DDS/CCZ 内容识别、解析和封装 |
| `packages/engine/src/` | 资源扫描、工作图、原生进程、队列、预览 |
| `apps/desktop/electron/` | 生命周期、权限注册、IPC、preload |
| `apps/desktop/src/` | 工作台、参数和对比预览 |
| `tests/fixtures/` | 自制样本、可分发互操作样本及来源 |
| `tests/integration/`, `tests/desktop/` | 真实内核及 Electron 操作测试 |
| `docs/validation/` | 命令、结果、许可证和手工验收证据 |

接口均使用具名类型，禁止把任意 shell 命令或编码器路径暴露给渲染器。共享契约在任务 2 定义，后续任务修改时同步调用方与测试。

```ts
type Operation = 'encode' | 'decode' | 'rewrap';
type ConflictPolicy = 'skip' | 'overwrite' | 'rename';
type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type KeyRef = string; // 主进程会话注册表中的不透明引用
// 以下名称是各模块必须提供的公开边界，具体字段由任务 2 固化。
// CapabilityService.list(): Promise<CodecCapability[]>
// AssetService.import(selection: ImportSelection, signal: AbortSignal): Promise<Asset[]>
// planOutputs(assets: Asset[], request: ConversionRequest): PlannedOutput[]
// ConversionService.run(plan: PlannedOutput, signal: AbortSignal): Promise<ConversionResult>
// QueueService.start(plans: PlannedOutput[]): string
// QueueService.cancel(batchId: string): Promise<void>
// PreviewService.request(request: PreviewRequest, signal: AbortSignal): Promise<PreviewResult>
```

### Task 1: 验证双内核、分发与互操作前提

**Files:** Create `scripts/engines/{build-etcpak,probe-pvrtc,verify-matrix}.mjs`, `config/engines.lock.json`, `tests/fixtures/README.md`, `docs/validation/{engine-baseline,licenses}.md`。保留 `etcpak/` 独立；必要补丁放 `scripts/engines/patches/`。

**Consumes:** 本地 etcpak 源码及官方 PVRTC 工具；**Produces:** 可运行内核、真实模式矩阵和发布约束。

- [ ] 记录 etcpak commit/dirty 状态、宿主架构、编译器和工具版本；检查依赖许可证。固定 Tracy commit，发布构建关闭 `MARCH_NATIVE`，不使用浮动 master。
- [ ] 构建 etcpak，执行帮助及自制 PNG 编码/解码；记录链接库，确保发布方案不引用开发机 Homebrew 绝对路径。
- [ ] 从官方来源核实并获取 PVRTC 工具，保存版本、下载来源、文件哈希、许可和 CLI 帮助摘要。实测原生运行或 Rosetta 运行，确认可交付路径。
- [ ] 生成 RGB、透明 RGBA、灰度、R/RG 渐变、非 4 倍数、非幂次和最小尺寸样本；逐一验证 10 个 etcpak 和 6 个 PVRTC 模式，记录有效参数及独立解码路径。
- [ ] 验证 PVRTC 质量、Mipmaps、Alpha、尺寸与色彩行为；获得合法 TexturePacker 普通/加密小样本和对应 Cocos 加载参考。无样本时明确记录阻断，不自制同源样本冒充互操作证据。
- [ ] 运行 `node scripts/engines/verify-matrix.mjs`：每个模式输出输入、命令、尺寸、通道、退出码、哈希与独立解码结果；任一必需模式缺失返回非零。
- [ ] 将实测版本和能力写入锁文件，补入本计划确切 CLI 参数、平台下限和编码约束。PVRTC 不可交付则暂停依赖它的实现，提出具体替代方案。

### Task 2: 根工程和共享契约

**Files:** Create root `package.json`, lockfile, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`; `packages/core/src/{types,capabilities,validation,errors}.ts`; `packages/core/tests/validation.test.ts`; `apps/desktop/{package.json,vite.config.ts,electron/main.ts,electron/preload.ts,src/main.tsx,src/App.tsx}`。

**Consumes:** 任务 1 冻结能力；**Produces:** 可启动 Electron 与共享类型、统一校验。

- [ ] 建立 npm workspaces；锁定经兼容检查的依赖版本，定义 `test`, `typecheck`, `build`, `dev`, `test:integration`, `test:desktop`, `package:mac` 命令。
- [ ] 先写校验测试：16 个 ID 全部出现；PKM+Mipmaps 被拒绝；隐藏选项被拒绝；未安装编码器返回原因；rewrap 不接受编码参数。
- [ ] 运行 `npm test -- packages/core/tests/validation.test.ts` 确认行为测试失败，再实现能力表与运行时请求校验。用判别联合分开 encode/decode/rewrap；KeyRef 不含密钥值。
- [ ] 创建最小 Electron 窗口，禁用 Node 集成、启用 context isolation 和适用 sandbox；只加载打包页面或受控开发地址。
- [ ] 运行上述测试、`npm run typecheck`、`npm run build`；启动真实 Electron 记录窗口证据。

### Task 3: 安全资源导入与工作图

**Files:** Create `packages/engine/src/assets/{registry,scan,probe,normalize}.ts`, `packages/engine/tests/assets.test.ts`, `apps/desktop/electron/{ipc,asset-service}.ts`。

**Consumes:** 共享模型与导入选择；**Produces:** Asset 注册表与统一 RGBA PNG 工作图。

- [ ] 写临时目录测试：递归导入、目录符号链接循环、文件真实路径去重、取消、输出子树排除、输出等于输入目录、Unicode 与多点文件名。
- [ ] 写图片测试：PNG/JPEG/WebP、灰度、透明；固定归一化为 sRGB 或显式 Linear 数据的策略，验证 R/RG 不自动变亮度。
- [ ] 运行 `npm test -- packages/engine/tests/assets.test.ts` 确认失败；实现扫描快照、内容探测和独立工作进程中的归一化。
- [ ] 实现主进程文件选择与拖入授权：渲染端仅获得 ID 和可显示元数据，后续请求不能以任意路径扩大访问范围。
- [ ] 重跑测试与类型检查；损坏文件成为单文件错误，不中断整个导入。

### Task 4: 容器与 CCZ 兼容

**Files:** Create `packages/containers/src/{detect,pkm,pvr,dds,ccz,keys,index}.ts`, `packages/containers/tests/{headers,ccz,keys}.test.ts`, `tests/integration/ccz-interop.test.ts`, `scripts/engines/verify-cocos/`。

**Consumes:** 字节数据、会话密钥；**Produces:** 已校验纹理元数据、解包 PVR 和 CCZ 字节。

- [ ] 写 PKM 1.0/2.0 字节级预期测试：magic、端序、格式映射、逻辑/块尺寸、精确载荷长度、裁回尺寸；PVR/DDS 拒绝数组、立方体、3D 和未支持编码。
- [ ] 写 CCZ 测试：普通/加密签名、版本、截断、非法长度、解压上限、错误密钥、阈值两侧、连续更换密钥；PVR→CCZ→PVR 使用字节相等断言。
- [ ] 写密钥测试：32 位 hex、四段 0x、非法字符和目标 Cocos key-part 限制；错误文本与日志不得含真实密钥。
- [ ] 运行 `npm test -- packages/containers` 确认失败；按实际 Cocos 实现完成派生、覆盖区间和校验，不使用自定义 AES 替代。
- [ ] 运行 `npm run test:integration -- ccz-interop`：TexturePacker 样本由 CPTool 读取；CPTool 产物由独立 Cocos 路径加载。区分完整引擎加载证据与提取参考实现测试，二者不混称。

### Task 5: 真实转换服务

**Files:** Create `packages/engine/src/{process-runner,conversion}.ts`, `packages/engine/src/codecs/{etcpak,pvrtc}.ts`, `packages/engine/tests/process-runner.test.ts`, `tests/integration/conversion.test.ts`。

**Consumes:** 有效请求、工作图、容器模块；**Produces:** ConversionResult（校验后临时产物、尺寸和大小）。

- [ ] 写工作进程故障测试：非零退出、崩溃、超时、取消、含空格路径；参数数组启动且无 shell；标准输出有界，日志脱敏。
- [ ] 写实际格式测试：16 模式逐一编码并独立解码，R/RG 与 Alpha 行为正确；PKM 通过临时 PVR 无损搬运载荷，逻辑尺寸裁回；有 Mip 的输入预览基础层。
- [ ] 运行测试确认失败，按任务 1 的确切 CLI 封装适配；实现 encode、decode PNG、重新编码及 rewrap。rewrap 用进程调用计数断言未执行有损编码器。
- [ ] 验证保持尺寸拒绝非法输入；明确补齐使用边缘复制、缩放显示实际尺寸；记录磁盘大小、纹理载荷大小与位率，不混用 GPU 占用。
- [ ] 运行 `npm run test:integration -- conversion`，完整模式矩阵成功才勾选此任务。

### Task 6: 输出规划与安全发布

**Files:** Create `packages/core/src/output-plan.ts`, `packages/core/tests/output-plan.test.ts`, `packages/engine/src/publish.ts`, `packages/engine/tests/publish.test.ts`。

**Consumes:** Asset[] 与请求快照；**Produces:** PlannedOutput[] 和最终发布结果。

- [ ] 写表驱动路径测试：原目录/指定目录、相对层级、多根同名、大小写等价、Unicode、`.pvr.ccz` 完整后缀、跳过/覆盖/重命名和同输入路径。
- [ ] 写故障注入测试：写入失败、目标发布失败、已有目标存在、同路径输入；断言原文件字节不变、无成功半文件，其他输入不会成为目标。
- [ ] 运行测试确认失败，实现无副作用规划和批次冲突汇总；重命名同时预留本批次目标，发布前重新检查外部竞争。
- [ ] 临时产物验证后发布；跨卷先复制到目标目录的临时文件再发布。覆盖失败必须可恢复原目标；成功后清理备份，失败清理临时文件。
- [ ] 运行 `npm test -- packages/core/tests/output-plan.test.ts packages/engine/tests/publish.test.ts`。

### Task 7: 串行队列、取消与重试

**Files:** Create `packages/engine/src/queue.ts`, `packages/engine/tests/queue.test.ts`, `apps/desktop/electron/job-service.ts`。

**Consumes:** PlannedOutput[]；**Produces:** 批次 ID、Job 状态事件和汇总。

- [ ] 写状态序列测试：pending→running→终态；同一时刻至多一个重编码；单文件失败继续；取消停止后续任务并终止当前进程；已完成输出保留。
- [ ] 写重试测试：仅失败项使用明确快照重试，已成功项不再执行；批次前统一显示通道丢失和覆盖决策。
- [ ] 运行测试确认失败，实现队列与可订阅事件，进度仅报告已完成文件数/总数。
- [ ] 实现关闭窗口时运行任务的退出选择和清理；运行 `npm test -- packages/engine/tests/queue.test.ts`。

### Task 8: 真实预览、缓存与密钥隔离

**Files:** Create `packages/engine/src/{preview,session-keys}.ts`, `packages/engine/tests/preview.test.ts`, `apps/desktop/electron/preview-service.ts`。

**Consumes:** 请求版本、资源指纹、KeyRef；**Produces:** PreviewResult 与受限预览句柄。

- [ ] 写延迟测试：A 请求晚于 B 完成也不能覆盖 B；资源切换和取消使旧版本失效；源文件变化、编码器版本变化、参数变化均失效。
- [ ] 写缓存测试：不同输入密钥隔离，缓存名/日志无原始密钥；会话结束移除解密数据，句柄不能访问任意本地文件。
- [ ] 运行测试确认失败，实现真实编码再解码预览；预览低优先级，批处理期间不启动争抢资源的编码任务。
- [ ] UI 明确显示过期状态；压缩输入左侧标为“输入纹理解码图”。运行 `npm test -- packages/engine/tests/preview.test.ts`。

### Task 9: 中文 React 工作台

**Files:** Create `apps/desktop/src/{App.tsx,styles.css}`, `apps/desktop/src/components/{AssetList,PreviewCanvas,SettingsPanel,QueueBar,KeyInput}.tsx`, `apps/desktop/src/state/workbench.ts`, `tests/desktop/workbench.spec.ts`。

**Consumes:** preload 受限接口；**Produces:** 完整导入→预览→批量输出→定位结果工作流。

- [ ] 实现前按 UI Skills 路由读取规格指定的界面指导。建立手写 CSS 变量、中性灰和蓝色操作强调，不放无关统计卡片。
- [ ] 先写 Electron 流程测试：导入真实样本、切换格式/操作、检查隐藏参数不传入、PKM 禁用 Mip、缺失编码器显示原因、开始/取消/重试与定位结果。
- [ ] 实现资源列表、参数区、底部批次状态；参数仅来自统一能力表。输入/输出密钥独立，安全随机生成、显示隐藏、复制规范值与 Cocos 调用示例；首期不增加持久记住密钥功能。
- [ ] 实现并排/滑动比较、同步缩放平移、适应窗口、真实 100%、RGBA/RGB/R/G/B/A、棋盘格与尺寸差异标注。未生成结果不显示节省率；体积增加也正确显示。
- [ ] 检查空、扫描、加载、不支持、失败、取消和过期状态，键盘焦点、标签、禁用原因、减少动态效果与窄窗口折叠。
- [ ] 运行 `npm run test:desktop`、`npm run typecheck`、`npm run build`；真实 Electron 手动检查像素比例、拖入目录和对比操作，保存截图与操作记录。

### Task 10: macOS 打包与完整验收

**Files:** Create `scripts/{package-mac,verify-bundle}.mjs`, `apps/desktop/electron-builder.yml`, `docs/validation/{release-checklist,acceptance}.md`, `THIRD_PARTY_NOTICES.md`; update `README.md`, `docs/engineering-roadmap.md`。

**Consumes:** 已通过测试的应用和冻结内核；**Produces:** 安装包、许可清单和真实验收证据。

- [ ] 打包内核、动态库和许可，原生可执行文件放到可执行资源目录；检查架构、最低系统、动态库引用及打包路径。禁止把宿主架构检测当作 universal 证据。
- [ ] 运行 `npm test`, `npm run typecheck`, `npm run build`, `npm run test:integration`, `npm run test:desktop`, `npm run package:mac`；保存命令与结果摘要。
- [ ] 在无开发依赖的目标环境验证安装启动、16 模式、CCZ 互操作、Unicode 目录、权限失败、覆盖失败、取消、重试和过期预览；缺乏环境或样本的项明确未验收。
- [ ] 按实际账号条件执行签名/公证并验证；条件不足则明确标注安装包未签名/未公证，不能声称已完成相应验证。
- [ ] 由独立审阅者检查整体验收与安全边界；修复问题后仅重跑受影响检查及必要回归。记录安装包绝对路径、哈希、支持平台和已知限制。
- [ ] 仅全部实现与必要验收完成后，将本计划及本任务规格保留原文件名移入 `docs/superpowers/archive/{plans,specs}/`，更新所有文档链接；未完成不归档。

## 自审覆盖映射

规格 1–3/11/13 → 任务 1、2、5、10；规格 4–6 → 任务 2–5、9；规格 7 → 任务 1、4、8、10；规格 8 → 任务 3、6、7；规格 9 → 任务 8、9；规格 10/12 → 任务 2、3、5、7、8。五类 Review Focus 均已分配行为测试。

本计划刻意把未知原生工具的实际版本与 CLI 固化安排在首个阻断任务，不将未验证的平台、质量档位或分发许可当作既定事实。后续细节在关卡证据基础上更新，不改变审阅后的产品范围。

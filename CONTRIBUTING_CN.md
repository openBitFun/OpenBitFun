# 贡献指南

[English](./CONTRIBUTING.md)

感谢你对 OpenBitFun 的兴趣！OpenBitFun 是一个由 Rust 与 TypeScript 驱动的多端 AI 编程环境，桌面端/CLI/Server 共享核心逻辑。本指南说明如何高效参与贡献。

## 行为准则

请保持尊重、友善与建设性沟通。我们欢迎不同背景与经验的贡献者。

## 快速开始

### 环境准备

- Node.js 22.12+（建议 LTS 版本）
- pnpm 10.15.0（建议通过 Corepack 使用）
- Rust toolchain（通过 rustup 安装）；原生桌面应用需 Rust 1.97+（若默认 `rustc` 更低，请执行 `rustup toolchain install 1.98.1`）
- Linux 构建原生桌面另需 GTK4、libadwaita 和 WebKitGTK 6.0 开发包
- 锁定版本的 [NSH CLI](docs/architecture/nsh-frontend.md)（`v0.6.1`）会在 `pnpm install` 时自动安装到 `~/.nsh/bin` 并链接至 `node_modules/.bin/nsh`（也可手动执行 `pnpm run nsh:install`，或设置 `OPENBITFUN_SKIP_NSH_INSTALL=1` 跳过）

OpenBitFun 将本地 JavaScript 构建和 CI 统一到 Node.js 22.12+。仓库里的
GitHub Actions 升级使用的是兼容 Node.js 24 的 action runtime，但项目脚本
默认仍以 Node.js 22.12+ 为基线，除非局部指南另有说明。从旧 Node.js 版本切换
后，请重新运行 `pnpm install`。

#### 构建前置检查

当 `cargo check --workspace`、`cargo check -p openbitfun-desktop` 或 pnpm 构建
命令报出难以理解的错误（如 "resource path doesn't exist" 或 sherpa-onnx
下载失败）时，运行前置检查以识别缺失的依赖并获取可操作的修复命令：

```bash
pnpm run check:build-prereqs           # 仅检查
pnpm run check:build-prereqs -- --fix  # 尝试自动修复缺失的前置依赖
```

检查项包括：

- 缺少 `node_modules` 或 pnpm virtual store 损坏（修复：`pnpm install`）
- 缺少 `src/apps/extension-host/dist` Bun 宿主入口（修复：`pnpm run plugin-host:prepare`）
- 缺少或版本不匹配的锁定版 NSH CLI（`v0.6.1`，修复：`pnpm run nsh:install`）
- 缺少 sherpa-onnx 预编译库（sherpa-onnx-sys 构建脚本会在构建时从
  GitHub 下载；若网络连通性差导致下载失败，设置
  `SHERPA_ONNX_LIB_DIR` 指向 `target/sherpa-onnx-prebuilt/` 下的预编译
  lib 目录以使用本地副本）

### 安装依赖

```bash
pnpm install
```

`pnpm install` 还会自动校验并安装锁定版本的 NSH CLI（`v0.6.1`，SHA-256 校验）到 `~/.nsh/bin`，同时链接到 `node_modules/.bin/nsh`，因此所有 `pnpm run ...` 脚本与 `pnpm exec nsh ...` 无需额外配置 `PATH` 即可运行（离线或非 NSH 开发可设置 `OPENBITFUN_SKIP_NSH_INSTALL=1` 跳过）。如需在终端中直接执行裸 `nsh` 命令，可将 `~/.nsh/bin` 加入 `PATH`。

pnpm 工作区统一使用根目录的 `pnpm-lock.yaml`，不要为工作区包提交
`package-lock.json`。独立的 `packages/dsh-acp` npm 包与
`src/apps/extension-host` Bun 宿主保留各自的锁文件和准备命令。
生成的 `gen/` 目录（Data Tools、安装器、MiniApp shell）以及本地实施过程记录不进入 Git。

### 常用命令

```bash
# Desktop：原生 NSH 应用（src/apps/desktop-nsh + src/nsh-ui + 后端库）
pnpm run desktop:dev                # 构建 UI 包、后端和运行器（debug）后启动
pnpm run desktop:dev -- --isolated-data # 显式使用当前仓库的独立测试数据
pnpm run desktop:preview:debug      # 不重新构建，直接运行上次的 debug 构建
pnpm run prepare:dsh-profile        # 可选：编译 DeepSeek Harness 桥，供本地会话使用

# Desktop（当前系统的打包应用：target/desktop-nsh/）
pnpm run desktop:build              # release profile；本地快速打包用 desktop:build:release-fast

# UI 测试与原生冒烟测试
pnpm run e2e:ui                     # 无界面 NSH UI 测试（cd src/nsh-ui && nsh test .）
pnpm run e2e:smoke                  # 在临时配置下启动已构建的应用，并通过 OBP 驱动
```

> `pnpm install` 会自动准备锁定版本的 NSH CLI（`v0.6.1`），默认 `rustc` 低于 1.97 时 `desktop:dev` / `desktop:build` 会自动选用 `RUSTUP_TOOLCHAIN=1.98.1`，详见 [`docs/architecture/nsh-frontend.md`](docs/architecture/nsh-frontend.md)。`desktop:dev` 每次启动前都会重新构建；只迭代界面时可用 `pnpm exec nsh run src/nsh-ui --target web` 获得热更新。

两种启动器默认使用安装版的日常数据，包括已有模型设置、工作区和会话。
需要独立测试数据时，显式添加 `--isolated-data`，数据保存在当前仓库的
`.openbitfun/desktop-dev/` 下。显式设置的数据目录环境变量仍优先生效；
`--shared-data` 保留为默认模式的兼容写法。

> 完整脚本列表见 [`package.json`](package.json)。agent 专用命令、验证与架构规则见 [`AGENTS-CN.md`](AGENTS-CN.md)。

### 桌面端调试工具

桌面端是原生 NSH 应用，没有 WebView DevTools。调试界面可用
`nsh run src/nsh-ui --target web`（web target 下使用浏览器开发者工具）和无头测试
（`cd src/nsh-ui && nsh test .`）；后端日志位于会话日志目录（设置 → 日志）。

## 代码规范与架构约束

仓库级规则、分层边界和验证选择方式以 [`AGENTS-CN.md`](AGENTS-CN.md) 为准。面向贡献者只需把握：

- 日志只使用英文，并保持必要、可读。
- 用户可见文案走项目 i18n 流程；不要把桌面 UI 的 locale catalog 共享给较小产品形态。
- shared core 必须保持平台无关；桌面宿主细节属于 app adapter，并通过类型化能力接口回流；需要事件投递时使用已有生产 transport adapter。
- 后端命令使用 `snake_case` 命令名和结构化 `request` 参数（以 `// @backend-command` 标记，并在 `backend_commands!` 中注册）。
- core 拆解、feature 边界、依赖边界和构建提速重构必须遵循
  `docs/architecture/product-architecture.md` 和
  `docs/architecture/rust-build-dependency-boundaries.md`。
- 功能级规则应放在离代码最近的模块 `AGENTS.md` 中。

## 重点关注的贡献方向

1. 贡献好的想法/创意（功能、交互、视觉等），提交 Issue
   > 欢迎产品经理、UI 设计师通过 PI 快速提交创意，我们会帮助完善开发
2. 优化 Agent 系统和效果
3. 对提升系统稳定性和完善基础能力
4. 扩展生态（Skills、MCP，或者对某些垂域开发场景的更好支持）

## 贡献流程与 PR 约定

### 除功能/修复外的贡献方向

我们欢迎不仅限于功能或修复的 PR。示例包括：

| 贡献方向 | 位置/文件 | 示例说明 |
| --- | --- | --- |
| Prompts | `src/crates/assembly/agent-content/prompts/agents/` | 新增或优化内置提示词；选择逻辑与运行时策略仍由现有模块负责 |
| Tools | `src/crates/assembly/core/src/agentic/tools/implementations/`、`src/crates/assembly/core/src/agentic/tools/registry.rs` | 新增工具实现，并在工具注册表中注册 |
| Subagents | `src/crates/assembly/core/src/agentic/agents/definitions/`、`src/crates/assembly/core/src/agentic/agents/registry/` | 新增子代理定义，并在所属注册表中注册 |
| 模式贡献 | `src/crates/assembly/core/src/agentic/agents/definitions/`、`src/crates/assembly/agent-content/prompts/agents/`、`src/nsh-ui/src/locales/` | 同步模式策略、内置提示词及所属界面文案 |
| Playbook 与场景指南 | `src/shared/interactive-capabilities/catalog.json`、所属应用 README | 维护源目录并运行 `pnpm run capabilities:generate`；`website/` 消费生成的目录 |

### 开始前

- 先开 Issue 说明问题或方案，尤其是较大改动，以避免重复与设计冲突
- 新功能或 UI 变更建议先讨论设计方向，确保符合产品体验
- 将 Issue 和 PR 模板作为填写指引；保持 PR 聚焦，必要时说明跳过了哪些验证以及原因。

### PR 标题与描述

建议使用 Conventional Commits 风格，便于维护版本记录与自动化流程：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档变更
- `chore:` 维护/依赖
- `refactor:` 重构且不改行为
- `test:` 测试相关

UI 改动请附前后对比截图或短录屏，方便快速评审。

如为 AI 辅助产出，请在 PR 中注明并说明测试程度（未测/轻测/已测），便于评审风险。

不要提交临时 AI prompt、本地绝对路径、生成的草稿文件、配对密钥、token、证书或无关产物。PR 应聚焦于本次产品或维护改动。

Repository Object Sizes 检查会拒绝超过 5 MiB 的 Git 文件对象，包括在中间提交中加入、
最终又删除的文件。构建产物应放在 Git 仓库之外。现有内置中文字体在
`scripts/git-object-size-policy.json` 中按精确对象 ID 列出例外，修改例外需要审查。
提交前可运行 `node scripts/check-git-object-sizes.mjs --base origin/main --head HEAD`，
省略 `--base` 则检查全部可达历史。检查器的验证命令为
`node --test scripts/check-git-object-sizes.test.mjs`。

### 分支管理

**`main` 分支为默认协作分支，并接受特性 PR。** 本仓库欢迎产品经理、开发者使用 AI 生成代码进行快速验证或提交想法，因此 **所有 PR 请直接提交到 `main` 分支**。

### 变更范围

保持 PR 小而聚焦，避免混杂无关改动。

## 测试与验证

按改动文件和行为选择最小检查。完整构建和大范围测试由 CI 保护；只有改动影响构建、打包、发布行为，
或 CI 无法覆盖对应路径时，才在本地运行更重命令。

常见本地检查：

| 改动类型 | 常用验证 |
| --- | --- |
| 仓库元信息或 GitHub 配置 | `pnpm run check:repo-hygiene && pnpm run check:github-config && git diff --check` |
| 前端运行时或 UI | `pnpm exec nsh check src/nsh-ui`；行为变化时再加最近的 focused `nsh test` 用例 |
| Rust 共享 runtime 或 services | 遵循最近模块的 `AGENTS.md`，选择单个包/测试目标和最小所需 feature |
| 桌面后端 / 原生宿主集成 | `cargo check -p openbitfun-desktop` |
| i18n 资源 | `pnpm run i18n:audit` |
| i18n 契约或共享术语 | `pnpm run i18n:generate && pnpm run i18n:contract:test && pnpm run i18n:audit` |

UI 改动在有帮助时附截图或短录屏。无法运行相关检查时，在 PR 中说明原因，并提供风险更低的手动验证路径。

桌面 UI 改动运行 `cd src/nsh-ui && nsh check && nsh test .`（`pnpm run e2e:ui`），主题或颜色改动另运行
`pnpm run theme:color-audit:all`。

## 安全与合规

- 不要提交密钥、Token、证书或任何敏感信息
- 新增依赖请确认许可证兼容并说明用途

## 感谢

每一份贡献都很重要，欢迎提交 Issue、PR 或建议！

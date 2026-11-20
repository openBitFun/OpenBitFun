**中文** | [English](AGENTS.md)

# AGENTS-CN.md

## 适用范围

本文件适用于 `tests/e2e`。仓库级规则请看顶层 `AGENTS.md`。

## 这里最重要的内容

原生 NSH 桌面应用的端到端覆盖分两层：

- **UI 层**：`src/nsh-ui` 中的无头 NSH 测试（`nsh test .`）。它在模拟宿主上渲染真实的
  TSX 应用，负责 UI 行为；规则见 [`src/nsh-ui/AGENTS.md`](../../src/nsh-ui/AGENTS.md)。
- **原生冒烟测试**（`native/smoke.mjs`）：在隔离的临时配置中启动真实运行器
  （`openbitfun-nsh` + `libopenbitfun_desktop_lib`），通过回环 OBP owner 连接
  （`ws://127.0.0.1:<port>/obp`，`Authorization: Bearer <owner token>`，JSON-RPC 2.0，
  先 `hello` 再 `call`）驱动后端，检查经 NSH shell 的 `host://shell-request` 往返，
  最后通过 `quit_app` 退出并要求退出码为 0。

驱动 Tauri WebView 的 WebDriverIO 套件已随 Tauri 宿主一同退役。

规则：

1. 纯 Node >= 22，无 npm 依赖；本目录不是 pnpm workspace 成员。
2. 不得触碰真实配置：保持 `OPENBITFUN_E2E_STORAGE_GUARD=1`、`OPENBITFUN_E2E_USER_ROOT`、
   `OPENBITFUN_E2E_HOME`、`OPENBITFUN_E2E_LOG_DIR`、隔离的 `HOME`（NSH UI 存储）和空闲的
   `OPENBITFUN_OBP_PORT`；断言 owner token 与 `hello.backend.dataDir` 位于临时根目录内。
3. 子进程设置 `windowsHide: true`；失败时结束应用并输出日志末尾。
4. 命令取自 `src/apps/desktop/src/backend_protocol/dispatch_generated.rs`，并在处理函数中
   确认请求结构；断言结果结构，而不只是成功与否。

## 命令

```bash
pnpm run desktop-nsh:build            # debug 运行器 + 后端 + NSH 包
pnpm run e2e:smoke                    # release-fast 构建（默认）
pnpm run e2e:smoke:debug              # target/debug 构建
pnpm run e2e:smoke:packaged           # target/desktop-nsh/OpenBitFun.app（macOS）或打包目录
node tests/e2e/native/smoke.mjs --help
pnpm run e2e:ui                       # cd src/nsh-ui && nsh test .（nsh 需在 PATH 中：$HOME/.nsh/bin）
```

## 验证

针对改动的构建运行冒烟测试。运行器、后端库和 NSH 包必须来自同一版本：较旧的部分会以
`unsupported_in_native_host` 明确失败。

CI：`ci.yml` 中的 `Native Desktop UI` 运行 `nsh check` 和 `nsh test .`；`desktop-package.yml`
与 `nightly-artifacts.yml` 的 macOS 打包任务用发布布局的 `OpenBitFun.app`（`--app`）运行冒烟测试。

冒烟测试只覆盖本地。不覆盖远程工作区、远程控制（mobile web、IM 机器人）、Peer Device
Mode、Detached Dispatch、LAN 或 mesh 监听器，也不覆盖真实模型服务。

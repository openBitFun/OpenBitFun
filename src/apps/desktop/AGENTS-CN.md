**中文** | [English](AGENTS.md)

# AGENTS-CN.md

## 适用范围

本文件适用于 `src/apps/desktop`。仓库级规则请看顶层 `AGENTS.md`。

## 这里最重要的内容

`src/apps/desktop` 是桌面端后端库（`openbitfun_desktop_lib`）。原生 NSH 桌面应用
（`src/apps/desktop-nsh`）通过 `src/backend_protocol/ffi.rs` 的 C ABI 在进程内加载它；浏览器、
手机和同账号的其他设备通过 OBP（`src/backend_protocol/ws`、`src/mesh`）访问同一个
`BackendService`。这里没有 Tauri 运行时、窗口或 WebView：Tauri 桌面外壳已退役
（`docs/architecture/unified-client-architecture.md`）。本 crate 只构建 `cdylib` + `rlib`，
runner 可执行文件位于 `src/apps/desktop-nsh/native`。

主要区域：

- `src/api/`：后端命令（`// @backend-command` 处理函数）
- `src/backend_protocol/`：协议服务、生成的分发器（`dispatch_generated.rs`）、宿主适配器
  （`native_commands/`）、OBP 监听器
- `src/host/`：宿主 shim（`State`、`HostHandle`、`NativeHost`）以及到 UI 进程的 shell 通道（`host/shell.rs`）
- `src/native_host.rs`：后端启动与优雅退出
- `src/native_browser.rs`：基于 shell 网页视图、面向智能体的内置浏览器
- `src/miniapp_desktop/`、`src/miniapp_web_host.rs`：MiniApp 窗口（`openbitfun-miniapp-shell`
  sidecar）与智能体 MiniApp 自动化
- `src/api/peer_host_invoke.rs`：面向旧版 peer 的 relay HostInvoke 宿主；允许/拒绝与能力来自
  Product Operation Registry（`openbitfun_product_domains::remote_surface`），不再有本地表
- `src/api/remote_workspace_policy.rs`：证明每个已注册命令在注册表中恰有一行的闭包测试
- `src/update_maintenance/`：已验证原生更新包的 macOS 应用包替换
- `src/computer_use/`：操作系统相关自动化支持

Peer Device Mode 的所有权和边界见 `docs/architecture/peer-device-mode.md`。

OpenBitFun 账号身份（GitHub 或邮箱验证码登录）统一由 `account_identity_api.rs` 提供；Relay 设备注册和生命周期位于
`src/api/remote_connect_api.rs`。设置留在所属设备，不再提供云端/本地同步选择。
Relay 部署向导已移除。保留 `src/apps/relay-server` 下供开发者使用的脚本和
[运维文档](../relay-server/README.md)，不要重新加入产品 UI。

如果改动影响多个运行时共享的行为，应把稳定契约、执行策略和服务放在各自的下层 owner
crate；`src/crates/assembly/core` 只保留产品装配与兼容桥接。

## 本模块规则

- 桌面端专属集成留在这里，不要下沉到共享 core。
- 窗口 lifecycle 行为（包括 close/minimize-to-tray 默认值）属于 NSH 外壳负责的桌面端 surface；
  修改时必须保留用户已保存偏好。
- 命令及其辅助函数使用 `crate::host::State` 与 `crate::host::HostHandle`。新命令在 `src/lib.rs`
  的 `backend_commands!` 中注册，在 `fn` 前一行加 `// @backend-command` 标记，保持旧客户端发送的
  `{ request }` / camelCase 参数形状，运行 `pnpm run desktop-nsh:generate-dispatch`，并在
  Product Operation Registry（`src/crates/contracts/product-domains/src/remote_surface/table.rs`）
  添加一行，然后运行 `pnpm run capabilities:generate`。生成器会拒绝 Tauri 参数类型。
- 直接作用于宿主或其 UI shell、而非类型化参数的命令，写成
  `src/backend_protocol/native_commands/` 中的宿主适配器
  （`fn <command>(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_>`），并以
  `backend_protocol::native_commands::<command>` 注册。窗口、托盘、通知、剪贴板、登录项与应用
  生命周期操作经由 shell 通道（`host://shell-request`，由 shell 以 `host_shell_respond` 应答）；
  没有 shell 提供该操作时明确报错。
- 删除命令：从 `backend_commands!` 移除，并把注册表行替换为带原因的 `retired(...)`。分发器随后
  对旧客户端返回 `unsupported_in_native_host: <command> (retired: <reason>)`。
- 原生更新器读取清单中的 `<os>-<arch>-nsh` 条目，并使用独立的 `app-updates-nsh` 缓存。发布清单
  也把旧的 `darwin-<arch>` 键指向同一个原生包，让已安装的 Tauri 版本升级到原生应用；应用包为此保留
  指向 runner 的 `Contents/MacOS/openbitfun-desktop` 链接（`scripts/package-desktop-nsh-macos.mjs`）。
  聚焦检查：`cargo test -p openbitfun-desktop --lib -- host::shell backend_protocol::native_commands`。

## 命令

```bash
pnpm run desktop:dev              # 构建（profile desktop-dev）并运行原生应用（scripts/desktop-nsh-dev.mjs）
pnpm run desktop:preview:debug    # 不重新构建，运行上一次开发构建
pnpm run desktop-nsh:build        # UI bundle + 后端库 + runner
pnpm run desktop-nsh:package:mac  # target/desktop-nsh/OpenBitFun.app（另有 :windows、:linux）
pnpm run prepare:dsh-profile      # 可选：本地 DeepSeek Harness 会话
```

`desktop:dev --isolated-data` 把设置、工作区和会话放在本仓库的 `.openbitfun/desktop-dev/`
（`OPENBITFUN_USER_ROOT`/`OPENBITFUN_HOME`），默认使用已安装应用的数据。NSH crate 需要
Rust 1.97 或更新版本。

Data Tools 独立运行；桌面开发启动器不会构建、启动或监管它，请使用 `src/apps/data-tools`
自己的开发和发布入口。

`release-fast` profile（`Cargo.toml`）：继承 `release`，但关闭 LTO、`codegen-units` 提高到 16、
启用增量编译。编译速度显著提升，代价是二进制体积和少量运行时性能。

## 验证

```bash
cargo check -p openbitfun-desktop
cargo test -p openbitfun-desktop --lib
pnpm run desktop-nsh:check-dispatch
node --test scripts/generate-desktop-native-dispatch.test.mjs
```

打包后原生应用的冒烟测试（隔离数据目录启动、经 loopback OBP owner 连接驱动、退出）是
`pnpm run e2e:smoke`，见 `tests/e2e/AGENTS.md`。UI 测试套件是 `pnpm run e2e:ui`。

验证 ACP 取消请求兼容性时，运行
`cargo test --locked -p openbitfun-desktop --no-default-features --lib acp_cancel_request`，
覆盖旧请求反序列化与往返，以及可选的 Turn 绑定字段。

已暂存更新包的缓存与签名行为使用 `cargo test -p openbitfun-desktop --lib api::update_api::tests`；
内置浏览器目标关联与导航结果使用
`cargo test -p openbitfun-desktop --lib api::browser_api::tests native_browser`。修改浏览器或
更新器命令注册后，还要运行 `cargo test -p openbitfun-desktop --lib remote_workspace_policy`。

其余聚焦测试（ACP、token 用量、Relay 路由、账号身份、Pages、快照、技能、宠物包、搜索、
配额、HTML 预览、LaTeX、上下文估算、macOS ComputerUse 往返）与英文版 [AGENTS.md](AGENTS.md)
的“Verification”章节一致。

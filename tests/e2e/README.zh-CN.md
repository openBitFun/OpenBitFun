[English](README.md) | **中文**

# OpenBitFun E2E 测试

原生 NSH 桌面应用的端到端检查。

| 层 | 位置 | 运行 |
|---|---|---|
| UI | `src/nsh-ui/test` | `pnpm run e2e:ui`（`cd src/nsh-ui && nsh test .`） |
| 原生冒烟 | `tests/e2e/native/smoke.mjs` | `pnpm run e2e:smoke` |

UI 层在模拟宿主上无头渲染真实应用。原生冒烟测试运行真实运行器和后端库，并像浏览器或
手机客户端一样，通过回环 OBP owner 连接访问后端。

## 前置条件

- Node >= 22。本目录不需要 `pnpm install`。
- 原生构建：
  - Profile 构建：`pnpm run desktop-nsh:build`（debug），或用 `--profile release-fast`
    构建的运行器和后端库，并在 `target/desktop-nsh/nsh`（`pnpm run desktop-nsh:bundle`）
    或 `nsh-release` 中有 NSH 包；
  - 打包构建：`pnpm run desktop-nsh:package:mac`（或 `:windows` / `:linux`）。
- `e2e:ui` 需要 `nsh` CLI 在 `PATH` 中（`export PATH="$HOME/.nsh/bin:$PATH"`）。

## 运行

```bash
pnpm run e2e:smoke                    # target/release-fast/openbitfun-nsh
pnpm run e2e:smoke:debug              # target/debug/openbitfun-nsh
pnpm run e2e:smoke:packaged           # target/desktop-nsh/OpenBitFun.app
node tests/e2e/native/smoke.mjs --app /path/to/OpenBitFun.app --keep-profile
pnpm run e2e:ui
```

参数：`--profile <debug|release-fast|release>`、`--packaged`、`--app <path>`、
`--nsh-app-dir <dir>`、`--keep-profile`、`--timeout <ms>`（见 `--help`）。缺少构建时会
失败并给出对应的构建命令。

## 冒烟测试检查的内容

1. 应用在全新的临时配置中启动（`OPENBITFUN_E2E_STORAGE_GUARD=1`、E2E 用户根目录、产品
   主目录、日志目录、隔离的 `HOME`、空闲的 `OPENBITFUN_OBP_PORT`）。
2. owner token 出现在 `<tmp>/user/data/obp/owner-token`。
3. `hello` 返回协议 1、scope `owner`、后端版本，以及位于临时配置内的数据目录。
4. `get_app_version`、`get_system_info`、`get_config`、`open_workspace`、
   `get_opened_workspaces`、`get_recent_workspaces` 和 `list_sessions` 返回预期结构。
   打包运行（`--packaged`、`--app`）还会把工作区初始化为只有一个提交的 Git 工作树、开启
   工作区搜索，并要求 `search_file_contents` 由包内的 Flashgrep 守护进程完成：先在未建索引时，
   再在 `search_build_index` 之后由索引返回结果（缺少 `flashgrep/` 的包在这一步失败）。
5. `initialize_tray_after_startup` 和 `set_tray_unread_count` 经 NSH shell
   （`host://shell-request` 往返）完成。
6. `quit_app` 使进程以退出码 0 结束，并删除 owner token。

失败时会结束应用、输出 `app.log` 和运行器输出的末尾，并以非零退出码结束。除非指定
`--keep-profile`，临时配置会被删除。

## 覆盖范围限制

只覆盖本地。不覆盖远程工作区、远程控制（mobile web、IM 机器人）、Peer Device Mode、
Detached Dispatch、LAN 与 mesh 监听器以及真实模型服务。扩展冒烟测试见
[E2E-TESTING-GUIDE.zh-CN.md](E2E-TESTING-GUIDE.zh-CN.md)。

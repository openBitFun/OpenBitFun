[English](E2E-TESTING-GUIDE.md) | **中文**

# E2E 测试指南

说明原生冒烟测试的构成及扩展方法。命令与覆盖范围见 [README.zh-CN.md](README.zh-CN.md)。

## 进程与配置

`native/smoke.mjs` 以 `windowsHide: true` 启动运行器，`cwd` 为临时根目录，环境变量如下：

| 变量 | 值 | 作用 |
|---|---|---|
| `OPENBITFUN_E2E_STORAGE_GUARD` | `1` | 没有隔离根目录时 PathManager 拒绝启动 |
| `OPENBITFUN_E2E_USER_ROOT` | `<tmp>/user` | 配置、数据（`data/obp/owner-token`）、会话 |
| `OPENBITFUN_E2E_HOME` | `<tmp>/home` | 产品主目录（助理工作区、项目运行时） |
| `OPENBITFUN_E2E_LOG_DIR` | `<tmp>/logs` | `<timestamp>/app.log` |
| `OPENBITFUN_OBP_PORT` | 空闲回环端口 | 不与运行在 47610 的应用冲突 |
| `HOME`、`XDG_*`（Windows 上为 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`） | `<tmp>/os-home` | NSH UI 存储及其他系统主目录路径 |
| `NSH_APP_DIR` | NSH 包（仅 profile 构建） | 打包应用使用自身的 `Resources/nsh` |

继承环境中的 `OPENBITFUN_USER_ROOT`、`OPENBITFUN_HOME`、`OPENBITFUN_LOG_DIR`、
`OPENBITFUN_OBP_LISTENER` 和 `OPENBITFUN_WEBDRIVER_PORT` 会被移除。若请求的端口被占用，
监听器会改用临时端口；测试从 `OBP loopback listener started` 日志行读取实际端口。

## 协议客户端

回环监听器通过 `Authorization: Bearer <token>`（或会话 cookie）接受 owner token。Node 的全局
`WebSocket` 无法设置该请求头，因此测试自带一个无依赖的最小 RFC 6455 客户端（HTTP 升级、
带掩码的文本帧、ping/pong、关闭）。

会话流程：

1. `hello {protocol: 1, client: 'e2e-smoke', ack: true}`。`ack: true` 时后端启用信用流控，
   客户端需对每个 `event` 帧回复 `{method: 'ack', params: {seq}}`。
2. 每个步骤发送 `call {command, args}`。参数采用 Tauri 形式：带结构化请求的命令使用
   `{request: {...}}`。
3. `quit_app`：回复可能与进程退出竞争；连接关闭视为已送达，随后进程须在 30 秒内以退出码
   0 结束。

## 添加步骤

1. 在 `src/apps/desktop/src/backend_protocol/dispatch_generated.rs` 中选择命令。`Native`
   命令在后端运行；`Adapter` 命令经 `backend_protocol/native_commands`（通常是发往 NSH
   shell 的 `host://shell-request`）；`Unsupported` 命令按设计失败。
2. 阅读处理函数的请求结构和响应类型；断言响应结构及测试可控的值。
3. 副作用限制在临时配置内（工作区路径使用 `dirs.workspace`）。不要调用访问网络、真实账号
   或其他设备的命令。
4. Shell 适配命令需要 UI 已完成 shell 挂接（`host_shell_attach`）；放在等待挂接的
   `initialize_tray_after_startup` 步骤之后。

## 故障排查

- `Runner not found` / `Backend library not found` / `NSH UI bundle not found`：按输出的
  命令构建。
- `unsupported_in_native_host: ...`：运行器、后端库和 NSH 包来自不同版本；重新构建较旧的部分。
- `no owner token`：后端未启动；查看输出的 `app.log` 末尾，或使用 `--keep-profile` 重跑后
  检查 `<tmp>/logs`。
- `HTTP 401`：token 不属于该监听器（由其他进程写入）。

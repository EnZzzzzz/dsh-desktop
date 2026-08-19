# dsh-desktop

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的桌面客户端：Electron + React + TypeScript，通过官方 SDK [`@deepseek-ai/dsh-sdk-client`](https://www.npmjs.com/package/@deepseek-ai/dsh-sdk-client) 以 stdio JSON-RPC 驱动一个本地的 harness 运行时子进程。

## 架构

```
渲染进程（React 聊天 UI）
   │  IPC（window.dsh，contextBridge 隔离）
主进程（Electron / Node）
   │  DeepSeekHarness（@deepseek-ai/dsh-sdk-client）
   │  stdio JSON-RPC（initialize / session/prompt / shutdown + 事件通知）
运行时子进程（dsh-jsonrpc-agent + runtime/cordis.yml）
   │  DeepSeek API
模型服务
```

- **运行时组合**：`runtime/cordis.yml` 定义子进程的插件栈（SDK JSON-RPC server、DeepSeek 适配器、本地沙箱、persistent bash、str-replace 编辑器、JSONL 会话持久化），改编自上游 `examples/jsonrpc-agent/minimal.cordis.yml`。
- **事件流**：运行时的 `session.event` / `session.status` 通知经主进程转发到渲染端，由 `src/renderer/src/events.ts` 折叠成聊天记录（流式文本增量、思考过程、工具调用/结果卡片、轮次边界）。
- **设置**：API Key、模型、工作区目录、输出 token 上限保存在 `userData/settings.json`（本机明文，注意取舍），改动后运行时自动重启。

## 先决条件

- Node.js `^22.19.0 || >=24.0.0`（运行时使用；Electron 界面本身自带运行时）
- pnpm 11
- 一个 DeepSeek API Key（在应用「设置」中填写，或经环境变量 `DEEPSEEK_API_KEY` 传给子进程）

## 运行

```sh
pnpm install
pnpm dev        # 开发模式（HMR）
pnpm build      # 三端编译到 out/
pnpm start      # 以构建产物启动
pnpm typecheck  # tsc 项目引用检查
pnpm smoke      # 无界面冒烟：SDK 握手；有 DEEPSEEK_API_KEY 时加跑一轮真实对话
```

首次发送消息时会惰性启动运行时子进程（需要几秒）。「新会话」按钮开启新的 SDK 会话；会话持久化在 `userData/sessions/`。

## 已知限制（继承自上游 preview 协议）

- **无逐轮取消**：SDK 协议没有 prompt 取消方法。「停止」按钮的语义是回收并重启运行时子进程，进行中的轮次输出仍会留在事件流中。
- **无历史会话列表**：协议没有会话枚举/恢复接口；会话 JSONL 在运行时侧持久化，但 UI 只能看到本次启动后的活动会话。
- **上游处于 developer preview**：`@deepseek-ai/*` 各包固定为 `0.1.0-rc.7`（存在兼容性断裂声明，升级需整族一起升）。注意默认 npmmirror 镜像的 latest 标签滞后，本项目 `.npmrc` 已将 `@deepseek-ai` scope 指向官方 registry。
- **未打包分发**：本期只做开发态运行；electron-builder 打包与运行时内嵌（捆绑 node、node_modules 外置）留作后续。

## 目录

```
runtime/cordis.yml   运行时插件组合（stdio JSON-RPC agent）
scripts/smoke.mjs    SDK 路径冒烟脚本
src/main/            Electron 主进程：HarnessManager（SDK 生命周期）、设置、IPC
src/preload/         contextBridge → window.dsh
src/shared/          IPC 通道与载荷类型（三端共享）
src/renderer/        React 聊天界面
```

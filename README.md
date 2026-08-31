# dsh-desktop

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）官方 Web UI 的桌面壳：Electron 主进程在本地拉起 `dsh web` 服务（随机空闲端口，仅监听 `127.0.0.1`），就绪后在窗口中加载该界面。**界面与功能 100% 来自官方 `@deepseek-ai/dsh` 包，本项目不做任何修改。**

## 架构

```
Electron 窗口（BrowserWindow）
   │  loadURL http://127.0.0.1:<随机端口>
主进程（Electron / Node）
   │  spawn node <dsh CLI> web --port <随机端口>
   │  轮询等待 HTTP 200，失败展示错误页；退出时 SIGTERM 回收
dsh web 服务子进程（@deepseek-ai/dsh，官方 Web UI + agent 运行时）
```

- 会话、凭据、插件等数据全部走 dsh 自身的 `$DSH_HOME` 默认位置，与命令行 `npx @deepseek-ai/dsh web` 完全互通。
- 服务日志写入应用数据目录 `logs/web-server.log`（界面提示服务启动失败时先看它）。
- 单实例锁：重复启动只会聚焦已有窗口；关闭窗口即退出应用并回收服务进程。

## 安装（DMG）

1. 双击 `dist/dsh-desktop-<version>-arm64.dmg`，把 dsh-desktop 拖进「应用程序」。
2. 首次启动如被 Gatekeeper 拦截（应用未签名）：在「应用程序」里**右键 → 打开**，或在 系统设置 → 隐私与安全性 中放行。
3. 应用内已捆绑 Node.js 运行时与全部 dsh 依赖，**无需安装任何其他东西**。

## 开发

先决条件：Node.js `^22.19.0 || >=24.0.0`、npm 11。

```sh
npm install
npm run dev          # 开发模式（主进程改动自动重启）
npm run typecheck    # tsc 检查
npm run package      # 产出 dist/ 下的 DMG
npm run package:dir  # 免压缩的 .app 目录，调试用
```

打包踩坑记录与开发准则见 [AGENTS.md](AGENTS.md)。

## 已知限制

- 未签名、未公证：DMG 仅供本机/信任环境安装。
- 上游 dsh 处于 developer preview，存在兼容性断裂声明；升级时整族版本一起升。
- 未构建 x64 / Windows / Linux 包（配置可加，未验证）。
- 应用图标沿用 Electron 默认图标。

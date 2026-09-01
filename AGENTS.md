# AGENTS.md

dsh-desktop 是 DeepSeek Harness（`dsh`）官方 Web UI 的 Electron 桌面壳。项目介绍见 [README.md](README.md)。

## 常用命令

```sh
npm install
npm run dev          # 开发模式（主进程改动自动重启）
npm run typecheck    # tsc 检查，改完代码必须跑
npm run package      # 先跑 scripts/prepare-node.mjs 捆绑 Node，再产出 dist/ 下的 DMG
npm run package:dir  # 免压缩的 .app 目录，调试用
```

先决条件：Node.js `^22.19.0 || >=24.0.0`、npm 11。

## 查内核版本

"内核"指 `@deepseek-ai/dsh` 包。当前版本看 `package.json` 的 `dependencies`（`build/runtime/package.json` 由 prepare 脚本同步生成）。

```sh
npm view @deepseek-ai/dsh dist-tags   # latest / next / alpha 各通道指向的版本
npm view @deepseek-ai/dsh versions    # 全部已发布版本
npm view @deepseek-ai/dsh time        # 各版本发布时间，判断新旧
```

稳定通道看 `latest` 标签；预发布版（如 `*-alpha.*`）挂在 `alpha` 标签下，升级前需确认稳定性。

## 开发准则

- 本项目只做壳：界面与功能 100% 来自官方 `@deepseek-ai/dsh` 包，不 fork、不修改上游 UI；自定义行为只落在 `src/main` / `src/preload`。
- 应用版本号与内核 `@deepseek-ai/dsh` 版本保持同步，升级时 `@deepseek-ai/*` 整族一起升。
- 改动打包配置（`electron-builder.yml`、`scripts/`、依赖结构）后必须跑 `npm run package` 验证 DMG 能产出且应用能启动。

## 打包踩坑记录

- `asar: false`：运行时子进程按真实文件路径读取 CLI 与插件包，asar 归档内无法读取。
- **用 npm 而不是 pnpm**：electron-builder 的依赖收集器面对 pnpm 布局（符号链接 / `.pnpm` 隐藏目录 / hoisted 冲突嵌套）会静默丢包。
- **node_modules 经 `extraResources` 原样拷贝，不走收集器**：dsh 插件树大量依赖 peerDependencies，npm 会自动安装 peers 但收集器不携带间接 peer（如 `cordis-plugin-group`、`dsh-bash-sandbox`），逐个补声明是打地鼠，直接整树拷贝最可靠。
- electron-builder 固定 25.1.8：26.x 的 `app-builder-lib` 声明依赖 `@electron/get@^3` 却使用了 v4+ 才加入的 `ElectronDownloadCacheMode`，打包即崩（上游版本声明 bug）。
- `scripts/prepare-node.mjs` 把构建机的 Node 可执行文件复制到 `build/node/bin/node`，经 `extraResources` 打进 `Resources/node/`，子进程优先使用它（找不到才回退系统 Node / Electron run-as-node）。
- `@deepseek-ai/*` 固定版本并指向官方 registry（`.npmrc`）：npmmirror 的 latest 标签滞后。
- npm 11 默认拦截依赖安装脚本：已在本包 `allowScripts` 中放行 electron/esbuild/koffi/node-pty/dsh-subprocess-local。若 `node_modules/electron/dist` 不完整（本机出现过 install.js 缓存命中后不解压的静默失败），手动执行：
  `cd node_modules/electron && unzip -oq ~/Library/Caches/electron/*/electron-v<version>-darwin-arm64.zip -d dist && echo -n "v<version>" > dist/version && echo -n "Electron.app/Contents/MacOS/Electron" > path.txt`

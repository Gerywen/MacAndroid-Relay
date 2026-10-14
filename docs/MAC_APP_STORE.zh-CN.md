# Mac App Store 适配

[English](MAC_APP_STORE.md) | **简体中文**

[返回 README](../README.zh-CN.md)

## 当前状态

已实现 MAS 构建配置和应用层文件夹授权。**尚未运行或验证真正签名的 MAS 版本。** 当前开发机没有有效的 Apple 签名证书。普通 Electron 构建和授权策略测试不代表 Apple App Sandbox 已通过，也不代表会获得审核批准。

首轮验收目标是在已注册的 Mac 上运行 Apple Development 签名的 MAS 应用：选择一个 Mac 文件夹，连接 Android，上传、下载并比较 SHA-256，再断开 / 重连。

## 签名准备

1. 加入 Apple Developer Program。
2. 在开发者后台注册明确的 App ID `io.macandroid.relay` 和测试 Mac。
3. 创建 Apple Development 证书，并将证书和私钥安装到本机钥匙串。
4. 下载与 App ID 和测试 Mac 匹配的 Mac 开发描述文件。Electron 所需的应用组 `TEAM_ID.io.macandroid.relay` 必须与团队和描述文件配置一致。

不要提交证书、私钥或描述文件。构建脚本检查签名身份、描述文件 Team ID、App ID、注册设备信息及有效期；完整的证书与描述文件匹配关系还会在签名时由 Apple 和 electron-builder 验证。

```sh
export MAS_TEAM_ID='YOUR_TEAM_ID'
export MAS_SIGN_IDENTITY='Apple Development: Your Name (YOUR_TEAM_ID)'
export MAS_PROVISIONING_PROFILE='/absolute/path/to/development.provisionprofile'
npm run package:mas:dev
```

将示例替换为真实签名信息。产物单独保存在 `release/mas-development/`，不会覆盖普通预览版。生成配置和已替换 Team ID 的权限文件位于忽略目录 `native-build/mas/`。脚本使用 Electron 的 `mas-dev` 目标，并要求实际签名，不会退回 ad-hoc 签名。

提交商店时使用 Apple Distribution 身份及匹配的 Mac App Store 分发描述文件：

```sh
export MAS_SIGN_IDENTITY='Apple Distribution: Your Name (YOUR_TEAM_ID)'
export MAS_PROVISIONING_PROFILE='/absolute/path/to/distribution.provisionprofile'
npm run package:mas
```

分发产物位于 `release/mas-distribution/`。还需要安装 electron-builder 生成安装包所需的安装包签名证书。商店分发包不是本地测试包，应先用开发描述文件验证。以上命令不会上传或提交审核。

## 沙箱设计

父进程申请 App Sandbox、USB、用户选择文件读写、应用范围书签及 Electron 应用组权限；辅助进程继承沙箱。首轮配置不申请摄像头、麦克风、网络、广泛文件系统例外或未签名库权限。

MAS 界面首先显示文件夹授权入口。原生选择框生成 security-scoped bookmark，书签只保存在应用本机数据目录，不通过渲染层 API 暴露。恢复授权后才浏览目录；授权失效或目录移动时，需要重新选择。

路径输入、本地修改、打开文件、上传来源和下载目标都会检查授权边界。检查解析现有父目录和符号链接，也覆盖尚未创建的路径。应用不能重命名或删除授权根目录。退出前等待传输完成并释放所有活动授权。

首轮 MAS 验证中，libmtp 后端运行在已沙箱化的**主进程**，使用同一组文件访问授权；普通版保留独立 utility process。这样不依赖尚未验证的动态文件授权向已有子进程传递。代价是原生故障可能终止 MAS 应用；验证沙箱传输后，还需继续设计原生故障隔离。MAS 分支不会使用普通服务进程的未签名库选项。

## 无证书时可以运行的检查

```sh
npm test
npm run build
npm run verify:mas:policy
npm run verify
```

`verify:mas:policy` 在未打包的普通 Electron 中使用测试专用的文件选择返回值，验证真实渲染层 / preload / IPC 授权流程和未授权路径拒绝。报告明确记录 `actualAppSandbox: false`。测试夹具不能在真实 MAS 版本中授予访问权限，并在打包应用中禁用。

单元测试覆盖授权持久化、资源释放、路径越界、相似路径前缀、符号链接逃逸，以及缺少签名材料时构建配置拒绝继续。

## 签名开发版验收

- 通过诊断确认 `process.mas`，用 `codesign` 检查应用及辅助进程权限。
- 选择文件夹，验证其中的读取、新建、重命名和删除。
- 输入未授权路径或访问指向根目录之外的符号链接，必须拒绝。
- 重启后验证书签恢复；移动或删除已授权目录，验证重新授权入口。
- 连接 Android，浏览存储与目录，上传、下载中文、空文件、二进制和嵌套文件，比较 SHA-256，并测试重连。
- 测试手机锁屏、拔线、存储不足及下载失败时原文件保留。
- 检查原生模块加载和沙箱拒绝日志，验证其他设备与 Intel 后再声明支持。

## 尚需准备的上架材料

公开隐私政策 URL、支持 URL、App Store Connect 应用记录、真实截图与元数据，以及说明 Android 硬件要求的审核备注。提供实体 Mac 与手机交互的视频，不将 README 模拟截图作为兼容性证据。隐私申报必须符合最终分发版本的实际行为。

官方参考：

- [Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [Apple App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)
- [USB 权限](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.usb)
- [依赖硬件应用的审核资料](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review)

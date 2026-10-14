# 独立 libmtp 传输后端

[English](README.md) | **简体中文**

[返回工程说明](../README.zh-CN.md)

应用直接通过 Koffi 调用 libmtp 1.1.23，由 TypeScript 负责路径解析、目录递归、覆盖保护和进度汇总。USB 通信使用 libusb 1.0.30。

## 固定源码

`vendor/libmtp-1.1.23.tar.gz` 来源为 libmtp 官方 SourceForge 发布；`vendor/libusb-1.0.30.tar.bz2` 来源为 libusb 官方 GitHub Release。下载地址及 SHA-256 记录在 `resources/native/manifest.json` 与构建脚本中。`include/libmtp.h` 是该固定版本的官方公开头文件，用于原生 ABI 回归。

## 构建

需要 macOS、Xcode Command Line Tools、Node.js 和 pkg-config（用于 libmtp 查找刚构建的 libusb）。构建使用工程中随附的源码归档和依赖。

在工程根目录运行：

```sh
npm run build:core                  # 当前架构，产物位于 native-build/<arch>/bundle
npm run build:core -- --all         # Apple Silicon 和 Intel
npm run build:core -- --all --install # 写入 resources/native 并更新校验清单
```

构建脚本先校验源码归档，再进行独立目录构建。发布归档中预生成的 Linux endian 头文件会被移除，使用 configure 针对目标平台生成的头文件。由于新 SDK 的链接检查可能把旧系统缺少的 pipe2 弱符号判为可用，构建固定 `ac_cv_func_pipe2=no`，使用兼容的 pipe 实现。另随附 `patches/libmtp-macos-android-close.patch`：仅在 macOS 自动识别到 Android 协议扩展时取消“关闭会话后强制 USB reset”标志，避免手机从总线重新枚举造成即时重连失败。正常 MTP CloseSession 与 USB 接口释放仍执行，MTP 包编解码未修改。MTPZ（非 Android 的专有扩展）被禁用，不引入额外加密依赖。

两种原生库架构都以 macOS 12 为部署目标；这不代表 Electron 应用的最低系统版本。libmtp 的 libusb 依赖设置为 `@loader_path/libusb-1.0.0.dylib`，使用系统 libiconv；两个 dylib 均添加 ad-hoc 签名。随附 Intel 二进制尚未在 Intel Mac 真机验证。

## 验证

`npm test` 用官方头文件编译 C 夹具，对照结构大小和字段偏移，并验证链表释放、会话互斥、中文 / 空文件 / 递归目录传输、异常设备名称拒绝，以及失败下载保留原文件和清理临时文件。

`npm run build` 后运行 `npm run verify:hardware`，通过实际 Electron / preload / IPC 进行手机往返验证。独立后端已在 Apple Silicon Mac + Redmi K50 Pro 上通过 4 项 SHA-256、目录操作、覆盖确认、立即断开 / 重连和测试目录清理，最终签名包诊断确认加载的是 `libmtp.9.dylib`。

## 许可与源码重建

libmtp 和 libusb 使用 LGPL；许可证位于 `resources/licenses/`。应用采用独立动态库，并在 `Contents/Resources/licenses/` 中提供许可、源码归档、兼容补丁、此构建说明及构建脚本。重建时可把源码归档放入工程的 `native/vendor/`，按以上命令构建。

`resources/native/manifest.json` 的动态库 SHA-256 对应工程资源中的构建产物。Electron 打包时会重新签名 Mach-O 文件，其签名区变化会使应用包内动态库的完整文件哈希不同；源码归档及兼容补丁的校验值不受签名影响。

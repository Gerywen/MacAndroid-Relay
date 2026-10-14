# 第三方声明

[English](THIRD_PARTY_NOTICES.md) | **简体中文**

[返回 README](README.zh-CN.md)

应用的 MIT 许可证不替代依赖组件的许可证。上游版权和许可声明应随对应组件保留。

| 组件                                              | 用途     | 许可证 / 声明                                   |
| ------------------------------------------------- | -------- | ----------------------------------------------- |
| [libmtp 1.1.23](https://github.com/libmtp/libmtp) | MTP 通信 | [LGPL 文本](resources/licenses/libmtp-LGPL.txt) |
| [libusb 1.0.30](https://github.com/libusb/libusb) | USB 访问 | [LGPL 文本](resources/licenses/libusb-LGPL.txt) |

libmtp 与 libusb 采用动态加载。固定源码归档位于 `native/vendor/`，macOS Android 会话兼容补丁位于 `native/patches/`，构建步骤见[原生说明](native/README.zh-CN.md)。打包应用的 `Contents/Resources/licenses/` 中包含这些源码、补丁、许可证和构建说明。

原作者的 MIT 版权声明保留于 [版权归属文件](resources/licenses/attribution-MIT.txt)。

Electron、React、Koffi、node-usb 和 Lucide 等 JavaScript 依赖保留其软件包提供的许可证。重新分发时，请根据 `package-lock.json` 中固定的版本查看各软件包的许可文件。

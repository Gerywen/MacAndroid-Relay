# 为 MacAndroid Relay 贡献

[English](CONTRIBUTING.md) | **简体中文**

[返回 README](README.zh-CN.md)

## 开始开发

使用 macOS 和 Node.js 24（最低 22.12）。运行 C/FFI 测试需要安装 Xcode Command Line Tools。

```sh
nvm use
npm ci
npm run dev
```

Vite 默认监听 `127.0.0.1:5174`，可通过 `VITE_PORT` 更换端口。React 更新保留组件状态；Electron 服务代码更新会重启开发应用。

## 工程结构

| 目录               | 职责                               |
| ------------------ | ---------------------------------- |
| `src/`             | React 界面、Hooks、翻译和样式      |
| `shared/`          | 桌面 API 类型契约                  |
| `electron/`        | 桌面集成、文件系统操作和 MTP 服务  |
| `electron/native/` | libmtp FFI 绑定和递归传输          |
| `native/`          | 固定上游源码、公开头文件和兼容补丁 |
| `resources/`       | 图标、原生二进制和依赖许可证       |
| `scripts/`         | 开发、构建和应用验证工具           |
| `tests/`           | 业务和原生 ABI/FFI 测试            |

## 提交 Pull Request

1. 说明要解决的问题或实现的功能，保持修改范围明确。
2. 修改界面文字时同步更新两种语言字典；修改已记录行为时同步更新两份 README。
3. 为行为变化补充回归覆盖，特别是传输失败、对象内存所有权和删除等文件操作。
4. 执行下列检查。界面修改附上截图；原生修改说明测试使用的系统、架构和设备。
5. 在 Pull Request 中说明修改内容和验证结果，明确列出无法运行的检查。

```sh
npm run typecheck
npm test
npm run format:check
npm run build
```

不要提交构建产物、临时配置、个人文件或设备标识。保留版权和依赖声明。

## 应用验证

先构建，再运行相关检查：

```sh
npm run build
npm run verify
npm run verify:dev
npm run verify:hardware
```

- `verify`：使用隔离配置和生成文件验证真实 Electron 界面，包括路径导航、文件操作、虚拟滚动、主题、原生菜单和 preload 边界。
- `verify:dev`：检查 React 热更新和 Electron 重启，会临时修改两个源码文件并在结束后恢复；执行时不要同时编辑这些文件。
- `verify:hardware`：需要解锁并开启 MTP 的 Android 设备，同时退出其他传输应用。测试创建自己的设备目录，检查文件操作和覆盖保护，上传、下载测试文件并比较 SHA-256，最后清理目录。

报告和截图保存在系统临时目录的 `macandroid-relay-ui-*` 下。向 Issue 附加报告前，请检查并移除隐私信息。

原生夹具测试与固定版本公开头文件对照 C 结构大小和偏移，检查链表释放及操作互斥，并确认失败下载保留已有文件。

## 修改原生库

参见[原生构建说明](native/README.zh-CN.md)。固定上游版本，替换二进制时更新校验值，并同步维护源码与许可证。修改 macOS 兼容补丁时，如有硬件条件，应进行真实断开 / 重连和文件传输验证。

## 设备兼容性反馈

提供 macOS 版本、Mac 架构、Android 型号与系统版本、应用版本、USB 模式、复现步骤，以及移除隐私标识后的诊断。分别说明连接、浏览、上传、下载和重连结果，不要只写“可以使用”。

## 文档截图

README 截图来自应用的实际渲染层，使用生成的示例文件和模拟设备。截图展示界面，不作为真机兼容性证据。

# Contributing to MacAndroid Relay

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

[Back to the README](README.md)

## Getting started

Use macOS and Node.js 24 (minimum 22.12). Install Xcode Command Line Tools to run the C/FFI tests.

```sh
nvm use
npm ci
npm run dev
```

Vite listens on `127.0.0.1:5174` by default; set `VITE_PORT` to change the port. React updates preserve component state, while Electron service changes restart the development app.

## Project layout

| Directory          | Responsibility                                                  |
| ------------------ | --------------------------------------------------------------- |
| `src/`             | React UI, Hooks, translations, and styles                       |
| `shared/`          | Typed desktop API contracts                                     |
| `electron/`        | Desktop integration, filesystem operations, and MTP service     |
| `electron/native/` | libmtp FFI bindings and recursive transfers                     |
| `native/`          | Pinned upstream sources, public header, and compatibility patch |
| `resources/`       | Icons, native binaries, and dependency licenses                 |
| `scripts/`         | Development, build, and application verification tools          |
| `tests/`           | Business and native ABI/FFI tests                               |

## Pull requests

1. Describe the problem or feature and keep the change focused.
2. Update both language catalogs for UI text and both README editions when changing documented behavior.
3. Add regression coverage for behavior changes, especially transfer failures, object ownership, and destructive file operations.
4. Run the checks below. For UI changes, include a screenshot; for native changes, report the tested OS, architecture, and device.
5. Submit a pull request explaining the change and the checks performed. Clearly state checks you could not run.

```sh
npm run typecheck
npm test
npm run format:check
npm run build
```

Do not commit generated build output, temporary profiles, private files, or device identifiers. Keep copyright and dependency notices intact.

## Application verification

Build first, then run the relevant checks:

```sh
npm run build
npm run verify
npm run verify:dev
npm run verify:hardware
```

- `verify`: tests the real Electron UI with an isolated profile and generated files, including navigation, file operations, virtualization, themes, native menus, and the preload boundary.
- `verify:dev`: checks React Fast Refresh and Electron restarts. It temporarily edits two source files and restores them; run it without concurrent edits to those files.
- `verify:hardware`: requires an unlocked Android device in MTP mode, with other transfer applications closed. It creates its own device directory, tests mutations and overwrite protection, uploads and downloads fixtures, compares SHA-256 values, and cleans up the directory.

Reports and screenshots are stored in the system temporary directory under `macandroid-relay-ui-*`. Inspect reports for private information before attaching them to an issue.

Native fixture tests compare C structure sizes and offsets with the pinned public header, check linked-list cleanup and operation locking, and ensure failed downloads preserve existing files.

## Native library changes

See the [native build guide](native/README.md). Keep upstream versions pinned, update checksums when replacing binaries, and include source and license updates. Changes to the macOS compatibility patch should be accompanied by real disconnect/reconnect and transfer verification where hardware is available.

## Device compatibility reports

Include the macOS version, Mac architecture, Android model and OS version, app version, USB connection mode, reproduction steps, and diagnostics with private identifiers removed. Distinguish connection, browsing, upload, download, and reconnect results rather than reporting only “works.”

## Documentation screenshots

README screenshots show the application's actual renderer with generated example files and a simulated device. They illustrate the interface and are not evidence of physical-device compatibility.

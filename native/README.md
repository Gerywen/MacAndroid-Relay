# Independent libmtp transport

**English** | [简体中文](README.zh-CN.md)

[Back to the project README](../README.md)

The app calls libmtp 1.1.23 directly through Koffi. TypeScript handles paths, recursive folders, overwrite protection, and progress aggregation. USB communication uses libusb 1.0.30.

## Pinned sources

- `vendor/libmtp-1.1.23.tar.gz`: the official libmtp SourceForge release.
- `vendor/libusb-1.0.30.tar.bz2`: the official libusb GitHub release.
- `include/libmtp.h`: the public header for the pinned libmtp version, used by native ABI regression tests.

Download URLs and SHA-256 values are recorded in `resources/native/manifest.json` at the project root and in the build script.

## Building

Requirements: macOS, Xcode Command Line Tools, Node.js, and `pkg-config`, which lets libmtp find the newly built libusb. The source archives and dependencies needed by the build are included in the repository.

Run from the project root:

```sh
# Current architecture; output in native-build/<arch>/bundle
npm run build:core

# Apple Silicon and Intel libraries
npm run build:core -- --all

# Install both architectures into resources/native and update checksums
npm run build:core -- --all --install
```

The script verifies the source archives and builds in separate directories. It applies the following compatibility adjustments:

- Remove the release archive's generated Linux endian header so configure can supply the correct target-platform header.
- Set `ac_cv_func_pipe2=no`: newer SDKs may link the weak `pipe2` symbol even when the deployment OS does not provide it. The build uses the compatible `pipe` implementation.
- Apply `patches/libmtp-macos-android-close.patch`. On macOS, when libmtp identifies an Android protocol extension, the patch clears the forced USB-reset-on-close flag. Normal MTP CloseSession and USB interface release still run; MTP packet encoding and decoding are unchanged.
- Apply `patches/libusb-macos-cooperative-open.patch`. On macOS, `USBDeviceOpenSeize` resets the device and terminates other USB clients, so a concurrently running `adb` cannot stay attached. The patch uses `USBDeviceOpen` instead, keeping the device-level access libusb needs without evicting other clients.
- Disable MTPZ, a proprietary extension outside Android file transfer, to avoid its additional cryptographic dependency.

Both native architectures target macOS 12. This is the native library deployment target, not a statement about the minimum OS supported by the Electron application. libmtp loads `@loader_path/libusb-1.0.0.dylib` and uses the system libiconv. Both libraries receive ad-hoc signatures.

The Intel binaries have not been tested with a physical device on an Intel Mac.

## Verification

`npm test` compiles a C fixture against the public header and checks structure sizes and field offsets. It also verifies linked-list ownership, operation locking, Unicode names, empty files, recursive folders, rejection of unsafe device filenames, and failed downloads preserving existing files while cleaning temporary files.

After `npm run build`, run `npm run verify:hardware` with an unlocked Android device in MTP mode. The independent backend has passed four SHA-256 comparisons, directory operations, overwrite protection, immediate disconnect/reconnect, and test-directory cleanup on an Apple Silicon Mac with a Redmi K50 Pro. The signed application's diagnostics confirmed that it loaded `libmtp.9.dylib`.

## Licenses and rebuilding sources

libmtp and libusb use LGPL licenses, included in `resources/licenses/`. The application loads separate dynamic libraries. Packaged applications include the licenses, source archives, compatibility patch, this guide, and the build script under `Contents/Resources/licenses/`.

To rebuild using the supplied sources, place the archives under `native/vendor/` and the patch under `native/patches/` in the project, then run the commands above.

The library SHA-256 values in `resources/native/manifest.json` describe the project resource binaries before Electron application signing. Packaging re-signs Mach-O files, changing their signature regions and therefore their full-file hashes. Source archive and patch checksums are unaffected by signing.

# Third-party notices

**English** | [简体中文](THIRD_PARTY_NOTICES.zh-CN.md)

[Back to the README](README.md)

The application's MIT license does not replace the licenses of its dependencies. Upstream copyright and license notices must remain with their respective components.

| Component                                         | Use               | License / notice                                |
| ------------------------------------------------- | ----------------- | ----------------------------------------------- |
| [libmtp 1.1.23](https://github.com/libmtp/libmtp) | MTP communication | [LGPL text](resources/licenses/libmtp-LGPL.txt) |
| [libusb 1.0.30](https://github.com/libusb/libusb) | USB access        | [LGPL text](resources/licenses/libusb-LGPL.txt) |

libmtp and libusb are dynamically loaded. Their pinned source archives are in `native/vendor/`; the macOS Android-session compatibility patch is in `native/patches/`. Build instructions are in the [native guide](native/README.md). Packaged applications include these sources, the patch, licenses, and build instructions under `Contents/Resources/licenses/`.

The original MIT copyright notice is preserved in the [attribution file](resources/licenses/attribution-MIT.txt).

JavaScript dependencies, including Electron, React, Koffi, node-usb, and Lucide, retain the license files supplied by their packages. Consult the pinned dependency versions in `package-lock.json` and each package's license when redistributing them.

# Mac App Store preparation

**English** | [简体中文](MAC_APP_STORE.zh-CN.md)

[Back to the README](../README.md)

## Status

MAS build configuration and application-level folder authorization are implemented. **A signed MAS build has not been run or verified.** The development machine currently has no valid Apple signing identity. Ordinary Electron builds and authorization-policy tests are not evidence of Apple App Sandbox compatibility or App Review approval.

The first validation target is an Apple Development-signed MAS build on a registered Mac: select one Mac folder, connect an Android device, upload and download files, verify SHA-256, and disconnect/reconnect.

## Signing prerequisites

1. Join the Apple Developer Program.
2. Register the explicit App ID `io.macandroid.relay` and your test Mac in the developer portal.
3. Create an Apple Development certificate with its private key installed in the local keychain.
4. Download a Mac development provisioning profile for that App ID and registered Mac. Configure the application group required by Electron, `TEAM_ID.io.macandroid.relay`, consistently with your team and provisioning settings.

Do not commit certificates, private keys, or provisioning profiles. The build script checks the identity, profile Team ID, App ID, registered-device presence, and expiration before packaging. Apple and electron-builder still validate the full certificate/profile pairing during signing.

```sh
export MAS_TEAM_ID='YOUR_TEAM_ID'
export MAS_SIGN_IDENTITY='Apple Development: Your Name (YOUR_TEAM_ID)'
export MAS_PROVISIONING_PROFILE='/absolute/path/to/development.provisionprofile'
npm run package:mas:dev
```

Replace all example values with your real signing information. Output is isolated under `release/mas-development/`; the regular preview build is not overwritten. The generated configuration and resolved entitlements are under the ignored `native-build/mas/` directory. The script selects Electron's `mas-dev` target and requires signing, rather than falling back to an ad-hoc identity.

For submission, use an Apple Distribution identity and a matching Mac App Store distribution profile:

```sh
export MAS_SIGN_IDENTITY='Apple Distribution: Your Name (YOUR_TEAM_ID)'
export MAS_PROVISIONING_PROFILE='/absolute/path/to/distribution.provisionprofile'
npm run package:mas
```

Distribution output goes to `release/mas-distribution/`. The installer signing certificate required by electron-builder must also be installed. A store distribution build is not a local testing build; test with the development profile first. No upload or review submission is performed by these commands.

## Sandbox design

The parent entitlements request App Sandbox, USB access, user-selected read/write access, app-scoped bookmarks, and Electron's application group. Helpers inherit the sandbox. Camera, microphone, network, broad filesystem exceptions, and unsigned-library entitlements are not requested by this initial configuration.

The MAS UI starts with a folder authorization screen. Its native folder picker creates a security-scoped bookmark. Bookmarks remain in the app's local data directory and are never exposed through the renderer API. Restored authorizations are activated before browsing. Expired or moved authorizations require the user to choose the folder again.

Path entry, local mutations, file opening, upload sources, and download destinations are checked against authorized roots. The check resolves existing ancestors and symbolic links, including paths that do not exist yet. Authorized root folders cannot be renamed or deleted through the app. All active scopes are released on quit after transfers finish.

For this first MAS validation, the libmtp backend runs in the sandboxed **main process** so it uses the same active file authorizations. The normal version retains its separate utility process. This avoids relying on unverified propagation of dynamically granted filesystem access to an existing worker. The tradeoff is that native faults can terminate the MAS app; native isolation remains a follow-up design task after the sandbox transport is validated. The normal utility process's unsigned-library option is not used on the MAS path.

## Checks available without certificates

```sh
npm test
npm run build
npm run verify:mas:policy
npm run verify
```

`verify:mas:policy` runs an unpackaged, ordinary Electron application with a test-only folder-picker response. It verifies the real renderer/preload/IPC authorization flow and denial of unapproved paths. Its report explicitly records `actualAppSandbox: false`. The fixture does not authorize files in a real MAS build and is disabled in packaged applications.

Unit tests verify persistence, scope release, path traversal, prefix collisions, symlink escapes, and signing-configuration rejection of missing materials.

## Signed development acceptance checks

- Confirm `process.mas` through diagnostics and verify the app/helper entitlements with `codesign`.
- Choose a folder; read, create, rename, and delete files inside it.
- Enter an unrelated path and follow a symbolic link outside the root: access must be denied.
- Restart the app and verify bookmark restoration; move/delete the authorized folder and verify reauthorization is offered.
- Connect Android, inspect storage and directories, upload/download Unicode, empty, binary, and nested files, compare SHA-256, and reconnect.
- Check phone locking, cable removal, storage exhaustion, and a failed download preserving the original local file.
- Inspect native-module loading and sandbox-denial logs. Test other devices and Intel before claiming their compatibility.

## Submission materials still needed

A public privacy-policy URL, support URL, App Store Connect app record, accurate screenshots and metadata, and review notes explaining the Android hardware requirement are still needed. Provide a video showing the real Mac and phone interacting, rather than using simulated README screenshots as compatibility evidence. Privacy declarations must match the final shipped implementation.

Useful official references:

- [Electron MAS guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [Apple App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)
- [USB entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.usb)
- [Review information for hardware-dependent apps](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review)

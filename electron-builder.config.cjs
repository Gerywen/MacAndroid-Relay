module.exports = {
  appId: 'io.macandroid.relay',
  productName: 'MacAndroid Relay',
  directories: { output: 'release' },
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],
  extraResources: [
    { from: 'resources/native', to: 'native' },
    { from: 'resources/licenses', to: 'licenses' },
    { from: 'native/vendor', to: 'licenses/sources' },
    { from: 'native/patches', to: 'licenses/patches' },
    { from: 'native/README.md', to: 'licenses/BUILDING.md' },
    { from: 'scripts/build-native.mjs', to: 'licenses/build-native.mjs' },
  ],
  asarUnpack: ['node_modules/koffi/**/*', 'node_modules/usb/**/*'],
  mac: {
    icon: 'resources/icon.icns',
    category: 'public.app-category.utilities',
    target: ['dmg'],
    identity: '-',
    extendInfo: {
      CFBundleLocalizations: ['en', 'zh-Hans'],
      NSDesktopFolderUsageDescription: 'Access files selected for Android transfer.',
      NSDocumentsFolderUsageDescription: 'Access files selected for Android transfer.',
      NSDownloadsFolderUsageDescription: 'Save files downloaded from Android.',
      NSRemovableVolumesUsageDescription: 'Browse external volumes selected for transfer.',
    },
  },
};

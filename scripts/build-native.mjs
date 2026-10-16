import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin')
  throw new Error('macOS and Xcode Command Line Tools are required');
const packages = [
  {
    name: 'libusb',
    version: '1.0.30',
    archive: 'libusb-1.0.30.tar.bz2',
    sha256: 'fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf',
    source: 'https://github.com/libusb/libusb/releases/download/v1.0.30/libusb-1.0.30.tar.bz2',
  },
  {
    name: 'libmtp',
    version: '1.1.23',
    archive: 'libmtp-1.1.23.tar.gz',
    sha256: '74a2b6e8cb4a0304e95b995496ea3ac644c29371649b892b856e22f12a0bdeed',
    source: 'https://downloads.sourceforge.net/project/libmtp/libmtp/1.1.23/libmtp-1.1.23.tar.gz',
  },
];
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function run(command, args, env = process.env, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const sources = path.join(root, 'native-build/sources');
mkdirSync(sources, { recursive: true });
for (const pkg of packages) {
  const archive = path.join(root, 'native/vendor', pkg.archive);
  if (hash(archive) !== pkg.sha256) throw new Error('Source checksum mismatch: ' + pkg.archive);
  run('tar', ['-xf', archive, '-C', sources]);
}
// The release archive contains a generated Linux endian header.
// Out-of-tree builds must use configure's target-specific header instead.
rmSync(path.join(sources, 'libmtp-1.1.23/src/gphoto2-endian.h'), { force: true });
run(
  'patch',
  ['-p1', '-i', path.join(root, 'native/patches/libmtp-macos-android-close.patch')],
  process.env,
  path.join(sources, 'libmtp-1.1.23'),
);
run(
  'patch',
  ['-p1', '-i', path.join(root, 'native/patches/libusb-macos-cooperative-open.patch')],
  process.env,
  path.join(sources, 'libusb-1.0.30'),
);
const targets = process.argv.includes('--all')
  ? ['arm64', 'amd64']
  : [process.arch === 'arm64' ? 'arm64' : 'amd64'];
const manifest = {
  origin: 'Upstream libmtp and libusb with macOS Android compatibility patches',
  packages,
  patches: [
    {
      file: 'patches/libmtp-macos-android-close.patch',
      sha256: hash(path.join(root, 'native/patches/libmtp-macos-android-close.patch')),
    },
    {
      file: 'patches/libusb-macos-cooperative-open.patch',
      sha256: hash(path.join(root, 'native/patches/libusb-macos-cooperative-open.patch')),
    },
  ],
  sha256: {},
};
for (const arch of targets) {
  const output = path.join(root, 'native-build', arch),
    prefix = path.join(output, 'prefix');
  const flags = `-arch ${arch === 'amd64' ? 'x86_64' : 'arm64'} -mmacosx-version-min=12.0`;
  const env = {
    ...process.env,
    CC: 'clang',
    // New SDKs expose pipe2 even when the deployment OS lacks its symbol.
    ac_cv_func_pipe2: 'no',
    CFLAGS: flags,
    LDFLAGS: flags,
    PKG_CONFIG_PATH: path.join(prefix, 'lib/pkgconfig'),
  };
  for (const pkg of packages) {
    const work = path.join(output, pkg.name);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const args = [
      `--prefix=${prefix}`,
      '--disable-static',
      '--enable-shared',
      `--host=${arch === 'amd64' ? 'x86_64' : 'aarch64'}-apple-darwin`,
    ];
    if (pkg.name === 'libmtp') args.push('--disable-mtpz', '--disable-doxygen');
    run(path.join(sources, `${pkg.name}-${pkg.version}`, 'configure'), args, env, work);
    run('make', ['-j4'], env, work);
    run('make', ['install'], env, work);
  }
  const install = path.join(root, 'resources/native', arch);
  const destination = process.argv.includes('--install') ? install : path.join(output, 'bundle');
  mkdirSync(destination, { recursive: true });
  for (const file of ['libmtp.9.dylib', 'libusb-1.0.0.dylib']) {
    copyFileSync(path.join(prefix, 'lib', file), path.join(destination, file));
    run('install_name_tool', ['-id', `@loader_path/${file}`, path.join(destination, file)]);
  }
  run('install_name_tool', [
    '-change',
    path.join(prefix, 'lib/libusb-1.0.0.dylib'),
    '@loader_path/libusb-1.0.0.dylib',
    path.join(destination, 'libmtp.9.dylib'),
  ]);
  for (const file of ['libmtp.9.dylib', 'libusb-1.0.0.dylib']) {
    run('codesign', ['--force', '--sign', '-', path.join(destination, file)]);
    manifest.sha256[`${arch}/${file}`] = hash(path.join(destination, file));
  }
}
if (process.argv.includes('--install')) {
  for (const arch of ['arm64', 'amd64'])
    for (const file of ['libmtp.9.dylib', 'libusb-1.0.0.dylib']) {
      const library = path.join(root, 'resources/native', arch, file);
      if (existsSync(library)) manifest.sha256[`${arch}/${file}`] = hash(library);
    }
  writeFileSync(
    path.join(root, 'resources/native/manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

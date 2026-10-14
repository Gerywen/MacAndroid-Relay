import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signingOptions, configuration, entitlementForTeam } from './mas-config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const development = !process.argv.includes('--distribution');
const options = signingOptions(process.env, development);
const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
  encoding: 'utf8',
});
if (identities.status !== 0 || !identities.stdout.includes(options.identity))
  throw new Error('The requested signing identity is not installed or valid in this Mac keychain');
const decoded = spawnSync('security', ['cms', '-D', '-i', options.profile], { encoding: 'utf8' });
if (decoded.status !== 0) throw new Error('Cannot decode the provisioning profile');
const folder = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-profile-'));
try {
  const xml = path.join(folder, 'profile.plist');
  await writeFile(xml, decoded.stdout, { mode: 0o600 });
  const get = (key) =>
    spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, xml], {
      encoding: 'utf8',
    }).stdout.trim();
  if (get('TeamIdentifier:0') !== options.teamId)
    throw new Error('Provisioning profile belongs to another Team ID');
  if (
    (get('Entitlements:com.apple.application-identifier') ||
      get('Entitlements:application-identifier')) !== `${options.teamId}.io.macandroid.relay`
  )
    throw new Error('Provisioning profile must match io.macandroid.relay');
  if (get('ProvisionsAllDevices') === 'true')
    throw new Error('Use a Mac App Store profile, not a Developer ID profile');
  if (!options.development && get('ProvisionedDevices'))
    throw new Error('Use a distribution profile for the store build');
  if (options.development && !get('ProvisionedDevices'))
    throw new Error('Development profile must include registered Mac devices');
  const expires = new Date(get('ExpirationDate'));
  if (!Number.isFinite(expires.getTime()) || expires <= new Date())
    throw new Error('Provisioning profile has expired');
} finally {
  await rm(folder, { recursive: true, force: true });
}
const generated = path.join(root, 'native-build/mas');
await mkdir(generated, { recursive: true });
await writeFile(path.join(generated, 'entitlements.mas.plist'), entitlementForTeam(options.teamId));
const config = path.join(generated, 'electron-builder.config.cjs');
await writeFile(
  config,
  'module.exports = ' + JSON.stringify(configuration(options, generated), null, 2) + ';\n',
);
for (const [command, args] of [
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']],
  [
    process.execPath,
    [
      'node_modules/electron-builder/out/cli/cli.js',
      '--config',
      config,
      '--mac',
      development ? 'mas-dev' : 'mas',
      '--publish',
      'never',
    ],
  ],
]) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

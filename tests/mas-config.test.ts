import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// @ts-expect-error Build tooling is intentionally a standalone Node module.
import { signingOptions, configuration, entitlementForTeam } from '../scripts/mas-config.mjs';
test('MAS build fails closed without signing materials and keeps release output separate', () => {
  assert.throws(() => signingOptions({}), /MAS_TEAM_ID/);
  assert.throws(
    () =>
      signingOptions({
        MAS_TEAM_ID: 'ABCDEFGHIJ',
        MAS_SIGN_IDENTITY: '-',
        MAS_PROVISIONING_PROFILE: 'package.json',
      }),
    /Apple Development/,
  );
  const options = signingOptions({
    MAS_TEAM_ID: 'ABCDEFGHIJ',
    MAS_SIGN_IDENTITY: 'Apple Development: Example (ABCDEFGHIJ)',
    MAS_PROVISIONING_PROFILE: 'package.json',
  });
  const config = configuration(options, '/tmp/generated');
  assert.equal(config.forceCodeSigning, true);
  assert.deepEqual(config.mac.target, ['mas-dev']);
  assert.equal(config.directories.output, 'release/mas-development');
  assert.equal(config.mac.identity, 'Example (ABCDEFGHIJ)');
  assert.equal(config.mas.identity, 'Example (ABCDEFGHIJ)');
  assert.equal(config.mac.extendInfo.ElectronTeamID, 'ABCDEFGHIJ');
  const xml = entitlementForTeam('ABCDEFGHIJ');
  assert(!xml.includes('__TEAM_ID__'));
  assert(xml.includes('ABCDEFGHIJ.io.macandroid.relay'));
  for (const key of [
    'app-sandbox',
    'device.usb',
    'files.user-selected.read-write',
    'files.bookmarks.app-scope',
  ])
    assert(xml.includes('com.apple.security.' + key));
  for (const key of [
    'network.client',
    'network.server',
    'device.camera',
    'device.microphone',
    'disable-library-validation',
    'allow-unsigned-executable-memory',
  ])
    assert(!xml.includes(key));
  const child = readFileSync('build/entitlements.mas.inherit.plist', 'utf8');
  assert(child.includes('com.apple.security.inherit'));
});

test('Generated MAS configuration passes the installed electron-builder schema', async () => {
  const { validateConfiguration } = createRequire(import.meta.url)(
    'app-builder-lib/out/util/config/config',
  );
  const config = configuration(
    {
      teamId: 'ABCDEFGHIJ',
      identity: 'Apple Development: Example (ABCDEFGHIJ)',
      profile: '/tmp/example.provisionprofile',
      development: true,
    },
    '/tmp/generated',
  );
  await validateConfiguration(config);
});

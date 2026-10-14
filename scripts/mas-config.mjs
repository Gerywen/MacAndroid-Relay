import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const base = require('../electron-builder.config.cjs');
export function signingOptions(env, development = true) {
  const teamId = env.MAS_TEAM_ID;
  if (!/^[A-Z0-9]{10}$/.test(teamId || ''))
    throw new Error('Set MAS_TEAM_ID to your 10-character Apple Developer Team ID');
  const identity = env.MAS_SIGN_IDENTITY;
  const expected = development ? 'Apple Development' : 'Apple Distribution';
  if (!identity?.startsWith(expected + ':'))
    throw new Error(`Set MAS_SIGN_IDENTITY to the installed ${expected} certificate name`);
  const profile = env.MAS_PROVISIONING_PROFILE;
  if (!profile || !existsSync(profile))
    throw new Error('Set MAS_PROVISIONING_PROFILE to the downloaded provisioning profile path');
  if (!identity.endsWith(`(${teamId})`))
    throw new Error('Signing identity must belong to MAS_TEAM_ID');
  return { teamId, identity, profile: path.resolve(profile), development };
}
export function configuration(options, generatedDirectory) {
  const target = options.development ? 'mas-dev' : 'mas';
  const entitlement = path.join(generatedDirectory, 'entitlements.mas.plist');
  const qualifier = options.identity.replace(/^[^:]+:\s*/, '');
  const common = {
    identity: qualifier,
    provisioningProfile: options.profile,
    hardenedRuntime: false,
    entitlements: entitlement,
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
  };
  return {
    ...base,
    forceCodeSigning: true,
    directories: {
      ...base.directories,
      output: options.development ? 'release/mas-development' : 'release/mas-distribution',
    },
    mac: {
      ...base.mac,
      identity: qualifier,
      target: [target],
      hardenedRuntime: false,
      extendInfo: { ...base.mac.extendInfo, ElectronTeamID: options.teamId },
    },
    mas: { ...common, type: options.development ? 'development' : 'distribution' },
    masDev: { ...common, type: 'development' },
  };
}
export function entitlementForTeam(teamId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Invalid Team ID');
  return readFileSync(
    new URL('../build/entitlements.mas.plist', import.meta.url),
    'utf8',
  ).replaceAll('__TEAM_ID__', teamId);
}

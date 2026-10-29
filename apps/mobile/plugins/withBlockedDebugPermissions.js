const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const TOOLS_NS = 'xmlns:tools="http://schemas.android.com/tools"';

/**
 * Expo writes `tools:node="remove"` into `src/main` for `blockedPermissions`.
 * React Native's debug template then adds `SYSTEM_ALERT_WINDOW` in
 * `src/debug` and `src/debugOptimized`. That source set is higher priority
 * than main, so a debug APK keeps the overlay permission. Put the same
 * remove marker in those manifests.
 */
function permissionName(permission) {
  if (permission.includes('.')) {
    return permission;
  }
  return `android.permission.${permission}`;
}

function ensureToolsNamespace(xml) {
  if (xml.includes('xmlns:tools=')) {
    return xml;
  }
  return xml.replace('<manifest', `<manifest ${TOOLS_NS}`);
}

function usesPermissionTag(name) {
  return new RegExp(`<uses-permission\\b[^>]*android:name="${name}"[^>]*\\/?>`, 'g');
}

function applyBlockedPermissions(xml, permissions) {
  let next = ensureToolsNamespace(xml);
  const names = [...new Set((permissions ?? []).filter(Boolean).map(permissionName))];
  const missing = [];
  for (const name of names) {
    if (!usesPermissionTag(name).test(next)) {
      missing.push(name);
      continue;
    }
    next = next.replace(usesPermissionTag(name), (match) => {
      if (match.includes('tools:node="remove"')) {
        return match;
      }
      if (match.endsWith('/>')) {
        return match.replace(/\s*\/>$/, ' tools:node="remove"/>');
      }
      return match.replace(/>$/, ' tools:node="remove">');
    });
  }
  if (missing.length > 0) {
    const block = missing
      .map((name) => `    <uses-permission android:name="${name}" tools:node="remove"/>`)
      .join('\n');
    if (next.includes('<application')) {
      next = next.replace(/\n([ \t]*)<application\b/, `\n${block}\n$1<application`);
    } else {
      next = next.replace('</manifest>', `${block}\n</manifest>`);
    }
  }
  return next;
}

function withBlockedDebugPermissions(config) {
  const blocked = config.android?.blockedPermissions ?? [];
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const root = mod.modRequest.platformProjectRoot;
      for (const variant of ['debug', 'debugOptimized']) {
        const file = path.join(root, 'app/src', variant, 'AndroidManifest.xml');
        if (!fs.existsSync(file)) {
          continue;
        }
        const xml = fs.readFileSync(file, 'utf8');
        const next = applyBlockedPermissions(xml, blocked);
        if (next !== xml) {
          fs.writeFileSync(file, next);
        }
      }
      return mod;
    },
  ]);
}

module.exports = withBlockedDebugPermissions;
module.exports.applyBlockedPermissions = applyBlockedPermissions;

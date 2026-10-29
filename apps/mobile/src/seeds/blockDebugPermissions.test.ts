import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyBlockedPermissions } = require('../../plugins/withBlockedDebugPermissions.js') as {
  applyBlockedPermissions: (xml: string, permissions: string[]) => string;
};

const DEBUG_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />
</manifest>
`;

describe('debug blocked permissions', () => {
  it('blocks the overlay permission in app config and does not grant it', () => {
    const app = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../app.json'), 'utf8')) as {
      expo: {
        plugins: string[];
        android: { permissions: string[]; blockedPermissions: string[] };
      };
    };
    expect(app.expo.plugins).toContain('./plugins/withBlockedDebugPermissions');
    expect(app.expo.android.blockedPermissions).toContain('android.permission.SYSTEM_ALERT_WINDOW');
    expect(app.expo.android.permissions).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });

  it('marks the debug overlay permission for removal', () => {
    const next = applyBlockedPermissions(DEBUG_TEMPLATE, ['android.permission.SYSTEM_ALERT_WINDOW']);
    expect(next).toContain(
      '<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>',
    );
    expect(next).not.toContain('<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>');
    expect(next).toContain('android:usesCleartextTraffic="true"');
  });

  it('inserts a remove marker when the debug manifest does not mention the permission', () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application />\n</manifest>\n`;
    const next = applyBlockedPermissions(xml, ['android.permission.SYSTEM_ALERT_WINDOW']);
    expect(next).toContain('xmlns:tools="http://schemas.android.com/tools"');
    expect(next).toContain('tools:node="remove"');
  });

  it('leaves an existing remove marker in place', () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
    <application />
</manifest>`;
    expect(applyBlockedPermissions(xml, ['android.permission.SYSTEM_ALERT_WINDOW'])).toBe(xml);
  });
});

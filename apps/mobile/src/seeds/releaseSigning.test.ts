import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyReleaseUploadSigning } = require('../../plugins/withReleaseUploadSigning.js') as {
  applyReleaseUploadSigning: (source: string) => string;
};

const BEFORE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
`;

const UNSAFE = BEFORE.replace(
  `            keyPassword 'android'\n        }\n    }`,
  `            keyPassword 'android'\n        }\n        release {\n            storeFile file(System.getenv("CWS_UPLOAD_STORE_FILE"))\n            storePassword System.getenv("CWS_UPLOAD_STORE_PASSWORD")\n            keyAlias System.getenv("CWS_UPLOAD_KEY_ALIAS")\n            keyPassword System.getenv("CWS_UPLOAD_KEY_PASSWORD")\n        }\n    }`,
).replace('signingConfig signingConfigs.debug\n            minifyEnabled', 'signingConfig signingConfigs.release\n            minifyEnabled');

describe('release upload signing', () => {
  it('points release at the upload keystore env and leaves the debug key in place', () => {
    const next = applyReleaseUploadSigning(BEFORE);
    expect(next).toContain('def uploadStore = System.getenv("CWS_UPLOAD_STORE_FILE")');
    expect(next).toContain('if (uploadStore)');
    expect(next).toContain('storeFile file(uploadStore)');
    expect(next).not.toContain('file(System.getenv("CWS_UPLOAD_STORE_FILE"))');
    expect(next).toContain('signingConfig signingConfigs.release');
    expect(next).toContain("storePassword 'android'");
    expect(next).not.toMatch(/release \{\n            signingConfig signingConfigs\.debug/);
  });

  it('rewrites a configure-time file(null) block without adding a second one', () => {
    const next = applyReleaseUploadSigning(UNSAFE);
    expect(next).toContain('def uploadStore = System.getenv("CWS_UPLOAD_STORE_FILE")');
    expect(next).not.toContain('file(System.getenv("CWS_UPLOAD_STORE_FILE"))');
    expect(next.match(/signingConfigs\.release/g)).toHaveLength(1);
    expect(applyReleaseUploadSigning(next)).toBe(next);
  });

  it('does not insert a second block when the safe env reference is already present', () => {
    const once = applyReleaseUploadSigning(BEFORE);
    expect(applyReleaseUploadSigning(once)).toBe(once);
  });

  it('leaves an unrecognized gradle file unchanged', () => {
    const other = 'apply plugin: "com.android.application"\n';
    expect(applyReleaseUploadSigning(other)).toBe(other);
  });
});

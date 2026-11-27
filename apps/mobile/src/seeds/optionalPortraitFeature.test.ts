import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyOptionalPortraitFeature, PORTRAIT_FEATURE } = require(
  '../../plugins/withOptionalPortraitFeature.js',
) as {
  applyOptionalPortraitFeature: (manifest: Record<string, unknown>) => Record<string, unknown>;
  PORTRAIT_FEATURE: string;
};

describe('optional portrait uses-feature', () => {
  it('keeps the app portrait-locked and registers the config plugin', () => {
    const app = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../app.json'), 'utf8')) as {
      expo: { orientation: string; plugins: Array<string | [string, unknown]> };
    };
    expect(app.expo.orientation).toBe('portrait');
    expect(app.expo.plugins).toContain('./plugins/withOptionalPortraitFeature');
  });

  it('declares android.hardware.screen.portrait as required=false', () => {
    const manifest = applyOptionalPortraitFeature({});
    expect(manifest['uses-feature']).toEqual([
      {
        $: {
          'android:name': PORTRAIT_FEATURE,
          'android:required': 'false',
        },
      },
    ]);
  });

  it('forces an existing portrait feature to required=false', () => {
    const manifest = applyOptionalPortraitFeature({
      'uses-feature': [
        {
          $: {
            'android:name': PORTRAIT_FEATURE,
            'android:required': 'true',
          },
        },
      ],
    });
    expect(manifest['uses-feature']).toEqual([
      {
        $: {
          'android:name': PORTRAIT_FEATURE,
          'android:required': 'false',
        },
      },
    ]);
  });
});

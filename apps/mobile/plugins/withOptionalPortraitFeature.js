const { withAndroidManifest } = require('@expo/config-plugins');

const PORTRAIT_FEATURE = 'android.hardware.screen.portrait';

/**
 * Play treats a portrait-locked activity as android.hardware.screen.portrait.
 * Declare it with required=false so the feature is not a hardware filter.
 * The app stays portrait-locked via app.json orientation.
 */
function featureList(manifest) {
  const raw = manifest['uses-feature'];
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

function applyOptionalPortraitFeature(manifest) {
  const list = featureList(manifest);
  const existing = list.find((entry) => entry.$?.['android:name'] === PORTRAIT_FEATURE);
  if (existing) {
    existing.$ = { ...existing.$, 'android:required': 'false' };
  } else {
    list.push({
      $: {
        'android:name': PORTRAIT_FEATURE,
        'android:required': 'false',
      },
    });
  }
  manifest['uses-feature'] = list;
  return manifest;
}

function withOptionalPortraitFeature(config) {
  return withAndroidManifest(config, (mod) => {
    applyOptionalPortraitFeature(mod.modResults.manifest);
    return mod;
  });
}

module.exports = withOptionalPortraitFeature;
module.exports.applyOptionalPortraitFeature = applyOptionalPortraitFeature;
module.exports.PORTRAIT_FEATURE = PORTRAIT_FEATURE;

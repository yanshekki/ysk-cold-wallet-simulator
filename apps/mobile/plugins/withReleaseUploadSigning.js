const { withAppBuildGradle } = require('@expo/config-plugins');

const SAFE_MARKER = 'def uploadStore = System.getenv("CWS_UPLOAD_STORE_FILE")';

const RELEASE_CONFIG = `        release {
            def uploadStore = System.getenv("CWS_UPLOAD_STORE_FILE")
            if (uploadStore) {
                storeFile file(uploadStore)
                storePassword System.getenv("CWS_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("CWS_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("CWS_UPLOAD_KEY_PASSWORD")
            }
        }`;

const UNSAFE_BLOCK = `        release {
            storeFile file(System.getenv("CWS_UPLOAD_STORE_FILE"))
            storePassword System.getenv("CWS_UPLOAD_STORE_PASSWORD")
            keyAlias System.getenv("CWS_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("CWS_UPLOAD_KEY_PASSWORD")
        }`;

/**
 * Point release builds at an upload keystore supplied by the environment.
 * No password or path is stored here. `file()` runs only when
 * CWS_UPLOAD_STORE_FILE is set, so a debug build still configures.
 * Release packaging fails closed instead of using the debug key.
 */
function applyReleaseUploadSigning(source) {
  if (source.includes(SAFE_MARKER)) {
    return source;
  }
  if (source.includes(UNSAFE_BLOCK)) {
    return source.replace(UNSAFE_BLOCK, RELEASE_CONFIG);
  }
  const debugClose = "            keyPassword 'android'\n        }";
  const releaseDebug = 'release {\n            signingConfig signingConfigs.debug\n';
  if (!source.includes(debugClose) || !source.includes(releaseDebug)) {
    return source;
  }
  return source
    .replace(debugClose, `${debugClose}\n${RELEASE_CONFIG}`)
    .replace(releaseDebug, 'release {\n            signingConfig signingConfigs.release\n');
}

function withReleaseUploadSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language === 'kt') {
      return mod;
    }
    mod.modResults.contents = applyReleaseUploadSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseUploadSigning;
module.exports.applyReleaseUploadSigning = applyReleaseUploadSigning;

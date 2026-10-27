const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const FGS_SERVICE = 'com.munimbluetooth.MunimBluetoothBackgroundService';

/**
 * CWS only advertises while the activity is on screen.
 * munim-bluetooth still injects a connectedDevice FGS; strip it.
 */
function withForegroundOnlyBle(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) {
      return mod;
    }
    const services = application.service;
    const list = !services ? [] : Array.isArray(services) ? services : [services];
    application.service = [
      ...list.filter((entry) => entry.$?.['android:name'] !== FGS_SERVICE),
      {
        $: {
          'android:name': FGS_SERVICE,
          'tools:node': 'remove',
        },
      },
    ];
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    delete mod.modResults.UIBackgroundModes;
    return mod;
  });
  return config;
}

module.exports = withForegroundOnlyBle;

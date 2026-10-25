const { existsSync } = require('fs');
const { join } = require('path');

const candidates = [
  join(__dirname, `native-proxy.${process.platform}-${process.arch}.node`),
  join(__dirname, `native-proxy.${process.platform}-${process.arch}-gnu.node`),
  join(__dirname, 'native-proxy.darwin-arm64.node'),
  join(__dirname, 'native-proxy.darwin-x64.node'),
  join(__dirname, 'native-proxy.linux-x64-gnu.node'),
  join(__dirname, 'native-proxy.linux-arm64-gnu.node'),
  join(__dirname, 'index.node'),
];

function missing(message) {
  const error = new Error(
    message ??
      'native-proxy is not built. Install Rust, then run: yarn workspace @cws/native-proxy build',
  );
  return {
    nativeOk() {
      return false;
    },
    scanBle() {
      return Promise.reject(error);
    },
    connectBle() {
      return Promise.reject(error);
    },
    VirtualHid: class VirtualHid {
      constructor() {
        throw error;
      }
    },
    BleDevice: class BleDevice {},
  };
}

const path = candidates.find((item) => existsSync(item));
if (!path) {
  module.exports = missing();
} else {
  try {
    module.exports = require(path);
  } catch (error) {
    module.exports = missing(error instanceof Error ? error.message : String(error));
  }
}

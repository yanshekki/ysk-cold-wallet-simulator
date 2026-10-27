const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
const upstreamResolve = config.resolver.resolveRequest;
const slip39Crypto = path.resolve(__dirname, '../../packages/sdk/src/node-crypto-shim.ts');
const nobleCrypto = path.resolve(__dirname, 'src/lab/nobleCrypto.ts');

function isNobleCrypto(moduleName, origin) {
  if (
    moduleName === '@noble/hashes/crypto' ||
    moduleName === '@noble/hashes/crypto.js' ||
    moduleName === '@noble/hashes/cryptoNode' ||
    moduleName === '@noble/hashes/cryptoNode.js' ||
    moduleName === '@noble/hashes/esm/crypto.js' ||
    moduleName === '@noble/hashes/esm/cryptoNode.js'
  ) {
    return true;
  }
  if (
    (moduleName === './crypto.js' ||
      moduleName === './crypto' ||
      moduleName === './cryptoNode.js' ||
      moduleName === './cryptoNode') &&
    origin.includes('/@noble/hashes')
  ) {
    return true;
  }
  return false;
}

config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require', 'import'];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: path.resolve(workspaceRoot, 'node_modules/buffer'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = typeof context.originModulePath === 'string' ? context.originModulePath.replace(/\\/g, '/') : '';
  if (moduleName === 'crypto' && origin.includes('/slip39/')) {
    return { type: 'sourceFile', filePath: slip39Crypto };
  }
  if (isNobleCrypto(moduleName, origin)) {
    return { type: 'sourceFile', filePath: nobleCrypto };
  }
  if (upstreamResolve) {
    return upstreamResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

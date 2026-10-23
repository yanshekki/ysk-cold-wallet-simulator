const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const upstreamResolve = config.resolver.resolveRequest;
const slip39Crypto = path.resolve(__dirname, '../../packages/sdk/src/node-crypto-shim.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = typeof context.originModulePath === 'string' ? context.originModulePath.replace(/\\/g, '/') : '';
  if (moduleName === 'crypto' && origin.includes('/slip39/')) {
    return { type: 'sourceFile', filePath: slip39Crypto };
  }
  if (upstreamResolve) {
    return upstreamResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

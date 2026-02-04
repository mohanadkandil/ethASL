const { getDefaultConfig } = require('@expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('onnx', 'ort', 'bin');
module.exports = config;

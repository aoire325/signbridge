const { getDefaultConfig } = require('expo/metro-config');
const { prepareModelAssets } = require('./scripts/prepare-model-assets.cjs');

// Refuse to package Git LFS pointer text as a neural network model.
prepareModelAssets(__dirname);

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite');

module.exports = config; 


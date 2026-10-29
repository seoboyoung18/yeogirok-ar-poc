const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const localPrefill = path.join(__dirname, 'validation-records', 'prefill.js');
const config = {
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (
        context.dev &&
        moduleName === './validationRecordPrefill' &&
        context.originModulePath ===
          path.join(__dirname, 'GeoValidationPanel.tsx') &&
        fs.existsSync(localPrefill)
      ) {
        return { type: 'sourceFile', filePath: localPrefill };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

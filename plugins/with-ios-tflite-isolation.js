const { withPodfile } = require('expo/config-plugins');

const MARKER = '# SignBridge: isolate the standalone TFLite runtime from MediaPipe';

function addTfliteIsolationHook(contents) {
  if (contents.includes(MARKER)) return contents;
  const hook = /post_install do \|installer\|\r?\n/;
  if (!hook.test(contents)) throw new Error('Cannot install the TFLite isolation hook: the Expo Podfile post_install block was not found.');
  return contents.replace(hook, (start) => `${start}    ${MARKER}\n    require File.join(__dir__, '..', 'scripts', 'ios-isolate-tflite')\n    SignBridgeTfliteIsolation.apply(installer)\n\n`);
}

module.exports = function withIosTfliteIsolation(config) {
  return withPodfile(config, (mod) => {
    mod.modResults.contents = addTfliteIsolationHook(mod.modResults.contents);
    return mod;
  });
};
module.exports.addTfliteIsolationHook = addTfliteIsolationHook; 


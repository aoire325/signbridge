import { NativeModules } from 'react-native';

// Delay importing the library: older development builds must still be able to
// open the translator and the call lobby without crashing at module evaluation.
export function getWebRTC(): typeof import('react-native-webrtc') {
  if (!NativeModules.WebRTCModule) throw new Error('Calling needs the updated SignBridge app. Install a new development or release build.');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Native availability must be checked before this library evaluates.
  return require('react-native-webrtc') as typeof import('react-native-webrtc');
}

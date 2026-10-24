import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import type { TrackingFrame } from '@/recognition/landmarks';

type Props = ViewProps & {
  facing: 'front' | 'back';
  onLandmarks: (event: { nativeEvent: TrackingFrame }) => void;
  onReady: () => void;
  onPreviewReady: () => void;
  onError: (event: { nativeEvent: { message: string } }) => void;
};

const NativeCamera = requireOptionalNativeModule('SignBridgeTracker')
  ? requireNativeView<Props>('SignBridgeTracker') : null;

export function LiveLandmarkCamera(props: Props) {
  const { onError } = props;
  useEffect(() => {
    if (!NativeCamera) onError({ nativeEvent: {
      message: 'Live tracking needs a new development build. Rebuild SignBridge for this phone; Expo Go and older builds do not include the tracker.',
    } });
  }, [onError]);
  return NativeCamera ? <NativeCamera {...props} /> : <View style={StyleSheet.absoluteFill} />;
} 


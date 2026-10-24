import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TrackingFrame } from '@/recognition/landmarks';
import { trackingOverlayGeometry } from './tracking-overlay-geometry';

export const LandmarkOverlay = memo(function LandmarkOverlay({ frame, mirrored }: {
  frame: TrackingFrame | null; mirrored: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { lines, dots } = trackingOverlayGeometry(frame, size, mirrored);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}>
      {lines.map(({ key, from, to, color, thickness }) => {
        const dx = to.x - from.x; const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        return <View key={key} style={{ position: 'absolute', height: thickness,
          backgroundColor: color, width: length, left: (from.x + to.x - length) / 2,
          top: (from.y + to.y - thickness) / 2, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
      })}
      {dots.map(({ key, x, y, color, radius }) => <View key={key} style={{ position: 'absolute',
        left: x - radius, top: y - radius, width: radius * 2, height: radius * 2, borderRadius: radius, backgroundColor: color }} />)}
    </View>
  );
}); 


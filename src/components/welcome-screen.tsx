import { useEffect } from 'react';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet, View, useAnimatedValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { colors } from '@/constants/palette';

export function WelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
  const offset = useAnimatedValue(0);

  useEffect(() => {
    let alive = true;
    let preferenceChanged = false;
    const applyPreference = (reduceMotion: boolean) => {
      if (!alive) return;
      offset.stopAnimation();
      offset.setValue(reduceMotion ? 0 : 16);
      if (!reduceMotion) {
        Animated.timing(offset, { toValue: 0, duration: 480, useNativeDriver: true }).start();
      }
    };
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      preferenceChanged = true;
      applyPreference(enabled);
    });
    // Keep the complete heading visible and static until the preference is known.
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!preferenceChanged) applyPreference(enabled);
    }).catch(() => undefined);
    return () => { alive = false; subscription.remove(); offset.stopAnimation(); };
  }, [offset]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.welcome}>
          <Animated.Text accessibilityRole="header" accessibilityLabel="Welcome to SignBridge"
            style={[styles.title, { transform: [{ translateY: offset }] }]}>
            Welcome to{'\n'}SignBridge
          </Animated.Text>
          <View style={styles.button}>
            <ActionButton label="Get Started" icon="→" variant="dark" onPress={onGetStarted} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sky },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  welcome: { width: '100%', maxWidth: 640, alignItems: 'center', gap: 32 },
  title: { color: colors.navy, fontSize: 44, lineHeight: 53, fontWeight: '800', letterSpacing: -1.5, textAlign: 'center' },
  button: { width: '100%', maxWidth: 300, flexDirection: 'row' },
});

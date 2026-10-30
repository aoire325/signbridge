import { useEffect } from 'react';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { colors } from '@/constants/palette';

export function WelcomeScreen({ onGetStarted, onOpenCalls }: { onGetStarted: () => void; onOpenCalls?: () => void }) {
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
          <Text style={styles.eyebrow}>SIGN. SPEAK. CONNECT.</Text>
          <Animated.Text accessibilityRole="header" accessibilityLabel="Welcome to SignBridge"
            style={[styles.title, { transform: [{ translateY: offset }] }]}>
            Welcome to{'\n'}SignBridge
          </Animated.Text>
          <Text style={styles.description}>Your conversations, in your own way. Meet face to face with sign captions, or find the words with your personal translator.</Text>
          {onOpenCalls ? <View style={styles.callCard}>
            <View style={styles.callBadge}><Text style={styles.callBadgeText}>↗</Text></View>
            <Text accessibilityRole="header" style={styles.callTitle}>Closer through conversation</Text>
            <Text style={styles.callDescription}>Private video calls. Optional AI sign captions. Room for everyone to be heard.</Text>
            <ActionButton label="Open video calls" text="Start or join a call" icon="↗" variant="dark" onPress={onOpenCalls} />
          </View> : null}
          <View style={styles.button}>
            <ActionButton label="Get Started" text="Open translator" icon="→" variant="secondary" onPress={onGetStarted} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sky },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  welcome: { width: '100%', maxWidth: 560, alignItems: 'center', gap: 22, paddingVertical: 20 },
  title: { color: colors.navy, fontSize: 44, lineHeight: 53, fontWeight: '800', letterSpacing: -1.5, textAlign: 'center' },
  button: { width: '100%', maxWidth: 300, flexDirection: 'row' },
  eyebrow: { color: colors.tealDeep, fontSize: 10, letterSpacing: 2, fontWeight: '800' },
  description: { color: colors.inkSoft, fontSize: 16, lineHeight: 25, textAlign: 'center', maxWidth: 420 },
  callCard: { alignSelf: 'stretch', borderRadius: 28, backgroundColor: colors.white, padding: 24, gap: 16, borderWidth: 1, borderColor: colors.line },
  callBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.sky, alignItems: 'center', justifyContent: 'center' },
  callBadgeText: { fontSize: 27, color: colors.tealDeep }, callTitle: { color: colors.navy, fontSize: 23, fontWeight: '700', letterSpacing: -0.5 },
  callDescription: { color: colors.inkSoft, fontSize: 14, lineHeight: 22 },
});

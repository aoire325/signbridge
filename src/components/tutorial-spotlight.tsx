import { useEffect, useLayoutEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View, useAnimatedValue, useWindowDimensions } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { colors } from '@/constants/palette';

const instructions = [
  'Position your hands in front of the camera.',
  'Your recognized signs will appear here.',
  'Choose a suggestion if the recognition is incorrect.',
  'Open Dictionary to explore available signs.',
];

type Props = {
  children: ReactNode;
  step: number | null;
  cameraActive?: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onReveal: (target: ComponentRef<typeof View>) => void;
};

function TutorialInstruction({ step, cameraActive, onNext, onBack, onSkip }: Omit<Props, 'children' | 'onReveal'> & { step: number }) {
  const arrow = useAnimatedValue(0);
  const reveal = useAnimatedValue(1);

  useEffect(() => {
    let alive = true;
    let changed = false;
    let animation: Animated.CompositeAnimation | undefined;
    const apply = (reduced: boolean) => {
      if (!alive) return;
      animation?.stop();
      arrow.stopAnimation(); reveal.stopAnimation();
      arrow.setValue(0); reveal.setValue(1);
      if (reduced) return;
      reveal.setValue(0);
      Animated.timing(reveal, { toValue: 1, duration: 220, useNativeDriver: true, isInteraction: false }).start();
      animation = Animated.loop(Animated.sequence([
        Animated.timing(arrow, { toValue: 6, duration: 650, useNativeDriver: true, isInteraction: false }),
        Animated.timing(arrow, { toValue: 0, duration: 650, useNativeDriver: true, isInteraction: false }),
      ]));
      animation.start();
    };
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => { changed = true; apply(enabled); });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (!changed) apply(enabled); }).catch(() => undefined);
    return () => { alive = false; subscription.remove(); animation?.stop(); arrow.stopAnimation(); reveal.stopAnimation(); };
  }, [arrow, reveal]);

  return (
    <View style={styles.coach} accessibilityLiveRegion="polite">
      <Text style={styles.progress}>Quick tour · {step + 1} of 4</Text>
      <Animated.Text accessibilityRole="header" style={[styles.instruction, { opacity: reveal }]}>{instructions[step]}</Animated.Text>
      {step === 0 && !cameraActive ? <Text style={styles.hint}>Tap Start camera below the preview. Allow camera access if asked.</Text> : null}
      <View style={styles.actions}>
        <ActionButton label="Back" icon="←" compact disabled={step === 0} onPress={onBack} />
        <ActionButton label="Skip" icon="⇥" compact onPress={onSkip} />
        <ActionButton label={step === 3 ? 'Finish' : 'Next'} icon={step === 3 ? '✓' : '→'} compact variant="dark" onPress={onNext} />
      </View>
      <Animated.Text aria-hidden style={[styles.arrow, { transform: [{ translateY: arrow }] }]}>↓</Animated.Text>
    </View>
  );
}

export function TutorialSpotlight({ children, step, onReveal, ...controls }: Props) {
  const target = useRef<ComponentRef<typeof View>>(null);
  const { width, height, fontScale } = useWindowDimensions();
  const revealTarget = () => {
    if (step !== null && target.current) onReveal(target.current);
  };
  useLayoutEffect(() => {
    if (step !== null && target.current) onReveal(target.current);
  }, [step, onReveal, width, height, fontScale]);

  return (
    <View ref={target} collapsable={false} onLayout={revealTarget} style={styles.group}>
      {step !== null ? <TutorialInstruction key={step} step={step} {...controls} /> : null}
      <View style={step !== null && styles.spotlight}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  coach: { borderRadius: 18, backgroundColor: colors.sky, borderWidth: 1, borderColor: colors.tealDeep, padding: 16, gap: 10 },
  progress: { color: colors.tealDeep, fontSize: 13, fontWeight: '700' },
  instruction: { color: colors.navy, fontSize: 19, lineHeight: 27, fontWeight: '700' },
  hint: { color: colors.inkSoft, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  arrow: { color: colors.tealDeep, alignSelf: 'center', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  spotlight: { outlineWidth: 3, outlineColor: colors.tealDeep, outlineOffset: 3, borderRadius: 20 },
});

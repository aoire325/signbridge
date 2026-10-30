import { StyleSheet, Text, View } from 'react-native';
import type { Caption } from '@/calls/protocol';
import { getWebRTC } from '@/calls/native-webrtc';
import { colors } from '@/constants/palette';
import { useAccessibilitySettings } from '@/state/accessibility-settings';
import type { CallCaptionFeedback } from './call-caption-composer';

type Props = { name: string; streamURL?: string; mirrored?: boolean; camera: boolean; microphone: boolean;
  caption: Caption | null; local?: boolean; waiting?: boolean; height: number; feedback?: CallCaptionFeedback | null; fill?: boolean; compact?: boolean };

export function CallVideoTile({ name, streamURL, mirrored, camera, microphone, caption, local, waiting, height, feedback, fill, compact }: Props) {
  const { largeText, highContrast } = useAccessibilitySettings();
  const Video = streamURL ? getWebRTC().RTCView : null;
  return <View style={[styles.tile, fill && styles.fill]}>
    <View style={[styles.video, fill ? styles.fillVideo : { height }]}>
      {Video && camera ? <Video streamURL={streamURL} mirror={mirrored} objectFit="contain" style={StyleSheet.absoluteFill} />
        : <View style={styles.placeholder}>
          <View style={styles.avatar}><Text style={styles.initial}>{waiting ? '↗' : name.slice(0, 1).toUpperCase()}</Text></View>
          <Text style={styles.placeholderTitle}>{waiting ? 'A conversation starts with two.' : `${name} · camera off`}</Text>
          {waiting ? <Text style={styles.placeholderHint}>Your guest’s video will appear here.</Text> : null}
        </View>}
    </View>
    <View style={[styles.identity, compact && styles.compactIdentity]}>
      <View style={[styles.dot, waiting && styles.dotWaiting]} />
      <Text numberOfLines={1} style={styles.name}>{local ? `${name} (you)` : name}</Text>
      <Text accessibilityLabel={microphone ? 'Microphone on' : 'Microphone muted'} style={styles.mic}>{microphone ? 'Mic on' : 'Muted'}</Text>
    </View>
    {(!compact || caption?.text || !feedback) ? <View style={[styles.caption, compact && styles.compactCaption, highContrast && styles.contrast]} accessibilityLiveRegion={local ? 'none' : 'polite'}>
      <Text style={styles.captionLabel}>{caption?.text ? caption.kind === 'ai' ? 'AI GUESS · UNREVIEWED' : caption.kind === 'typed' ? 'TYPED CAPTION' : 'REVIEWED CAPTION' : 'CAPTIONS'}</Text>
      <Text selectable numberOfLines={compact && !largeText ? 3 : undefined} style={[styles.captionText, largeText && styles.large, !caption?.text && styles.captionEmpty]}>
        {caption?.text || (local ? 'Your shared words will appear here.' : 'Their shared words will appear here.')}
      </Text>
    </View> : null}
    {local && feedback ? <View style={[styles.caption, compact && styles.compactCaption, highContrast && styles.contrast]} accessibilityLiveRegion="polite">
      <Text style={styles.captionLabel}>{feedback.preview ? 'AI PREVIEW · ONLY YOU' : 'AI SIGN TRACKING'}</Text>
      {feedback.preview ? <Text selectable style={[styles.captionText, largeText && styles.large]}>{feedback.preview}</Text> : null}
      {!compact ? <Text style={styles.captionEmpty}>{feedback.tracking}</Text> : null}
      <Text numberOfLines={compact && !largeText ? 2 : undefined} style={styles.feedback}>{feedback.message}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.navy, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#314952' },
  video: { backgroundColor: '#11212B' }, placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  avatar: { width: 64, height: 64, borderRadius: 24, backgroundColor: '#2A414C', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#C9E8F1', fontSize: 30, fontWeight: '600' }, placeholderTitle: { color: '#E5F2F6', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  placeholderHint: { color: '#A6BFC9', fontSize: 13, textAlign: 'center' }, identity: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9ED6B9' }, dotWaiting: { backgroundColor: '#A6BFC9' },
  name: { color: '#E9F3F6', fontWeight: '600', fontSize: 13, flex: 1 }, mic: { color: '#B9CED7', fontSize: 11 },
  caption: { backgroundColor: '#203743', paddingHorizontal: 14, paddingVertical: 12, gap: 5, minHeight: 74 },
  contrast: { backgroundColor: '#07131B' }, captionLabel: { color: '#ACCDD9', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  captionText: { color: '#FFFFFF', fontSize: 16, lineHeight: 23 }, large: { fontSize: 22, lineHeight: 30 }, captionEmpty: { color: '#B6CDD6', fontSize: 13 },
  feedback: { color: '#D4E6ED', fontSize: 13, lineHeight: 19 },
  fill: { flex: 1 }, fillVideo: { flex: 1, minHeight: 90 }, compactIdentity: { paddingVertical: 6 },
  compactCaption: { minHeight: 0, paddingVertical: 8, gap: 3 },
});

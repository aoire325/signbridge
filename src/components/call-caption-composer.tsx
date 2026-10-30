import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { useAslWordRecognizer } from '@/recognition/use-asl-word-recognizer';
import { useSentenceTranslator } from '@/recognition/use-sentence-translator';
import { useRecognitionExamples } from '@/state/use-recognition-examples';
import { useCallTracking } from '@/calls/use-call-tracking';
import type { CaptionKind } from '@/calls/protocol';
import { visibleHands } from '@/recognition/landmarks';
import { hasExpandedContext } from '@/recognition/expanded-word-input';
import { ActionButton } from './action-button';
import { colors } from '@/constants/palette';
import { CallIconButton } from './call-icon-button';

export type CallCaptionFeedback = { preview: string; message: string; tracking: string };
type Props = { stream: MediaStream; active: boolean; canSend: boolean; frontCamera: boolean;
  onCaption: (text: string, kind: CaptionKind) => boolean;
  onFeedback: (feedback: CallCaptionFeedback | null) => void; compact?: boolean };

/** Mounted only while the caller explicitly enables AI captions. */
export function CallCaptionComposer({ stream, active, canSend, frontCamera, onCaption, onFeedback, compact = false }: Props) {
  const [automatic, setAutomatic] = useState(false);
  const [sentenceMode, setSentenceMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const generation = Number(frontCamera) + Number(sentenceMode) * 2;
  const phrase = useRef({ text: '', at: 0 });
  const settings = useRef({ automatic, onCaption, canSend });
  useLayoutEffect(() => { settings.current = { automatic, onCaption, canSend }; });
  useLayoutEffect(() => { phrase.current = { text: '', at: 0 }; }, [frontCamera, active, sentenceMode, automatic, canSend]);
  const appendWord = useCallback((word: string) => {
    if (!settings.current.canSend) return;
    const now = Date.now();
    const previous = now - phrase.current.at < 6000 ? phrase.current.text : '';
    const text = previous && `${previous} ${word}`.length <= 280 ? `${previous} ${word}` : word;
    if (settings.current.onCaption(text, settings.current.automatic ? 'ai' : 'reviewed')) {
      phrase.current = { text, at: now }; setNotice('');
    } else setNotice('Caption could not be sent. Wait for the connection, then try again.');
  }, []);
  // Local recognition is useful before anyone joins. Only transmission depends
  // on the caption channel. Start a fresh word at connection changes so an old
  // practice guess cannot be auto-shared when the guest arrives.
  const enabled = active;
  const wordGeneration = generation + Number(canSend) * 4;
  const personal = useRecognitionExamples(true, enabled && !sentenceMode, wordGeneration);
  const word = useAslWordRecognizer(enabled && !sentenceMode, wordGeneration, appendWord, personal.learning, !sentenceMode);
  const sentence = useSentenceTranslator(sentenceMode, enabled, generation);
  const tracker = useCallTracking(stream, enabled, sentenceMode ? sentence.onFrame : word.onFrame, frontCamera);
  const { processing, candidates, chooseCandidate } = word;
  useEffect(() => {
    if (automatic && enabled && canSend && !sentenceMode && !processing && candidates.length) chooseCandidate(candidates[0]);
  }, [automatic, enabled, canSend, sentenceMode, processing, candidates, chooseCandidate]);
  const frame = sentenceMode ? sentence.frame : word.frame;
  const hands = frame ? visibleHands(frame).length : 0;
  const tracking = !active ? 'Camera paused' : !tracker.ready ? 'Waiting for camera tracking'
    : `${hands ? `${hands} hand${hands === 1 ? '' : 's'} detected` : 'No hands detected'} · ${frame && hasExpandedContext(frame) ? 'shoulders visible' : 'move back to show your shoulders'}`;
  const recognitionMessage = sentenceMode ? sentence.message : word.status !== 'loaded' ? 'Loading sign recognition models…' : word.message;
  const message = !active ? 'Turn on your camera to sign.' : tracker.error || (!sentenceMode && word.error)
    || (!tracker.ready ? 'Preparing gesture tracking…' : recognitionMessage);
  const preview = active && tracker.ready ? sentenceMode ? sentence.draft : word.candidates[0] ?? '' : '';
  useEffect(() => { onFeedback({ preview, message, tracking }); }, [onFeedback, preview, message, tracking]);
  useEffect(() => () => onFeedback(null), [onFeedback]);
  const fullPanel = <View style={styles.panel}>
    <View style={styles.heading}>
      <Text style={styles.title}>Your AI captions</Text>
      <Text style={styles.badge}>EXPERIMENTAL</Text>
    </View>
    <Text style={styles.hint}>{canSend
      ? automatic && !sentenceMode ? 'New guesses are shared automatically as unreviewed AI captions.' : 'Your AI preview is private. Choose a word below to share it with your guest.'
      : 'Try signing now. Your AI preview appears under your camera, even while waiting for a guest. Nothing is sent yet.'}</Text>
    <Text style={styles.body}>{tracking}</Text>
    <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text>
    {tracker.error ? <ActionButton label="Restart AI tracking" text="Restart AI tracking" compact onPress={tracker.retry} /> : null}
    <View style={styles.modes}>
      {[false, true].map((sentences) => <Pressable key={String(sentences)} accessibilityRole="button"
        accessibilityState={{ selected: sentenceMode === sentences }} disabled={sentence.busy || sentence.recording || word.processing}
        onPress={() => setSentenceMode(sentences)} style={[styles.mode, sentenceMode === sentences && styles.selected]}>
        <Text style={[styles.modeText, sentenceMode === sentences && styles.selectedText]}>{sentences ? 'Short sentence' : 'One sign at a time'}</Text>
      </Pressable>)}
    </View>
    {!sentenceMode ? <>
      <View style={styles.heading}>
        <View style={styles.copy}><Text style={styles.body}>Share guesses automatically</Text>
          <Text style={styles.hint}>{automatic ? 'The other person sees these as unreviewed AI guesses.' : 'Choose a word below to share a reviewed caption.'}</Text></View>
        <Switch accessibilityLabel="Share AI guesses automatically" value={automatic} onValueChange={setAutomatic}
          trackColor={{ false: colors.line, true: colors.teal }} />
      </View>
      {(!automatic || !canSend) && word.candidates.length > 0 ? <View style={styles.choices}>
        {word.candidates.map((label) => <ActionButton key={label} label={`Caption ${label}`} text={label} compact
          disabled={!enabled || !canSend || word.processing} onPress={() => word.chooseCandidate(label)} />)}
      </View> : null}
      <ActionButton label="Finish sign for caption" text={word.processing ? 'Reading your sign…' : 'Finish sign'} compact
        disabled={!enabled || !tracker.ready || word.status !== 'loaded' || word.processing} onPress={word.finishSign} />
    </> : <>
      <Text style={styles.hint}>Sign a short sentence, then review the draft. Up to 12 seconds; translation may take a while.</Text>
      {sentence.busy ? <ActivityIndicator color={colors.teal} accessibilityLabel="Translating your signed sentence" /> : null}
      <View style={styles.choices}>
        <ActionButton label={sentence.recording ? 'Translate sentence caption' : 'Record sentence caption'}
          text={sentence.recording ? 'Stop & translate' : 'Record sentence'} compact
          disabled={!enabled || !tracker.ready || sentence.busy} onPress={() => { if (sentence.recording) void sentence.finish(); else void sentence.start(); }} />
        {sentence.recording || sentence.busy ? <ActionButton label="Cancel sentence caption" text="Cancel" compact onPress={sentence.cancel} /> : null}
      </View>
      {sentence.draft ? <>
        <TextInput accessibilityLabel="Review sentence caption" multiline value={sentence.draft} onChangeText={sentence.editDraft} style={styles.draft} />
        {sentence.draft.trim().length > 280 ? <Text style={styles.hint}>Shorten this draft to 280 characters before sharing.</Text> : null}
        <ActionButton label="Share reviewed sentence" text="Share this sentence" compact variant="primary" disabled={!canSend || !sentence.draft.trim() || sentence.draft.trim().length > 280}
          onPress={() => { if (onCaption(sentence.draft, 'reviewed')) sentence.clearDraft(); else setNotice('Caption could not be sent. Try again.'); }} />
        <ActionButton label="Discard sentence caption" text="Discard draft" compact onPress={sentence.clearDraft} />
      </> : null}
    </>}
    {notice ? <Text accessibilityRole="alert" style={styles.hint}>{notice}</Text> : null}
  </View>;
  if (!compact) return fullPanel;
  return <View style={styles.compactPanel}>
    <View style={styles.heading}>
      <View style={styles.copy}><Text style={styles.compactTitle}>AI sign captions</Text>
        <Text numberOfLines={1} style={styles.compactHint}>{!canSend ? 'Private preview · waiting for guest' : sentenceMode ? 'Review your sentence before sharing' : automatic ? 'Sharing unreviewed AI guesses' : 'Tap a match to share'}</Text></View>
      {!sentenceMode ? <CallIconButton label="Finish sign for caption" disabled={!enabled || !tracker.ready || word.status !== 'loaded' || word.processing}
        icon={{ ios: 'checkmark', android: 'check', web: 'check' }} onPress={word.finishSign} />
        : <CallIconButton label={sentence.recording ? 'Translate sentence caption' : 'Record sentence caption'}
          active={sentence.recording} disabled={!enabled || !tracker.ready || sentence.busy}
          icon={{ ios: sentence.recording ? 'stop.fill' : 'record.circle', android: sentence.recording ? 'stop' : 'radio_button_checked', web: sentence.recording ? 'stop' : 'radio_button_checked' }}
          onPress={() => { if (sentence.recording) void sentence.finish(); else void sentence.start(); }} />}
      <CallIconButton label="AI caption options" hint="Choose words, sentences, or automatic sharing"
        icon={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} onPress={() => setDetailsOpen(true)} />
    </View>
    {!sentenceMode && (!automatic || !canSend) && word.candidates.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {word.candidates.map((label) => <ActionButton key={label} label={`Caption ${label}`} text={label} compact variant="dark"
        disabled={!enabled || !canSend || word.processing} onPress={() => word.chooseCandidate(label)} />)}
    </ScrollView> : null}
    {tracker.error ? <Pressable accessibilityRole="button" accessibilityLabel="Restart AI tracking" onPress={tracker.retry}>
      <Text style={styles.compactHint}>Tracking stopped · tap to restart</Text></Pressable> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.compactHint}>{notice}</Text> : null}
    <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
      <View style={styles.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close AI caption options" onPress={() => setDetailsOpen(false)} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}><Text style={styles.compactTitle}>AI sign captions</Text>
            <CallIconButton label="Close AI caption options" icon={{ ios: 'xmark', android: 'close', web: 'close' }} onPress={() => setDetailsOpen(false)} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.sheetContent}>{fullPanel}</ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.navy },
  badge: { fontSize: 9, letterSpacing: 0.7, fontWeight: '800', color: colors.tealDeep },
  modes: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.field, padding: 4, gap: 4 },
  mode: { flex: 1, padding: 12, minHeight: 48, justifyContent: 'center', borderRadius: 10 },
  selected: { backgroundColor: colors.navy }, modeText: { color: colors.inkSoft, fontWeight: '600', textAlign: 'center', fontSize: 13 },
  selectedText: { color: colors.white }, copy: { flex: 1, gap: 4 }, body: { color: colors.navy, fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 19, color: colors.inkSoft }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  draft: { fontSize: 18, lineHeight: 26, color: colors.navy, backgroundColor: colors.field, padding: 14, borderRadius: 12 },
  compactPanel: { backgroundColor: '#19313D', borderRadius: 20, padding: 12, gap: 8 },
  compactTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' }, compactHint: { color: '#B7CDD6', fontSize: 12, lineHeight: 18 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' }, sheet: { maxHeight: '85%', backgroundColor: '#0D2029', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  sheetContent: { padding: 16, paddingBottom: 40 },
});

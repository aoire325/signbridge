import * as Clipboard from 'expo-clipboard';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { useCameraSession } from '@/camera/use-camera-session';
import { LiveLandmarkCamera } from '@/camera/live-landmark-camera';
import { LandmarkOverlay } from '@/camera/landmark-overlay';
import type { TrackingFrame } from '@/recognition/landmarks';
import { trackingFeedback, TRACKING_COLORS } from '@/recognition/tracking-feedback';
import { colors } from '@/constants/palette';
import { useSentenceTranslator } from '@/recognition/use-sentence-translator';
import { useAslWordRecognizer, type WordVocabulary } from '@/recognition/use-asl-word-recognizer';
import { SUPPORTED_WORD_LABELS } from '@/recognition/expanded-vocabulary';
import { EXPANDED_WORD_LABELS } from '@/recognition/asl1000-recognition';
import { WORD_MODEL_LABELS } from '@/recognition/asl-word-recognition';
import { ModelStatusService } from '@/services/model-status';
import { useAccessibilitySettings } from '@/state/accessibility-settings';
import { useTranscript } from '@/state/use-transcript';

const modelStatus = ModelStatusService.getStatus();

export default function HomeScreen() {
  const isFocused = useIsFocused();
  const camera = useCameraSession(isFocused);
  const transcript = useTranscript();
  const [sentenceMode, setSentenceMode] = useState(false);
  const sentence = useSentenceTranslator(sentenceMode, camera.isActive && !transcript.isEditing, camera.sessionToken);
  const [wordVocabulary, setWordVocabulary] = useState<WordVocabulary>('expanded');
  const expandedVocabulary = wordVocabulary === 'expanded';
  const vocabulary = expandedVocabulary ? SUPPORTED_WORD_LABELS : wordVocabulary === 'standard' ? EXPANDED_WORD_LABELS : WORD_MODEL_LABELS;
  const recognizer = useAslWordRecognizer(!sentenceMode && camera.isActive && !transcript.isEditing, camera.sessionToken, transcript.appendWord, wordVocabulary);
  const currentFrame = sentenceMode ? sentence.frame : recognizer.frame;
  const { highContrast, largeText } = useAccessibilitySettings();
  const [previewSessionToken, setPreviewSessionToken] = useState(-1);
  const [readySessionToken, setReadySessionToken] = useState(-1);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [feedback, setFeedback] = useState('');
  const textSize = largeText ? 22 : 18;
  const textColor = highContrast ? colors.ink : colors.inkSoft;
  const cameraIsVisible = camera.isActive;
  const previewIsReady = cameraIsVisible && (previewSessionToken === camera.sessionToken || readySessionToken === camera.sessionToken);
  const cameraIsReady = cameraIsVisible && readySessionToken === camera.sessionToken;
  const tracking = trackingFeedback(cameraIsReady ? currentFrame : null);
  const announceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSession = useRef({ active: camera.isActive, token: camera.sessionToken });

  useLayoutEffect(() => {
    currentSession.current = { active: camera.isActive, token: camera.sessionToken };
    return () => { currentSession.current.active = false; };
  }, [camera.isActive, camera.sessionToken]);

  useEffect(() => () => {
    if (announceRef.current) clearTimeout(announceRef.current);
  }, []);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    if (announceRef.current) clearTimeout(announceRef.current);
    announceRef.current = setTimeout(() => setFeedback(''), 2600);
  }, []);

  const onFrame = sentenceMode ? sentence.onFrame : recognizer.onFrame;
  const handleLandmarks = useCallback((event: { nativeEvent: TrackingFrame }) => {
    if (!currentSession.current.active || currentSession.current.token !== camera.sessionToken) return;
    onFrame(event.nativeEvent);
  }, [camera.sessionToken, onFrame]);

  const handlePreviewReady = useCallback(() => {
    if (currentSession.current.active && currentSession.current.token === camera.sessionToken) {
      setPreviewSessionToken(camera.sessionToken);
    }
  }, [camera.sessionToken]);

  const handleCameraReady = useCallback(() => {
    if (currentSession.current.active && currentSession.current.token === camera.sessionToken) {
      setReadySessionToken(camera.sessionToken);
    }
  }, [camera.sessionToken]);

  const reportCameraError = camera.reportCameraError;
  const handleCameraError = useCallback((event: { nativeEvent: { message: string } }) => {
    if (currentSession.current.active && currentSession.current.token === camera.sessionToken) {
      reportCameraError(event.nativeEvent.message || 'Live tracking could not start.');
    }
  }, [camera.sessionToken, reportCameraError]);

  const startCamera = async () => {
    Keyboard.dismiss();
    transcript.commitEditing();
    if (camera.permission && !camera.permission.granted && !camera.permission.canAskAgain) {
      await Linking.openSettings();
      return;
    }
    const started = await camera.start();
    if (!started) {
      showFeedback('Camera permission is needed to show the live preview.');
    }
  };

  const handleCopy = async () => {
    if (!transcript.value.trim()) {
      showFeedback('Add text to the transcript before copying.');
      return;
    }
    try {
      await Clipboard.setStringAsync(transcript.value);
      showFeedback('Transcript copied.');
    } catch {
      showFeedback('Could not copy the transcript. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.brandBridge} />
            <View style={styles.brandDot} />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.wordmark}>signbridge</Text>
            <Text style={styles.wordmarkCaption}>ASL CAMERA STUDIO</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open model and accessibility settings"
            accessibilityHint="Shows recognition status, privacy details, and display settings"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
            <Text style={styles.settingsGlyph} aria-hidden>⋯</Text>
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>AMERICAN SIGN LANGUAGE</Text>
          <Text style={[styles.title, largeText && styles.titleLarge]}>A clearer way to connect.</Text>
          <Text style={[styles.subtitle, { color: textColor }]}> 
            Sign ASL words or record a short sentence. Recognition runs on this device.
          </Text>
        </View>

        <View style={styles.cameraCard}>
          <View style={styles.cameraStage}>
            {cameraIsVisible ? (
              <>
                <LiveLandmarkCamera
                  style={StyleSheet.absoluteFill}
                  facing={camera.facing}
                  key={`${camera.facing}-${camera.sessionToken}`}
                  onReady={handleCameraReady}
                  onPreviewReady={handlePreviewReady}
                  onError={handleCameraError}
                  onLandmarks={handleLandmarks}
                />
                <LandmarkOverlay frame={currentFrame} mirrored={camera.facing === 'front'} />
              </>
            ) : (
              <View style={styles.previewPlaceholder}>
                <View style={styles.previewIcon}>
                  <View style={styles.previewLens} />
                  <View style={styles.previewShutter} />
                </View>
                <Text style={styles.previewTitle}>
                  {camera.session === 'paused' ? 'Session paused' : 'Ready when you are'}
                </Text>
                <Text style={styles.previewDescription}>
                  {camera.session === 'paused'
                    ? 'Resume when you are ready to use the camera again.'
                    : 'Allow camera access to begin a private, on-device preview.'}
                </Text>
              </View>
            )}

            <View style={styles.cameraTopline}>
              <View style={styles.cameraStatusPill} accessibilityLiveRegion="polite">
                <View style={[styles.statusDot, previewIsReady && styles.statusDotLive]} />
                <Text style={styles.cameraStatusText}>
                  {cameraIsVisible ? (previewIsReady ? 'CAMERA ON' : 'STARTING CAMERA') : 'CAMERA OFF'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${camera.facing === 'front' ? 'rear' : 'front'} camera`}
                disabled={sentenceMode && (sentence.recording || sentence.busy)}
                onPress={camera.switchCamera}
                style={({ pressed }) => [styles.flipButton, pressed && styles.pressed]}>
                <Text style={styles.flipButtonText} aria-hidden>↻</Text>
              </Pressable>
            </View>


            {camera.error ? (
              <View style={styles.cameraError} accessibilityRole="alert">
                <Text style={styles.cameraErrorTitle}>Camera unavailable</Text>
                <Text style={styles.cameraErrorText}>{camera.error}</Text>
                <Text style={styles.cameraErrorText}>Check camera access and try again.</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.trackingStatusRow} accessible
            accessibilityLabel={cameraIsReady && currentFrame
              ? `Tracking: face ${tracking.face}, upper body ${tracking.upperBody}, ${tracking.hands} hands detected.`
              : 'Face, upper body and hand tracking will appear when the camera is ready.'}>
            {[
              { label: 'Face', value: tracking.face, color: TRACKING_COLORS.face },
              { label: 'Upper body', value: tracking.upperBody, color: TRACKING_COLORS.body },
              { label: 'Hands', value: `${tracking.hands} detected`, color: TRACKING_COLORS.leftHand },
            ].map(({ label, value, color }) => <View key={label} style={styles.trackingStatusChip}>
              <View style={[styles.trackingStatusDot, { backgroundColor: color }]} />
              <Text style={styles.trackingStatusText}>{label}: {cameraIsReady && currentFrame ? value : 'waiting'}</Text>
            </View>)}
          </View>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}><Text style={styles.guidanceIconText}>i</Text></View>
            <Text style={styles.guidanceText}>
            {cameraIsReady && currentFrame ? tracking.guidance : sentenceMode
              ? 'Keep your face, shoulders, elbows and hands visible. Record a complete short sentence without pausing between words.'
              : 'Keep your face, shoulders, elbows and hands visible. Sign one word, lower your hands, then review the result.'}
            </Text>
          </View>
        </View>

        <View style={styles.controls}>
          {camera.session === 'running' ? (
            <>
              <ActionButton label="Pause camera" icon="Ⅱ" variant="primary"
                disabled={sentenceMode && (sentence.recording || sentence.busy)} onPress={camera.pause} />
              <ActionButton label={sentenceMode && sentence.recording ? 'Stop & translate' : 'Stop camera'} icon="■" variant="secondary"
                disabled={sentenceMode && sentence.busy}
                onPress={() => { if (sentenceMode && sentence.recording) void sentence.finish(); else camera.stop(); }} />
            </>
          ) : camera.session === 'paused' ? (
            <>
              <ActionButton label="Resume camera" icon="▶" variant="primary" onPress={startCamera} />
              <ActionButton label="Stop camera" icon="■" variant="secondary" onPress={camera.stop} />
            </>
          ) : (
            <ActionButton
              label={
                !camera.permission?.granted && camera.permission?.canAskAgain === false
                  ? 'Open Settings'
                  : camera.permission?.granted ? 'Start camera' : 'Allow camera & start'
              }
              icon="▶"
              variant="primary"
              onPress={startCamera}
            />
          )}
        </View>

        <View style={styles.controls}>
          <ActionButton label="Words" variant={sentenceMode ? 'secondary' : 'primary'} compact
            disabled={sentence.busy || sentence.recording} onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); setSentenceMode(false); }} />
          <ActionButton label="Sentences" variant={sentenceMode ? 'primary' : 'secondary'} compact
            disabled={recognizer.processing} onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); setSentenceMode(true); }} />
        </View>

        <View style={[styles.recognitionFeedback, camera.error && styles.recognitionError]}>
          <View style={styles.currentLetterBlock}>
            <Text style={styles.currentLetterLabel}>HANDS</Text>
            <Text style={styles.currentLetter}>{cameraIsReady ? tracking.hands : '—'}</Text>
          </View>
          <View style={styles.feedbackCopy}>
            <Text style={styles.feedbackTitle}>
              {camera.error ? 'Tracking unavailable' : sentenceMode ? 'Offline sentence translation · experimental' : recognizer.error ? 'Word recognition unavailable' : cameraIsReady ? (recognizer.status === 'loaded' ? 'ASL word recognition' : 'Preparing ASL word model…') : cameraIsVisible ? (previewIsReady ? 'Camera ready · preparing tracking…' : 'Starting camera…') : 'ASL word recognition'}
            </Text>
            <Text style={styles.feedbackBody}>{camera.error || (!sentenceMode && recognizer.error) || (transcript.isEditing ? 'Transcription paused while you edit the text.' : cameraIsVisible && !cameraIsReady ? 'You can position yourself in the preview while tracking prepares. Models stay ready briefly for faster restarts.' : sentenceMode ? sentence.message : recognizer.message)}</Text>
            {cameraIsReady && currentFrame ? <Text style={styles.trackingMeta}>
              Face {tracking.face} · Upper body {tracking.upperBody} · {Math.round(currentFrame.inferenceMs)} ms
            </Text> : null}
          </View>
        </View>

        {sentenceMode ? <View style={styles.teachingCard}>
          <Text style={styles.sectionTitle}>Translate a signed sentence</Text>
          <Text style={styles.modelNoticeBody}>
            Record one short sentence continuously, up to 12 seconds. The trained pose-to-English model runs entirely on this phone. First load is slower than word recognition.
          </Text>
          <Text style={styles.modelNoticeBody}>
            Experimental: live translation accuracy is unvalidated. Review the draft before adding it; it can omit or change meaning.
          </Text>
          <View accessibilityLiveRegion="polite">
            {sentence.busy ? <ActivityIndicator color={colors.teal} accessibilityLabel="Processing sentence offline" /> : null}
            <Text style={styles.feedbackBody}>{sentence.message}</Text>
          </View>
          <ActionButton label={sentence.recording ? 'Stop & translate' : sentence.busy ? 'Working offline…' : 'Record sentence'}
            variant="primary" disabled={!cameraIsReady || transcript.isEditing || sentence.busy}
            onPress={() => { if (sentence.recording) void sentence.finish(); else void sentence.start(); }} />
          {sentence.recording || sentence.busy ? <ActionButton label="Cancel sentence" variant="secondary" onPress={sentence.cancel} /> : null}
          {sentence.draft ? <>
            <Text style={styles.sectionTitle}>Translation draft</Text>
            <TextInput multiline value={sentence.draft} onChangeText={sentence.editDraft}
              accessibilityLabel="Review and edit sentence translation" style={styles.wordLabelInput} />
            <ActionButton label="Add sentence to transcript" variant="primary"
              disabled={transcript.isEditing || !sentence.draft.trim()} onPress={() => {
                transcript.appendWord(sentence.draft); sentence.clearDraft();
              }} />
            <ActionButton label="Discard draft" variant="quiet" onPress={sentence.clearDraft} />
          </> : null}
        </View> : null}

        <View style={styles.transcriptSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>YOUR WORDS</Text>
              <Text style={[styles.sectionTitle, largeText && styles.sectionTitleLarge]}>{sentenceMode ? 'Sentence transcript' : 'Word transcript'}</Text>
            </View>
            <View style={styles.editableBadge}>
              <Text style={styles.editableBadgeText}>EDITABLE</Text>
            </View>
          </View>

          <TextInput
            accessibilityLabel={sentenceMode ? 'Editable sentence transcript' : 'Editable word transcript'}
            accessibilityHint={sentenceMode ? 'Review the translation draft, then add it to this transcript.' : 'Recognized ASL words are added automatically. Transcription pauses while you edit.'}
            multiline
            textAlignVertical="top"
            value={transcript.value}
            onChangeText={transcript.update}
            onFocus={transcript.beginEditing}
            onEndEditing={transcript.commitEditing}
            onBlur={transcript.commitEditing}
            placeholder={sentenceMode ? 'Record a sentence, review its translation, then tap Add sentence to transcript.' : expandedVocabulary ? 'Sign one word, lower your hands, then tap the correct match to add it here.' : 'Sign one supported word, then lower both hands. Recognized words appear here automatically.'}
            placeholderTextColor={colors.inkMuted}
            style={[styles.transcriptInput, { fontSize: textSize, color: textColor }]}
            maxLength={1200}
            selectionColor={colors.teal}
          />

          {transcript.isEditing ? <ActionButton label="Done editing" variant="secondary"
            onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); }} /> : null}

          <View style={styles.transcriptMeta}>
            <Text style={styles.wordCount}>{transcript.value.trim() ? `${transcript.wordCount} words` : 'No text yet'}</Text>
            <Text style={styles.localOnly}>NOT SAVED</Text>
          </View>

          <View style={styles.wordControls}>
            <ActionButton
              label="Add space"
              icon="␣"
              variant="secondary"
              compact
              disabled={!transcript.value || /\s$/.test(transcript.value)}
              onPress={transcript.appendSpace}
            />
            <ActionButton
              label="Delete last character"
              icon="⌫"
              variant="secondary"
              compact
              disabled={!transcript.value}
              onPress={transcript.backspace}
            />
          </View>

          <View style={styles.transcriptActions}>
            <ActionButton
              label="Undo"
              icon="↶"
              variant="secondary"
              compact
              disabled={!transcript.canUndo}
              onPress={transcript.undo}
            />
            <ActionButton
              label="Copy"
              icon="▢"
              variant="secondary"
              compact
              disabled={!transcript.value.trim()}
              onPress={handleCopy}
            />
            <ActionButton
              label="Clear"
              icon="×"
              variant="quiet"
              compact
              disabled={!transcript.value}
              onPress={transcript.clear}
            />
          </View>
          <Text style={styles.privacyCaption}>
            Transcript text stays in this session and clears when you close the app.
          </Text>
        </View>

        {!sentenceMode ? <View style={styles.teachingCard}>
          <Text style={styles.sectionTitle}>Sign → words → transcript</Text>
          <Text style={styles.modelNoticeBody}>
            {vocabulary.length.toLocaleString()} supported word entries. Sign one at a time. {expandedVocabulary ? 'Expanded predictions require your review before adding text.' : 'Confident predictions are added automatically; uncertain predictions are skipped.'} Use Undo to correct a word.
          </Text>
          <ActionButton label={recognizer.processing ? 'Reading sign…' : 'Finish sign'} variant="primary"
            disabled={!cameraIsReady || recognizer.status !== 'loaded' || recognizer.processing || transcript.isEditing}
            onPress={recognizer.finishSign} />
          {recognizer.candidates.length ? <>
            <Text style={styles.sectionTitle}>Possible matches · tap only if correct</Text>
            {recognizer.candidates.map((word) => <ActionButton key={word} label={`Add ${word}`}
              compact variant="secondary" onPress={() => recognizer.chooseCandidate(word)}
              disabled={recognizer.processing || transcript.isEditing || !cameraIsReady} />)}
            <Text style={styles.modelNoticeBody}>These are suggestions, not confirmed recognition. If none matches your sign, leave them unselected and try again.</Text>
          </> : null}
          <Text style={styles.modelNoticeBody}>
            Start with your hands lowered and shoulders visible. Sign one word, then lower your hands and wait for the result. Use Finish sign if your hands stay in view.
          </Text>
          {!expandedVocabulary ? <ActionButton label={`Use ${SUPPORTED_WORD_LABELS.length.toLocaleString()} entries · review required`}
            variant="secondary" onPress={() => setWordVocabulary('expanded')} disabled={recognizer.processing} /> : null}
          {wordVocabulary !== 'standard' ? <ActionButton label="Use legacy 1,000-sign model"
            variant="secondary" onPress={() => setWordVocabulary('standard')} disabled={recognizer.processing} /> : null}
          {wordVocabulary !== 'basic' ? <ActionButton label="Use original 250-sign model"
            variant="secondary" onPress={() => setWordVocabulary('basic')} disabled={recognizer.processing} /> : null}
          <Text style={styles.modelNoticeBody}>
            {expandedVocabulary ? 'Each sign is checked twice for a consistent match. Keep your signing hand, face and shoulders in view. Sign once at your natural speed, then lower your hands or tap Finish sign. Review the suggestions before adding a word. All recognition stays offline.' : wordVocabulary === 'standard' ? 'Legacy 1,000-sign model: body and hand landmarks. This option performed worse in our recorded-pose check; live accuracy remains experimental.' : 'Original 250-sign model: uses face and hand landmarks.'}
          </Text>
          <ActionButton label={showVocabulary ? 'Hide supported words' : `Show ${vocabulary.length.toLocaleString()} supported words`}
            variant="quiet" compact onPress={() => setShowVocabulary((visible) => !visible)} />
          {showVocabulary ? <Text selectable style={styles.modelNoticeBody}>{vocabulary.join(' · ')}</Text> : null}
        </View> : null}

        <View style={styles.modelNotice}>
          <View style={styles.modelNoticeTop}>
            <View style={styles.modelGlyph}><Text style={styles.modelGlyphText}>✳</Text></View>
            <View style={styles.modelNoticeCopy}>
              <Text style={styles.modelNoticeTitle}>Pretrained ASL word recognition</Text>
              <Text style={styles.modelNoticeBody}>
                {sentenceMode ? 'The sentence encoder reads the whole landmark sequence, and a trained English decoder produces a draft. No server or grammar templates are used.' : expandedVocabulary ? 'Matches one sign at a time. Choose the correct suggestion to add it to your transcript. You can also edit the text directly.' : 'Matches one sign at a time from the selected vocabulary. Uncertain matches are skipped. Words appear in sign order.'}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View model status and supported signs"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.modelDetailsButton, pressed && styles.pressed]}>
            <Text style={styles.modelDetailsText}>View model status</Text>
            <Text style={styles.chevron} aria-hidden>›</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerRule} />
          <Text style={styles.footerText}>Experimental isolated ASL words · {modelStatus.label}</Text>
        </View>
      </ScrollView>

      {feedback ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="status" style={styles.toast}>
          <Text style={styles.toastText}>{feedback}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  teachingCard: { padding: 17, borderRadius: 20, gap: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  wordLabelInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, color: colors.navy, fontSize: 16 },
  matchCard: { backgroundColor: colors.mintSoft, borderRadius: 14, padding: 12, gap: 10 },
  trackingMeta: { color: colors.tealDeep, fontSize: 11, marginTop: 6 },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  brandBridge: { width: 21, height: 11, borderWidth: 2.5, borderBottomWidth: 0, borderColor: colors.mint, borderTopLeftRadius: 15, borderTopRightRadius: 15, marginTop: 8 },
  brandDot: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: colors.white, top: 10, right: 10 },
  brandText: { flex: 1, gap: 2 },
  wordmark: { fontSize: 19, lineHeight: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.navy },
  wordmarkCaption: { fontSize: 9, letterSpacing: 1.35, fontWeight: '700', color: colors.inkMuted },
  settingsButton: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  settingsGlyph: { color: colors.navy, fontSize: 24, lineHeight: 25, fontWeight: '700', transform: [{ rotate: '90deg' }] },
  intro: { gap: 7, paddingTop: 2 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: colors.teal },
  title: { fontSize: 29, lineHeight: 35, letterSpacing: -0.9, fontWeight: '800', color: colors.navy },
  titleLarge: { fontSize: 34, lineHeight: 41 },
  subtitle: { fontSize: 15, lineHeight: 22, maxWidth: 390 },
  cameraCard: { borderRadius: 25, padding: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: 10, shadowColor: colors.navy, shadowOpacity: 0.05, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  cameraStage: { height: 390, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.navy, position: 'relative' },
  previewPlaceholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  previewIcon: { width: 55, height: 42, borderRadius: 13, borderWidth: 2, borderColor: '#729099', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  previewLens: { width: 18, height: 18, borderRadius: 10, borderWidth: 2, borderColor: colors.mint },
  previewShutter: { position: 'absolute', top: -6, width: 14, height: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#729099' },
  previewTitle: { color: colors.white, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  previewDescription: { color: '#B7C8C9', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 250 },
  cameraTopline: { position: 'absolute', zIndex: 2, top: 11, left: 11, right: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cameraStatusPill: { height: 31, paddingHorizontal: 11, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(12, 27, 40, 0.82)' },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A9BBC0' },
  statusDotLive: { backgroundColor: colors.mint },
  cameraStatusText: { color: colors.white, fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  flipButton: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12, 27, 40, 0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)' },
  flipButtonText: { color: colors.white, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  signFrame: { position: 'absolute', zIndex: 1, width: 190, height: 190, alignSelf: 'center', top: '50%', marginTop: -95, borderWidth: 1, borderColor: 'rgba(210, 245, 230, 0.22)', borderRadius: 17 },
  frameCorner: { position: 'absolute', zIndex: 1, width: 25, height: 25, borderColor: 'rgba(210, 245, 230, 0.82)' },
  cornerTopLeft: { left: -1, top: -1, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 9 },
  cornerTopRight: { right: -1, top: -1, borderRightWidth: 2, borderTopWidth: 2, borderTopRightRadius: 9 },
  cornerBottomLeft: { left: -1, bottom: -1, borderLeftWidth: 2, borderBottomWidth: 2, borderBottomLeftRadius: 9 },
  cornerBottomRight: { right: -1, bottom: -1, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 9 },
  cameraError: { position: 'absolute', zIndex: 3, top: '35%', left: 33, right: 33, padding: 14, borderRadius: 16, backgroundColor: 'rgba(22, 38, 49, 0.94)', gap: 5 },
  cameraErrorTitle: { color: colors.white, fontSize: 15, fontWeight: '800' },
  cameraErrorText: { color: '#D2DDDF', fontSize: 12, lineHeight: 17 },
  guidanceRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 5, paddingVertical: 2 },
  guidanceIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft },
  guidanceIconText: { color: colors.tealDeep, fontSize: 12, fontWeight: '800' },
  guidanceText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
  trackingStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  trackingStatusChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7,
    borderRadius: 12, backgroundColor: colors.navy },
  trackingStatusDot: { width: 6, height: 6, borderRadius: 3 },
  trackingStatusText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 10 },
  recognitionFeedback: { flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 18, padding: 14, backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.navy },
  recognitionError: { backgroundColor: '#4A2B2A', borderColor: '#8C4C45' },
  currentLetterBlock: { width: 55, height: 55, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  currentLetterLabel: { color: '#B7C8C9', fontSize: 6, letterSpacing: 0.7, fontWeight: '800' },
  currentLetter: { color: colors.white, fontSize: 25, lineHeight: 29, fontWeight: '800' },
  feedbackCopy: { flex: 1, gap: 4 },
  feedbackTitle: { color: colors.white, fontSize: 13, fontWeight: '800' },
  feedbackBody: { color: '#D2DDDF', fontSize: 11, lineHeight: 16 },
  modelNotice: { borderWidth: 1, borderColor: '#E7E1D6', borderRadius: 19, backgroundColor: colors.warmCard, padding: 15, gap: 13 },
  modelNoticeTop: { flexDirection: 'row', gap: 11 },
  modelGlyph: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1E9D9' },
  modelGlyphText: { color: colors.ochre, fontSize: 18, fontWeight: '700' },
  modelNoticeCopy: { flex: 1, gap: 4 },
  modelNoticeTitle: { color: colors.navy, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  modelNoticeBody: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
  modelDetailsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E5DDCF' },
  modelDetailsText: { color: colors.tealDeep, fontSize: 12, fontWeight: '800' },
  chevron: { color: colors.tealDeep, fontSize: 21, lineHeight: 21 },
  transcriptSection: { borderRadius: 22, padding: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionEyebrow: { color: colors.teal, fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 3 },
  sectionTitle: { color: colors.navy, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  sectionTitleLarge: { fontSize: 23 },
  editableBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.mintSoft },
  editableBadgeText: { color: colors.tealDeep, fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  transcriptInput: { minHeight: 132, maxHeight: 260, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.field, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 13, lineHeight: 27 },
  transcriptMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wordCount: { color: colors.inkMuted, fontSize: 11 },
  localOnly: { color: colors.inkMuted, fontSize: 9, letterSpacing: 1.1, fontWeight: '800' },
  wordControls: { flexDirection: 'row', gap: 9 },
  transcriptActions: { flexDirection: 'row', gap: 9 },
  privacyCaption: { color: colors.inkMuted, fontSize: 11, lineHeight: 16 },
  footer: { alignItems: 'center', gap: 10, paddingTop: 1 },
  footerRule: { width: 38, height: 3, borderRadius: 2, backgroundColor: colors.mint },
  footerText: { color: colors.inkMuted, fontSize: 10, textAlign: 'center' },
  toast: { position: 'absolute', bottom: 18, left: 22, right: 22, alignSelf: 'center', maxWidth: 520, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, backgroundColor: colors.navy, shadowColor: colors.navy, shadowOpacity: 0.16, shadowRadius: 12, elevation: 5 },
  toastText: { color: colors.white, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.76 },
}); 


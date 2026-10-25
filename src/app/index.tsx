import * as Clipboard from 'expo-clipboard';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TutorialSpotlight } from '@/components/tutorial-spotlight';
import { WelcomeScreen } from '@/components/welcome-screen';
import { DictionaryPanel } from '@/components/dictionary-panel';
import { ActionButton } from '@/components/action-button';
import { useCameraSession } from '@/camera/use-camera-session';
import { LiveLandmarkCamera } from '@/camera/live-landmark-camera';
import { LandmarkOverlay } from '@/camera/landmark-overlay';
import type { TrackingFrame } from '@/recognition/landmarks';
import { trackingFeedback } from '@/recognition/tracking-feedback';
import { colors } from '@/constants/palette';
import { useSentenceTranslator } from '@/recognition/use-sentence-translator';
import { useAslWordRecognizer } from '@/recognition/use-asl-word-recognizer';
import { RECOGNITION_WORD_LABELS } from '@/recognition/expanded-vocabulary';
import { useAccessibilitySettings } from '@/state/accessibility-settings';
import { useTranscript } from '@/state/use-transcript';
import { useRecognitionExamples } from '@/state/use-recognition-examples';
import { RecognitionLab } from '@/components/recognition-lab';
import { PersonalSignPanel } from '@/components/personal-sign-panel';

export default function HomeScreen() {
  const isFocused = useIsFocused();
  const { width, height, fontScale } = useWindowDimensions();
  const wideLayout = width >= 960 && fontScale < 1.5;
  const cameraHeight = Math.min(420, Math.max(240, height * (wideLayout ? 0.5 : 0.4)));
  const { view } = useLocalSearchParams<{ view?: string }>();
  const inStudio = view === 'camera';
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<ComponentRef<typeof View>>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [showPersonalSigns, setShowPersonalSigns] = useState(false);
  const [initiallyAddWord, setInitiallyAddWord] = useState(false);
  const [personalFlowToken, setPersonalFlowToken] = useState(0);
  const [showTrackingGuides, setShowTrackingGuides] = useState(true);
  const [focusedControl, setFocusedControl] = useState('');
  const camera = useCameraSession(isFocused && inStudio);
  const transcript = useTranscript();
  const [sentenceMode, setSentenceMode] = useState(false);
  const sentence = useSentenceTranslator(sentenceMode, camera.isActive && !transcript.isEditing, camera.sessionToken);
  const wordActive = !sentenceMode && camera.isActive && !transcript.isEditing;
  const lab = useRecognitionExamples(inStudio, wordActive, camera.sessionToken);
  const dictionaryWords = useMemo(() => [...new Set([...RECOGNITION_WORD_LABELS, ...lab.savedVariants.map((variant) => variant.label)])]
    .sort((a, b) => a.localeCompare(b)), [lab.savedVariants]);
  const recognizer = useAslWordRecognizer(wordActive, camera.sessionToken, transcript.appendWord, lab.learning);
  const currentFrame = sentenceMode ? sentence.frame : recognizer.frame;
  const { highContrast, largeText, tutorialSeen, markTutorialSeen } = useAccessibilitySettings();
  const [previewSessionToken, setPreviewSessionToken] = useState(-1);
  const [readySessionToken, setReadySessionToken] = useState(-1);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [feedback, setFeedback] = useState('');
  const textSize = largeText ? 26 : 22;
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

  const finishTutorial = () => {
    setTutorialStep(null);
    markTutorialSeen();
  };
  const openPersonalSigns = (word?: string, addWord = false) => {
    Keyboard.dismiss();
    if (sentence.recording || sentence.busy || !lab.beginVariant(word)) return;
    transcript.commitEditing(); setSentenceMode(false); setShowLab(false); setShowOptions(false);
    setShowVocabulary(false); setInitiallyAddWord(addWord); setPersonalFlowToken((value) => value + 1); setShowPersonalSigns(true);
  };
  const revealTutorialTarget = useCallback((target: ComponentRef<typeof View>) => {
    const content = contentRef.current;
    if (!content) return;
    target.measureLayout(content, (_x, y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
    }, () => undefined);
  }, []);
  const tutorialControls = {
    onNext: () => { Keyboard.dismiss(); if (tutorialStep === 3) finishTutorial(); else setTutorialStep((step) => step === null ? null : step + 1); },
    onBack: () => { Keyboard.dismiss(); setTutorialStep((step) => step === null ? null : Math.max(0, step - 1)); },
    onSkip: finishTutorial,
    onReveal: revealTutorialTarget,
  };

  if (!inStudio) {
    return <WelcomeScreen onGetStarted={() => { setTutorialStep(tutorialSeen ? null : 0); router.setParams({ view: 'camera' }); }} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View ref={contentRef} collapsable={false} style={styles.content}>
          <View style={styles.navigationGroup}>
            <TutorialSpotlight step={tutorialStep === 3 ? 3 : null} {...tutorialControls}>
              <View style={styles.controls}>
                <ActionButton label="Home" text="Home" icon="⌂" compact disabled={sentence.recording || sentence.busy}
                  onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); camera.pause(); lab.discard(); setShowPersonalSigns(false); setTutorialStep(null); setShowVocabulary(false); setShowOptions(false); router.setParams({ view: 'welcome' }); }} />
                <ActionButton label="Dictionary" text="Dictionary" icon="▤" compact onPress={() => { Keyboard.dismiss(); setShowVocabulary(true); }} />
                <ActionButton label={showOptions ? 'Hide options' : 'Options'} text="Options" icon={showOptions ? '×' : '☰'} compact onPress={() => setShowOptions((visible) => !visible)} />
              </View>
            </TutorialSpotlight>
            {showOptions ? <View style={[styles.teachingCard, styles.optionsExtension]}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Recognition options</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open model and accessibility settings"
                accessibilityHint="Shows recognition status, privacy details, and display settings"
                onPress={() => router.push('/settings')}
                onFocus={() => setFocusedControl('settings')}
                onBlur={() => setFocusedControl('')}
                style={({ pressed }) => [styles.settingsButton, focusedControl === 'settings' && styles.focused, pressed && styles.pressed]}>
                <Text style={styles.settingsText} aria-hidden>⚙ Settings</Text>
              </Pressable>
              <ActionButton label={showTrackingGuides ? 'Hide tracking guides' : 'Show tracking guides'} text={showTrackingGuides ? 'Hide tracking guides' : 'Show tracking guides'} icon={showTrackingGuides ? '◉' : '◎'} compact
                onPress={() => setShowTrackingGuides((visible) => !visible)} />
              {cameraIsReady && currentFrame ? <Text style={styles.trackingMeta}>
                Face {tracking.face} · Upper body {tracking.upperBody} · Hands {tracking.hands} · {Math.round(currentFrame.inferenceMs)} ms
              </Text> : null}
              <ActionButton label="Replay tutorial" text="Replay tutorial" icon="↻" compact disabled={sentence.recording || sentence.busy}
                onPress={() => { Keyboard.dismiss(); setShowOptions(false); setTutorialStep(0); }} />
              <View style={styles.controls}>
                <ActionButton label="Words" text="Words" icon="▤" variant={sentenceMode ? 'secondary' : 'primary'} compact
                  disabled={sentence.busy || sentence.recording} onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); setSentenceMode(false); }} />
                <ActionButton label="Sentences" text="Sentences" icon="≡" variant={sentenceMode ? 'primary' : 'secondary'} compact
                  disabled={recognizer.processing || lab.busy} onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); lab.discard(); setShowPersonalSigns(false); setSentenceMode(true); }} />
              </View>
              <Text style={styles.modelNoticeBody}>Recognition is experimental. Review your text before using it.</Text>
              <ActionButton label="Personal signs" text="Personal signs" icon="✎" compact disabled={lab.busy || !!lab.request || !!lab.pending || sentence.recording || sentence.busy}
                onPress={() => openPersonalSigns()} />
              <ActionButton label={showLab ? 'Close Recognition Lab' : 'Recognition Lab'} text={showLab ? 'Close Recognition Lab' : 'Recognition Lab'} compact
                disabled={showPersonalSigns}
                onPress={() => setShowLab((previous) => !previous)} />
              {showLab ? <RecognitionLab lab={lab} canRecord={wordActive && cameraIsReady && !recognizer.processing} /> : null}
            </View> : null}
          </View>

          <View testID="translation-workspace" style={[styles.workspace, wideLayout && styles.workspaceWide]}>
            <View style={styles.cameraColumn}>
              <View>{lab.request ? <Text accessibilityLiveRegion="polite" style={styles.modelNoticeBody}>Example: {lab.request.label ?? 'UNKNOWN'} · sign once, then tap Finish sign.</Text> : null}</View>
              <TutorialSpotlight step={tutorialStep === 0 ? 0 : null} cameraActive={camera.isActive} {...tutorialControls}>
                <View style={styles.cameraCard}>
                  <View style={[styles.cameraStage, { height: cameraHeight }]}>
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
                        {showTrackingGuides ? <LandmarkOverlay frame={currentFrame} mirrored={camera.facing === 'front'} /> : null}
                      </>
                    ) : (
                      <View style={styles.previewPlaceholder}>
                        <View style={styles.previewIcon}>
                          <View style={styles.previewLens} />
                          <View style={styles.previewShutter} />
                        </View>
                        <Text style={styles.previewTitle}>
                          {camera.session === 'paused' ? 'Session paused' : 'Ready to sign'}
                        </Text>
                        <Text style={styles.previewDescription}>
                          {camera.session === 'paused'
                            ? 'Resume when you are ready to use the camera again.'
                            : 'Start the camera when you’re ready.'}
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
                        onFocus={() => setFocusedControl('flip')}
                        onBlur={() => setFocusedControl('')}
                        style={({ pressed }) => [styles.flipButton, focusedControl === 'flip' && styles.focused, pressed && styles.pressed]}>
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

                  {cameraIsVisible ? <View style={styles.guidanceRow}>
                    <Text style={styles.guidanceText}>{cameraIsReady && currentFrame ? tracking.guidance : 'Preparing camera…'}</Text>
                  </View> : null}
                </View>

              </TutorialSpotlight>

              <TutorialSpotlight step={tutorialStep === 2 ? 2 : null} {...tutorialControls}>
                <View style={styles.suggestionsArea}>
                  {(!recognizer.candidates.length || !cameraIsReady || transcript.isEditing || recognizer.error || camera.error) ? <Text accessibilityLiveRegion="polite" style={styles.modelNoticeBody}>
                    {camera.error || (!sentenceMode && recognizer.error) || (transcript.isEditing
                      ? 'Recognition paused while you edit.'
                      : !cameraIsVisible ? 'Start the camera to sign.'
                        : !cameraIsReady ? 'Preparing camera…'
                          : sentenceMode ? 'One sentence draft; no alternative predictions.'
                            : recognizer.status !== 'loaded' ? 'Preparing the word model…'
                              : recognizer.message)}
                  </Text> : null}
                  {!sentenceMode && recognizer.candidates.length > 0 ? (
                    <View style={styles.suggestionChips}>
                      {recognizer.candidates.map((word) => <View key={word} style={styles.suggestionChoice}>
                        <ActionButton label={`Add ${word}`} text={word} singleLine
                          compact variant="secondary" onPress={() => recognizer.chooseCandidate(word)}
                          disabled={recognizer.processing || transcript.isEditing || !cameraIsReady} />
                      </View>)}
                    </View>
                  ) : null}

                </View>
              </TutorialSpotlight>

              <View style={styles.controls}>
                {camera.session === 'running' ? (
                  <>
                    {showOptions ? <ActionButton label="Pause camera" text="Pause camera" icon="Ⅱ" variant="primary"
                      disabled={sentenceMode && (sentence.recording || sentence.busy)} onPress={camera.pause} /> : null}
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
                {!sentenceMode ? <ActionButton label={recognizer.processing ? 'Reading sign…' : 'Finish sign'} icon={recognizer.processing ? '◌' : '✓'} variant="primary"
                  disabled={!cameraIsReady || (!lab.request && recognizer.status !== 'loaded') || recognizer.processing || transcript.isEditing}
                  onPress={recognizer.finishSign} /> : null}
              </View>

              <View>{showPersonalSigns ? <PersonalSignPanel key={personalFlowToken} lab={lab} initiallyAddWord={initiallyAddWord}
                onChooseDictionary={() => { Keyboard.dismiss(); setShowVocabulary(true); }} onSelectWord={openPersonalSigns}
                canRecord={wordActive && cameraIsReady && !recognizer.processing}
                onClose={() => { Keyboard.dismiss(); if (lab.request || lab.pending) lab.discard(); setShowPersonalSigns(false); }} /> : null}</View>

              {sentenceMode ? <View style={styles.teachingCard}>
                <Text style={styles.sectionTitle}>Translate a signed sentence</Text>
                <Text style={styles.modelNoticeBody}>Experimental · Record up to 12 seconds. Review the draft for errors.</Text>
                <View accessibilityLiveRegion="polite">
                  {sentence.busy ? <ActivityIndicator color={colors.teal} accessibilityLabel="Processing sentence offline" /> : null}
                  <Text style={styles.modelNoticeBody}>{sentence.message}</Text>
                </View>
                <ActionButton label={sentence.recording ? 'Stop & translate' : sentence.busy ? 'Working offline…' : 'Record sentence'}
                  icon={sentence.recording ? '■' : sentence.busy ? '◌' : '●'}
                  variant="primary" disabled={!cameraIsReady || transcript.isEditing || sentence.busy}
                  onPress={() => { if (sentence.recording) void sentence.finish(); else void sentence.start(); }} />
                {sentence.recording || sentence.busy ? <ActionButton label="Cancel sentence" icon="×" variant="secondary" onPress={sentence.cancel} /> : null}
                {sentence.draft ? <>
                  <Text style={styles.sectionTitle}>Translation draft</Text>
                  <TextInput multiline value={sentence.draft} onChangeText={sentence.editDraft}
                    accessibilityLabel="Review and edit sentence translation" style={styles.wordLabelInput} />
                  <ActionButton label="Add sentence to transcript" icon="+" variant="primary"
                    disabled={transcript.isEditing || !sentence.draft.trim()} onPress={() => {
                      transcript.appendWord(sentence.draft); sentence.clearDraft();
                    }} />
                  <ActionButton label="Discard draft" icon="⌫" variant="quiet" onPress={sentence.clearDraft} />
                </> : null}
              </View> : null}

            </View>
            <View style={styles.textColumn}>
              <TutorialSpotlight step={tutorialStep === 1 ? 1 : null} {...tutorialControls}>
                <View style={[styles.transcriptSection, highContrast && styles.highContrastBorder]}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={[styles.sectionTitle, largeText && styles.sectionTitleLarge]}>Recognized Text</Text>
                    </View>
                  </View>

                  <TextInput
                    accessibilityLabel={sentenceMode ? 'Sentence transcript' : 'Word transcript'}
                    accessibilityHint={sentenceMode ? 'Review the translation draft, then add it to this transcript.' : 'Select a suggestion to add a word. Transcription pauses while you edit.'}
                    multiline
                    textAlignVertical="top"
                    value={transcript.value}
                    onChangeText={transcript.update}
                    onFocus={() => { setFocusedControl('transcript'); transcript.beginEditing(); }}
                    onEndEditing={transcript.commitEditing}
                    onBlur={() => { setFocusedControl(''); transcript.commitEditing(); }}
                    placeholder="Your words appear here. You can also type."
                    placeholderTextColor={colors.inkSoft}
                    style={[styles.transcriptInput, highContrast && styles.highContrastBorder, focusedControl === 'transcript' && styles.focused, { minHeight: wideLayout ? 220 : 160, fontSize: textSize, lineHeight: textSize + 10, color: colors.ink }]}
                    maxLength={1200}
                    selectionColor={colors.teal}
                  />

                  {transcript.isEditing ? <ActionButton label="Done editing" text="Done editing" icon="✓" variant="secondary"
                    onPress={() => { Keyboard.dismiss(); transcript.commitEditing(); }} /> : null}

                  <View style={styles.transcriptActions}>
                    <ActionButton
                      label="Copy" text="Copy"
                      icon="▢"
                      variant="secondary"
                      compact
                      disabled={!transcript.value.trim()}
                      onPress={handleCopy}
                    />
                    <ActionButton
                      label="Clear" text="Clear"
                      icon="×"
                      variant="quiet"
                      compact
                      disabled={!transcript.value}
                      onPress={transcript.clear}
                    />
                  </View>
                </View>
              </TutorialSpotlight>
            </View>
          </View>
        </View>
      </ScrollView>

      {showVocabulary ? <DictionaryPanel words={dictionaryWords} onClose={() => setShowVocabulary(false)}
        onSelectWord={(word) => openPersonalSigns(word)} onAddWord={() => openPersonalSigns(undefined, true)}
        selectionDisabled={lab.busy || !!lab.request || !!lab.pending || sentence.recording || sentence.busy} /> : null}

      {feedback ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="status" style={styles.toast}>
          <Text style={styles.toastText}>{feedback}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  navigationGroup: { gap: 6 },
  optionsExtension: { width: '100%', maxWidth: 520, alignSelf: 'flex-end', borderTopRightRadius: 0 },
  workspace: { gap: 16 },
  workspaceWide: { flexDirection: 'row', alignItems: 'flex-start' },
  cameraColumn: { flex: 1, minWidth: 0, gap: 10 },
  textColumn: { flex: 1, minWidth: 0, gap: 10 },
  suggestionsArea: { gap: 8, paddingHorizontal: 2, paddingVertical: 4 },
  suggestionChoice: { flex: 1, minWidth: 0 },
  suggestionChips: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  focused: { outlineWidth: 3, outlineColor: colors.navy, outlineOffset: 3 },
  highContrastBorder: { borderColor: colors.ink },
  teachingCard: { padding: 17, borderRadius: 20, gap: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  wordLabelInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, color: colors.navy, fontSize: 16 },
  trackingMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 6 },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 14 },
  settingsButton: { minHeight: 48, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  settingsText: { color: colors.navy, fontSize: 15, fontWeight: '700' },
  cameraCard: { borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', gap: 8 },
  cameraStage: { borderRadius: 17, overflow: 'hidden', backgroundColor: colors.navy, position: 'relative' },
  previewPlaceholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  previewIcon: { width: 55, height: 42, borderRadius: 13, borderWidth: 2, borderColor: '#729099', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  previewLens: { width: 18, height: 18, borderRadius: 10, borderWidth: 2, borderColor: colors.accent },
  previewShutter: { position: 'absolute', top: -6, width: 14, height: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#729099' },
  previewTitle: { color: colors.white, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  previewDescription: { color: '#B7C8C9', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 250 },
  cameraTopline: { position: 'absolute', zIndex: 2, top: 11, left: 11, right: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cameraStatusPill: { height: 31, paddingHorizontal: 11, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(12, 27, 40, 0.82)' },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A9BBC0' },
  statusDotLive: { backgroundColor: colors.accent },
  cameraStatusText: { color: colors.white, fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  flipButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12, 27, 40, 0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)' },
  flipButtonText: { color: colors.white, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  cameraError: { position: 'absolute', zIndex: 3, top: '35%', left: 33, right: 33, padding: 14, borderRadius: 16, backgroundColor: 'rgba(22, 38, 49, 0.94)', gap: 5 },
  cameraErrorTitle: { color: colors.white, fontSize: 15, fontWeight: '800' },
  cameraErrorText: { color: '#D2DDDF', fontSize: 12, lineHeight: 17 },
  guidanceRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingBottom: 8 },
  guidanceText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modelNoticeBody: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  transcriptSection: { borderRadius: 18, padding: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: 12 },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.navy, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  sectionTitleLarge: { fontSize: 23 },
  transcriptInput: { maxHeight: 360, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.field, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 13, lineHeight: 27 },
  transcriptActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  toast: { position: 'absolute', bottom: 18, left: 22, right: 22, alignSelf: 'center', maxWidth: 520, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, backgroundColor: colors.navy, shadowColor: colors.navy, shadowOpacity: 0.16, shadowRadius: 12, elevation: 5 },
  toastText: { color: colors.white, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.76 },
}); 


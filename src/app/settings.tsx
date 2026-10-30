import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/palette';
import { ModelStatusService } from '@/services/model-status';
import { useAccessibilitySettings } from '@/state/accessibility-settings';

const status = ModelStatusService.getStatus();

export default function SettingsScreen() {
  const { largeText, highContrast, setLargeText, setHighContrast } = useAccessibilitySettings();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backGlyph} aria-hidden>‹</Text>
          </Pressable>
          <View>
            <Text style={styles.eyebrow}>SIGNBRIDGE</Text>
            <Text style={styles.title}>Model & settings</Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusGlyph}><Text style={styles.statusGlyphText}>{status.ready ? '✓' : '—'}</Text></View>
            <View style={styles.statusCopy}>
              <Text style={styles.cardEyebrow}>RECOGNITION STATUS</Text>
              <Text style={styles.statusTitle}>{status.supportedSigns.length.toLocaleString()} word entries bundled</Text>
            </View>
            <View style={[styles.statusTag, status.ready && styles.statusTagReady]}>
              <Text style={[styles.statusTagText, status.ready && styles.statusTagTextReady]}>EXPERIMENTAL</Text>
            </View>
          </View>
          <Text style={styles.bodyText}>{status.message}</Text>
          <View style={styles.separator} />
          <InfoRow label="Model version" value={status.version ?? 'None'} />
          <InfoRow label="Vocabulary" value={`${status.supportedSigns.length.toLocaleString()} supported entries`} />
          <InfoRow label="Output" value="Reviewable words & sentence drafts" />
          <InfoRow label="Tracking" value="Hands · face · shoulders & arms" />
          <InfoRow label="Sentence translation" value="Experimental · fully offline" />
          <Text style={styles.scopeNote}>
            One 500-word dictionary is available. Sign one word at a time with your shoulders visible, then lower both hands and pause or tap Finish sign. Choose a suggestion to add it to the text. Personal signs can add your version of a Dictionary word or a new word from three examples, regardless of model guesses. Recognition Lab compares results on separate test recordings. Live camera accuracy has not been measured.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Accessibility</Text>
          <Text style={styles.bodyText}>Adjust the reading experience for this session.</Text>
          <SettingSwitch
            label="Larger transcript text"
            description="Increase the transcript and heading size."
            value={largeText}
            onValueChange={setLargeText}
          />
          <View style={styles.separator} />
          <SettingSwitch
            label="Higher contrast transcript"
            description="Use darker text in the introduction and transcript."
            value={highContrast}
            onValueChange={setHighContrast}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy</Text>
          <Text style={styles.bodyText}>
            Translator camera buffers and sign recognition are processed on-device. Recognition Lab saves landmark features locally only when you tap Save example. In video calls, your live camera and any enabled microphone audio are shared with your guest. Shared captions travel over the call’s encrypted data channel; landmark data stays on your phone. Microphone access is optional and requested when you enable it. SignBridge does not record calls or keep transcript history.
          </Text>
          <View style={styles.privacyPill}>
            <View style={styles.privacyDot} />
            <Text style={styles.privacyPillText}>LOCAL SIGN RECOGNITION · PRIVATE CALLS</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About isolated word recognition</Text>
          <Text style={styles.bodyText}>
            Expanded recognition combines the 2,731 ASL Citizen sign classes with the 2,000 WLASL classes, deduplicating variants and overlaps into word entries. Capture now preserves the beginning and ending of a sign. Suggestions prioritize ASL Citizen for its MediaPipe-trained vocabulary; the experimental OpenPose adapter can suggest additional WLASL-only words and strong shared-word alternatives. Recorded-pose checks improved, but every suggestion still needs your review. Sentence mode uses a separate trained T5 pose-to-English model and needs no pauses between words. Review sentence drafts before use. Live word and sentence accuracy still need validation.
          </Text>
          <Text style={styles.nextStep}>
            Full ASL needs a trained and evaluated sequence model for a defined vocabulary, continuous sign boundaries, nonmanual grammar and translation. A list of matched word labels is not grammatical translation.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function SettingSwitch({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{label}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.line, true: colors.accent }}
        thumbColor={value ? colors.teal : colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 13, paddingBottom: 32, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  backButton: { width: 43, height: 43, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: colors.navy, fontSize: 32, lineHeight: 34, marginTop: -3 },
  eyebrow: { color: colors.teal, fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 3 },
  title: { color: colors.navy, fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4 },
  card: { borderRadius: 20, padding: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, gap: 10 },
  statusCard: { borderRadius: 20, padding: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.warmCard, gap: 11 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusGlyph: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  statusGlyphText: { color: colors.ochre, fontSize: 18, fontWeight: '800' },
  statusCopy: { flex: 1, gap: 3 },
  cardEyebrow: { color: colors.inkMuted, fontSize: 9, letterSpacing: 1.1, fontWeight: '800' },
  statusTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  statusTag: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  statusTagReady: { backgroundColor: colors.mintSoft },
  statusTagText: { color: colors.ochre, fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  statusTagTextReady: { color: colors.tealDeep },
  bodyText: { color: colors.inkSoft, fontSize: 13, lineHeight: 20 },
  separator: { height: 1, backgroundColor: colors.line, marginVertical: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { color: colors.inkSoft, fontSize: 12 },
  infoValue: { color: colors.navy, fontSize: 12, fontWeight: '700' },
  alphabetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  letterChip: { minWidth: 28, height: 29, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: colors.line },
  letterChipText: { color: colors.tealDeep, fontSize: 11, fontWeight: '800' },
  scopeNote: { color: colors.inkSoft, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 12, padding: 11, fontSize: 12, lineHeight: 18 },
  cardTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  settingCopy: { flex: 1, gap: 3 },
  settingTitle: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  settingDescription: { color: colors.inkSoft, fontSize: 11, lineHeight: 16 },
  privacyPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.mintSoft },
  privacyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.teal },
  privacyPillText: { color: colors.tealDeep, fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  nextStep: { marginTop: 1, color: colors.tealDeep, fontSize: 12, lineHeight: 19, fontWeight: '700' },
  pressed: { opacity: 0.76 },
}); 


import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from './action-button';
import { colors } from '@/constants/palette';
import type { useRecognitionExamples } from '@/state/use-recognition-examples';

type Props = { lab: ReturnType<typeof useRecognitionExamples>; canRecord: boolean };
const percentage = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

export function RecognitionLab({ lab, canRecord }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [focused, setFocused] = useState('');
  const locked = lab.busy || !!lab.request || !!lab.pending;
  const button = (label: string, onPress: () => void, disabled = false) => <ActionButton key={label} label={label} text={label} compact onPress={onPress} disabled={disabled} />;
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>Recognition Lab</Text>
    <Text style={styles.body}>Record the word you intend to sign. Save three examples per gesture version, then record fresh tests in a separate session. Personal learning supports eight versions.</Text>
    <TextInput accessibilityLabel="Expected sign" placeholder="Word or personal sign (e.g. HELLO)" placeholderTextColor={colors.inkSoft}
      autoCorrect={false} autoCapitalize="characters" value={lab.label} onChangeText={lab.setLabel} editable={!locked}
      onFocus={() => setFocused('label')} onBlur={() => setFocused('')} style={[styles.input, focused === 'label' && styles.focused]} />
    <TextInput accessibilityLabel="Signer nickname" placeholder="Signer nickname" placeholderTextColor={colors.inkSoft}
      autoCorrect={false} autoCapitalize="none" maxLength={60} value={lab.signer} onChangeText={lab.setSigner} editable={!locked}
      onFocus={() => setFocused('signer')} onBlur={() => setFocused('')} style={[styles.input, focused === 'signer' && styles.focused]} />
    <View style={styles.row}>
      <ActionButton label="Training examples" text="Training" compact variant={lab.split === 'train' ? 'primary' : 'secondary'} disabled={locked} onPress={() => lab.changeSplit('train')} />
      <ActionButton label="Test examples" text="Test" compact variant={lab.split === 'test' ? 'primary' : 'secondary'} disabled={locked} onPress={() => lab.changeSplit('test')} />
      {button('New session', lab.newSession, locked)}
    </View>
    {lab.split === 'test' ? <Text style={styles.body}>Use UNKNOWN to test an unsupported sign or ordinary movement. Three guesses still appear; they are not confirmed recognition.</Text> : null}
    <View style={styles.row}>
      {lab.request ? button('Cancel recording', lab.cancel) : button('Record example', lab.arm, !canRecord || !lab.loaded || locked)}
      {lab.pending ? <>{button('Save example', () => void lab.save(), lab.busy)}{button('Discard', lab.discard, lab.busy)}</> : null}
    </View>
    {!canRecord ? <Text style={styles.body}>Start the camera in Words mode to record.</Text> : null}
    {lab.pending ? <View style={styles.detail}>
      {lab.saveError ? <Text accessibilityRole="alert" style={styles.body}>{lab.saveError}</Text> : null}
      <Text style={styles.body}>Expected: {lab.pending.label ?? 'UNKNOWN'} · {lab.pending.split}</Text>
      <Text style={styles.body}>Model: {lab.pending.baseline.length ? lab.pending.baseline.join(' · ') : 'No prediction — your chosen word is still recorded.'}</Text>
      {lab.pending.evidence ? <>
        <Text style={styles.body}>Primary: {lab.pending.evidence.primary.join(' · ')}</Text>
        <Text style={styles.body}>Mirrored: {lab.pending.evidence.mirrored.join(' · ')}</Text>
        <Text style={styles.body}>Secondary: {lab.pending.evidence.secondary.join(' · ')}</Text>
      </> : null}
      <Text style={styles.body}>{lab.pending.diagnostics.fps.toFixed(1)} fps · longest gap {Math.round(lab.pending.diagnostics.maxGapMs)} ms · hands {percentage(lab.pending.diagnostics.handCoverage)} · face {percentage(lab.pending.diagnostics.faceCoverage)}</Text>
    </View> : null}
    <Text style={styles.body}>{lab.dataset.examples.filter((e) => e.split === 'train').length} training · {lab.dataset.examples.filter((e) => e.split === 'test').length} test examples saved</Text>
    {lab.ranker ? <Text style={styles.body}>Personal signs for {lab.ranker.signer}: {[...new Set(lab.ranker.calibration.map((entry) => entry.label))].join(', ')}</Text> : null}
    <View style={styles.row}>
      {button('Learn examples', () => void lab.train(), locked || !lab.loaded)}
      {button('Run test', () => void lab.evaluate(), locked || !lab.loaded)}
      {button(lab.enabled ? 'Personal learning: on' : 'Personal learning: off', lab.toggle, locked || !lab.ranker)}
    </View>
    {lab.report ? <View style={styles.detail}>
      <Text style={styles.body}>{lab.report.known} labeled tests · {lab.report.unknown} unknown gestures · {lab.report.unseenSigner} tests from unseen signers</Text>
      <Text style={styles.body}>First choice: baseline {percentage(lab.report.baselineTop1)} → personal {percentage(lab.report.personalTop1)}</Text>
      <Text style={styles.body}>In three choices: baseline {percentage(lab.report.baselineTop3)} → personal {percentage(lab.report.personalTop3)}</Text>
      <Text style={styles.body}>{lab.report.improved} improved · {lab.report.regressed} regressed · {lab.report.unknownPromotions} changed guesses for unknown gestures</Text>
      {lab.report.confusions.slice(0, 5).map((c) => <Text key={`${c.expected}-${c.predicted}`} style={styles.body}>{c.expected} → {c.predicted}: {c.count}</Text>)}
    </View> : null}
    <View style={styles.row}>
      {button('Export examples', () => void lab.export(), locked || !lab.dataset.examples.length)}
      {button('Remove last', () => void lab.removeLast(), locked || !lab.dataset.examples.length)}
      {button(confirmDelete ? 'Confirm delete all' : 'Delete all', () => { if (confirmDelete) { void lab.clear(); setConfirmDelete(false); } else setConfirmDelete(true); }, locked)}
      {confirmDelete ? button('Keep examples', () => setConfirmDelete(false)) : null}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{lab.busy ? 'Working…' : lab.notice}</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, borderTopWidth: 1, borderColor: colors.line, paddingTop: 16 },
  title: { color: colors.navy, fontSize: 19, fontWeight: '700' },
  body: { color: colors.inkSoft, fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { backgroundColor: colors.field, padding: 12, borderRadius: 12, gap: 6 },
  input: { color: colors.navy, fontSize: 17, minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.inkSoft, borderRadius: 12, backgroundColor: colors.white },
  focused: { outlineWidth: 3, outlineColor: colors.navy, outlineOffset: 3 },
});

import { useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from './action-button';
import { colors } from '@/constants/palette';
import { RECOGNITION_WORD_LABELS, wordKey } from '@/recognition/expanded-vocabulary';
import { exampleLabel, MAX_TRAINING_EXAMPLES, personalVariantKey } from '@/recognition/recognition-examples';
import type { useRecognitionExamples } from '@/state/use-recognition-examples';

type Props = { lab: ReturnType<typeof useRecognitionExamples>; canRecord: boolean; onClose: () => void;
  onChooseDictionary: () => void; onSelectWord: (word?: string) => void; initiallyAddWord: boolean };

export function PersonalSignPanel({ lab, canRecord, onClose, onChooseDictionary, onSelectWord, initiallyAddWord }: Props) {
  const [addingWord, setAddingWord] = useState(initiallyAddWord);
  const [newWord, setNewWord] = useState('');
  const [recordingVersion, setRecordingVersion] = useState(false);
  const [focused, setFocused] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const locked = lab.busy || !!lab.request || !!lab.pending;
  const label = lab.variantLabel;
  const selected = !!lab.variantId && !!label;
  const ready = lab.variantCount >= 3;
  const learned = ready && lab.enabled && lab.ranker?.signer === lab.signer.trim()
    && lab.ranker.calibration.some((entry) => entry.variant === personalVariantKey(label!, lab.variantId!));
  const personalWords = [...new Set(lab.savedVariants.map((v) => v.label))].sort();
  const normalizedNewWord = exampleLabel(newWord);
  const existing = normalizedNewWord ? [...RECOGNITION_WORD_LABELS, ...personalWords].find((word) => wordKey(word) === wordKey(normalizedNewWord)) : undefined;
  const versions = lab.savedVariants.filter((v) => v.label === label);
  const atCapacity = lab.savedVariants.length >= MAX_TRAINING_EXAMPLES / 3;
  return <View style={styles.panel}>
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>Personal signs</Text>
      <ActionButton label="Close Personal signs" icon="×" compact disabled={lab.busy} onPress={onClose} />
    </View>
    {!selected ? <>
      <Text style={styles.body}>Choose a word, then teach your version of its sign.</Text>
      <View style={styles.row}>
        <ActionButton label="Choose Dictionary word" text="Choose Dictionary word" compact onPress={onChooseDictionary} disabled={locked} />
        <ActionButton label="Add new word" text="Add new word" compact onPress={() => setAddingWord(true)} disabled={locked} />
      </View>
      {addingWord ? <>
        <Text style={styles.body}>You choose the meaning. Name the gesture you want to teach, then record it the same way three times. It does not need to be in Dictionary or recognized by the app.</Text>
        <TextInput accessibilityLabel="New personal word" placeholder="Word or short phrase" placeholderTextColor={colors.inkSoft}
          value={newWord} onChangeText={setNewWord} maxLength={40} autoCorrect={false} autoCapitalize="characters" editable={!locked}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.input, focused && styles.focused]} />
        <ActionButton label="Use this word" text={existing ? `Use existing ${existing}` : 'Use this word'} compact variant="primary"
          disabled={locked || !normalizedNewWord} onPress={() => { Keyboard.dismiss(); onSelectWord(existing ?? normalizedNewWord!); }} />
      </> : null}
      {personalWords.length ? <View style={styles.row}>{personalWords.map((word) => <ActionButton key={word} label={`Choose personal word ${word}`} text={word}
        compact disabled={locked} onPress={() => onSelectWord(word)} />)}</View> : null}
    </> : <>
      <Text style={styles.word}>{label}</Text>
      <Text style={styles.body}>Your gesture versions all produce “{label}”. Previous versions are kept. The model’s guesses do not change the meaning you choose.</Text>
      {atCapacity && !lab.variantCount ? <Text style={styles.body}>Eight versions are saved. Remove a saved version to make room.</Text> : null}
      {!recordingVersion ? <ActionButton label="Teach my version" text="Teach my version" compact variant="primary" disabled={locked || !lab.loaded || atCapacity}
        onPress={() => setRecordingVersion(true)} /> : <>
        <Text accessibilityLiveRegion="polite" style={styles.body}>{Math.min(3, lab.variantCount)} of 3 examples saved for this version</Text>
        {lab.request ? <Text style={styles.body}>Sign {label} in the camera above, then tap Finish sign.</Text> : null}
        {lab.pending ? <Text style={styles.body}>Save this recording as your gesture for “{label}”. The app does not judge whether the sign is correct.</Text> : null}
        {lab.pending && lab.saveError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{lab.saveError}</Text> : null}
        {!canRecord && !lab.pending && !ready ? <Text style={styles.body}>Start the camera in Words mode and wait for recognition to be ready.</Text> : null}
        <View style={styles.row}>
          {!ready && !lab.pending && !lab.request ? <ActionButton label="Record version example" text={`Record example ${lab.variantCount + 1}`} icon="●" compact variant="primary"
            disabled={!canRecord || !lab.loaded || lab.busy} onPress={() => { Keyboard.dismiss(); lab.arm(); }} /> : null}
          {lab.request ? <ActionButton label="Cancel version recording" text="Cancel recording" compact onPress={lab.cancel} /> : null}
          {lab.pending ? <>
            <ActionButton label="Save version example" text="Save example" compact variant="primary" disabled={lab.busy} onPress={() => void lab.save()} />
            <ActionButton label="Discard version example" text="Discard" compact disabled={lab.busy} onPress={lab.discard} />
          </> : null}
          {ready && !learned ? <ActionButton label="Save and use this version" text="Save & use this version" compact variant="primary" disabled={lab.busy}
            onPress={() => void lab.activateVariant()} /> : null}
          {learned ? <ActionButton label="Done personalizing" text="Done — try your sign" compact variant="primary" onPress={onClose} /> : null}
        </View>
      </>}
      <View style={styles.row}>
        <ActionButton label="Choose another word" text="Choose another word" compact disabled={locked} onPress={() => onSelectWord()} />
        {learned ? <ActionButton label="Add another version" text="Add another version" compact disabled={locked} onPress={() => onSelectWord(label!)} /> : null}
      </View>
      {versions.length ? <View style={styles.versions}>
        <Text style={styles.body}>{versions.length} saved {versions.length === 1 ? 'version' : 'versions'} of {label}</Text>
        {versions.map((v, i) => <ActionButton key={v.id} label={removeId === v.id ? `Confirm remove version ${i + 1}` : `Remove version ${i + 1}`}
          text={removeId === v.id ? `Confirm remove version ${i + 1}` : `Remove version ${i + 1}`} compact disabled={locked}
          onPress={() => { if (removeId === v.id) { void lab.forgetVariant(v.id); setRemoveId(null); } else setRemoveId(v.id); }} />)}
        {!lab.enabled ? <ActionButton label="Use saved versions" text="Use saved versions" compact disabled={locked} onPress={() => void lab.activateSavedVariants()} /> : null}
      </View> : null}
    </>}
    <Text accessibilityLiveRegion="polite" style={styles.body}>{lab.busy ? 'Saving or learning…' : !lab.loaded ? 'Loading your examples…' : lab.notice}</Text>
    <Text style={styles.hint}>Eight gesture versions total. Examples stay on this device. Review every suggestion.</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 18, gap: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { flexGrow: 2, color: colors.navy, fontSize: 21, fontWeight: '700' },
  word: { color: colors.navy, fontSize: 24, fontWeight: '700' },
  body: { color: colors.inkSoft, fontSize: 16, lineHeight: 23 },
  hint: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 16, lineHeight: 23 },
  input: { color: colors.navy, backgroundColor: colors.field, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.inkSoft, padding: 12, fontSize: 18 },
  focused: { outlineWidth: 3, outlineColor: colors.navy, outlineOffset: 3 },
  versions: { gap: 8 },
});

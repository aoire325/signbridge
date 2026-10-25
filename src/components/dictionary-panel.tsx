import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { colors } from '@/constants/palette';

type Props = { words: readonly string[]; onClose: () => void };

export function DictionaryPanel({ words, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return words.filter((word) => word.toLocaleLowerCase().includes(search));
  }, [query, words]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.panel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>Dictionary</Text>
            <ActionButton label="Close Dictionary" icon="×" compact onPress={onClose} />
          </View>
          <TextInput accessibilityLabel="Search Dictionary" placeholder="Search words" placeholderTextColor={colors.inkSoft}
            value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none"
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={[styles.search, focused && styles.focused]} />
          <Text accessibilityLiveRegion="polite" style={styles.count}>{matches.length.toLocaleString()} {matches.length === 1 ? 'word' : 'words'}</Text>
          <FlatList data={matches} keyExtractor={(word) => word} keyboardShouldPersistTaps="handled"
            initialNumToRender={20} maxToRenderPerBatch={20}
            renderItem={({ item }) => <Text selectable style={styles.word}>{item}</Text>}
            ListEmptyComponent={<Text style={styles.empty}>No matching words.</Text>} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(22,38,49,0.5)', padding: 16 },
  panel: { width: '100%', maxWidth: 640, height: '90%', backgroundColor: colors.white, borderRadius: 24, padding: 20, gap: 14 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  title: { flexGrow: 2, color: colors.navy, fontSize: 26, fontWeight: '800' },
  search: { minHeight: 52, borderWidth: 1, borderColor: colors.inkSoft, borderRadius: 14, padding: 14, fontSize: 18, color: colors.navy, backgroundColor: colors.field },
  focused: { outlineWidth: 3, outlineColor: colors.navy, outlineOffset: 3 },
  count: { color: colors.inkSoft, fontSize: 14 },
  word: { color: colors.navy, fontSize: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  empty: { color: colors.inkSoft, fontSize: 16, paddingVertical: 20 },
});

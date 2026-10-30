import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

type Props = { label: string; icon: SymbolViewProps['name']; onPress: () => void;
  active?: boolean; danger?: boolean; disabled?: boolean; hint?: string };

/** Compact visual controls retain full labels and 48-point touch targets. */
export function CallIconButton({ label, icon, onPress, active, danger, disabled, hint }: Props) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ disabled: !!disabled, ...(active !== undefined ? { selected: active } : {}) }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, active && styles.active,
      danger && styles.danger, disabled && styles.disabled, pressed && styles.pressed]}>
    <SymbolView name={icon} size={23} tintColor={active && !danger ? '#102831' : '#FFFFFF'} accessible={false} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#263E49', borderWidth: 1, borderColor: '#405762' },
  active: { backgroundColor: '#B8E5D5', borderColor: '#B8E5D5' }, danger: { backgroundColor: '#C24757', borderColor: '#C24757' },
  disabled: { opacity: 0.4 }, pressed: { opacity: 0.65 },
});

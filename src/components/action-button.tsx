import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/palette';

type Variant = 'primary' | 'secondary' | 'quiet';

type ActionButtonProps = {
  label: string;
  icon?: string;
  variant?: Variant;
  compact?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
};

export function ActionButton({
  label,
  icon,
  variant = 'secondary',
  compact = false,
  disabled = false,
  onPress,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {icon ? <Text style={[styles.icon, variant === 'primary' && styles.primaryText]} aria-hidden>{icon}</Text> : null}
      <Text style={[styles.label, variant === 'primary' && styles.primaryText, variant === 'quiet' && styles.quietText]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 48, borderRadius: 15, paddingHorizontal: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  compact: { minHeight: 43, paddingHorizontal: 10, borderRadius: 13 },
  primary: { backgroundColor: colors.teal },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  quiet: { backgroundColor: colors.field, borderWidth: 1, borderColor: colors.line },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  icon: { color: colors.tealDeep, fontSize: 14, fontWeight: '800' },
  label: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  primaryText: { color: colors.white },
  quietText: { color: colors.inkSoft },
}); 


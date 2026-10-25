import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/palette';

type Variant = 'primary' | 'secondary' | 'quiet' | 'dark';

type ActionButtonProps = {
  label: string;
  icon?: string;
  text?: string;
  singleLine?: boolean;
  variant?: Variant;
  compact?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
};

export function ActionButton({
  label,
  icon,
  text,
  singleLine = false,
  variant = 'secondary',
  compact = false,
  disabled = false,
  onPress,
}: ActionButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        variant === 'primary' && styles.primary,
        variant === 'dark' && styles.dark,
        variant === 'secondary' && styles.secondary,
        variant === 'quiet' && styles.quiet,
        focused && !disabled && styles.focused,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {icon ? <Text style={[styles.icon, variant === 'dark' && styles.primaryText]} aria-hidden>{icon}</Text> : null}
      {text ? <Text
        numberOfLines={singleLine ? 1 : undefined}
        adjustsFontSizeToFit={singleLine}
        minimumFontScale={0.8}
        ellipsizeMode="tail"
        style={[styles.text, singleLine && styles.singleLineText, variant === 'dark' && styles.primaryText]}>{text}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 48, minHeight: 48, paddingVertical: 10, borderRadius: 15, paddingHorizontal: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  compact: { minHeight: 48, paddingHorizontal: 10, borderRadius: 13 },
  primary: { backgroundColor: colors.accent },
  dark: { backgroundColor: colors.navy },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  quiet: { backgroundColor: colors.field, borderWidth: 1, borderColor: colors.line },
  disabled: { opacity: 0.42 },
  focused: { outlineWidth: 3, outlineColor: colors.navy, outlineOffset: 3 },
  pressed: { opacity: 0.78 },
  icon: { color: colors.navy, fontSize: 24, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  text: { color: colors.navy, fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  singleLineText: { flex: 1, minWidth: 0, fontSize: 14 },
  primaryText: { color: colors.white },
}); 


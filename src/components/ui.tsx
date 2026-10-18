import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}>
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' ? Colors.brand : Colors.surface}
        />
      )}
      <Text
        style={[
          styles.buttonLabel,
          variant === 'secondary' && styles.buttonLabelSecondary,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function IconButton({
  onPress,
  accessibilityLabel,
  children,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.iconButtonPressed,
      ]}>
      {children}
    </Pressable>
  );
}

/** Width ÷ height of the Heft lockup; the asset is cropped tight to the ink. */
const WORDMARK_ASPECT = 1698 / 652;

/**
 * The Heft lockup (gauge mark plus wordmark) shown as the dashboard title.
 *
 * The source artwork is flat colour on opaque white, so it was keyed to
 * transparency against its own palette. The white inside the mark — the ring
 * and the "h" — is genuinely opaque rather than punched out, so the lockup
 * still reads if it ever lands on a dark surface.
 *
 * `wordmark.png` ships @1x/@2x/@3x, so the platform picks a bitmap already at
 * the size it paints. A single tall bitmap resampled at draw time is what made
 * the ring and the letterforms go soft.
 */
export function Wordmark({ height = 32 }: { height?: number }) {
  return (
    <Image
      source={require('../../assets/images/wordmark.png')}
      style={{ width: Math.round(height * WORDMARK_ASPECT), height }}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Heft"
    />
  );
}

/** Side length `GearIcon` is drawn at; any other size scales from these ratios. */
const GEAR_SIZE = 22;

/**
 * A settings cog drawn from plain Views, so the app needs no icon font, asset
 * or native module for its one icon.
 *
 * Eight stubby teeth are each rotated around the centre and then pushed
 * outwards by a `translateY` applied *after* the rotation, so every tooth
 * lands on its own radius instead of a bar crossing the middle. With nothing
 * running through the centre the ring can stay a hollow outline, leaving a
 * genuinely transparent hole that needs no knowledge of the colour behind it.
 */
export function GearIcon({
  size = GEAR_SIZE,
  color = Colors.text,
}: {
  size?: number;
  color?: string;
}) {
  const scale = size / GEAR_SIZE;
  const toothWidth = 3.4 * scale;
  const toothLength = 5 * scale;
  const toothRadius = 7.7 * scale;
  const ringSize = 15.4 * scale;
  const ringBorder = 3.2 * scale;

  return (
    <View style={{ width: size, height: size }}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            left: (size - toothWidth) / 2,
            top: (size - toothLength) / 2,
            width: toothWidth,
            height: toothLength,
            borderRadius: toothWidth / 2,
            backgroundColor: color,
            transform: [{ rotate: `${angle}deg` }, { translateY: -toothRadius }],
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          left: (size - ringSize) / 2,
          top: (size - ringSize) / 2,
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: ringBorder,
          borderColor: color,
        }}
      />
    </View>
  );
}

export function Screen({
  children,
  style,
  edges = ['top', 'left', 'right'],
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function Title({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Description({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.description, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  button: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: Colors.brand,
    paddingVertical: 16,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: Colors.brand,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.brand,
  },
  buttonDanger: {
    backgroundColor: Colors.danger,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonLabelSecondary: {
    color: Colors.brand,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  iconButtonPressed: {
    opacity: 0.55,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  description: {
    color: Colors.textSecondary,
    lineHeight: 22,
  },
});

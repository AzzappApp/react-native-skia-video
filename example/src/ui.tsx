import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing, switchColors } from './theme';

/**
 * The few controls the example's screens are made of, in the app's theme
 * (see theme.ts).
 */

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'caption' | 'mono';

export const AppText = ({
  variant = 'body',
  style,
  ...props
}: TextProps & { variant?: TextVariant }) => (
  <Text {...props} style={[textStyles[variant], style]} />
);

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  compact = false,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Smaller paddings, for buttons in a row or a header. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.button,
      compact && styles.buttonCompact,
      buttonStyles[variant],
      pressed && pressedButtonStyles[variant],
      disabled && styles.disabled,
      style,
    ]}
  >
    <Text
      style={[
        styles.buttonLabel,
        compact && styles.buttonLabelCompact,
        { color: buttonLabelColors[variant] },
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

/** A choice among a few, shown in a row (see ChipGroup). */
export const Chip = ({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityState={{ selected, disabled }}
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.chip,
      selected && styles.chipSelected,
      pressed && !selected && styles.chipPressed,
      disabled && styles.disabled,
    ]}
  >
    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
      {label}
    </Text>
  </Pressable>
);

/** Chips for the values of `options`, one of them selected. */
export const ChipGroup = <T extends string | number>({
  options,
  value,
  onChange,
  format = String,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
  disabled?: boolean;
}) => (
  <View style={styles.wrapRow} accessibilityRole="radiogroup">
    {options.map((option) => (
      <Chip
        key={option}
        label={format(option)}
        selected={option === value}
        onPress={() => onChange(option)}
        disabled={disabled}
      />
    ))}
  </View>
);

export const Card = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) => <View style={[styles.card, style]}>{children}</View>;

/** A small label, e.g. a requirement next to a title. */
export const Tag = ({
  label,
  tone = 'accent',
}: {
  label: string;
  tone?: 'accent' | 'warning' | 'muted';
}) => (
  <View style={[styles.tag, tagStyles[tone]]}>
    <Text style={[styles.tagLabel, { color: tagLabelColors[tone] }]}>
      {label}
    </Text>
  </View>
);

export const ProgressBar = ({ progress }: { progress: number }) => (
  <View style={styles.progressTrack}>
    <View
      style={[
        styles.progressFill,
        { width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` },
      ]}
    />
  </View>
);

/** A label and a switch, side by side. */
export const ToggleRow = ({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) => (
  <View style={styles.row}>
    <AppText style={styles.grow}>{label}</AppText>
    <Switch
      {...switchColors}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    />
  </View>
);

/** A spinner with a line of text under it. */
export const Loading = ({ label }: { label: string }) => (
  <View style={styles.loading}>
    <ActivityIndicator size="large" color={colors.accent} />
    <AppText variant="muted" style={styles.center}>
      {label}
    </AppText>
  </View>
);

/** A scrolling screen, padded, clear of the home indicator. */
export const Screen = ({
  children,
  contentStyle,
}: {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.screenContent,
        {
          paddingLeft: spacing.lg + insets.left,
          paddingRight: spacing.lg + insets.right,
          paddingBottom: spacing.xl + insets.bottom,
        },
        contentStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
};

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  grow: {
    flex: 1,
  },
  center: {
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonLabelCompact: {
    fontSize: 14,
  },
  disabled: {
    opacity: 0.4,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipPressed: {
    borderColor: colors.textMuted,
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: colors.accent,
  },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tagLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
});

const textStyles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heading: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  mono: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
});

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSoft },
});

const pressedButtonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.border },
  ghost: { backgroundColor: colors.surfaceRaised },
  danger: { backgroundColor: 'rgba(248, 113, 113, 0.24)' },
});

const buttonLabelColors: Record<ButtonVariant, string> = {
  primary: colors.onAccent,
  secondary: colors.text,
  ghost: colors.accent,
  danger: colors.danger,
};

const tagStyles = StyleSheet.create({
  accent: { backgroundColor: colors.accentSoft },
  warning: { backgroundColor: colors.warningSoft },
  muted: { backgroundColor: colors.surfaceRaised },
});

const tagLabelColors = {
  accent: colors.accent,
  warning: colors.warning,
  muted: colors.textMuted,
} as const;

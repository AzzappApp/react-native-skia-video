import { Platform } from 'react-native';
import { DarkTheme, type Theme } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

/**
 * The example app's theme: dark, with the teal accent of the documentation
 * site (docs/src/css/custom.css), so that the app and the docs look alike.
 */
export const colors = {
  background: '#0A0E14',
  surface: '#141A24',
  surfaceRaised: '#1C2431',
  border: '#253042',
  text: '#E6EDF3',
  textMuted: '#8B98A9',
  accent: '#2DD4BF',
  accentPressed: '#1FB7A4',
  accentSoft: 'rgba(45, 212, 191, 0.14)',
  // Text drawn on the accent.
  onAccent: '#04221E',
  // A second hue for gradients, next to the teal.
  violet: '#8B5CF6',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251, 191, 36, 0.14)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
} as const;

/** The navigation theme: dark headers and screens in the app's colors. */
export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

/** The headers of every stack of the app. */
export const screenOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.accent,
  headerTitleStyle: { color: colors.text },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
};

/** Colors of the sliders (@react-native-community/slider). */
export const sliderColors = {
  minimumTrackTintColor: colors.accent,
  maximumTrackTintColor: colors.border,
  thumbTintColor: Platform.OS === 'android' ? colors.accent : undefined,
} as const;

/** Colors of the switches. */
export const switchColors = {
  trackColor: { false: colors.border, true: colors.accent },
  thumbColor: Platform.OS === 'android' ? colors.text : undefined,
  ios_backgroundColor: colors.border,
} as const;

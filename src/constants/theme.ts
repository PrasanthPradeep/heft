export const Colors = {
  brand: '#067D52',
  brandDark: '#065B3A',
  brandTint: '#E4F3EC',
  text: '#183326',
  textSecondary: '#52645A',
  textMuted: '#718078',
  border: '#D6E1D9',
  surface: '#FFFFFF',
  background: '#F7FAF8',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  warning: '#B54708',
  warningTint: '#FEF3E7',
  accent: '#6EE7AE',
  /**
   * Mint only reaches 3.37:1 on the brand green, which clears the 3:1 bar for
   * large text but not the 4.5:1 one for the dashboard card's small strings.
   * This is the mint for text on brand surfaces (4.71:1).
   */
  accentOnBrand: '#DCFCE7',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 48,
} as const;

export const Radius = {
  sm: 10,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const MaxContentWidth = 720;

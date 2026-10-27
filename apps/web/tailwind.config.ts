import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--mc-${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ringWidth: { 3: '3px' },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Noto Sans', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        section: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.012em' }],
        metric: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        'metric-lg': ['2.5rem', { lineHeight: '2.875rem', letterSpacing: '-0.025em' }],
        display: ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.022em' }],
      },
      colors: {
        // Cool teal-tinted neutrals: every neutral-* class inherits the MediCore surface palette.
        neutral: {
          50: '#FAFDFC',
          100: '#F2F8F6',
          200: '#E1EBE8',
          300: '#C9D7D3',
          400: '#5E706D',
          500: '#566A67',
          600: '#4C5F5C',
          700: '#354A47',
          800: '#213836',
          900: '#132E2D',
          950: '#0B1F1E',
        },
        brand: {
          50: '#ECFBF6',
          100: '#D9F7EF',
          200: '#A7EBDD',
          300: '#5FD8C4',
          400: '#14B8A6',
          500: '#0D9488',
          600: '#0F766E',
          700: '#115E59',
          800: '#123B3A',
          900: '#0B2928',
          deep: token('brand-deep'),
        },
        canvas: token('canvas'),
        surface: token('surface'),
        subtle: token('subtle'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        quiet: token('quiet'),
        mint: token('mint'),
        primary: { DEFAULT: token('primary'), hover: token('primary-hover') },
        accent: token('accent'),
        'teal-ink': token('teal-ink'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        info: token('info'),
      },
      borderRadius: {
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        // Surfaces stay flat; only floating layers cast a shadow.
        sm: '0 1px 1px rgb(18 59 58 / 0.03)',
        DEFAULT: '0 1px 2px rgb(18 59 58 / 0.05)',
        md: '0 4px 12px -4px rgb(18 59 58 / 0.10)',
        lg: '0 12px 28px -10px rgb(18 59 58 / 0.16)',
        xl: '0 18px 40px -14px rgb(18 59 58 / 0.20)',
        '2xl': '0 24px 56px -18px rgb(18 59 58 / 0.26)',
        pop: '0 10px 30px -12px rgb(18 59 58 / 0.18), 0 0 0 1px rgb(18 59 58 / 0.04)',
        overlay: '0 24px 60px -20px rgb(18 59 58 / 0.28)',
      },
      height: { control: '2.25rem', 'control-sm': '2rem' },
      zIndex: { header: '30', dropdown: '40', drawer: '50', dialog: '60', toast: '100' },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
export default config;

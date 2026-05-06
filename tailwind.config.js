/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface colors
        'surface': {
          DEFAULT: '#FAFAFA',
          'elevated': '#FFFFFF',
          'sunken': '#F4F4F5',
          'hover': '#F4F4F5',
        },
        // Border colors
        'border': {
          DEFAULT: '#E4E4E7',
          'strong': '#D4D4D8',
          'subtle': '#F4F4F5',
        },
        // Text colors
        'text': {
          'primary': '#18181B',
          'secondary': '#52525B',
          'tertiary': '#71717A',
          'disabled': '#A1A1AA',
          'inverse': '#FAFAFA',
        },
        // Brand colors — BLUE accent
        'brand': {
          DEFAULT: '#2563EB',
          'hover': '#1D4ED8',
          'active': '#1E40AF',
          'subtle': '#EFF6FF',
          'subtle-hover': '#DBEAFE',
          'border': '#BFDBFE',
          'text': '#1E40AF',
        },
        // Semantic
        'success': {
          DEFAULT: '#059669',
          'subtle': '#ECFDF5',
          'border': '#A7F3D0',
          'text': '#065F46',
        },
        'warning': {
          DEFAULT: '#D97706',
          'subtle': '#FFFBEB',
          'border': '#FDE68A',
          'text': '#92400E',
        },
        'danger': {
          DEFAULT: '#DC2626',
          'subtle': '#FEF2F2',
          'border': '#FECACA',
          'text': '#991B1B',
        },
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
        'card-hover': '0 2px 4px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.08)',
        'modal': '0 10px 38px rgba(0,0,0,0.10), 0 10px 20px rgba(0,0,0,0.12)',
        'focus': '0 0 0 3px rgba(37, 99, 235, 0.15)',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
      },
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

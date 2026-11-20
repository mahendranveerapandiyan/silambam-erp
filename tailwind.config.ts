import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary-color)',
        header: 'var(--header-bg)',
        sidebar: 'var(--sidebar-bg)',
      },
    },
  },
} satisfies Config;

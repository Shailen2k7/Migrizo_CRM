import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        ink: "hsl(var(--ink))",
        "ink-2": "hsl(var(--ink-2))",
        muted: "hsl(var(--muted))",
        faint: "hsl(var(--faint))",
        indigo: {
          DEFAULT: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          soft: "hsl(var(--indigo-soft))",
          "soft-2": "hsl(var(--indigo-soft-2))",
        },
        success: { DEFAULT: "#10B981", soft: "hsl(var(--green-soft))", dark: "#047857" },
        warning: { DEFAULT: "#F59E0B", soft: "hsl(var(--amber-soft))", dark: "#B45309" },
        danger: { DEFAULT: "#EF4444", soft: "hsl(var(--rose-soft))", dark: "#B91C1C" },
        info: { DEFAULT: "#3B82F6", soft: "hsl(var(--blue-soft))", dark: "#1E40AF" },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: "14px",
        md: "10px",
        sm: "8px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(15,17,21,.04), 0 1px 1px rgba(15,17,21,.03)",
        md: "0 4px 12px -2px rgba(15,17,21,.06), 0 2px 4px -1px rgba(15,17,21,.04)",
        lg: "0 24px 48px -16px rgba(15,17,21,.12), 0 8px 16px -6px rgba(15,17,21,.06)",
      },
      keyframes: {
        pageIn: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideInRight: { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
      },
      animation: {
        pageIn: "pageIn .3s cubic-bezier(.2,.8,.2,1)",
        fadeIn: "fadeIn .2s ease",
        slideInRight: "slideInRight .35s cubic-bezier(.2,.8,.2,1)",
      },
    },
  },
  plugins: [],
};
export default config;

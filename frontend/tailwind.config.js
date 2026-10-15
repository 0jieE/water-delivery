import plugin from "tailwindcss/plugin";
import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // Brand: a clear "water" blue that stays accessible (600+ passes AA with white text).
        water: {
          50: "#eef8ff",
          100: "#d9efff",
          200: "#bce3ff",
          300: "#8ed1ff",
          400: "#58b6ff",
          500: "#3294fb",
          600: "#1b76f0",
          700: "#145fdc",
          800: "#174ec0",
          900: "#18449a",
          950: "#132b5e",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgb(15 23 42 / 0.05)",
        card: "0 1px 2px rgb(15 23 42 / 0.04), 0 6px 20px -8px rgb(15 23 42 / 0.10)",
        lift: "0 2px 4px rgb(15 23 42 / 0.05), 0 14px 32px -10px rgb(15 23 42 / 0.18)",
        pop: "0 24px 60px -16px rgb(15 23 42 / 0.35)",
        glow: "0 8px 22px -8px rgb(27 118 240 / 0.65)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(.96)" }, to: { opacity: "1", transform: "none" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(-12px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(50 148 251 / 0.5)" },
          "100%": { boxShadow: "0 0 0 10px rgb(50 148 251 / 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "slide-up": "slide-up .26s cubic-bezier(.2,.8,.2,1)",
        "scale-in": "scale-in .18s ease-out",
        "toast-in": "toast-in .22s cubic-bezier(.2,.8,.2,1)",
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
      },
    },
  },
  plugins: [
    // `wide:` applies a style only OUTSIDE the phone-style shell (customer / rider). Breakpoints like
    // `sm:` look at the browser window, which on a desktop would wrongly switch the narrow phone
    // frame to multi-column layouts. Use it as `sm:wide:grid-cols-2` in components shared with staff.
    plugin(({ addVariant }) => addVariant("wide", "&:not(.phone *)")),
  ],
};

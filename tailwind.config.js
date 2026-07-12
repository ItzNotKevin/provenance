/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0b",
        surface: "#131314",
        "surface-container": "#1c1b1c",
        "surface-container-low": "#161516",
        "surface-container-high": "#201f20",
        hairline: "#27272a",
        primary: "#ffffff",
        "on-surface": "#e5e2e3",
        "on-surface-variant": "#a1a1aa",
        muted: "#8e9192",
        "verdict-green": "#22c55e",
        "verdict-green-dim": "#14532d",
        "verdict-amber": "#f59e0b",
        "verdict-amber-dim": "#78350f",
        "verdict-grey": "#71717a",
        accent: "#c4b5fd",
        "accent-red": "#fca5a5",
        "accent-green": "#86efac",
        "accent-orange": "#fdba74",
      },
      fontFamily: {
        mono: ["JetBrainsMono_400Regular"],
        "mono-medium": ["JetBrainsMono_500Medium"],
        "mono-bold": ["JetBrainsMono_700Bold"],
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
      },
    },
  },
  plugins: [],
};

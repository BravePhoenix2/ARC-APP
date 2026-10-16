import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./types/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F2F1F4",
        surface: "#FFFFFF",
        "indigo-dark": "#362A67",
        "indigo-darker": "#2B2260",
        purple: "#7C74C4",
        lavender: "#AFA8D3",
        "pink-accent": "#EF476F",
        "pink-soft": "#F49BC5",
        "grey-block": "#C9C7CD",
        "aurora-bg": "#08090D",
        "aurora-surface": "#0F1116",
        "aurora-green": "#2FE6A6",
        "aurora-blue": "#3E8EF7",
        "aurora-violet": "#8B6BF2",
        "aurora-magenta": "#D24FD1",
      },
      boxShadow: {
        soft: "0 8px 18px rgba(54, 42, 103, 0.08)",
        minimal: "0 4px 10px rgba(54, 42, 103, 0.06)",
      },
      borderRadius: {
        artic: "6px",
      },
      fontFamily: {
        sans: ["Raleway", "sans-serif"],
        display: ["Raleway", "sans-serif"],
      },
      keyframes: {
        fadeSlideIn: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatY: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        auroraDrift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(3%, -4%) scale(1.08)" },
        },
        scrollWheel: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "70%": { opacity: "0" },
          "100%": { transform: "translateY(10px)", opacity: "0" },
        },
      },
      animation: {
        "fade-slide-in": "fadeSlideIn 0.7s ease-out both",
        float: "floatY 4.5s ease-in-out infinite",
        "aurora-drift": "auroraDrift 22s ease-in-out infinite",
        "scroll-wheel": "scrollWheel 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

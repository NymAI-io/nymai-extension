// tailwind.config.js

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}", // This is the correct path for the v4 template
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#2d3748", // Dark charcoal
          teal: "#4fd1c5", // Primary teal
          tealLight: "#81e6d9", // Light teal
          // Legacy aliases for gradual migration
          primary: "#4fd1c5", // Teal (replaces purple)
          primaryDark: "#2d3748", // Dark (replaces purple-dark)
          primaryLight: "#81e6d9", // Light teal (replaces purple-light)
          accent: "#4fd1c5", // Teal (replaces blue)
          accentDark: "#2d3748", // Dark (replaces blue-dark)
        },
      },
      // Add this animation code
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-in-out",
      },
      // End of animation code
    },
  },
  plugins: [],
};
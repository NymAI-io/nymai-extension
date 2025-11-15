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
          primary: "#8b5cf6", // Purple-600
          primaryDark: "#7c3aed", // Purple-700
          primaryLight: "#a78bfa", // Purple-400
          accent: "#3b82f6", // Blue-600
          accentDark: "#2563eb", // Blue-700
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
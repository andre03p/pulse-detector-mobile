/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          darkest: "#0d1321",
          dark: "#1d2d44",
          DEFAULT: "#3e5c76",
          light: "#748cab",
          lightest: "#f0ebd8",
        },
      },
    },
  },
  plugins: [],
};

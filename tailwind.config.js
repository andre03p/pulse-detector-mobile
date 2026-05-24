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
        surface: "#050000",
        heart: {
          darkest: "#28080e",
          dark: "#920c0c",
          DEFAULT: "#e94560",
          bright: "#ed0909",
        },
        success: "#12b07c",
        warning: "#f5a623",
        error: "#e63946",
      },
    },
  },
  plugins: [],
};

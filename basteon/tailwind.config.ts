import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    // Keep desktop breakpoints tied to mouse-like input so mobile browsers in desktop-site mode retain phone layouts.
    screens: {
      sm: "(min-width: 640px) and (hover: hover) and (pointer: fine)",
      md: "(min-width: 768px) and (hover: hover) and (pointer: fine)",
      lg: "(min-width: 1024px) and (hover: hover) and (pointer: fine)",
      xl: "(min-width: 1280px) and (hover: hover) and (pointer: fine)",
      "2xl": "(min-width: 1536px) and (hover: hover) and (pointer: fine)",
    },
    extend: {},
  },
  plugins: [],
} satisfies Config;
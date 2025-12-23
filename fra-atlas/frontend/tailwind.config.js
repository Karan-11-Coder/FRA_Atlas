/** @type {import('tailwindcss').Config} */

// Optional plugin loader for ESM environments — safe even if not installed
let animatePlugin = null;
try {
  // dynamically import without await — avoids PostCSS restrictions
  import("tailwindcss-animate")
    .then((mod) => {
      animatePlugin = mod.default || mod;
    })
    .catch(() => {
      console.warn(
        "tailwindcss-animate not found. Continuing without it. To enable animations install: npm install -D tailwindcss-animate"
      );
    });
} catch (e) {
  console.warn(
    "tailwindcss-animate not found. Continuing without it. To enable animations install: npm install -D tailwindcss-animate"
  );
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/components/v0ui/**/*.{js,ts,jsx,tsx}", // include v0 UI components
  ],
  theme: {
    extend: {
      colors: {
        govGreen: "#0f7b40",
        govAccent: "#2aa26b",
        ctaBlue: "#0f6fff",
        neutralBg: "#f7fafc",
        govText: "#111827",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: animatePlugin ? [animatePlugin] : [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{tsx,ts,jsx,js}"],
  theme: {
    extend: {
      colors: {
        emerald: {
          glow: "#00FF88",
        },
      },
      keyframes: {
        scan: {
          "0%": { top: "0%" },
          "100%": { top: "100%" },
        },
        pulse_ring: {
          "0%": { boxShadow: "0 0 0 0 rgba(0, 255, 136, 0.5)" },
          "70%": { boxShadow: "0 0 0 10px rgba(0, 255, 136, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(0, 255, 136, 0)" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        scan: "scan 1.2s ease-in-out",
        pulse_ring: "pulse_ring 2s infinite",
        fadeInUp: "fadeInUp 0.3s ease-out",
        slideInRight: "slideInRight 0.3s ease-out",
        shimmer: "shimmer 2s infinite",
      },
    },
  },
  plugins: [],
}

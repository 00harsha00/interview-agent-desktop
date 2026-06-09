/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        // Primary backgrounds
        'bg-primary': '#1e293b',    // Surface
        'bg-secondary': '#0f172a',  // Panel (elevated)
        'bg-tertiary': '#0a0f1a',   // Deep (for extra depth)
        
        // Accent colors (blue/indigo brand)
        'accent-primary': '#6366f1',   // Indigo-500 (primary action)
        'accent-secondary': '#818cf8', // Indigo-400 (secondary)
        'accent-light': '#a5b4fc',     // Indigo-300 (hover/active)
        'accent-muted': 'rgba(99, 102, 241, 0.12)',  // Indigo dim background
        'accent-border': 'rgba(99, 102, 241, 0.3)',  // Indigo border
        
        // Legacy support (green for backwards compatibility)
        'green-accent': '#22c55e',
        'green-dim': 'rgba(34,197,94,0.12)',
        'green-border': 'rgba(34,197,94,0.3)',
        
        // Extended text hierarchy
        'text-primary': '#f1f5f9',
        'text-secondary': 'rgba(255, 255, 255, 0.6)',
        'text-tertiary': 'rgba(255, 255, 255, 0.35)',
        'text-muted': 'rgba(255, 255, 255, 0.18)',
        
        // Status colors
        'status-success': '#10b981',
        'status-warning': '#f59e0b',
        'status-error': '#ef4444',
      },
      animation: {
        'pulse-dot': 'pulse 1.4s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.15s ease-out',
        'fade-in-slow': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'spin-slow': 'spin 2s linear infinite',
        'scale-pulse': 'scalePulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { 
          from: { opacity: '0' }, 
          to: { opacity: '1' } 
        },
        slideUp: { 
          from: { opacity: '0', transform: 'translateY(8px)' }, 
          to: { opacity: '1', transform: 'translateY(0)' } 
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        pulseGlow: {
          '0%, 100%': { 
            opacity: '1',
            boxShadow: '0 0 0 0 rgba(99, 102, 241, 0.7)'
          },
          '50%': { 
            opacity: '0.8',
            boxShadow: '0 0 0 4px rgba(99, 102, 241, 0)'
          },
        },
        scalePulse: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
      },
    },
  },
  plugins: [],
}

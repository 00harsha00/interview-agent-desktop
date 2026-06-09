/**
 * Button — semantic button component with multiple variants
 * Supports accent, secondary, and ghost variants with smooth interactions
 */
import React, { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-white/8 text-white/80 border border-white/12',
    'hover:bg-white/12 hover:text-white/95 hover:border-white/20',
    'active:scale-95 active:bg-white/10'
  ),
  secondary: cn(
    'bg-white/4 text-white/60 border border-white/8',
    'hover:bg-white/8 hover:text-white/80 hover:border-white/15',
    'active:scale-95'
  ),
  accent: cn(
    'bg-indigo-500/15 text-indigo-300 border border-indigo-400/30',
    'hover:bg-indigo-500/25 hover:text-indigo-200 hover:border-indigo-400/50',
    'hover:shadow-lg hover:shadow-indigo-500/20',
    'active:scale-95 active:bg-indigo-500/20'
  ),
  ghost: cn(
    'bg-transparent text-white/50 border border-transparent',
    'hover:bg-white/6 hover:text-white/75 hover:border-white/10',
    'active:scale-95'
  ),
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2 h-6 text-[10px] gap-1',
  md: 'px-3 h-7 text-[11px] gap-1.5',
  lg: 'px-4 h-9 text-[12px] gap-2',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      children,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium',
          'transition-all duration-150 ease-out',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <>
            {icon && <span className="flex items-center justify-center">{icon}</span>}
            <span>{children}</span>
          </>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'

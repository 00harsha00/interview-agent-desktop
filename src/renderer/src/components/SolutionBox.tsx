/**
 * SolutionBox — elevated markdown card with syntax highlighting
 * Displays rich content with clean typography and code highlighting
 */
import React, { useState } from 'react'
import { cn } from '@/lib/utils'

interface SolutionBoxProps {
  content: string
  title?: string
  onCopy?: (text: string) => void
  showCopyButtons?: boolean
  className?: string
  highlighted?: boolean
}

export function SolutionBox({
  content,
  title,
  onCopy,
  showCopyButtons = true,
  className,
  highlighted = false,
}: SolutionBoxProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    onCopy?.(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Parse markdown-like content for basic formatting
  const renderContent = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, idx) => {
      // Check for code block markers
      if (line.startsWith('```')) {
        return null // Skip delimiter lines
      }

      // Bold text
      let rendered = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic text
      rendered = rendered.replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Inline code
      rendered = rendered.replace(/`(.*?)`/g, '<code>$1</code>')

      if (line.trim() === '') {
        return <div key={idx} className="h-1" />
      }

      return (
        <div key={idx} className="break-words">
          <div dangerouslySetInnerHTML={{ __html: rendered }} />
        </div>
      )
    })
  }

  return (
    <div
      className={cn(
        'rounded-12px overflow-hidden anim-scale-in',
        className
      )}
    >
      {/* Header with title and actions */}
      {(title || showCopyButtons) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/5 border-b border-white/6">
          {title && (
            <h3 className="text-[12px] font-semibold text-white/75">
              {title}
            </h3>
          )}
          <div className="flex-1" />
          {showCopyButtons && (
            <button
              onClick={handleCopy}
              className="text-[11px] text-white/40 hover:text-white/70 transition-colors flex items-center gap-1.5"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="h-3 w-3" fill="none" strokeWidth="2" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Content with elevated background */}
      <div
        className={cn(
          'px-4 py-3 text-[13px] leading-relaxed',
          'bg-gradient-to-br from-white/[0.02] to-white/[0.01]',
          'border-l-2',
          highlighted ? 'border-indigo-400/50' : 'border-white/6'
        )}
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        }}
      >
        {/* Code-like rendering */}
        <div className="space-y-1 font-mono">
          {renderContent(content)}
        </div>
      </div>

      {/* Syntax highlighting overlay hints */}
      <style>{`
        code {
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.15);
          border-radius: 3px;
          padding: 2px 4px;
          color: #a5b4fc;
          font-size: 0.9em;
          font-family: 'SF Mono', Monaco, 'Fira Code', monospace;
        }
        strong {
          color: #e0e7ff;
          font-weight: 600;
        }
        em {
          color: #c7d2fe;
          font-style: italic;
        }
      `}</style>
    </div>
  )
}

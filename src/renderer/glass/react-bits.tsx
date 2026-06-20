import React, { CSSProperties, ReactNode } from 'react'

type CSSVars = CSSProperties & Record<`--${string}`, string | number>

export function SpotlightPanel({
  children,
  className = '',
  spotlightColor = 'rgba(95, 212, 154, 0.16)',
  style,
  onMouseMove,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  spotlightColor?: string
}) {
  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--rb-x', `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty('--rb-y', `${event.clientY - rect.top}px`)
    onMouseMove?.(event)
  }

  return (
    <div
      className={'rb-spotlight' + (className ? ' ' + className : '')}
      style={{ '--rb-spotlight': spotlightColor, ...style } as CSSVars}
      onMouseMove={handleMouseMove}
      {...rest}
    >
      {children}
    </div>
  )
}

export function ShinyText({ children, className = '', disabled = false }: {
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <span className={'rb-shiny' + (disabled ? ' disabled' : '') + (className ? ' ' + className : '')}>
      {children}
    </span>
  )
}

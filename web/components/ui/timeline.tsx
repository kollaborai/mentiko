'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// ============================================================================
// CONTEXT
// ============================================================================

interface TimelineContextValue {
  orientation: 'horizontal' | 'vertical'
}

const TimelineContext = React.createContext<TimelineContextValue>({
  orientation: 'vertical',
})

function useTimelineContext(): TimelineContextValue {
  const context = React.useContext(TimelineContext)
  if (!context) {
    return { orientation: 'vertical' }
  }
  return context
}

// ============================================================================
// TIMELINE (MAIN CONTAINER)
// ============================================================================

export interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  children: React.ReactNode
}

export function Timeline({
  orientation = 'vertical',
  className,
  children,
  ...props
}: TimelineProps) {
  // Inject index into each TimelineItem for alternating layouts
  const childrenWithIndex = React.Children.map(children, (child, index) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<{ index?: number }>, {
        index,
      })
    }
    return child
  })

  return (
    <TimelineContext.Provider value={{ orientation }}>
      <div
        className={cn(
          // Horizontal: grid flows left to right
          orientation === 'horizontal' &&
            'grid grid-flow-col grid-rows-[min-content_2rem_min-content] gap-x-8 gap-y-4 items-center w-full',
          // Vertical: grid flows top to bottom
          orientation === 'vertical' &&
            'grid grid-cols-[1fr_2rem_1fr] gap-y-8 items-start w-full',
          className
        )}
        {...props}
      >
        {childrenWithIndex}
      </div>
    </TimelineContext.Provider>
  )
}

// ============================================================================
// TIMELINE DOT
// ============================================================================

const timelineDotVariants = cva(
  'flex items-center justify-center rounded-full shrink-0 relative z-10',
  {
    variants: {
      variant: {
        default: 'border-2 border-primary bg-primary',
        secondary: 'border-2 border-secondary bg-secondary',
        destructive: 'border-2 border-destructive bg-destructive',
        outline: 'border-2 border-border bg-background',
      },
      size: {
        sm: 'w-3 h-3',
        md: 'w-4 h-4',
        lg: 'w-5 h-5',
      },
      hollow: {
        true: 'border-2 bg-card',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      hollow: false,
    },
  }
)

export interface TimelineDotProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof timelineDotVariants> {
  asChild?: boolean
}

export function TimelineDot({
  className,
  variant,
  size,
  hollow,
  ...props
}: TimelineDotProps) {
  return (
    <div
      className={cn(timelineDotVariants({ variant, size, hollow }), className)}
      {...props}
    />
  )
}

// ============================================================================
// TIMELINE ITEM
// ============================================================================

const timelineItemVariants = cva('', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      destructive: 'bg-destructive/10 text-destructive-foreground',
      outline: 'bg-muted/50 text-foreground',
    },
    noCards: {
      true: 'border-none shadow-none bg-transparent',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    noCards: false,
  },
})

const timelineAlignmentVariants = cva('', {
  variants: {
    align: {
      start: 'justify-self-start text-left',
      end: 'justify-self-end text-right',
      center: 'justify-self-center text-center',
    },
  },
  defaultVariants: {
    align: 'start',
  },
})

export interface TimelineItemProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: VariantProps<typeof timelineItemVariants>['variant']
  align?: VariantProps<typeof timelineAlignmentVariants>['align']
  noCards?: boolean
  alternating?: boolean
  index?: number
  asChild?: boolean
  children: React.ReactNode
}

export function TimelineItem({
  variant = 'default',
  align = 'start',
  noCards = false,
  alternating = false,
  index = 0,
  className,
  children,
  ...props
}: TimelineItemProps) {
  const { orientation } = useTimelineContext()

  // Determine alignment based on alternating prop and index
  const calculatedAlign = alternating
    ? index % 2 === 0
      ? 'start'
      : 'end'
    : align

  // Horizontal layout: dot in middle row, content above/below
  // Vertical layout: dot in middle column, content left/right
  const isHorizontal = orientation === 'horizontal'

  // Parse children to extract dot, date, title, description
  const childrenArray = React.Children.toArray(children)
  let dot: React.ReactNode = null
  const content: React.ReactNode[] = []

  childrenArray.forEach((child) => {
    if (React.isValidElement(child)) {
      if (child.type === TimelineDot) {
        dot = child
      } else {
        content.push(child)
      }
    } else {
      content.push(child)
    }
  })

  // Default dot if none provided
  if (!dot) {
    dot = <TimelineDot variant={variant} />
  }

  return (
    <div
      className={cn(
        'contents',
        className
      )}
      {...props}
    >
      {isHorizontal ? (
        <>
          {/* Horizontal: content above */}
          <div className={cn('contents')} />
          <div
            className={cn(
              'flex items-center justify-center',
              timelineAlignmentVariants({ align: calculatedAlign })
            )}
          >
            {dot}
          </div>
          {/* Horizontal: content below */}
          <div
            className={cn(
              timelineItemVariants({ variant, noCards }),
              timelineAlignmentVariants({ align: calculatedAlign }),
              'rounded-md p-4'
            )}
          >
            {content}
          </div>
        </>
      ) : (
        <>
          {/* Vertical: left content */}
          <div
            className={cn(
              timelineItemVariants({ variant, noCards }),
              timelineAlignmentVariants({ align: calculatedAlign }),
              'rounded-md p-4',
              calculatedAlign === 'end' ? 'order-3' : 'order-1'
            )}
          >
            {content}
          </div>
          {/* Vertical: middle dot with line */}
          <div className="relative flex items-center justify-center order-2">
            {dot}
            {/* Vertical connector line */}
            <div className="absolute w-px bg-foreground/10 min-h-[2rem] -z-10" />
          </div>
          {/* Vertical: right spacer */}
          <div className="order-3" />
        </>
      )}
    </div>
  )
}

// ============================================================================
// TIMELINE ITEM DATE
// ============================================================================

export interface TimelineItemDateProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function TimelineItemDate({
  className,
  children,
  ...props
}: TimelineItemDateProps) {
  return (
    <div
      className={cn('text-sm text-muted-foreground font-mono', className)}
      {...props}
    >
      {children}
    </div>
  )
}

// ============================================================================
// TIMELINE ITEM TITLE
// ============================================================================

export interface TimelineItemTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  children: React.ReactNode
}

export function TimelineItemTitle({
  className,
  level = 'h3',
  children,
  ...props
}: TimelineItemTitleProps) {
  const Tag = level

  return (
    <Tag
      className={cn('font-semibold text-foreground mt-1', className)}
      {...props}
    >
      {children}
    </Tag>
  )
}

// ============================================================================
// TIMELINE ITEM DESCRIPTION
// ============================================================================

export interface TimelineItemDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode
}

export function TimelineItemDescription({
  className,
  children,
  ...props
}: TimelineItemDescriptionProps) {
  return (
    <p
      className={cn('text-sm text-muted-foreground mt-2 leading-relaxed', className)}
      {...props}
    >
      {children}
    </p>
  )
}

// ============================================================================
// TIMELINE SEPARATOR (for horizontal layouts)
// ============================================================================

export interface TimelineSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: VariantProps<typeof timelineDotVariants>['variant']
}

export function TimelineSeparator({
  variant: _variant = 'default',
  className,
  ...props
}: TimelineSeparatorProps) {
  return (
    <div
      className={cn('h-px bg-foreground/10 w-full', className)}
      {...props}
    />
  )
}

// ============================================================================
// TIMELINE BRANCH (for branching paths)
// ============================================================================

const timelineBranchVariants = cva('border-2 border-dashed', {
  variants: {
    variant: {
      default: 'border-primary',
      secondary: 'border-secondary',
      destructive: 'border-destructive',
      outline: 'border-border',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export interface TimelineBranchProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: VariantProps<typeof timelineBranchVariants>['variant']
  direction?: 'horizontal' | 'vertical'
}

export function TimelineBranch({
  variant = 'default',
  direction = 'vertical',
  className,
  ...props
}: TimelineBranchProps) {
  return (
    <div
      className={cn(
        timelineBranchVariants({ variant }),
        direction === 'horizontal' ? 'w-full h-px' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
}

// ============================================================================
// GLOBAL STYLES
// ============================================================================

// Additional utility classes for connector lines
export const timelineStyles = `
  .timeline-connector-vertical {
    position: absolute;
    width: 1px;
    background-color: hsl(var(--foreground) / 0.1);
    z-index: 0;
  }
  .timeline-connector-horizontal {
    position: absolute;
    height: 1px;
    background-color: hsl(var(--foreground) / 0.1);
    z-index: 0;
  }
`

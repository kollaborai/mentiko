import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface MarketplaceCardProps {
  title: string
  description?: string
  /** badge next to title (e.g. category) */
  badge?: ReactNode
  /** badge in top-right corner (e.g. version, format) */
  cornerBadge?: ReactNode
  /** slot between description and tags (e.g. star rating) */
  afterDescription?: ReactNode
  tags?: string[]
  /** max tags to show before +N overflow */
  maxTags?: number
  /** array of text/elements for the metadata row */
  meta?: ReactNode[]
  /** action buttons at the bottom */
  actions?: ReactNode
  /** expandable content below actions */
  expanded?: ReactNode
  className?: string
}

export function MarketplaceCard({
  title,
  description,
  badge,
  cornerBadge,
  afterDescription,
  tags,
  maxTags = 4,
  meta,
  actions,
  expanded,
  className,
}: MarketplaceCardProps) {
  return (
    <div className={cn("bg-card hover:bg-muted rounded-md p-4 transition-colors group flex flex-col", className)}>
      {/* header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-sm font-medium truncate">{title}</span>
            {badge}
          </div>
          {description && (
            <p className="text-[11px] text-muted-foreground line-clamp-2">{description}</p>
          )}
        </div>
        {cornerBadge && <div className="shrink-0 ml-2">{cornerBadge}</div>}
      </div>

      {/* optional slot (rating, bundle info, etc.) */}
      {afterDescription && <div className="mb-3">{afterDescription}</div>}

      {/* tags */}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {tags.slice(0, maxTags).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
          ))}
          {tags.length > maxTags && (
            <Badge variant="secondary" className="text-[10px]">+{tags.length - maxTags}</Badge>
          )}
        </div>
      )}

      {/* metadata row */}
      {meta && meta.length > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-3">
          {meta.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      )}

      {/* spacer to push actions to bottom */}
      <div className="flex-1" />

      {/* actions */}
      {actions && <div className="flex gap-2">{actions}</div>}

      {/* expandable content */}
      {expanded && <div className="mt-3">{expanded}</div>}
    </div>
  )
}

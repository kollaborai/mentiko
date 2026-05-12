"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ArrowRight1Filled, ArrowDown1Filled } from "@aliimam/icons"

export interface NestedMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: string | number
  children?: NestedMenuItem[]
  disabled?: boolean
}

export interface NestedMenuProps {
  items: NestedMenuItem[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}

interface MenuItemProps {
  item: NestedMenuItem
  level: number
  selectedValue?: string
  onSelect: (value: string) => void
}

function MenuItem({ item, level, selectedValue, onSelect }: MenuItemProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = item.children && item.children.length > 0
  const isSelected = selectedValue === item.id
  const hasSelectedChild = item.children?.some(child => child.id === selectedValue)

  const handleClick = () => {
    if (hasChildren) {
      setExpanded(!expanded)
    } else if (!item.disabled) {
      onSelect(item.id)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={item.disabled}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors rounded-sm",
          "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
          isSelected && "bg-accent text-foreground",
          !isSelected && "text-foreground/70",
          level > 0 && "ml-3"
        )}
      >
        {hasChildren ? (
          expanded ? (
            <ArrowDown1Filled className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
          ) : (
            <ArrowRight1Filled className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
          )
        ) : (
          <div className="w-3.5 shrink-0" />
        )}

        {item.icon && (
          <span className="shrink-0 text-foreground/50">{item.icon}</span>
        )}

        <span className="flex-1 text-sm truncate">{item.label}</span>

        {item.badge && (
          <span className="shrink-0 text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/60">
            {item.badge}
          </span>
        )}
      </button>

      {hasChildren && expanded && (
        <div className={cn(
          hasSelectedChild && "bg-accent/30",
          "rounded-sm"
        )}>
          {item.children!.map((child) => (
            <MenuItem
              key={child.id}
              item={child}
              level={level + 1}
              selectedValue={selectedValue}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function NestedMenu({ items, value, onChange, className }: NestedMenuProps) {
  const handleSelect = (itemId: string) => {
    onChange?.(itemId)
  }

  return (
    <nav className={cn("space-y-0.5", className)}>
      {items.map((item) => (
        <MenuItem
          key={item.id}
          item={item}
          level={0}
          selectedValue={value}
          onSelect={handleSelect}
        />
      ))}
    </nav>
  )
}

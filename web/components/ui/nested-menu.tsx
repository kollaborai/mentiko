"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
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

// does this item have any children at all (collapse-eligible)?
function hasChildren(item: NestedMenuItem): boolean {
  return !!item.children && item.children.length > 0
}

interface FlatMenuRow {
  id: string
  parentId: string | null
  hasChildren: boolean
  disabled: boolean
}

// flatten the visible menu (respecting collapse state) into keyboard-nav order
function flattenVisibleMenuRows(
  items: NestedMenuItem[],
  collapsed: Set<string>
): FlatMenuRow[] {
  const rows: FlatMenuRow[] = []

  function walk(item: NestedMenuItem, parentId: string | null) {
    rows.push({
      id: item.id,
      parentId,
      hasChildren: hasChildren(item),
      disabled: !!item.disabled,
    })
    if (hasChildren(item) && !collapsed.has(item.id)) {
      for (const child of item.children!) walk(child, item.id)
    }
  }

  for (const root of items) walk(root, null)
  return rows
}

interface MenuItemProps {
  item: NestedMenuItem
  collapsed: Set<string>
  selectedValue?: string
  onToggle: (id: string) => void
  onSelect: (value: string) => void
}

function MenuItem({ item, collapsed, selectedValue, onToggle, onSelect }: MenuItemProps) {
  const itemHasChildren = hasChildren(item)
  const isExpanded = !collapsed.has(item.id)
  const isSelected = selectedValue === item.id
  const hasSelectedChild = item.children?.some(child => child.id === selectedValue)

  const handleClick = () => {
    if (itemHasChildren) {
      onToggle(item.id)
    } else if (!item.disabled) {
      onSelect(item.id)
    }
  }

  return (
    <div>
      <button
        type="button"
        data-nested-menu-row-id={item.id}
        onClick={handleClick}
        disabled={item.disabled}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors rounded-sm",
          "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
          isSelected && "bg-accent text-foreground",
          !isSelected && "text-foreground/70"
        )}
        style={{ paddingLeft: 12 }}
      >
        {itemHasChildren ? (
          isExpanded ? (
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

      {itemHasChildren && isExpanded && (
        <div className={cn(
          hasSelectedChild && "bg-accent/30",
          "rounded-sm"
        )}>
          {item.children!.map((child) => (
            <MenuItem
              key={child.id}
              item={child}
              collapsed={collapsed}
              selectedValue={selectedValue}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function NestedMenu({ items, value, onChange, className }: NestedMenuProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelect = useCallback(
    (itemId: string) => {
      onChange?.(itemId)
    },
    [onChange]
  )

  // flattened, keyboard-navigable order of everything currently visible
  const flatRows = useMemo(
    () => flattenVisibleMenuRows(items, collapsed),
    [items, collapsed]
  )

  // keyboard nav: up/down move selection, left/right collapse/expand or step to parent/child
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "TEXTAREA" || tag === "INPUT") return
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return
      if (flatRows.length === 0) return

      const currentIndex = flatRows.findIndex((r) => r.id === value)

      if (e.key === "ArrowDown") {
        e.preventDefault()
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, flatRows.length - 1)
        const row = flatRows[nextIndex]
        if (!row.disabled) handleSelect(row.id)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1
        const row = flatRows[prevIndex]
        if (!row.disabled) handleSelect(row.id)
      } else if (e.key === "ArrowRight") {
        if (currentIndex === -1) return
        const row = flatRows[currentIndex]
        if (!row.hasChildren) return
        e.preventDefault()
        if (collapsed.has(row.id)) {
          toggleCollapse(row.id)
        } else {
          const child = flatRows[currentIndex + 1]
          if (child?.parentId === row.id && !child.disabled) handleSelect(child.id)
        }
      } else if (e.key === "ArrowLeft") {
        if (currentIndex === -1) return
        const row = flatRows[currentIndex]
        if (row.hasChildren && !collapsed.has(row.id)) {
          e.preventDefault()
          toggleCollapse(row.id)
        } else if (row.parentId) {
          e.preventDefault()
          handleSelect(row.parentId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [flatRows, value, collapsed, handleSelect, toggleCollapse])

  // keep the selected row scrolled into view (keyboard nav can move selection off-screen)
  useEffect(() => {
    if (!value) return
    const el = document.querySelector(
      `[data-nested-menu-row-id="${CSS.escape(value)}"]`
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [value])

  return (
    <nav className={cn("space-y-0.5", className)}>
      {items.map((item) => (
        <MenuItem
          key={item.id}
          item={item}
          collapsed={collapsed}
          selectedValue={value}
          onToggle={toggleCollapse}
          onSelect={handleSelect}
        />
      ))}
    </nav>
  )
}

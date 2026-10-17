"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

type DockEdge = "top" | "right" | "bottom" | "left";

const EDGES: DockEdge[] = ["top", "right", "bottom", "left"];
const DOCK_GAP_PX = 12;
const HORIZONTAL_DOCK_MIN = "--mentiko-pill-nav-horizontal-center-min";
const HORIZONTAL_DOCK_MAX = "--mentiko-pill-nav-horizontal-center-max";
const HORIZONTAL_DOCK_WIDTH = "--mentiko-pill-nav-horizontal-max-width";

interface PillNavLayout {
  edge: DockEdge;
  scale: number;
  suspended: boolean;
}

export interface PillNavVerticalBounds {
  maxHeight: number;
  minCenter: number;
  maxCenter: number;
}

/** Publish the settled dock's footprint without following its drag animation. */
export function usePillNavInsets(
  navRef: RefObject<HTMLDivElement | null>,
  { edge, scale, suspended }: PillNavLayout,
) {
  const [verticalBounds, setVerticalBounds] = useState<PillNavVerticalBounds | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || suspended) return;

    const root = document.documentElement;
    const measure = () => {
      // Layout dimensions exclude the temporary drag/snap transforms. Apply the
      // user's scale explicitly so the inset animates toward the final size.
      const thickness = edge === "top" || edge === "bottom"
        ? nav.offsetHeight
        : nav.offsetWidth;
      const inset = thickness > 0 ? Math.ceil(thickness * scale) + DOCK_GAP_PX : 0;

      for (const side of EDGES) {
        const property = `--mentiko-pill-nav-inset-${side}`;
        const value = `${side === edge ? inset : 0}px`;
        if (root.style.getPropertyValue(property) !== value) {
          root.style.setProperty(property, value);
        }
      }

      if (edge === "top" || edge === "bottom") {
        const viewportWidth = window.innerWidth;
        const safePadding = Math.min(DOCK_GAP_PX, viewportWidth / 4);
        const availableWidth = Math.max(0, viewportWidth - safePadding * 2);
        const maxWidth = availableWidth / scale;
        const scaledWidth = Math.min(nav.offsetWidth * scale, availableWidth);
        const bounds = {
          minCenter: safePadding + scaledWidth / 2,
          maxCenter: viewportWidth - safePadding - scaledWidth / 2,
        };

        root.style.setProperty(HORIZONTAL_DOCK_MIN, `${bounds.minCenter}px`);
        root.style.setProperty(HORIZONTAL_DOCK_MAX, `${bounds.maxCenter}px`);
        root.style.setProperty(HORIZONTAL_DOCK_WIDTH, `${maxWidth}px`);
        setVerticalBounds(current => current === null ? current : null);
      } else {
        root.style.removeProperty(HORIZONTAL_DOCK_MIN);
        root.style.removeProperty(HORIZONTAL_DOCK_MAX);
        root.style.removeProperty(HORIZONTAL_DOCK_WIDTH);

        const viewportHeight = window.innerHeight;
        const safePadding = Math.min(DOCK_GAP_PX, viewportHeight / 4);
        const availableHeight = Math.max(0, viewportHeight - safePadding * 2);
        const maxHeight = availableHeight / scale;
        const borderHeight = Number.parseFloat(getComputedStyle(nav).borderTopWidth || "0")
          + Number.parseFloat(getComputedStyle(nav).borderBottomWidth || "0");
        const contentHeight = (nav.scrollHeight + borderHeight) * scale;
        const visibleHeight = Math.min(contentHeight, availableHeight);
        const bounds = {
          maxHeight,
          minCenter: safePadding + visibleHeight / 2,
          maxCenter: viewportHeight - safePadding - visibleHeight / 2,
        };

        setVerticalBounds(current => (
          current?.maxHeight === bounds.maxHeight
          && current.minCenter === bounds.minCenter
          && current.maxCenter === bounds.maxCenter
            ? current
            : bounds
        ));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav, { box: "border-box" });
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [navRef, edge, scale, suspended]);

  // Do not clear the insets on drag, scale, or dock changes: only the nav's
  // actual removal (for example, a standalone auth surface) releases its space.
  useLayoutEffect(() => () => {
    for (const side of EDGES) {
      document.documentElement.style.removeProperty(`--mentiko-pill-nav-inset-${side}`);
    }
    document.documentElement.style.removeProperty(HORIZONTAL_DOCK_MIN);
    document.documentElement.style.removeProperty(HORIZONTAL_DOCK_MAX);
    document.documentElement.style.removeProperty(HORIZONTAL_DOCK_WIDTH);
  }, []);

  return verticalBounds;
}

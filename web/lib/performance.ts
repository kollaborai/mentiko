import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import type { ComponentType, UIEvent, DependencyList } from "react";

/**
 * debounce hook for search inputs and other expensive operations
 * usage: const debouncedSearch = useDebounce(searchTerm, 300)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * memoized component factory with custom comparison
 */
export function memoWith<T extends object>(
  Component: ComponentType<T>,
  arePropsEqual?: (prevProps: T, nextProps: T) => boolean
) {
  return memo(Component, arePropsEqual);
}

/**
 * virtual list hook for efficiently rendering long lists
 * only renders items visible in viewport + buffer
 *
 * usage:
 *   const { visibleItems, totalHeight, offsetY, handleScroll, containerRef } = useVirtualList({
 *     items,
 *     itemHeight: 60,
 *     containerHeight: 400,
 *   });
 */
export function useVirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 3,
}: {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // measure actual container height if not provided
  const [measuredHeight, setMeasuredHeight] = useState(containerHeight);
  useEffect(() => {
    if (containerRef.current && !containerHeight) {
      setMeasuredHeight(containerRef.current.offsetHeight);
    }
  }, [containerHeight]);

  const actualHeight = containerHeight || measuredHeight;

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(
      items.length,
      Math.ceil((scrollTop + actualHeight) / itemHeight) + overscan
    );
    return { start, end };
  }, [scrollTop, itemHeight, actualHeight, overscan, items.length]);

  const visibleItems = useMemo(
    () => items.slice(visibleRange.start, visibleRange.end).map((item, i) => ({
      item,
      index: visibleRange.start + i,
    })),
    [items, visibleRange]
  );

  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    containerRef,
    startIndex: visibleRange.start,
  };
}

/**
 * intersection observer hook for lazy loading images/components
 */
export function useInView(options: IntersectionObserverInit = {}) {
  const ref = useRef<HTMLElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, { threshold: 0.1, ...options });

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [options]);

  return [ref, isInView] as const;
}

/**
 * idle callback hook for non-urgent updates
 * runs callback during browser idle periods
 */
export function useIdleCallback(
  callback: () => void,
  deps: DependencyList = []
) {
  useEffect(() => {
    if (typeof requestIdleCallback === "undefined") {
      callback();
      return;
    }
    const id = requestIdleCallback(callback);
    return () => cancelIdleCallback(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback, ...deps]);
}

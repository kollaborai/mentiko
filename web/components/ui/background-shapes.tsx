"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
// Cell shape functions that return JSX instead of SVG strings
const Cell1 = ({ colors }: { colors: string[]; strokeWidth: number }) => (
  <circle cx="50" cy="50" r="9.44" fill={colors[0]} fillRule="evenodd" />
);

const Cell2 = ({ colors, strokeWidth }: { colors: string[]; strokeWidth: number }) => (
  <>
    <line x1="25" x2="75" y1="25" y2="25" stroke={colors[0]} strokeWidth={strokeWidth} />
    <line x1="25" x2="75" y1="50" y2="50" stroke={colors[0]} strokeWidth={strokeWidth} />
    <line x1="25" x2="75" y1="75" y2="75" stroke={colors[0]} strokeWidth={strokeWidth} />
  </>
);

const Cell3 = ({ colors, strokeWidth }: { colors: string[]; strokeWidth: number }) => (
  <>
    <line x1="25" x2="75" y1="25" y2="75" stroke={colors[0]} strokeWidth={strokeWidth} />
    <line x1="25" x2="75" y1="75" y2="25" stroke={colors[0]} strokeWidth={strokeWidth} />
  </>
);

const Cell4 = ({ colors, strokeWidth }: { colors: string[]; strokeWidth: number }) => (
  <rect
    width="50"
    height="50"
    x="25"
    y="25"
    fill="none"
    stroke={colors[0]}
    strokeWidth={strokeWidth}
  />
);

const Cell5 = ({ colors, strokeWidth }: { colors: string[]; strokeWidth: number }) => (
  <line x1="25" x2="75" y1="75" y2="25" fill="none" stroke={colors[0]} strokeWidth={strokeWidth} />
);

const Cell6 = () => null;

const Cell7 = () => <rect width="75" height="75" x="12.5" y="12.5" fill="rgba(255,255,255,0.1)" />;

// Simple seeded random number generator
const seedPRNG = (seed: number) => {
  // Simple implementation - in production you might want a more robust seeded RNG
  // This is a basic seeded RNG implementation
  let seedValue = seed;
  return () => {
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
  };
};

interface ShapeConfig {
  shape: ({
    colors,
    strokeWidth,
  }: {
    colors: string[];
    strokeWidth: number;
  }) => ReactElement | null;
  weight: number;
}

const shapesConfig: ShapeConfig[] = [
  { shape: Cell1, weight: 1 },
  { shape: Cell2, weight: 1 },
  { shape: Cell3, weight: 1 },
  { shape: Cell4, weight: 1 },
  { shape: Cell5, weight: 1 },
  { shape: Cell6, weight: 5 },
  { shape: Cell7, weight: 3 },
];

// Create weighted selector
const createWeightedSelector = (items: ShapeConfig[], seededRandom: () => number) => {
  const weightedArray: ShapeConfig[] = [];

  for (const item of items) {
    for (let i = 0; i < item.weight; i++) {
      weightedArray.push(item);
    }
  }

  return (): ShapeConfig =>
    weightedArray[Math.floor(seededRandom() * weightedArray.length)] ?? items[0]!;
};

// Individual shape component that manages its own interval
interface ShapeProps {
  x: number;
  y: number;
  colors: string[];
  strokeWidth: number;
  scale: number;
  shapeId: string;
  minInterval?: number;
  maxInterval?: number;
}

const Shape = ({
  x,
  y,
  colors,
  strokeWidth,
  scale,
  shapeId,
  minInterval = 0,
  maxInterval = 5000,
}: ShapeProps) => {
  const [currentShape, setCurrentShape] = useState<ShapeConfig>(() => {
    // Initialize with a random shape
    const seededRandom = seedPRNG(Math.random() * 1000);
    const pickShape = createWeightedSelector(shapesConfig, seededRandom);
    return pickShape();
  });

  useEffect(() => {
    const getRandomInterval = () => Math.random() * (maxInterval - minInterval) + minInterval;

    const updateShape = () => {
      const seededRandom = seedPRNG(Math.random() * 1000);
      const pickShape = createWeightedSelector(shapesConfig, seededRandom);
      setCurrentShape(pickShape());
    };

    // Set initial random interval
    let timeoutId = setTimeout(() => {
      updateShape();

      // Set up recurring random intervals
      const setNextTimeout = () => {
        timeoutId = setTimeout(() => {
          updateShape();
          setNextTimeout();
        }, getRandomInterval());
      };

      setNextTimeout();
    }, getRandomInterval());

    return () => clearTimeout(timeoutId);
  }, [minInterval, maxInterval]);

  const ShapeComponent = currentShape.shape;

  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform={`scale(${scale})`}>
        <ShapeComponent colors={colors} strokeWidth={strokeWidth} />
      </g>
    </g>
  );
};

interface BackgroundShapesProps {
  width?: number;
  height?: number;
  cellSize?: number;
  strokeWidth?: number;
  colors?: string[];
  className?: string;
  minInterval?: number;
  maxInterval?: number;
  /** Measure the parent container and render at its exact pixel size — cells stay
   * square and the grid re-tiles on resize, instead of stretching a fixed viewBox. */
  fill?: boolean;
}

export const BackgroundShapes = ({
  width = 500,
  height = 500,
  cellSize = 20,
  strokeWidth = 10,
  colors = ["white"],
  className = "",
  minInterval = 1000,
  maxInterval = 5000,
  fill = false,
}: BackgroundShapesProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!fill) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setMeasured({ width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  const effectiveWidth = fill ? (measured?.width ?? width) : width;
  const effectiveHeight = fill ? (measured?.height ?? height) : height;
  // fill mode tiles the whole container edge-to-edge; the 2-cell inset only suits
  // the fixed 500-square canvas — on a short banner it eats all but ~4 rows.
  const borderSize = fill ? 0 : cellSize * 2;
  const scale = 0.2;
  const colorsKey = colors.join("|");

  const shapes = useMemo<ReactNode[]>(() => {
    const list: ReactNode[] = [];
    for (let x = borderSize; x < effectiveWidth / 2; x += cellSize) {
      for (let y = borderSize; y < effectiveHeight - borderSize; y += cellSize) {
        list.push(
          <Shape
            key={`left-${x}-${y}`}
            x={x}
            y={y}
            colors={colors}
            strokeWidth={strokeWidth}
            scale={scale}
            shapeId={`left-${x}-${y}`}
            minInterval={minInterval}
            maxInterval={maxInterval}
          />,
          <Shape
            key={`right-${x}-${y}`}
            x={effectiveWidth - cellSize - x}
            y={y}
            colors={colors}
            strokeWidth={strokeWidth}
            scale={scale}
            shapeId={`right-${x}-${y}`}
            minInterval={minInterval}
            maxInterval={maxInterval}
          />,
        );
      }
    }
    return list;
    // colors identity may change per-render; use a stable join key instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWidth, effectiveHeight, cellSize, strokeWidth, colorsKey, borderSize, minInterval, maxInterval]);

  const svg = (
    <svg
      width={effectiveWidth}
      height={effectiveHeight}
      viewBox={`0 0 ${effectiveWidth} ${effectiveHeight}`}
      className={fill ? "absolute inset-0 h-full w-full" : className}
    >
      {shapes}
    </svg>
  );

  if (!fill) return svg;

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      {measured ? svg : null}
    </div>
  );
};

export default BackgroundShapes;

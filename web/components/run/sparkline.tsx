"use client";

interface SparklineProps {
  data: Array<{ timestamp: number; value: number }>;
  width?: number;
  height?: number;
  color?: string;
  showGradient?: boolean;
}

export function Sparkline({
  data,
  width = 200,
  height = 40,
  color = "#22c55e",
  showGradient = true,
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;

  // generate svg path points
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.value - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  // generate area path for gradient fill
  const areaPoints = `
    0,${height}
    ${points}
    ${width},${height}
  `;

  const gradientId = `sparkline-gradient-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        {showGradient && (
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>

      {/* filled area */}
      {showGradient && (
        <polygon
          points={areaPoints}
          fill={showGradient ? `url(#${gradientId})` : "none"}
        />
      )}

      {/* line */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        vectorEffect="non-scaling-stroke"
      />

      {/* end dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - ((data[data.length - 1].value - min) / range) * height}
          r="2"
          fill={color}
        />
      )}
    </svg>
  );
}

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface MetricsSparklineProps {
  metrics: MetricPoint[];
  width?: number;
  height?: number;
  type?: "cpu" | "memory" | "tokens" | "cost" | "duration";
}

export function MetricsSparkline({
  metrics,
  width = 200,
  height = 40,
  type = "cpu",
}: MetricsSparklineProps) {
  const colors = {
    cpu: "#22c55e",
    memory: "#3b82f6",
    tokens: "#a855f7",
    cost: "#eab308",
    duration: "#f97316",
  };

  return (
    <Sparkline
      data={metrics}
      width={width}
      height={height}
      color={colors[type]}
    />
  );
}

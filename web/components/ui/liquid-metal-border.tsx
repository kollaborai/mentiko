"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Liquid-metal border — jolyui's Liquid Metal Button effect (paper-design's
 * `liquidMetalFragmentShader` via `ShaderMount`) applied as a frame.
 *
 * The shader fills the whole card on a layer behind the content; an opaque inner
 * panel inset by `borderWidth` masks the centre, so the genuine liquid metal
 * shows only as a rim around every edge. Uniforms are the official ones from the
 * jolyui component (u_scale: 8 fills the surface, so the rim wraps the full
 * rectangle rather than pooling in one spot).
 */

type Uniforms = Record<string, number>;

const UNIFORMS: Uniforms = {
  u_repetition: 4,
  u_softness: 0.5,
  u_shiftRed: 0.3,
  u_shiftBlue: 0.3,
  u_distortion: 0,
  u_contour: 0,
  u_angle: 45,
  u_scale: 8,
  u_shape: 1,
  u_offsetX: 0.1,
  u_offsetY: -0.1,
};

// static metallic fallback if WebGL/shader init fails, so the rim never gaps.
const FALLBACK_METAL =
  "conic-gradient(from 210deg, #2b2c30, #d9dde3 12%, #6c7079 27%, #f4f6fa 44%, #3a3d44 60%, #b8bcc4 78%, #2b2c30)";

type LiquidMetalBorderProps = {
  children: ReactNode;
  /** className for the inner content panel (e.g. "bg-card rounded-md p-6"). */
  className?: string;
  /** outer corner radius in px (set to innerRadius + borderWidth for an even rim). */
  radius?: number;
  /** metal rim thickness in px. */
  borderWidth?: number;
  /** shader animation speed (0 = static). */
  speed?: number;
  style?: CSSProperties;
};

export function LiquidMetalBorder({
  children,
  className,
  radius = 14,
  borderWidth = 2,
  speed = 0.6,
  style,
}: LiquidMetalBorderProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mount: { destroy?: () => void; canvasElement?: HTMLCanvasElement } | null =
      null;
    let cancelled = false;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    (async () => {
      try {
        const { ShaderMount, liquidMetalFragmentShader } = await import(
          "@paper-design/shaders"
        );
        if (cancelled || !hostRef.current) return;
        mount = new ShaderMount(
          hostRef.current,
          liquidMetalFragmentShader,
          UNIFORMS,
          undefined,
          reduceMotion ? 0 : speed,
        );
        const canvas = mount?.canvasElement;
        if (canvas) {
          Object.assign(canvas.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            display: "block",
          });
        }
      } catch {
        // WebGL/shader unavailable — fallback gradient stays visible.
      }
    })();

    return () => {
      cancelled = true;
      try {
        mount?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, [speed]);

  return (
    <div
      className="relative isolate"
      style={{
        borderRadius: radius,
        padding: borderWidth,
        background: FALLBACK_METAL,
        ...style,
      }}
    >
      <div
        ref={hostRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ borderRadius: radius, zIndex: 0 }}
      />
      <div className={cn("relative", className)} style={{ zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}

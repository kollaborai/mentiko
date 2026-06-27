'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

export interface EntropyBannerProps {
  /** Any CSS color. Defaults to the inherited `currentColor` (theme-aware). */
  color?: string;
  /** Canvas background. Use 'transparent' to overlay on a section. Default '#000'. */
  background?: string;
  /** Additive 'lighter' compositing for the neon-on-dark glow. Set false on light themes. Default true. */
  glow?: boolean;
  /** Grid cell size in CSS px — smaller = denser. Default 26. */
  spacing?: number;
  /** Animation speed multiplier. Default 1. 0 renders a single static frame. */
  speed?: number;
  /** Chaos displacement factor (× spacing). Default 1.12. */
  amplitude?: number;
  /** Feather the mesh to transparent around all edges (vignette). Default false. */
  edgeFade?: boolean;
  /**
   * Direction the order→chaos seam sweeps.
   * 'horizontal' = left→right, 'vertical' = top→bottom,
   * 'diagonal' = top-left→bottom-right, 'diagonal-alt' = top-right→bottom-left.
   * Default 'diagonal'.
   */
  orientation?: 'horizontal' | 'vertical' | 'diagonal' | 'diagonal-alt';
  /** Force pause regardless of visibility. */
  paused?: boolean;
  /** Render the built-in telemetry panel on the right edge. Default false. */
  showStatus?: boolean;
  /** Heading shown above the status panel. Default '010 · ENTROPY'. */
  statusLabel?: string;
  /** Show the per-metric labels (ENTROPY/NODES/LINKS/STATE) beside values. Default true. */
  showStatusLabels?: boolean;
  /** Live stats callback (throttled to ~10/s). Use to drive your own HUD. */
  onStats?: (stats: EntropyStats) => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible label; defaults to a sensible description. */
  ariaLabel?: string;
}

/** Live readout pushed to the status panel / onStats callback each tick. */
export interface EntropyStats { entropy: number; nodes: number; links: number; state: string; }

/** Resolve any CSS color string to [r,g,b] (0–255). Falls back to white. */
function toRGB(css: string): [number, number, number] {
  if (typeof document === 'undefined') return [255, 255, 255];
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return [255, 255, 255];
  ctx.fillStyle = '#fff';
  ctx.fillStyle = css; // browser normalizes to #rrggbb or rgb(a)(...)
  const v = ctx.fillStyle as string;
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = v.match(/(\d+(?:\.\d+)?)/g);
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  return [255, 255, 255];
}

/** Compact seeded perlin-ish value noise → ~[-1, 1]. */
function makeNoise(seed: number) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const grad = (h: number, x: number, y: number) => (h & 1 ? -x : x) + (h & 2 ? -y : y);
  return (x: number, y: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, x, y), grad(ba, x - 1, y), u),
      lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u),
      v,
    );
  };
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

interface Node { i: number; j: number; hx: number; hy: number; x: number; y: number; e: number; }

/**
 * "Entropy" — an ordered lattice that melts through a glowing seam into a
 * chaotic proximity web. Recreation of lab.xubh.me/sketches/010 as a banner.
 * Pure 2D canvas, no dependencies.
 */
export default function EntropyBanner({
  color,
  background = '#000',
  glow = true,
  spacing = 26,
  speed = 1,
  amplitude = 1.12,
  orientation = 'diagonal',
  edgeFade = false,
  paused = false,
  showStatus = false,
  statusLabel = '010 · ENTROPY',
  showStatusLabels = true,
  onStats,
  className,
  style,
  ariaLabel = 'Animated generative mesh transitioning from an ordered grid into chaos',
}: EntropyBannerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  // Live props for the rAF loop without re-subscribing every render.
  const props = useRef({ color, background, glow, spacing, speed, amplitude, orientation, paused, onStats });

  useEffect(() => {
    props.current = { color, background, glow, spacing, speed, amplitude, orientation, paused, onStats };
  }, [color, background, glow, spacing, speed, amplitude, orientation, paused, onStats]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const canvasEl = canvas;
    const context = ctx;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const nA = makeNoise(1337), nB = makeNoise(99173), nS = makeNoise(424242);

    let W = 0, H = 0, cols = 0, rows = 0;
    let nodes: Node[] = [];
    const idx = (i: number, j: number) => j * cols + i;

    // Cache the resolved color so toRGB (which allocates) only runs when it changes.
    let colorKey = '', rgb = '255,255,255';
    function resolveColor() {
      const src = props.current.color ?? getComputedStyle(canvasEl).color;
      if (src !== colorKey) {
        colorKey = src;
        const [r, g, b] = toRGB(src);
        rgb = `${r},${g},${b}`;
      }
      return rgb;
    }

    function build() {
      const r = canvasEl.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvasEl.width = Math.round(W * DPR);
      canvasEl.height = Math.round(H * DPR);
      context.setTransform(DPR, 0, 0, DPR, 0, 0);
      const s = props.current.spacing;
      // expand the grid past every edge by the max chaos displacement, so the
      // visible area is always fully interior — no gaps even where nodes scatter
      const margin = props.current.amplitude * s + s;
      cols = Math.max(2, Math.ceil((W + 2 * margin) / s) + 1);
      rows = Math.max(2, Math.ceil((H + 2 * margin) / s) + 1);
      const ox = (W - (cols - 1) * s) / 2, oy = (H - (rows - 1) * s) / 2;
      nodes = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          nodes.push({ i, j, hx: ox + i * s, hy: oy + j * s, x: 0, y: 0, e: 0 });
    }

    function render(t: number) {
      const { spacing: s, amplitude: ampF, glow: glw, background: bg, orientation: ori } = props.current;
      const col = resolveColor();
      const amp = ampF * s, R = 2.6 * s, win = 3;
      const front = 0.54 + 0.2 * Math.sin(t * 0.16);

      let sumE = 0;
      for (const n of nodes) {
        const ax = n.hx / W, ay = n.hy / H;
        let u: number, along: number;
        if (ori === 'horizontal') { u = ax; along = n.hy; }
        else if (ori === 'vertical') { u = ay; along = n.hx; }
        else if (ori === 'diagonal-alt') { u = ((1 - ax) + ay) / 2; along = n.hx + n.hy; }
        else { u = (ax + ay) / 2; along = n.hx - n.hy; } // diagonal (default)
        const wobble = nS(along * 0.03, t * 0.08) * 0.1;
        const e = smooth(front - 0.13, front + 0.13, u + wobble);
        n.e = e;
        sumE += e;
        const dx = nA(n.hx * 0.012, n.hy * 0.012 + t * 0.16);
        const dy = nB(n.hx * 0.012, n.hy * 0.012 + t * 0.16);
        n.x = n.hx + e * amp * dx;
        n.y = n.hy + e * amp * dy;
      }
      let linkCount = 0;

      context.globalCompositeOperation = 'source-over';
      if (bg === 'transparent') context.clearRect(0, 0, W, H);
      else { context.fillStyle = bg; context.fillRect(0, 0, W, H); }
      context.globalCompositeOperation = glw ? 'lighter' : 'source-over';
      context.lineWidth = 1;

      // ordered edges: right, down, both diagonals — fade as chaos rises
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const a = nodes[idx(i, j)];
          const links: Node[] = [];
          if (i < cols - 1) links.push(nodes[idx(i + 1, j)]);
          if (j < rows - 1) links.push(nodes[idx(i, j + 1)]);
          if (i < cols - 1 && j < rows - 1) links.push(nodes[idx(i + 1, j + 1)]);
          if (i > 0 && j < rows - 1) links.push(nodes[idx(i - 1, j + 1)]);
          for (const b of links) {
            const al = 0.34 * Math.pow(1 - (a.e + b.e) / 2, 1.6);
            if (al < 0.01) continue;
            context.strokeStyle = `rgba(${col},${al})`;
            context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
            linkCount++;
          }
        }

      // chaos edges: nearby nodes within reach — rise as chaos takes over
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const a = nodes[idx(i, j)];
          if (a.e < 0.04) continue;
          for (let dj = 0; dj <= win; dj++)
            for (let di = -win; di <= win; di++) {
              if (dj === 0 && di <= 0) continue;
              const ni = i + di, nj = j + dj;
              if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
              const b = nodes[idx(ni, nj)];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (d > R) continue;
              const al = 0.4 * ((a.e + b.e) / 2) * (1 - d / R);
              if (al < 0.01) continue;
              context.strokeStyle = `rgba(${col},${al})`;
              context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
              linkCount++;
            }
        }

      // nodes — brighter at the transition seam
      for (const n of nodes) {
        const heat = 1 - Math.abs(n.e - 0.5) * 2;
        context.fillStyle = `rgba(${col},${0.5 + 0.45 * heat})`;
        context.beginPath(); context.arc(n.x, n.y, 1.5 * (1 + 0.5 * heat), 0, Math.PI * 2); context.fill();
      }

      pushStats(nodes.length ? sumE / nodes.length : 0, nodes.length, linkCount);
    }

    // ---- status telemetry (throttled to ~10/s) ----
    let lastStat = -1;
    function pushStats(entropy: number, nodeCount: number, links: number) {
      if (t - lastStat < 0.1) return;
      lastStat = t;
      const state = entropy < 0.34 ? 'ORDERED' : entropy < 0.62 ? 'DRIFTING' : 'CHAOTIC';
      props.current.onStats?.({ entropy, nodes: nodeCount, links, state });
      const el = statusRef.current;
      if (!el) return;
      const set = (k: string, v: string) => {
        const t = el.querySelector<HTMLElement>(`[data-k="${k}"]`);
        if (t) t.textContent = v;
      };
      set('entropy', entropy.toFixed(3));
      set('nodes', String(nodeCount));
      set('links', links.toLocaleString());
      set('state', state);
      const bar = el.querySelector<HTMLElement>('[data-bar]');
      if (bar) bar.style.width = `${Math.round(entropy * 100)}%`;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, t = 0, visible = true;

    function loop() {
      const { paused: isPaused, speed: spd } = props.current;
      if (!isPaused && visible) t += 0.016 * spd;
      render(t);
      raf = requestAnimationFrame(loop);
    }

    build();

    const ro = new ResizeObserver(() => build());
    ro.observe(canvasEl);

    const io = new IntersectionObserver(
      ([entry]) => { visible = entry.isIntersecting; },
      { threshold: 0 },
    );
    io.observe(canvasEl);

    if (reduceMotion) {
      t = 12; // a representative static frame
      build();
      render(t);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const fadeMask = edgeFade
    ? 'radial-gradient(125% 120% at 50% 50%, #000 60%, transparent 100%)'
    : undefined;

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', color: 'currentColor', ...style }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{
          display: 'block', width: '100%', height: '100%', color: 'currentColor',
          maskImage: fadeMask, WebkitMaskImage: fadeMask,
        }}
      />
      {showStatus && (
        <div
          ref={statusRef}
          aria-hidden
          style={{
            position: 'absolute', right: 'clamp(16px, 4%, 48px)', top: '50%',
            transform: 'translateY(-50%)', textAlign: 'right', pointerEvents: 'none',
            fontFamily: mono, color: 'currentColor', lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.22em', opacity: 0.55, marginBottom: 14 }}>
            {statusLabel}
          </div>
          {([['entropy', 'ENTROPY'], ['nodes', 'NODES'], ['links', 'LINKS'], ['state', 'STATE']] as const).map(
            ([k, lbl]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, alignItems: 'baseline' }}>
                {showStatusLabels && (
                  <span style={{ fontSize: 9, letterSpacing: '0.18em', opacity: 0.45 }}>{lbl}</span>
                )}
                <span data-k={k} style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', minWidth: 64 }}>
                  —
                </span>
              </div>
            ),
          )}
          <div style={{ marginTop: 12, marginLeft: 'auto', width: 120, height: 2, background: 'currentColor', opacity: 0.18 }}>
            <div data-bar style={{ height: '100%', width: '0%', background: 'currentColor', opacity: 1, transition: 'width 0.1s linear' }} />
          </div>
        </div>
      )}
    </div>
  );
}

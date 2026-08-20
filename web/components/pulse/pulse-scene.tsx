"use client";

// The Pulse 3D scene. Follows the house r3f convention (see components/ui/grid-bloom.tsx):
// raw <Canvas> + three + AdditiveBlending for glow, no drei / no postprocessing.
// OrbitControls comes from three/examples (ships with three) — zero new deps.
//
// Nodes are STATIC in world space (positions come from the pure model) so links,
// hover, and labels never desync; the "alive" feeling comes from the auto-orbiting
// camera, per-orb breathe/pulse, traveling packets along links, and agent satellites.

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PulseNode, PulseLink, PulseScene as PulseSceneData } from "./pulse-model";

export interface PulseHover {
  node: PulseNode;
  x: number;
  y: number;
}

interface PulseSceneProps {
  scene: PulseSceneData;
  showLabels: boolean;
  onHover: (hover: PulseHover | null) => void;
  onSelect: (actionUrl: string) => void;
}

// ---- shared textures (built once) ----

let _haloTex: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (_haloTex) return _haloTex;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _haloTex = new THREE.CanvasTexture(c);
  return _haloTex;
}

const _labelCache = new Map<string, { tex: THREE.Texture; aspect: number }>();
function labelTexture(text: string): { tex: THREE.Texture; aspect: number } {
  const cached = _labelCache.get(text);
  if (cached) return cached;
  const pad = 16;
  const font = "600 40px 'JetBrains Mono', ui-monospace, monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 40 + pad * 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(240,240,245,0.92)";
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const entry = { tex, aspect: w / h };
  _labelCache.set(text, entry);
  return entry;
}

// ---- one orb (mesh + additive halo + optional label + agent satellites) ----

function phaseScale(phase: PulseNode["phase"], t: number): number {
  switch (phase) {
    case "check": return 1 + Math.sin(t * 6) * 0.1;
    case "alert": return 1 + Math.abs(Math.sin(t * 4)) * 0.14;
    case "dim": return 0.92;
    case "settle":
    case "breathe":
    default: return 1 + Math.sin(t * 1.5) * 0.05;
  }
}
function phaseHalo(phase: PulseNode["phase"], t: number): number {
  switch (phase) {
    case "check": return 0.75 + Math.sin(t * 6) * 0.2;
    case "alert": return 0.6 + Math.abs(Math.sin(t * 4)) * 0.35;
    case "dim": return 0.16;
    default: return 0.48 + Math.sin(t * 1.5) * 0.14;
  }
}

function Orb({ node, showLabels, onHover, onSelect }: {
  node: PulseNode;
  showLabels: boolean;
  onHover: (h: PulseHover | null) => void;
  onSelect: (url: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.SpriteMaterial>(null);
  const satellites = useRef<THREE.Group>(null);
  const mounted = useRef<number | null>(null);
  const color = useMemo(() => new THREE.Color(node.color), [node.color]);
  const haloScale = node.radius * (node.kind === "core" ? 7 : 5.2);
  const satCount = node.kind === "run" ? Math.min(node.agentsActive ?? 0, 6) : 0;
  const labeled = showLabels && node.kind !== "queue";

  useFrame((state) => {
    const t = state.clock.elapsedTime + node.position[0] + node.position[2];
    // spawn pop: ease 0->1 over ~0.6s so dispatched runs "materialize"
    if (mounted.current === null) mounted.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - mounted.current;
    const pop = Math.min(1, age / 0.6);
    const s = phaseScale(node.phase, t) * (0.4 + 0.6 * pop);
    if (orb.current) orb.current.scale.setScalar(s);
    if (haloMat.current) haloMat.current.opacity = phaseHalo(node.phase, t) * pop;
    if (satellites.current) satellites.current.rotation.y = state.clock.elapsedTime * 1.4;
    // gentle vertical bob for depth (runs + gates)
    if (group.current && (node.kind === "run" || node.kind === "gate")) {
      group.current.position.y = node.position[1] + Math.sin(t * 0.9) * 0.15;
    }
  });

  const handleOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = node.actionUrl ? "pointer" : "default";
    onHover({ node, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  }, [node, onHover]);
  const handleMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onHover({ node, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  }, [node, onHover]);
  const handleOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "default";
    onHover(null);
  }, [onHover]);
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (node.actionUrl) onSelect(node.actionUrl);
  }, [node, onSelect]);

  const halo = haloTexture();
  const label = labeled ? labelTexture(node.label) : null;
  /* eslint-disable react/no-unknown-property */
  return (
    <group ref={group} position={node.position}>
      <mesh
        ref={orb}
        onPointerOver={handleOver}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[node.radius, 32, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>

      {/* additive glow halo */}
      <sprite scale={[haloScale, haloScale, 1]}>
        <spriteMaterial
          ref={haloMat}
          map={halo}
          color={color}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      {/* progress ring for runs */}
      {node.kind === "run" && node.progress !== undefined && node.progress > 0 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[node.radius * 1.35, node.radius * 1.55, 48, 1, 0, Math.PI * 2 * node.progress]} />
          <meshBasicMaterial color={"#e8fff4"} transparent opacity={0.85} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}

      {/* agent satellites (the runners being watched) */}
      {satCount > 0 && (
        <group ref={satellites}>
          {Array.from({ length: satCount }).map((_, i) => {
            const a = (i / satCount) * Math.PI * 2;
            const r = node.radius + 0.55;
            return (
              <mesh key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
                <sphereGeometry args={[0.12, 12, 12]} />
                <meshBasicMaterial color={"#dff3ff"} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      )}

      {/* label sprite below the orb */}
      {label && (
        <sprite position={[0, -(node.radius + 0.7), 0]} scale={[label.aspect * 0.85, 0.85, 1]}>
          <spriteMaterial map={label.tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
        </sprite>
      )}
    </group>
  );
  /* eslint-enable react/no-unknown-property */
}

// ---- one link (glowing tube + traveling packet) ----

function LinkTube({ link, positions }: { link: PulseLink; positions: Map<string, [number, number, number]> }) {
  const packet = useRef<THREE.Mesh>(null);
  const from = positions.get(link.from);
  const to = positions.get(link.to);

  const curve = useMemo(() => {
    if (!from || !to) return null;
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += a.distanceTo(b) * 0.18 + 0.8; // gentle arc
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }, [from, to]);

  const tubeGeom = useMemo(() => (curve ? new THREE.TubeGeometry(curve, 28, 0.028, 8, false) : null), [curve]);
  useEffect(() => () => tubeGeom?.dispose(), [tubeGeom]);
  const color = useMemo(() => new THREE.Color(link.color), [link.color]);
  const speed = link.kind === "watch" ? 0.35 : 0.6;

  useFrame((state) => {
    if (packet.current && curve && link.active) {
      const tt = (state.clock.elapsedTime * speed) % 1;
      curve.getPointAt(tt, packet.current.position);
    }
  });

  if (!curve || !tubeGeom) return null;
  /* eslint-disable react/no-unknown-property */
  return (
    <group>
      <mesh geometry={tubeGeom}>
        <meshBasicMaterial color={color} transparent opacity={link.active ? 0.32 : 0.12} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {link.active && (
        <mesh ref={packet}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
  /* eslint-enable react/no-unknown-property */
}

// ---- starfield backdrop ----

function Starfield() {
  const geom = useMemo(() => {
    const n = 900;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // shell of stars around the scene
      const r = 34 + Math.random() * 40;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(ph) * Math.cos(th);
      arr[i * 3 + 1] = r * Math.cos(ph);
      arr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  /* eslint-disable react/no-unknown-property */
  return (
    <points geometry={geom}>
      <pointsMaterial color={"#8891a8"} size={0.14} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
    </points>
  );
  /* eslint-enable react/no-unknown-property */
}

// ---- auto-orbiting camera (three/examples OrbitControls, no drei) ----

function CameraControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useMemo(() => new ThreeOrbitControls(camera, gl.domElement), [camera, gl]);
  useEffect(() => {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 40;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controls.target.set(0, 0, 0);
    return () => controls.dispose();
  }, [controls]);
  useFrame(() => controls.update());
  return null;
}

// ---- scene root ----

function SceneRoot({ scene, showLabels, onHover, onSelect }: PulseSceneProps) {
  const positions = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const n of scene.nodes) m.set(n.id, n.position);
    return m;
  }, [scene.nodes]);
  /* eslint-disable react/no-unknown-property */
  return (
    <>
      <color attach="background" args={["#060607"]} />
      <fogExp2 attach="fog" args={["#060607", 0.023]} />
      <ambientLight intensity={0.4} />
      <Starfield />
      {scene.links.map((l) => (
        <LinkTube key={l.id} link={l} positions={positions} />
      ))}
      {scene.nodes.map((n) => (
        <Orb key={n.id} node={n} showLabels={showLabels} onHover={onHover} onSelect={onSelect} />
      ))}
      <CameraControls />
    </>
  );
  /* eslint-enable react/no-unknown-property */
}

export default function PulseSceneCanvas(props: PulseSceneProps) {
  const [dpr, setDpr] = useState(1);
  useEffect(() => setDpr(Math.min(2, window.devicePixelRatio || 1)), []);
  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [0, 9, 19], fov: 55, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => props.onHover(null)}
    >
      <SceneRoot {...props} />
    </Canvas>
  );
}

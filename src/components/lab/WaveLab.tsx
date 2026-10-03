"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The wave lab.
 *
 * The sea surface is a Gerstner sum whose amplitude, period and heading come from
 * real data: either the conditions frozen into a session, or today's live swell.
 * The reef is a seabed profile in the same coordinates the cross-section uses, and
 * the wave only breaks where the water is shallow enough (H/d = 0.78).
 *
 * The peel is the real thing: the breaking point travels along the reef at
 * c = sqrt(g * depth), and the rider has to stay in the pocket between the
 * whitewater and the section. Get ahead of it and it closes out. Fall behind and
 * you are in the foam.
 */

export interface LabConditions {
  breakName: string;
  breakType: string;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirDeg: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  tideM: number | null;
  depthAtBreakM: number;
  peelSpeedKmh: number | null;
  breakHeightM: number | null;
  band: string;
  score: number;
  sourceLabel: string;
}

interface RideResult {
  durationSec: number;
  longestRideSec: number;
  topSpeedKmh: number;
  completed: boolean;
  reason: string;
}

const REEF_X = -6;
const FACE_WIDTH = 34;
const RIDGE_Z = -140;
const RIDGE_SPACING = 22;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uPeriod;
uniform vec2  uDir;
uniform float uTide;

varying vec3 vWorld;
varying float vSteep;
varying float vCrest;

// Seabed depth below chart datum, mirroring the cross-section profile.
float seabed(vec2 p) {
  float shelf = mix(13.0, 0.35, smoothstep(-46.0, 4.0, p.x));
  float ridge = 0.0;
  for (int i = 0; i < 5; i++) {
    float rz = ${RIDGE_Z.toFixed(1)} + float(i) * ${RIDGE_SPACING.toFixed(1)};
    ridge += exp(-pow((p.x + ${REEF_X.toFixed(1)}) * 0.22, 2.0)) * exp(-pow((p.y - rz) * 0.10, 2.0)) * 1.5;
  }
  return max(0.25, shelf - ridge);
}

// Gerstner wave, summed four times with rotating headings.
vec3 gerstner(vec2 dir, float amplitude, float wavelength, float steep, vec2 p, float t, out float crest) {
  float k = 6.28318 / wavelength;
  float c = sqrt(9.80665 / k * tanh(min(k * 6.0, 8.0)));
  vec2 d = normalize(dir);
  float f = k * dot(d, p) - c * k * t;
  float a = amplitude;
  crest = sin(f);
  float q = steep / (k * max(a, 0.02) * 4.0);
  float x = q * a * d.x * cos(f);
  float z = q * a * d.y * cos(f);
  float y = a * sin(f);
  return vec3(x, y, z);
}

void main() {
  vec3 pos = position;
  vec2 p = vec2(pos.x + 0.0, pos.z + 0.0);
  float depth = seabed(p);
  float usable = clamp(depth + uTide, 0.15, 14.0);

  // Shoaling: waves get taller and shorter as the water shallows.
  float shoal = pow(clamp(13.0 / usable, 0.35, 3.2), 0.25);
  float amp = uHeight * 0.34 * clamp(shoal, 0.5, 2.1);
  float lambda = max(uPeriod * 1.35 * (0.72 / clamp(shoal, 0.6, 2.0)), 6.0);

  float d0 = 0.0, d1 = 0.0, d2 = 0.0, d3 = 0.0;
  vec2 dir0 = uDir;
  vec2 dir1 = normalize(uDir + vec2(0.28, 0.16));
  vec2 dir2 = normalize(uDir - vec2(0.22, 0.24));
  vec2 dir3 = normalize(uDir + vec2(0.06, -0.30));

  vec3 g = vec3(0.0);
  g += gerstner(dir0, amp, lambda, 0.72, p, uTime, d0);
  g += gerstner(dir1, amp * 0.55, lambda * 0.78, 0.60, p, uTime, d1);
  g += gerstner(dir2, amp * 0.34, lambda * 0.61, 0.52, p, uTime, d2);
  g += gerstner(dir3, amp * 0.22, lambda * 0.47, 0.44, p, uTime, d3);

  // Only the swell that can stand up in this depth survives.
  float standing = smoothstep(0.15, 0.75, usable);
  g *= mix(0.55, 1.0, standing);

  float bedY = -depth;
  pos.y += g.y + (uTide - 0.0);
  pos.x += g.x;
  pos.z += g.z;
  pos.y = max(pos.y, bedY + 0.06);

  vWorld = pos;
  vCrest = d0;
  vSteep = (abs(d0) + abs(d1) * 0.6 + abs(d2) * 0.4) * standing;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uHeight;
uniform float uTide;
uniform float uPeelZ;
uniform float uFoamZ;
uniform float uPlayerZ;
uniform vec3  uSun;

varying vec3 vWorld;
varying float vSteep;
varying float vCrest;

float seabed(vec2 p) {
  float shelf = mix(13.0, 0.35, smoothstep(-46.0, 4.0, p.x));
  float ridge = 0.0;
  for (int i = 0; i < 5; i++) {
    float rz = ${RIDGE_Z.toFixed(1)} + float(i) * ${RIDGE_SPACING.toFixed(1)};
    ridge += exp(-pow((p.x + ${REEF_X.toFixed(1)}) * 0.22, 2.0)) * exp(-pow((p.y - rz) * 0.10, 2.0)) * 1.5;
  }
  return max(0.25, shelf - ridge);
}

void main() {
  float depth = seabed(vWorld.xz);
  float water = max(depth + uTide, 0.02);

  vec3 shallow = vec3(0.56, 0.90, 0.86);
  vec3 mid     = vec3(0.10, 0.55, 0.62);
  vec3 abyss   = vec3(0.02, 0.16, 0.28);
  vec3 bed     = vec3(0.86, 0.80, 0.62);

  vec3 color = mix(shallow, mid, smoothstep(0.4, 2.6, water));
  color = mix(color, abyss, smoothstep(2.6, 11.0, water));
  // Sand shows through where it is thin.
  color = mix(bed, color, smoothstep(0.25, 2.2, water));

  // Where the swell stands up on the reef it goes white.
  float breaking = smoothstep(0.30, 0.05, water) * step(0.15, uHeight);
  float crest = smoothstep(0.55, 0.95, vCrest);
  float foam = clamp(breaking * 1.2 + crest * smoothstep(3.0, 0.6, water) * 0.8, 0.0, 1.0);

  // Whitewater behind the peel, plus the set ahead of it.
  float foamZ = smoothstep(2.0, -2.0, vWorld.z - uFoamZ);
  foam = clamp(foam + foamZ * 0.85, 0.0, 1.0);

  // Lip highlight on the peeling section itself.
  float section = exp(-pow((vWorld.z - uPeelZ) * 0.055, 2.0)) * smoothstep(2.2, 0.4, water);
  color = mix(color, vec3(1.0, 0.99, 0.94), clamp(section * 0.75 + foam, 0.0, 1.0));

  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 lightDir = normalize(uSun);
  float diff = max(dot(normalize(vec3(0.0, 1.0, 0.0)), lightDir), 0.0);
  vec3 halfV = normalize(lightDir + viewDir);
  float spec = pow(max(dot(vec3(0.0, 1.0, 0.0), halfV), 0.0), 42.0);
  float fres = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), viewDir), 0.0), 3.0);

  vec3 outColor = color * (0.72 + 0.42 * diff);
  outColor += vec3(1.0, 0.95, 0.85) * spec * (0.35 + 0.5 * breaking);
  outColor = mix(outColor, vec3(0.86, 0.96, 0.98), fres * 0.35);

  gl_FragColor = vec4(outColor, 1.0);
}
`;

function buildScene(canvas: HTMLCanvasElement, conditions: LabConditions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ecbdd);
  scene.fog = new THREE.Fog(0x9ecbdd, 150, 340);

  const camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

  const swell = Math.max(0.2, conditions.swellHeightM ?? 1.2);
  const period = Math.max(6, conditions.swellPeriodS ?? 12);
  // Swell travels toward +x, so a swell "from 155°" heads at 155-180 = -25°.
  const headingRad = (((conditions.swellDirDeg ?? 150) - 180) * Math.PI) / 180;

  const uniforms = {
    uTime: { value: 0 },
    uHeight: { value: swell },
    uPeriod: { value: period },
    uDir: { value: new THREE.Vector2(Math.cos(headingRad), Math.sin(headingRad)) },
    uTide: { value: conditions.tideM ?? 0.4 },
    uPeelZ: { value: 0 },
    uFoamZ: { value: -FACE_WIDTH },
    uPlayerZ: { value: 0 },
    uSun: { value: new THREE.Vector3(-0.4, 0.85, 0.3) },
  };

  const geometry = new THREE.PlaneGeometry(220, 320, 220, 240);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
  const water = new THREE.Mesh(geometry, material);
  water.frustumCulled = false;
  scene.add(water);

  // The board, plus a white outline so the rider is always findable against foam.
  const board = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.18, 3.4),
    new THREE.MeshBasicMaterial({ color: 0xff6a2b }),
  );
  const outline = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.3, 3.7),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  );
  const rider = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.1, 4, 10),
    new THREE.MeshBasicMaterial({ color: 0x0a2f36 }),
  );
  rider.position.y = 0.9;
  rider.rotation.z = Math.PI / 2.4;
  board.add(outline, deck, rider);
  scene.add(board);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  scene.add(marker);

  return {
    renderer,
    scene,
    camera,
    uniforms,
    board,
    marker,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      board.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export function WaveLab({
  conditions,
  sessionId,
}: {
  conditions: LabConditions;
  sessionId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ReturnType<typeof buildScene> | null>(null);
  const [rideState, setRideState] = useState<"idle" | "riding" | "finished">("idle");
  const [telemetry, setTelemetry] = useState({ elapsed: 0, score: 0, topSpeed: 0, longest: 0, pocket: 0 });
  const [result, setResult] = useState<RideResult | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const keys = useRef<Record<string, boolean>>({});
  const runtime = useRef({
    running: false,
    elapsed: 0,
    z: 0,
    x: -13,
    peelZ: 0,
    speed: 0,
    topSpeed: 0,
    score: 0,
    longest: 0,
    lastFrame: 0,
  });

  /** Peel speed in metres per second, from the engine's km/h. */
  const peelMps = useMemo(() => (conditions.peelSpeedKmh ?? 14) / 3.6, [conditions.peelSpeedKmh]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: ReturnType<typeof buildScene> | null = null;
    try {
      engine = buildScene(canvas, conditions);
      engineRef.current = engine;
    } catch (error) {
      setSaveError(
        `WebGL could not start in this browser (${error instanceof Error ? error.message : "unknown"}). The saved data below still works.`,
      );
    }

    const resize = () => {
      if (!engine) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      engine.renderer.setSize(width, height, false);
      engine.camera.aspect = width / height;
      engine.camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (!engine) return;
      const rt = runtime.current;
      const dt = rt.lastFrame === 0 ? 0.016 : Math.min((time - rt.lastFrame) / 1000, 0.05);
      rt.lastFrame = time;

      const state = engine.uniforms;
      state.uTime.value += dt;

      if (rt.running) {
        rt.elapsed += dt;
        rt.peelZ += peelMps * dt;

        const pump = keys.current.KeyW || keys.current.ArrowUp;
        const ease = keys.current.KeyS || keys.current.ArrowDown;
        const target =
          (pump ? 1.16 : 1) *
          (ease ? 0.78 : 1) *
          peelMps *
          (0.72 + 0.5 * Math.min(1, rt.elapsed / 3));
        rt.speed += (target - rt.speed) * Math.min(1, dt * 2.4);
        rt.topSpeed = Math.max(rt.topSpeed, rt.speed);

        const steer = (keys.current.KeyD || keys.current.ArrowRight ? 1 : 0) - (keys.current.KeyA || keys.current.ArrowLeft ? 1 : 0);
        rt.x = Math.max(-19, Math.min(-1.5, rt.x + steer * dt * 7.5));
        rt.z += rt.speed * dt;

        // Steepness reward: the steeper part of the face gives you more lines.
        const steep = 1 - Math.min(1, Math.abs(rt.x + 6) / 13);
        const carve = 0.55 + steep * 0.9;
        const inPocket = rt.z > rt.peelZ - FACE_WIDTH - 6 && rt.z < rt.peelZ - 3;
        rt.score += dt * 100 * carve * (inPocket ? 1 : 0.25);
        rt.longest = Math.max(rt.longest, inPocket ? rt.elapsed : 0);

        const finished = rt.z > rt.peelZ - 2.5;
        const ateIt = rt.z < rt.peelZ - FACE_WIDTH - 5;
        if (finished || ateIt || rt.elapsed > 60 || keys.current.Space) {
          rt.running = false;
          const completed = !finished && !ateIt;
          setResult({
            durationSec: Math.round(rt.elapsed),
            longestRideSec: Math.round(completed ? rt.elapsed : rt.longest),
            topSpeedKmh: Number((rt.topSpeed * 3.6).toFixed(1)),
            completed,
            reason: finished
              ? "You got in front of the section and it closed out."
              : ateIt
                ? "You fell behind the whitewater."
                : keys.current.Space
                  ? "Kicked out clean."
                  : "Time limit reached.",
          });
          setRideState("finished");
        }
        setTelemetry({
          elapsed: rt.elapsed,
          score: rt.score,
          topSpeed: rt.topSpeed * 3.6,
          longest: rt.longest,
          pocket: rt.peelZ - rt.z,
        });
      }

      state.uPeelZ.value = runtime.current.peelZ;
      state.uFoamZ.value = runtime.current.peelZ - FACE_WIDTH;
      state.uPlayerZ.value = runtime.current.z;

      const rt2 = runtime.current;
      engine.board.position.set(rt2.x, rt2.running ? 0.5 : 0.3, rt2.z);
      engine.board.rotation.z = -((keys.current.KeyD ? 1 : 0) - (keys.current.KeyA ? 1 : 0)) * 0.28;
      engine.marker.position.set(-6, 2.2, rt2.peelZ);

      // Sit high enough behind the rider that the board, the face and the peeling
      // section are all in frame at once.
      const camX = rt2.x - 6.0;
      const camZ = rt2.z - 15;
      engine.camera.position.lerp(new THREE.Vector3(camX, 8.2, camZ), Math.min(1, dt * 3.4));
      engine.camera.lookAt(rt2.x + 0.8, 0.4, rt2.z + 17);

      engine.renderer.render(engine.scene, engine.camera);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      engine?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peelMps]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
    };
    const up = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function start() {
    const rt = runtime.current;
    rt.running = true;
    rt.elapsed = 0;
    rt.z = 0;
    rt.peelZ = 6;
    rt.x = -13;
    rt.speed = peelMps;
    rt.score = 0;
    rt.topSpeed = 0;
    rt.longest = 0;
    setResult(null);
    setSaveState("idle");
    setRideState("riding");
  }

  async function save() {
    if (!sessionId || !result) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/rides`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          durationSec: result.durationSec,
          longestRideSec: result.longestRideSec,
          topSpeedKmh: result.topSpeedKmh,
          completed: result.completed,
        }),
      });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setSaveError(body.error?.message ?? `Saving failed with HTTP ${response.status}.`);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "The ride could not be saved.");
      setSaveState("error");
    }
  }

  const pocketGood = telemetry.pocket > 4 && telemetry.pocket < FACE_WIDTH - 2;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="border border-rule bg-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2">
          <span className="label">Live surface · {conditions.breakName}</span>
          <span className="text-xs text-ink-faint">
            Hs {conditions.swellHeightM === null ? "—" : `${conditions.swellHeightM.toFixed(2)} m`} · Tp{" "}
            {conditions.swellPeriodS === null ? "—" : `${conditions.swellPeriodS.toFixed(0)} s`} · from{" "}
            {conditions.swellDirDeg === null ? "—" : `${Math.round(conditions.swellDirDeg)}°`}
          </span>
        </div>

        <div className="relative bg-abyss-deep">
          <canvas ref={canvasRef} className="h-[420px] w-full" aria-label="WebGL view of a peeling wave generated from real swell data" />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3 font-mono text-xs text-paper">
            <span className="bg-ink/70 px-2 py-1">
              {rideState === "riding"
                ? `${telemetry.elapsed.toFixed(1)}s · ${telemetry.score.toFixed(0)} pts · ${telemetry.topSpeed.toFixed(1)} km/h`
                : rideState === "finished"
                  ? "ride over"
                  : "ready"}
            </span>
            <span className={`bg-ink/70 px-2 py-1 ${rideState === "riding" && pocketGood ? "text-lagoon" : "text-paper"}`}>
              pocket {telemetry.pocket.toFixed(0)} m {rideState === "riding" ? (pocketGood ? "· in the pocket" : "· outside") : ""}
            </span>
          </div>
        </div>

        <div className="space-y-3 border-t border-rule px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={start}
              disabled={rideState === "riding"}
              className="bg-rescue px-5 py-2.5 font-display text-sm font-bold text-paper hover:bg-abyss-deep disabled:opacity-50"
            >
              {rideState === "riding" ? "Riding…" : rideState === "finished" ? "Drop in again" : "Drop in"}
            </button>
            <button
              type="button"
              onClick={() => {
                keys.current.Space = true;
              }}
              disabled={rideState !== "riding"}
              className="border-2 border-ink px-5 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
            >
              Kick out
            </button>
          </div>
          <p className="text-xs leading-relaxed text-ink-soft">
            <strong className="text-ink">A / D</strong> or ← → steer up and down the face. <strong className="text-ink">W</strong> pumps
            for speed, <strong className="text-ink">S</strong> stalls. <strong className="text-ink">Space</strong> kicks out.
            The white line is the peeling section; the pale band behind it is the foam. Stay between them.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="border border-rule bg-paper px-4 py-4">
          <p className="label">What you are riding</p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="label">Break height</dt>
              <dd className="data mt-0.5 text-lg font-bold">
                {conditions.breakHeightM === null ? "—" : `${conditions.breakHeightM.toFixed(2)} m`}
              </dd>
            </div>
            <div>
              <dt className="label">Peel speed</dt>
              <dd className="data mt-0.5 text-lg font-bold">
                {conditions.peelSpeedKmh === null ? "—" : `${conditions.peelSpeedKmh.toFixed(1)} km/h`}
              </dd>
            </div>
            <div>
              <dt className="label">Tide</dt>
              <dd className="data mt-0.5 text-lg font-bold">
                {conditions.tideM === null ? "no station" : `${conditions.tideM.toFixed(2)} m`}
              </dd>
            </div>
            <div>
              <dt className="label">Wind</dt>
              <dd className="data mt-0.5 text-lg font-bold">
                {conditions.windSpeedMs === null ? "—" : `${conditions.windSpeedMs.toFixed(1)} m/s`}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">{conditions.sourceLabel}</p>
        </div>

        {result ? (
          <div className="border border-rule bg-paper px-4 py-4">
            <p className="label">Ride result</p>
            <p className={`mt-2 font-display text-lg font-bold ${result.completed ? "text-lagoon-deep" : "text-rescue"}`}>
              {result.completed ? "Kicked out clean." : "Wipeout."}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{result.reason}</p>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <dt className="label">Water time</dt>
                <dd className="data mt-0.5 text-sm font-bold">{result.durationSec}s</dd>
              </div>
              <div>
                <dt className="label">Longest</dt>
                <dd className="data mt-0.5 text-sm font-bold">{result.longestRideSec}s</dd>
              </div>
              <div>
                <dt className="label">Top speed</dt>
                <dd className="data mt-0.5 text-sm font-bold">{result.topSpeedKmh.toFixed(1)} km/h</dd>
              </div>
            </dl>

            <div className="mt-4">
              {sessionId ? (
                <>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saveState === "saving" || saveState === "saved"}
                    className="border-2 border-ink px-4 py-2 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
                  >
                    {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to this session" : "Save this ride"}
                  </button>
                  {saveError ? <p className="mt-2 text-xs text-alert">{saveError}</p> : null}
                </>
              ) : (
                <p className="text-xs leading-relaxed text-ink-soft">
                  Open this lab from a session to save a ride to it. Without a session there is nothing to attach the
                  ride to, and Swellread will not invent one.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-rule bg-paper/60 px-4 py-6 text-sm text-ink-soft">
            Drop in to start the clock. Ride the pocket between the section and the foam.
          </div>
        )}

        {saveError && !result ? (
          <div className="border-l-4 border-alert bg-alert/10 px-4 py-3 text-sm text-alert">{saveError}</div>
        ) : null}
      </div>
    </div>
  );
}
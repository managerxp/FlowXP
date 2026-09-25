/* eslint-disable react/no-unknown-property */
/*
 * Antigravity — from React Bits (reactbits.dev), integrated close to
 * verbatim. A magnet-following ring of instanced particles, rendered with
 * @react-three/fiber. Kept as its own file, loaded lazily (see Home.jsx)
 * rather than bundled with the rest of the site — three.js is the heaviest
 * dependency in this app by a wide margin, and nothing else here needs a
 * WebGL context.
 *
 * Three additions beyond the original source, all added for FlowXP's specific
 * placement (a background sweep behind the hero headline, not a small
 * contained demo box):
 *
 *   Real cursor tracking via a `window` `pointermove` listener instead of
 *   r3f's own `state.pointer`. The hero wraps this canvas in
 *   `pointer-events-none` (so the decoration never blocks clicks on the
 *   headline/buttons above it) — but that also stops the canvas from ever
 *   receiving pointer events through the DOM, which is how r3f updates
 *   `state.pointer` in the first place. The practical effect: `state.pointer`
 *   sat frozen at its startup value forever, the "no mouse movement in 2s"
 *   fallback tripped almost immediately, and the ring only ever ran the slow
 *   autoAnimate sine/cosine path — it looked laggy because it was never
 *   actually following the cursor at all. `pointer-events: none` only
 *   affects hit-testing on that element; a `window`-level listener still
 *   receives every pointer move regardless, so tracking there and feeding
 *   the coordinates in manually (see `PointerTracker`) fixes this without
 *   touching the click-through behaviour the hero relies on.
 *
 *   `colors` — an optional array of 2+ hex strings. Rather than one instanced
 *   mesh with a per-particle gradient (tried first: `setColorAt` +
 *   `vertexColors` on the material — the instance-colour buffer verifiably
 *   held the right values, logged and inspected, but still rendered solid
 *   black on screen with this three.js version, a real rendering bug in that
 *   path, not a placement or data bug), this renders one `AntigravityInner`
 *   per colour, each with its own flat `color` — the one path already proven
 *   to render correctly — nested as concentric rings (each a bit wider than
 *   the last) so the colours read as layered bands around the same magnet
 *   point instead of a smooth blend.
 *
 *   Canvas `dpr` cap + `antialias: false` — the animation loop's per-particle
 *   trig runs on the main thread every frame regardless of GPU, but on a
 *   high-DPI display the GPU fill-rate cost of a transparent, antialiased
 *   canvas scales with device pixel ratio squared. Capping it is the
 *   standard r3f fix for "this looks fine on a laptop, chugs on a phone".
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/* One `window` listener shared by every colour layer, rather than one per
   AntigravityInner instance — mousemove already fires at display refresh
   rate, no need to multiply that by the number of colours. Normalizes
   relative to the canvas element's own rect (not window.innerWidth/Height —
   the canvas doesn't necessarily fill the whole viewport) into the same
   -1..1 range r3f's own `state.pointer` uses, so the rest of the animation
   code doesn't need to know the difference. Rendered once inside <Canvas>
   purely to reach `gl.domElement` via useThree() — it draws nothing. */
const PointerTracker = ({ pointerRef }) => {
  const { gl } = useThree();
  useEffect(() => {
    const canvasEl = gl.domElement;
    const handleMove = (e) => {
      const rect = canvasEl.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => window.removeEventListener('pointermove', handleMove);
  }, [gl]);
  return null;
};

const AntigravityInner = ({
  count = 300,
  magnetRadius = 10,
  ringRadius = 10,
  waveSpeed = 0.4,
  waveAmplitude = 1,
  particleSize = 2,
  lerpSpeed = 0.1,
  color = '#FF9FFC',
  autoAnimate = false,
  particleVariance = 1,
  rotationSpeed = 0,
  depthFactor = 1,
  pulseSpeed = 3,
  particleShape = 'capsule',
  fieldStrength = 10,
  pointerRef
}) => {
  const meshRef = useRef(null);
  const { viewport } = useThree();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastMouseMoveTime = useRef(0);
  const virtualMouse = useRef({ x: 0, y: 0 });

  const particles = useMemo(() => {
    const temp = [];
    const width = viewport.width || 100;
    const height = viewport.height || 100;

    for (let i = 0; i < count; i++) {
      const t = Math.random() * 100;
      const factor = 20 + Math.random() * 100;
      const speed = 0.01 + Math.random() / 200;
      const xFactor = -50 + Math.random() * 100;
      const yFactor = -50 + Math.random() * 100;
      const zFactor = -50 + Math.random() * 100;

      const x = (Math.random() - 0.5) * width;
      const y = (Math.random() - 0.5) * height;
      const z = (Math.random() - 0.5) * 20;

      const randomRadiusOffset = (Math.random() - 0.5) * 2;

      temp.push({
        t,
        factor,
        speed,
        xFactor,
        yFactor,
        zFactor,
        mx: x,
        my: y,
        mz: z,
        cx: x,
        cy: y,
        cz: z,
        vx: 0,
        vy: 0,
        vz: 0,
        randomRadiusOffset
      });
    }
    return temp;
  }, [count, viewport.width, viewport.height]);

  useFrame(state => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { viewport: v } = state;
    const m = pointerRef.current;

    const mouseDist = Math.sqrt(Math.pow(m.x - lastMousePos.current.x, 2) + Math.pow(m.y - lastMousePos.current.y, 2));

    if (mouseDist > 0.001) {
      lastMouseMoveTime.current = Date.now();
      lastMousePos.current = { x: m.x, y: m.y };
    }

    let destX = (m.x * v.width) / 2;
    let destY = (m.y * v.height) / 2;

    if (autoAnimate && Date.now() - lastMouseMoveTime.current > 2000) {
      const time = state.clock.getElapsedTime();
      destX = Math.sin(time * 0.5) * (v.width / 4);
      destY = Math.cos(time * 0.5 * 2) * (v.height / 4);
    }

    // 0.05 (the original, tuned for chasing a real mouse cursor) reads as a
    // sluggish half-second delay when the target is the slow autoAnimate
    // sine/cosine path instead — tightened for a background decoration.
    const smoothFactor = 0.15;
    virtualMouse.current.x += (destX - virtualMouse.current.x) * smoothFactor;
    virtualMouse.current.y += (destY - virtualMouse.current.y) * smoothFactor;

    const targetX = virtualMouse.current.x;
    const targetY = virtualMouse.current.y;

    const globalRotation = state.clock.getElapsedTime() * rotationSpeed;

    particles.forEach((particle, i) => {
      let { t, speed, mx, my, mz, cz, randomRadiusOffset } = particle;

      t = particle.t += speed / 2;

      const projectionFactor = 1 - cz / 50;
      const projectedTargetX = targetX * projectionFactor;
      const projectedTargetY = targetY * projectionFactor;

      const dx = mx - projectedTargetX;
      const dy = my - projectedTargetY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let targetPos = { x: mx, y: my, z: mz * depthFactor };

      if (dist < magnetRadius) {
        const angle = Math.atan2(dy, dx) + globalRotation;

        const wave = Math.sin(t * waveSpeed + angle) * (0.5 * waveAmplitude);
        const deviation = randomRadiusOffset * (5 / (fieldStrength + 0.1));

        const currentRingRadius = ringRadius + wave + deviation;

        targetPos.x = projectedTargetX + currentRingRadius * Math.cos(angle);
        targetPos.y = projectedTargetY + currentRingRadius * Math.sin(angle);
        targetPos.z = mz * depthFactor + Math.sin(t) * (1 * waveAmplitude * depthFactor);
      }

      particle.cx += (targetPos.x - particle.cx) * lerpSpeed;
      particle.cy += (targetPos.y - particle.cy) * lerpSpeed;
      particle.cz += (targetPos.z - particle.cz) * lerpSpeed;

      dummy.position.set(particle.cx, particle.cy, particle.cz);

      dummy.lookAt(projectedTargetX, projectedTargetY, particle.cz);
      dummy.rotateX(Math.PI / 2);

      const currentDistToMouse = Math.sqrt(
        Math.pow(particle.cx - projectedTargetX, 2) + Math.pow(particle.cy - projectedTargetY, 2)
      );

      const distFromRing = Math.abs(currentDistToMouse - ringRadius);
      let scaleFactor = 1 - distFromRing / 10;

      scaleFactor = Math.max(0, Math.min(1, scaleFactor));

      const finalScale = scaleFactor * (0.8 + Math.sin(t * pulseSpeed) * 0.2 * particleVariance) * particleSize;
      dummy.scale.set(finalScale, finalScale, finalScale);

      dummy.updateMatrix();

      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      {particleShape === 'capsule' && <capsuleGeometry args={[0.1, 0.4, 4, 8]} />}
      {particleShape === 'sphere' && <sphereGeometry args={[0.2, 16, 16]} />}
      {particleShape === 'box' && <boxGeometry args={[0.3, 0.3, 0.3]} />}
      {particleShape === 'tetrahedron' && <tetrahedronGeometry args={[0.3]} />}
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
};

const Antigravity = ({ colors, count = 300, ringRadius = 10, ...rest }) => {
  const palette = Array.isArray(colors) && colors.length >= 2 ? colors : null;
  const pointerRef = useRef({ x: 0, y: 0 });

  return (
    <Canvas
      camera={{ position: [0, 0, 50], fov: 35 }}
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
      dpr={[1, 1.5]}
    >
      <PointerTracker pointerRef={pointerRef} />
      {palette ? (
        palette.map((c, i) => (
          <AntigravityInner
            key={c}
            {...rest}
            count={Math.max(1, Math.round(count / palette.length))}
            ringRadius={ringRadius + i * 1.4}
            color={c}
            pointerRef={pointerRef}
          />
        ))
      ) : (
        <AntigravityInner {...rest} count={count} ringRadius={ringRadius} pointerRef={pointerRef} />
      )}
    </Canvas>
  );
};

export default Antigravity;

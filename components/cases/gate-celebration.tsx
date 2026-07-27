'use client';

// =============================================================================
// GATE CELEBRATION — a short burst of colourful ribbons when a gate is cleared.
//
// Pure CSS/DOM (no canvas, no library): ~40 lightweight ribbon strips that fly
// out, tumble and fade over ~2 seconds, then unmount themselves completely.
// Rendered in a fixed, pointer-events-none layer so it never blocks a click.
//
// Respects prefers-reduced-motion — anyone who has asked their device to limit
// animation simply doesn't see it.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';

const COLOURS = ['#4F46E5', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#8B5CF6', '#F43F5E', '#FACC15'];
const COUNT = 44;
const LIFETIME_MS = 2200;

interface Ribbon {
  id: number; left: number; colour: string; delay: number; duration: number;
  drift: number; spin: number; width: number; height: number; round: boolean;
}

export function GateCelebration({ fireKey, onDone }: { fireKey: string | null; onDone?: () => void }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!fireKey) return;
    // Honour reduced-motion preferences.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onDone?.();
      return;
    }
    setActive(fireKey);
    const t = setTimeout(() => { setActive(null); onDone?.(); }, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [fireKey, onDone]);

  // New ribbon set for every burst, so no two celebrations look identical.
  const ribbons = useMemo<Ribbon[]>(() => {
    if (!active) return [];
    return Array.from({ length: COUNT }, (_, i) => ({
      id: i,
      left: 8 + Math.random() * 84,               // % across the panel
      colour: COLOURS[i % COLOURS.length],
      delay: Math.random() * 0.28,                // s
      duration: 1.3 + Math.random() * 0.7,        // s
      drift: (Math.random() - 0.5) * 220,         // px sideways
      spin: 360 + Math.random() * 720,            // deg
      width: 6 + Math.random() * 6,
      height: 10 + Math.random() * 14,
      round: Math.random() > 0.72,                // a few circles among the ribbons
    }));
  }, [active]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[95] overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes mgz-ribbon-fall {
          0%   { transform: translate3d(0, -12vh, 0) rotate(0deg) scale(1); opacity: 0; }
          12%  { opacity: 1; }
          100% { transform: translate3d(var(--drift), 108vh, 0) rotate(var(--spin)) scale(0.85); opacity: 0; }
        }
      `}</style>
      {ribbons.map((r) => (
        <span
          key={r.id}
          style={{
            position: 'absolute',
            top: 0,
            left: `${r.left}%`,
            width: r.width,
            height: r.round ? r.width : r.height,
            background: r.colour,
            borderRadius: r.round ? '50%' : 2,
            // @ts-expect-error — CSS custom properties are valid at runtime
            '--drift': `${r.drift}px`,
            '--spin': `${r.spin}deg`,
            animation: `mgz-ribbon-fall ${r.duration}s cubic-bezier(.25,.6,.35,1) ${r.delay}s forwards`,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  );
}

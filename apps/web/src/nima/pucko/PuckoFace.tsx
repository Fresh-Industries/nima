import { useEffect, useRef } from "react";
import type { PuckoCharacterState } from "@t3tools/client-runtime/meetings";

export function PuckoFace({
  state,
  level = 0,
  small = false,
}: {
  state: PuckoCharacterState;
  level?: number;
  small?: boolean;
}) {
  const eyes = useRef<SVGGElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Sparse visible-page blinks give the face expression without a continuously repainting animation.
  useEffect(() => {
    if (small || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    let animation: Animation | undefined;
    const blink = () => {
      if (!document.hidden)
        animation = eyes.current?.animate(
          [{ transform: "scaleY(1)" }, { transform: "scaleY(0.08)" }, { transform: "scaleY(1)" }],
          { duration: 170 },
        );
      timer = setTimeout(blink, 4000 + Math.random() * 3000);
    };
    timer = setTimeout(blink, 4500);
    return () => {
      clearTimeout(timer);
      animation?.cancel();
    };
  }, [small]);
  const attentive = state === "summoned";
  const eyeHeight = state === "muted" ? 3 : attentive ? 21 : 15;
  const eyeY = state === "thinking" ? 83 : 90;
  const glance = state === "working" ? 5 : state === "summoned" ? -2 : 0;
  const color =
    state === "error"
      ? "var(--color-destructive)"
      : state === "muted"
        ? "var(--color-muted-foreground)"
        : "var(--color-foreground)";
  return (
    <svg
      viewBox="0 0 240 200"
      role="img"
      aria-label={`Pucko, ${state}`}
      className={small ? "size-5" : "h-auto w-full max-w-80"}
    >
      <g
        ref={eyes}
        fill={color}
        className="motion-safe:transition-transform motion-safe:duration-200"
        style={{ transformOrigin: "120px 90px", transform: `translateX(${glance}px)` }}
      >
        <rect x="66" y={eyeY - eyeHeight / 2} width="14" height={eyeHeight} rx="7" />
        <rect x="160" y={eyeY - eyeHeight / 2} width="14" height={eyeHeight} rx="7" />
      </g>
      {state === "speaking" ? (
        <ellipse cx="120" cy="135" rx={11 + level * 7} ry={3 + level * 15} fill={color} />
      ) : (
        <path
          d={
            state === "error"
              ? "M 106 140 Q 120 131 134 140"
              : state === "muted"
                ? "M 109 136 H 131"
                : "M 106 132 Q 120 145 134 132"
          }
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

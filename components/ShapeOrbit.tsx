"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  OrbitCircle,
  OrbitOval,
  OrbitRectangle,
  OrbitSquare,
  OrbitTriangle,
  type OrbitShapeProps,
} from "./orbit-shapes";

const SHAPES: {
  id: string;
  Component: (props: OrbitShapeProps) => JSX.Element;
  color: string;
  sizeRatio: number;
  aspect: number;
}[] = [
  { id: "triangle", Component: OrbitTriangle, color: "#362A67", sizeRatio: 0.62, aspect: 1 },
  { id: "circle", Component: OrbitCircle, color: "#7C74C4", sizeRatio: 0.5, aspect: 1 },
  { id: "square", Component: OrbitSquare, color: "#EF476F", sizeRatio: 0.44, aspect: 1 },
  { id: "oval", Component: OrbitOval, color: "#F49BC5", sizeRatio: 0.42, aspect: 1.4 },
  { id: "rectangle", Component: OrbitRectangle, color: "#AFA8D3", sizeRatio: 0.4, aspect: 1.6 },
];

const ORBIT_DURATION_S = 26;
const FLY_BASE_DELAY = 0.15;
const FLY_STAGGER = 0.12;

export default function ShapeOrbit() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState(0);
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize(el.offsetWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const center = containerSize / 2;
  const radius = containerSize * 0.34;
  const baseUnit = containerSize * 0.27;
  const flyDistance = containerSize * 1.7;

  return (
    <div
      ref={containerRef}
      className="orbit-container relative mx-auto aspect-square w-[88%] max-w-[500px] sm:max-w-[560px] lg:w-[82%] lg:max-w-[600px]"
    >
      {containerSize > 0 &&
        SHAPES.map((shape, i) => {
          const angleDeg = (360 / SHAPES.length) * i;
          const angleRad = (angleDeg * Math.PI) / 180;
          const height = baseUnit * shape.sizeRatio;
          const width = height * shape.aspect;
          const targetX = center + radius * Math.cos(angleRad);
          const targetY = center + radius * Math.sin(angleRad);
          const ShapeComponent = shape.Component;

          if (!settled) {
            return (
              <motion.div
                key={shape.id}
                className="absolute left-0 top-0"
                initial={{ x: targetX - flyDistance, y: targetY, opacity: 0, scale: 0.4, rotate: -50 }}
                animate={{ x: targetX, y: targetY, opacity: 1, scale: 1, rotate: 0 }}
                transition={{
                  delay: FLY_BASE_DELAY + i * FLY_STAGGER,
                  type: "spring",
                  stiffness: 230,
                  damping: 13,
                  mass: 0.8,
                }}
                onAnimationComplete={i === SHAPES.length - 1 ? () => setSettled(true) : undefined}
              >
                <div style={{ position: "absolute", top: -height / 2, left: -width / 2 }}>
                  <ShapeComponent width={width} height={height} color={shape.color} />
                </div>
              </motion.div>
            );
          }

          return (
            <div
              key={shape.id}
              className="orbit-rotate absolute"
              style={
                {
                  left: center,
                  top: center,
                  "--base-angle": `${angleDeg}deg`,
                  "--radius": `${radius}px`,
                  animationDuration: `${ORBIT_DURATION_S}s`,
                } as CSSProperties
              }
            >
              <div
                className="orbit-self-spin"
                style={
                  {
                    position: "absolute",
                    top: -height / 2,
                    left: -width / 2,
                    animationDuration: `${7 + i * 1.3}s`,
                  } as CSSProperties
                }
              >
                <ShapeComponent width={width} height={height} color={shape.color} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

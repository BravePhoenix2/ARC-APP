import type { ReactNode } from "react";

export type OrbitShapeProps = {
  width: number;
  height: number;
  color: string;
  children?: ReactNode;
};

function ShapeSlot({
  width,
  height,
  color,
  borderRadius,
  clipPath,
  children,
}: OrbitShapeProps & { borderRadius?: string; clipPath?: string }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ width, height, backgroundColor: color, borderRadius, clipPath }}
    >
      {/* Empty image slot — drop an <img> or next/image here later, it will be clipped to the shape */}
      {children ? <div className="absolute inset-0">{children}</div> : null}
    </div>
  );
}

export function OrbitTriangle(props: OrbitShapeProps) {
  return <ShapeSlot {...props} clipPath="polygon(50% 0%, 0% 100%, 100% 100%)" />;
}

export function OrbitCircle(props: OrbitShapeProps) {
  return <ShapeSlot {...props} borderRadius="9999px" />;
}

export function OrbitSquare(props: OrbitShapeProps) {
  return <ShapeSlot {...props} borderRadius="16%" />;
}

export function OrbitOval(props: OrbitShapeProps) {
  return <ShapeSlot {...props} borderRadius="9999px" />;
}

export function OrbitRectangle(props: OrbitShapeProps) {
  return <ShapeSlot {...props} borderRadius="18%" />;
}

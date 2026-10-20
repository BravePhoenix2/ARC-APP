import type { CSSProperties } from "react";
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_PIECES, BRAND_LOGO_WIDTH } from "@/lib/brandLogo";
import styles from "./ArticLogo.module.css";

type ArticLogoProps = {
  className?: string;
  variant?: "full" | "mark";
};

export default function ArticLogo({ className = "", variant = "full" }: ArticLogoProps) {
  const mark = variant === "mark";
  const pieces = mark ? BRAND_LOGO_PIECES.slice(0, 6) : BRAND_LOGO_PIECES;
  const origin = { x: mark ? 64 : BRAND_LOGO_WIDTH / 2, y: BRAND_LOGO_HEIGHT / 2 };

  return (
    <span className={`${styles.logo} ${mark ? styles.mark : ""} ${className}`}>
      <svg
        className={styles.artwork}
        viewBox={mark ? "-38 0 204 204" : `0 0 ${BRAND_LOGO_WIDTH} ${BRAND_LOGO_HEIGHT}`}
        role="img"
        aria-label="ARTIC"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>ARTIC</title>
        <g aria-hidden="true">
          <circle className={styles.ripple} cx={origin.x} cy={origin.y} r="20" />
          <circle className={styles.dot} cx={origin.x} cy={origin.y} r="10" />
          {pieces.map((piece, index) => (
            <rect
              key={`${piece.x}-${piece.y}`}
              className={styles.piece}
              x={piece.x}
              y={piece.y}
              width={piece.width}
              height={piece.height}
              fill={piece.fill}
              data-ink={piece.ink}
              style={{
                "--from-x": `${origin.x - piece.x - piece.width / 2}px`,
                "--from-y": `${origin.y - piece.y - piece.height / 2}px`,
                "--turn": `${index % 2 === 0 ? -12 : 12}deg`,
                "--delay": `${155 + index * 18}ms`,
              } as CSSProperties}
            />
          ))}
        </g>
      </svg>
    </span>
  );
}

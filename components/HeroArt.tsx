const COLORS = {
  purple: "#7C74C4",
  lavender: "#AFA8D3",
  pinkAccent: "#EF476F",
  pinkSoft: "#F49BC5",
  grey: "#C9C7CD",
  indigoDark: "#362A67",
  indigoDarker: "#2B2260",
  white: "#FFFFFF",
} as const;

const BLOCKS = [
  { key: "purple", x: 0, y: 0, width: 460, height: 500, fill: COLORS.purple },
  { key: "pink-accent", x: 460, y: 0, width: 340, height: 280, fill: COLORS.pinkAccent },
  { key: "grey", x: 460, y: 280, width: 340, height: 470, fill: COLORS.grey },
  { key: "pink-soft", x: 0, y: 500, width: 460, height: 250, fill: COLORS.pinkSoft },
  { key: "indigo-bar", x: 0, y: 750, width: 800, height: 150, fill: COLORS.indigoDark },
  { key: "lavender", x: 0, y: 0, width: 170, height: 170, fill: COLORS.lavender },
] as const;

const FINGERS = [
  { baseY: -2, length: 96, rotate: -26 },
  { baseY: 18, length: 108, rotate: -9 },
  { baseY: 38, length: 102, rotate: 9 },
  { baseY: 58, length: 78, rotate: 27 },
] as const;

const FINGER_ATTACH_X = 84;

export default function HeroArt() {
  return (
    <svg
      viewBox="0 0 800 900"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="Flat geometric illustration of a hand pinching a pencil above a staircase, a cylinder, and concentric circles, arranged on a patchwork of purple, pink, grey, and indigo blocks"
    >
      {BLOCKS.map((block, i) => (
        <rect
          key={block.key}
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          fill={block.fill}
          className="animate-fade-slide-in"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}

      {/* Staircase, rising across the pink-accent block */}
      <polygon
        points="480,280 480,240 520,240 520,200 560,200 560,160 600,160 600,120 640,120 640,80 780,80 780,280"
        fill={COLORS.indigoDarker}
        className="animate-fade-slide-in"
        style={{ animationDelay: "380ms" }}
      />

      {/* Cylinder with a lens-like ellipse end, on the purple block */}
      <g className="animate-fade-slide-in" style={{ animationDelay: "460ms" }}>
        <rect x={30} y={150} width={250} height={90} rx={4} fill={COLORS.indigoDark} />
        <ellipse cx={280} cy={195} rx={28} ry={46} fill={COLORS.white} />
      </g>

      {/* Concentric circles, near the bottom of the indigo bar */}
      <g className="animate-fade-slide-in" style={{ animationDelay: "540ms" }}>
        <circle cx={150} cy={825} r={70} fill={COLORS.white} />
        <circle cx={150} cy={825} r={48} fill={COLORS.grey} />
        <circle cx={150} cy={825} r={20} fill={COLORS.indigoDarker} />
      </g>

      {/* Hand pinching a pencil — gently floating together */}
      <g className="animate-fade-slide-in" style={{ animationDelay: "620ms" }}>
        <g className="animate-float" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          {/* Pencil, with the hand nested in the same rotated frame so it pinches the tip precisely */}
          <g transform="translate(230,600) rotate(-8)">
            <rect x={-190} y={-25} width={70} height={50} rx={25} fill={COLORS.pinkSoft} />
            <rect x={-132} y={-25} width={16} height={50} fill={COLORS.grey} />
            <rect x={-116} y={-25} width={236} height={50} fill={COLORS.indigoDark} />
            <rect x={-90} y={-25} width={10} height={50} fill={COLORS.white} />
            <rect x={-40} y={-25} width={10} height={50} fill={COLORS.white} />
            <rect x={10} y={-25} width={10} height={50} fill={COLORS.white} />
            <rect x={60} y={-25} width={10} height={50} fill={COLORS.white} />
            <polygon points="120,-25 162,0 120,25" fill={COLORS.indigoDarker} />

            {/* Hand, positioned near the tip (162,0); local origin below is the pinch point */}
            <g transform="translate(140,-4)">
              <rect x={168} y={-38} width={128} height={82} rx={26} fill={COLORS.indigoDark} />
              <ellipse cx={122} cy={2} rx={54} ry={44} fill={COLORS.indigoDark} />
              {/* Thumb, curling up from below to meet the fingers at the pinch point */}
              <rect
                x={-4}
                y={46}
                width={92}
                height={16}
                rx={8}
                fill={COLORS.indigoDark}
                transform="rotate(-52 88 54)"
              />
              {FINGERS.map((finger) => (
                <rect
                  key={finger.baseY}
                  x={FINGER_ATTACH_X - finger.length}
                  y={finger.baseY - 7}
                  width={finger.length}
                  height={14}
                  rx={7}
                  fill={COLORS.indigoDark}
                  transform={`rotate(${finger.rotate} ${FINGER_ATTACH_X} ${finger.baseY})`}
                />
              ))}
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

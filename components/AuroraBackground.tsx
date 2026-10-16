const BLOBS = [
  {
    color: "#2FE6A6",
    className: "left-[2%] top-[-16%] h-[20vw] w-[62vw] -rotate-[26deg]",
    duration: "24s",
    delay: "0s",
  },
  {
    color: "#3E8EF7",
    className: "right-[-10%] top-[4%] h-[24vw] w-[54vw] -rotate-[20deg]",
    duration: "28s",
    delay: "-6s",
  },
  {
    color: "#8B6BF2",
    className: "left-[26%] top-[26%] h-[18vw] w-[46vw] rotate-[14deg]",
    duration: "26s",
    delay: "-12s",
  },
  {
    color: "#D24FD1",
    className: "left-[-8%] bottom-[-18%] h-[22vw] w-[58vw] -rotate-[22deg]",
    duration: "30s",
    delay: "-4s",
  },
] as const;

export default function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-aurora-bg" aria-hidden="true">
      {BLOBS.map((blob, i) => (
        <div
          key={i}
          className={`animate-aurora-drift absolute rounded-[50%] opacity-[0.55] mix-blend-screen blur-[90px] ${blob.className}`}
          style={{
            backgroundColor: blob.color,
            animationDuration: blob.duration,
            animationDelay: blob.delay,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-aurora-bg/45" />
    </div>
  );
}

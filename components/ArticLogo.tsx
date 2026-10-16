// "A" and "I" track the page's text color so the logo stays legible in dark
// mode; R/T/C keep fixed brand accents since both are readable on either bg.
const LETTERS = [
  { char: "A", color: "var(--page-text)" },
  { char: "R", color: "#EF476F" },
  { char: "T", color: "#AFA8D3" },
  { char: "I", color: "var(--page-text)" },
  { char: "C", color: "#EF476F" },
] as const;

export default function ArticLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex select-none font-mono font-black tracking-tight ${className}`} aria-label="Artic">
      {LETTERS.map((letter, i) => (
        <span
          key={i}
          style={{
            color: letter.color,
            textShadow: i === 1 ? "2px 0 0 rgba(175,168,211,0.55)" : undefined,
          }}
        >
          {letter.char}
        </span>
      ))}
    </span>
  );
}

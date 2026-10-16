export default function Eyebrow({
  children,
  dotColor = "#EF476F",
  className = "",
}: {
  children: string;
  dotColor?: string;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.15em] ${className}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      <span>[:{children}]</span>
    </div>
  );
}

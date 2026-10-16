type LogoProps = {
  variant?: "small" | "full";
  className?: string;
};

export function Logo({ variant = "full", className = "" }: LogoProps) {
  const isSmall = variant === "small";

  return (
    <svg
      viewBox={isSmall ? "0 0 96 64" : "0 0 220 80"}
      role="img"
      aria-label="ARTIC logo"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="0" width="220" height="80" fill="transparent" />

      <g fill="#362A67">
        <rect x="12" y="12" width="24" height="56" rx="2" />
        <rect x="52" y="12" width="24" height="56" rx="2" />
        <rect x="92" y="12" width="24" height="56" rx="2" />
        <rect x="132" y="12" width="24" height="56" rx="2" />
        <rect x="172" y="12" width="24" height="56" rx="2" />

        <circle cx="33" cy="23" r="9" fill="#F49BC5" />
        <circle cx="70" cy="23" r="9" fill="#EF476F" />
        <circle cx="112" cy="23" r="9" fill="#AFA8D3" />

        <rect x="38" y="32" width="14" height="36" rx="2" fill="#F49BC5" />
        <rect x="76" y="32" width="14" height="36" rx="2" fill="#EF476F" />
        <rect x="118" y="32" width="14" height="36" rx="2" fill="#AFA8D3" />
      </g>

      <g fill="#362A67">
        <circle cx="183" cy="25" r="8" fill="#EF476F" />
        <rect x="176" y="35" width="20" height="10" rx="2" fill="#EF476F" />
        <rect x="194" y="23" width="12" height="12" rx="2" fill="#F49BC5" />
      </g>
    </svg>
  );
}

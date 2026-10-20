import ArticLogo from "./ArticLogo";

type LogoProps = {
  variant?: "small" | "full";
  className?: string;
};

export function Logo({ variant = "full", className = "" }: LogoProps) {
  return <ArticLogo variant={variant === "small" ? "mark" : "full"} className={className} />;
}

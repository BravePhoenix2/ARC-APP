"use client";

import type { ReactNode } from "react";
import { usePrivySession } from "@/hooks/usePrivySession";
import { hasReviewerAccess } from "@/lib/reviewerAccess";

/** Never reveal internal navigation from an unsigned SDK profile or stale user alone. */
export default function ReviewerOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return hasReviewerAccess(usePrivySession()) ? <>{children}</> : <>{fallback}</>;
}

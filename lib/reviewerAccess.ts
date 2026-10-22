/** Presentation gate only; protected pages and APIs verify permissions on the server. */
export function hasReviewerAccess(session: {
  authenticated: boolean;
  user: { isAdmin: boolean; email: string | null } | null;
}): boolean {
  return session.authenticated && session.user?.isAdmin === true && Boolean(session.user.email?.trim());
}

/** Public application identifiers only. Privy signing secrets never belong here. */
export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
export const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined;
export const isPrivyConfigured = Boolean(privyAppId);

export const PRIVY_SESSION_CHANGED = "artiq:privy-session-changed";
export const PRIVY_SETUP_MESSAGE = "Sign-in is being set up. Please try again soon.";

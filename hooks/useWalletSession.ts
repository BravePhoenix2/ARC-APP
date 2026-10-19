"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

type Session = { walletAddress: string; isAdmin: boolean };
const SESSION_CHANGED = "artiq:wallet-session-changed";

async function requestSession(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

function signatureRejected(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as { code?: number; name?: string; cause?: unknown };
    if (item.code === 4001 || item.name === "UserRejectedRequestError") return true;
    current = item.cause;
  }
  return false;
}

/** A connected wallet becomes authenticated only after signing the server nonce. */
export function useWalletSession() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletRef = useRef<string | undefined>(address?.toLowerCase());
  const refreshVersion = useRef(0);
  const signingRef = useRef(false);
  const mounted = useRef(true);
  walletRef.current = isConnected ? address?.toLowerCase() : undefined;

  const refresh = useCallback(async (): Promise<void> => {
    const version = ++refreshVersion.current;
    if (mounted.current) setIsLoading(true);
    try {
      const response = await requestSession("/api/auth/session");
      if (version !== refreshVersion.current || !mounted.current) return;
      if (response.status === 401) {
        setSession(null);
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Could not check your wallet sign-in."));
      const data: unknown = await response.json();
      if (version !== refreshVersion.current || !mounted.current) return;
      if (!data || typeof data !== "object" || !("walletAddress" in data) || typeof data.walletAddress !== "string") {
        throw new Error("Could not check your wallet sign-in.");
      }
      setSession({ walletAddress: data.walletAddress.toLowerCase(), isAdmin: "isAdmin" in data && data.isAdmin === true });
    } catch (cause) {
      if (version === refreshVersion.current && mounted.current) {
        setSession(null);
        setError(cause instanceof Error ? cause.message : "Could not check your wallet sign-in.");
      }
    } finally {
      if (version === refreshVersion.current && mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onChange = () => { void refresh(); };
    window.addEventListener(SESSION_CHANGED, onChange);
    window.addEventListener("artiq:email-session-changed", onChange);
    return () => {
      mounted.current = false;
      window.removeEventListener(SESSION_CHANGED, onChange);
      window.removeEventListener("artiq:email-session-changed", onChange);
    };
  }, [refresh]);

  useEffect(() => {
    setError(null);
    void refresh();
  }, [address, isConnected, refresh]);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (signingRef.current) return false;
    const connectedAddress = walletRef.current;
    if (!connectedAddress) {
      setError("Connect your wallet before signing in.");
      return false;
    }
    signingRef.current = true;
    setIsSigning(true);
    setError(null);
    // An older session read must not overwrite a fresh verification result.
    ++refreshVersion.current;
    try {
      const challengeResponse = await requestSession("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedAddress }),
      });
      if (!challengeResponse.ok) throw new Error(await responseError(challengeResponse, "Could not start wallet sign-in."));
      const challenge = await challengeResponse.json();
      if (typeof challenge.message !== "string" || typeof challenge.nonce !== "string") {
        throw new Error("Could not start wallet sign-in.");
      }
      if (walletRef.current !== connectedAddress) throw new Error("Your wallet changed. Sign in with the current account.");
      const signature = await signMessageAsync({ account: connectedAddress as `0x${string}`, message: challenge.message });
      if (walletRef.current !== connectedAddress) throw new Error("Your wallet changed. Sign in with the current account.");
      const response = await requestSession("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedAddress, nonce: challenge.nonce, signature }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not verify your wallet signature."));
      const data = await response.json();
      if (typeof data.walletAddress !== "string" || data.walletAddress.toLowerCase() !== connectedAddress) {
        throw new Error("Your wallet sign-in did not match the connected account.");
      }
      if (walletRef.current !== connectedAddress) {
        // Prevent the completed request from authenticating an account switched mid-signature.
        await requestSession("/api/auth/session", { method: "DELETE" });
        window.dispatchEvent(new Event(SESSION_CHANGED));
        throw new Error("Your wallet changed. Sign in with the current account.");
      }
      if (mounted.current) setSession({ walletAddress: connectedAddress, isAdmin: data.isAdmin === true });
      window.dispatchEvent(new Event(SESSION_CHANGED));
      return true;
    } catch (cause) {
      if (mounted.current) {
        setError(signatureRejected(cause)
          ? "Signature cancelled. Sign in again when you are ready."
          : cause instanceof Error ? cause.message : "Could not sign in. Please try again.");
      }
      return false;
    } finally {
      signingRef.current = false;
      if (mounted.current) {
        setIsSigning(false);
        setIsLoading(false);
      }
    }
  }, [signMessageAsync]);

  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await requestSession("/api/auth/session", { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not sign out. Please try again."));
      ++refreshVersion.current;
      setSession(null);
      window.dispatchEvent(new Event(SESSION_CHANGED));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
    }
  }, []);

  // A browser cookie never authenticates a different account selected in the wallet.
  const matchingSession = isConnected && session?.walletAddress === address?.toLowerCase() ? session : null;
  return {
    walletAddress: matchingSession?.walletAddress,
    isAdmin: matchingSession?.isAdmin ?? false,
    isAuthenticated: Boolean(matchingSession),
    isLoading,
    isSigning,
    error,
    signIn,
    signOut,
    refresh,
  };
}

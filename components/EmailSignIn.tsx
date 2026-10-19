"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";
import { EMAIL_SESSION_CHANGED, useEmailSession } from "@/hooks/useEmailSession";

type Challenge = { challengeId: string; email: string; expiresAt: number };
const inputClass = "w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm text-[var(--page-text)] outline-none transition placeholder:text-[var(--faint-text)] focus:border-[#b55fbe] focus:ring-2 focus:ring-[#b55fbe]/15 disabled:opacity-60";

class EmailRequestError extends Error {
  constructor(message: string, readonly retryAfter = 0) { super(message); }
}

async function emailRequest(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/auth/email/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  const data = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  if (!response.ok) {
    const retryHeader = Number(response.headers.get("Retry-After"));
    const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(retryHeader, 3600) : response.status === 429 ? 60 : 0;
    throw new EmailRequestError(typeof data?.error === "string" ? data.error : response.status === 503 ? "Email sign-in is temporarily unavailable. Please try again later or use a wallet." : "We couldn’t complete your request. Please try again.", retryAfter);
  }
  if (!data) throw new EmailRequestError("The server returned an unreadable response. Please try again.");
  return data;
}

export default function EmailSignIn({ onSuccess }: { onSuccess?: () => void }) {
  const id = useId();
  const session = useEmailSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [verifyAt, setVerifyAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const busy = isSending || isVerifying;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const verifySeconds = Math.max(0, Math.ceil((verifyAt - now) / 1000));
  const expired = !!challenge && challenge.expiresAt <= now;

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch("/api/auth/email/request", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (mounted.current) setAvailable(typeof data?.available === "boolean" ? data.available : null); })
      .catch(() => {});
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (!challenge && !resendAt && !verifyAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [challenge, resendAt, verifyAt]);

  useEffect(() => { if (challenge) codeRef.current?.focus(); }, [challenge]);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || resendSeconds || available === false) return;
    setError("");
    setIsSending(true);
    try {
      const result = await emailRequest("request", { email: challenge?.email ?? email.trim() });
      const expiresAt = typeof result.expiresAt === "string" ? Date.parse(result.expiresAt) : NaN;
      if (typeof result.challengeId !== "string" || typeof result.email !== "string" || !Number.isFinite(expiresAt)) throw new EmailRequestError("We couldn’t confirm the code request. Please try again.");
      if (!mounted.current) return;
      const requestedAt = Date.now();
      setEmail(result.email);
      setChallenge({ challengeId: result.challengeId, email: result.email, expiresAt });
      setCode("");
      setNow(requestedAt);
      setResendAt(requestedAt + (typeof result.resendAfter === "number" && result.resendAfter > 0 ? Math.min(result.resendAfter, 3600) : 60) * 1000);
      setVerifyAt(0);
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "We couldn’t send your code. Please try again.");
      if (cause instanceof EmailRequestError && cause.retryAfter) {
        setNow(Date.now());
        setResendAt(Date.now() + cause.retryAfter * 1000);
      }
    } finally { if (mounted.current) setIsSending(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !challenge || expired || verifySeconds || !/^\d{6}$/.test(code)) return;
    setError("");
    setIsVerifying(true);
    try {
      const result = await emailRequest("verify", { email: challenge.email, challengeId: challenge.challengeId, code });
      if (result.isAuthenticated !== true || !result.user || typeof result.user !== "object" || !("id" in result.user) || typeof result.user.id !== "string") throw new EmailRequestError("We couldn’t confirm your sign-in. Please try again.");
      await session.refresh({ afterAuthChange: true });
      window.dispatchEvent(new Event(EMAIL_SESSION_CHANGED));
      if (mounted.current) onSuccess?.();
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "We couldn’t verify your code. Please try again.");
      if (cause instanceof EmailRequestError && cause.retryAfter) {
        setNow(Date.now());
        setVerifyAt(Date.now() + cause.retryAfter * 1000);
      }
    } finally { if (mounted.current) setIsVerifying(false); }
  }

  return (
    <div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#b55fbe]/10 text-[#b55fbe]"><Mail size={24} aria-hidden="true" /></div>
      <h2 className="mt-5 text-2xl">{challenge ? "Check your inbox." : "Your art. Your email. You’re in."}</h2>
      <p className="mt-3 max-w-lg text-sm leading-7 text-[var(--muted-text)]">{challenge ? <>Enter the six-digit code sent to <strong className="break-all font-semibold text-[var(--page-text)]">{challenge.email}</strong>. Check your spam folder if it hasn’t arrived.</> : "Create an account or sign in with a one-time email code. No password or wallet is needed to submit your work."}</p>
      {available === false && <p role="status" className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-6">Email sign-in is being set up. Please try again later or continue with a wallet.</p>}
      {!challenge ? (
        <form onSubmit={(event) => void sendCode(event)} className="mt-6 space-y-4">
          <div><label htmlFor={`${id}-email`} className="mb-2 block text-sm font-semibold">Email address</label><input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="you@example.com" className={inputClass} /></div>
          <button type="submit" disabled={busy || available === false || resendSeconds > 0} className="gallery-button inline-flex w-full items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{isSending ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}{isSending ? "Sending your code…" : resendSeconds ? `Try again in ${resendSeconds}s` : "Send sign-in code"}</button>
        </form>
      ) : (
        <form onSubmit={(event) => void verifyCode(event)} className="mt-6 space-y-4">
          <div><label htmlFor={`${id}-code`} className="mb-2 block text-sm font-semibold">Sign-in code</label><input ref={codeRef} id={`${id}-code`} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} disabled={busy} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} placeholder="000000" aria-describedby={`${id}-code-help`} className={`${inputClass} max-w-xs font-mono text-xl tracking-[.3em]`} /><p id={`${id}-code-help`} role="status" className={`mt-2 text-xs leading-6 ${expired ? "text-[#d73c63] dark:text-[#ff8eab]" : "text-[var(--muted-text)]"}`}>{expired ? "This code has expired. Request a new one below." : "Use the latest code we sent. Each code can be used once."}</p></div>
          <button type="submit" disabled={busy || expired || code.length !== 6 || verifySeconds > 0} className="gallery-button inline-flex w-full items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{isVerifying ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}{isVerifying ? "Verifying…" : verifySeconds ? `Try again in ${verifySeconds}s` : "Verify and continue"}</button>
          <div className="flex flex-wrap gap-x-5 gap-y-3 text-xs font-semibold"><button type="button" onClick={() => void sendCode()} disabled={busy || resendSeconds > 0 || available === false} className="py-1 text-[#b55fbe] disabled:cursor-not-allowed disabled:text-[var(--faint-text)]">{isSending ? "Sending…" : resendSeconds ? `Resend in ${resendSeconds}s` : "Send a new code"}</button><button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(""); setError(""); setVerifyAt(0); }} className="py-1 text-[var(--muted-text)] disabled:opacity-50">Use a different email</button></div>
        </form>
      )}
      {error && <p role="alert" className="mt-5 rounded-xl bg-[#EF476F]/5 p-3 text-sm leading-6 text-[#d73c63] dark:text-[#ff8eab]">{error}</p>}
      <p className="mt-5 text-xs leading-6 text-[var(--faint-text)]">Your email stays private. A wallet is still needed for blockchain transactions.</p>
    </div>
  );
}

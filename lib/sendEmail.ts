import nodemailer from "nodemailer";

type SignInEmail = { email: string; code: string; origin: string };

function mailConfiguration() {
  const user = process.env.GMAIL_SMTP_USER?.trim();
  const password = process.env.GMAIL_SMTP_APP_PASSWORD?.replace(/\s/g, "");
  if (!user || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(user) ||
      /[\u0000-\u001f\u007f]/.test(user) || !password || !/^[a-zA-Z0-9]{16}$/.test(password)) return null;
  return { user, password };
}

export function isEmailConfigured(): boolean {
  return Boolean(mailConfiguration() && (process.env.ARTIQ_EMAIL_CODE_SECRET?.length ?? 0) >= 32);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]!));
}

/** Fixed SMTP destination and message headers; no credentials or codes are logged. */
export async function sendSignInEmail({ email, code, origin }: SignInEmail): Promise<void> {
  const configuration = mailConfiguration();
  if (!configuration || !isEmailConfigured() || !/^\d{6}$/.test(code)) {
    throw new Error("Email sign-in is not configured.");
  }
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: configuration.user, pass: configuration.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transporter.sendMail({
      from: { name: "Artiq", address: configuration.user },
      to: { address: email, name: "" },
      subject: "Your Artiq sign-in code",
      text: `Your Artiq sign-in code is ${code}.\n\nThis code expires in 10 minutes and can be used once at ${origin}.\n\nNever share this code. If you did not request it, you can ignore this email.`,
      html: `<p>Your Artiq sign-in code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes and can be used once at ${escapeHtml(origin)}.</p><p>Never share this code. If you did not request it, you can ignore this email.</p>`,
    });
  } finally {
    transporter.close();
  }
}

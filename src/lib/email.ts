const RESEND_API_URL = "https://api.resend.com/emails";

// Addresses that should never receive real email — test accounts
// and the dev-bypass user. Anything for these is logged instead,
// so a local run against the shared database stays harmless.
function isFakeAddress(email: string): boolean {
  const local = email.toLowerCase();
  return local.endsWith("@lyco.test") || local.endsWith("@lyco.local") || local.endsWith("@example.com");
}

export interface SendResult {
  sent: boolean;
  loggedOnly: boolean;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || isFakeAddress(to)) {
    console.log(`[email] ${to}: ${subject}`);
    return { sent: false, loggedOnly: true };
  }

  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
  return { sent: true, loggedOnly: false };
}

export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  await sendEmail(
    email,
    "Your Lyco sign-in link",
    `<p>Click the link below to sign in to Lyco:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`
  );
}

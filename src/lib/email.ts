const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[magic-link] ${email}: ${link}`);
    return;
  }

  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your Lyco sign-in link",
      html: `<p>Click the link below to sign in to Lyco:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
}

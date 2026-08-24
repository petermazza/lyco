import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = body?.email?.trim()?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const { link } = await createMagicLink(email);

  try {
    await sendMagicLinkEmail(email, link);
  } catch (err) {
    console.error("[request-link] Failed to send email:", err);
    return NextResponse.json({ error: "Could not send sign-in email. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ...(process.env.NODE_ENV === "development" ? { link } : {}) });
}

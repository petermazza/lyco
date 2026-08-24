import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = body?.email?.trim()?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const { link } = await createMagicLink(email);

  // If no email provider configured, log the link for dev
  if (!process.env.RESEND_API_KEY) {
    console.log(`[magic-link] ${email}: ${link}`);
  }

  return NextResponse.json({ ok: true, ...(process.env.NODE_ENV === "development" ? { link } : {}) });
}

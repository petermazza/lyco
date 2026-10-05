import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { unsubscribeSignature } from "@/lib/auth";

// One-click unsubscribe (and re-subscribe) from reminder emails.
// The link is signed with the auth secret so it can't be forged.

function page(title: string, line: string, actionHtml: string): Response {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
    <body style="font-family:-apple-system,system-ui,sans-serif;background:#0e1018;color:#e8e9ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
      <div style="max-width:320px;text-align:center">
        <div style="font-size:22px;font-weight:500;margin-bottom:12px">lyco</div>
        <p style="font-size:15px;line-height:1.6">${line}</p>
        ${actionHtml}
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  const sig = req.nextUrl.searchParams.get("sig");
  const action = req.nextUrl.searchParams.get("action") ?? "off";

  if (!u || !sig || sig !== unsubscribeSignature(u)) {
    return new NextResponse("That link isn't valid.", { status: 400 });
  }

  if (action === "on") {
    await query(`UPDATE users SET reminder_emails = true WHERE id = $1`, [u]);
    return page("Reminders on", "Reminder emails are back on.", "");
  }

  await query(`UPDATE users SET reminder_emails = false WHERE id = $1`, [u]);
  const backOn = `${req.nextUrl.origin}/api/user/reminders?u=${u}&sig=${sig}&action=on`;
  return page(
    "Reminders off",
    "You won't get reminder emails anymore.",
    `<p style="font-size:13px;color:#888">Changed your mind? <a href="${backOn}" style="color:#aaa">turn them back on</a></p>`
  );
}

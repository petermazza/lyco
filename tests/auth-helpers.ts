import { type APIRequestContext, type Page } from "@playwright/test";

// The magic link opens a confirm page — consuming the token needs one
// deliberate click so mail scanners can't burn it.
export async function redeemMagicLink(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export function redeemMagicLinkApi(
  ctx: APIRequestContext,
  link: string,
  opts?: { maxRedirects?: number },
) {
  return ctx.post(link, opts);
}

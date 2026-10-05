// Single source for the app's public URL. NEXT_PUBLIC_BASE_URL is kept
// as a fallback for any environment that still sets the old name.
export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3001"
  );
}

export function calendarRedirectUri(): string {
  return `${appUrl()}/api/calendar/callback`;
}

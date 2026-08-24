import { google } from "googleapis";
import type {
  CalendarProvider,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  FreeBusyResult,
} from "./provider";
import { getSecret, setSecret, deleteSecret } from "../secrets";

// ─── GoogleCalendarProvider ──────────────────────────────────
// This is the only file that imports googleapis.
// Nothing outside this directory should import Google's SDK.

const REFRESH_TOKEN_KEY = "google_calendar_refresh_token";
const ACCESS_TOKEN_KEY = "google_calendar_access_token";

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

export function getOAuthClient(redirectUri: string) {
  const { clientId, clientSecret } = getOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(redirectUri: string): string {
  const oauthClient = getOAuthClient(redirectUri);
  const scopes = ["https://www.googleapis.com/auth/calendar"];
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{
  refreshToken: string;
  accessToken: string;
}> {
  const oauthClient = getOAuthClient(redirectUri);
  const { tokens } = await oauthClient.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned from Google");
  }
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? "",
  };
}

// ─── Provider implementation ─────────────────────────────────

export class GoogleCalendarProvider implements CalendarProvider {
  private userId: string;
  private redirectUri: string;

  constructor(userId: string, redirectUri: string) {
    this.userId = userId;
    this.redirectUri = redirectUri;
  }

  private async getAuthenticatedClient() {
    const refreshToken = await getSecret(this.userId, REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new Error("Google Calendar not connected. Call /api/calendar/connect first.");
    }

    const oauthClient = getOAuthClient(this.redirectUri);
    oauthClient.setCredentials({
      refresh_token: refreshToken,
    });

    // Refresh the access token automatically
    const { credentials } = await oauthClient.refreshAccessToken();
    oauthClient.setCredentials(credentials);

    // Cache the refreshed access token
    if (credentials.access_token) {
      await setSecret(this.userId, ACCESS_TOKEN_KEY, credentials.access_token);
    }

    return google.calendar({ version: "v3", auth: oauthClient });
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const calendar = await this.getAuthenticatedClient();
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      },
    });
    const event = res.data;
    return {
      id: event.id!,
      htmlLink: event.htmlLink!,
      summary: event.summary!,
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
    };
  }

  async updateEvent(eventId: string, input: UpdateEventInput): Promise<CalendarEvent> {
    const calendar = await this.getAuthenticatedClient();
    const res = await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.start !== undefined && { start: { dateTime: input.start } }),
        ...(input.end !== undefined && { end: { dateTime: input.end } }),
      },
    });
    const event = res.data;
    return {
      id: event.id!,
      htmlLink: event.htmlLink!,
      summary: event.summary!,
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
    };
  }

  async deleteEvent(eventId: string): Promise<void> {
    const calendar = await this.getAuthenticatedClient();
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });
  }

  async getFreeBusy(start: string, end: string): Promise<FreeBusyResult> {
    const calendar = await this.getAuthenticatedClient();
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: start,
        timeMax: end,
        items: [{ id: "primary" }],
      },
    });
    const calendars = res.data.calendars ?? {};
    const primary = calendars["primary"] ?? {};
    const busy = (primary.busy ?? []).map((slot) => ({
      start: slot.start ?? "",
      end: slot.end ?? "",
    }));
    return { busy };
  }
}

// ─── Connection management ───────────────────────────────────

export async function isCalendarConnected(userId: string): Promise<boolean> {
  const refreshToken = await getSecret(userId, REFRESH_TOKEN_KEY);
  return refreshToken !== null;
}

export async function disconnectCalendar(userId: string): Promise<void> {
  await deleteSecret(userId, REFRESH_TOKEN_KEY);
  await deleteSecret(userId, ACCESS_TOKEN_KEY);
}

export async function getProvider(userId: string, redirectUri: string): Promise<GoogleCalendarProvider> {
  return new GoogleCalendarProvider(userId, redirectUri);
}

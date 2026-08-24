// ─── CalendarProvider adapter interface ──────────────────────
// Nothing outside this directory should import Google's SDK.
// All calendar operations go through this interface.

export interface CalendarEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: string;
  end: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  start: string;
  end: string;
}

export interface UpdateEventInput {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

export interface FreeBusyResult {
  busy: FreeBusySlot[];
}

export interface CalendarProvider {
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: UpdateEventInput): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
  getFreeBusy(start: string, end: string): Promise<FreeBusyResult>;
}

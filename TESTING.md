# Testing Lyco by hand

A small set of walkthroughs. Together they touch every feature of the app,
with as little overlap as possible. When a feature is added or changed,
update the matching walkthrough — or add a step to the closest one — so this
stays true.

## Before you start

- Start the app and open it at `http://localhost:3001`.
  (From the project folder: `npm run dev` — or ask me to start it.)
- **Signing in on your own computer:** type any email and press Sign in.
  It signs you straight in — no real email is sent. On the live site it
  emails you a link instead, so that part only needs checking once, live.
- Each walkthrough says at the top whether it needs a fresh account or works
  on top of whatever's already there.
- A lot of the app only appears when something is scheduled **right now**.
  The quickest way to get that is to ask the assistant for it — e.g.
  "put a 30-minute block called X starting right now".

---

## Workflow 1 — First day: sign in, make a goal, schedule it

*Needs a fresh account (an email you've never used on this app).*

1. Sign in with a new email.
   - You land on the welcome screen: "What's the one thing you'd like to get
     moving?" with two example buttons and a text box.
2. Type something like **"I want to train for a 5k by mid-December"** and send.
   - It opens a conversation. The assistant asks a follow-up or two — answer
     them in your own words.
   - When it has enough, it saves the goal and shows **"find time for this"**.
3. Tap **find time for this**.
   - The schedule screen loads with a headline ("finding your open times…"),
     then proposed days and times, a one-line reason for the pace, and a
     line like "that is N sessions before December 15."
4. Tap **Pick different times** — new slots load.
5. Tap **Go less often** — it switches to once a week and reloads. Tap
   **Go more often** to go back.
6. Tap **Accept these times**.
   - "Set. the blocks are in your calendar." appears, with a note that
     Google Calendar isn't connected yet (unless it is).
7. Back to home.
   - Greeting and today's date at the top, **schedule** and **new** buttons.
   - "Right now" shows the block if one is happening now, or "Nothing
     scheduled right now" otherwise.
   - "Later today" lists anything still coming up today.
   - At the bottom: dots and "you kept X of Y blocks this month."

**Covers:** sign-in, first-run screen, starting a conversation from the
home screen and from an example button, creating a goal, the schedule
proposal (reasoning, session math, different times, more/less often,
accepting), and every always-on part of the home screen.

---

## Workflow 2 — A block, start to finish

*Works on any account with an active goal.*

1. Open **new** and say: **"put a 30-minute block called 'Prep for the
   week' starting right now."** Then go home.
   - "Right now" shows the block: title, how long and when it ends, a
     progress bar, and "just started" / "N minutes in" with time left.
2. Tap the block's title.
   - The block screen opens: "block running", the goal name, the end time,
     and three buttons.
3. Tap **I don't know how to start**.
   - A conversation opens and the assistant asks what's in front of you.
     Reply with anything ("the kitchen's a mess, I can't focus"). Keep
     going until it suggests one small first step and you agree.
   - The block's title changes to that step and the screen switches to
     "That is the block now… nothing else to decide."
4. Tap **Move it**, then **Give it 15 more minutes**.
   - A small confirmation message appears, the block keeps running, and the
     end time moves 15 minutes later.
5. Tap **Mark done**.
   - "Kept." — the block closes. Back to home: the card is gone and the
     kept count at the bottom has gone up by one.

**Covers:** scheduling a block by asking, the "right now" card, the whole
block screen (running → getting help → settled → closed), the assistant
renaming a block mid-run, adding 15 minutes, finishing a block, and the
monthly kept count.

---

## Workflow 3 — Moving and dropping things

*Works on any account. Repeat the first step as needed.*

1. Ask in **new** for another right-now block, then go home.
2. Tap **Move it** on the "right now" card, then **Later today**.
   - A confirmation appears and the block shows up under "Later today"
     at its new time.
3. Do it again with **Tomorrow morning** — it leaves today entirely.
4. Do it again with **Drop it this week** — it's gone, "no explanation
   needed."
5. Ask for **"a 20-minute block that started two hours ago."** Go home.
   - It appears under **Still open from earlier**, marked with the time it
     was. Try each of its three buttons — **done**, **tomorrow**, **drop**
     (you'll need a few of these stale blocks to try all three).
   - Left alone past its grace period, a block like this lands here on its
     own — that's the "you missed it" behavior working.

**Covers:** all four places a block can move to, the move sheet on the home
screen, the "still open from earlier" section with its three buttons, blocks
being marked missed automatically, and all the confirmation messages.

---

## Workflow 4 — Spending and upcoming dates

*Works on any account.*

1. Open **new** and say: **"I want to keep eating out under $150 a month."**
   - The assistant confirms it's watching that.
2. In the same conversation: **"I spent $40 on dinner last night."**
   Then: **"I spent $130 on a birthday dinner."**
3. Still in the same conversation: **"our anniversary is the 24th — remind
   me. Note: book the restaurant this time."**
4. Go home.
   - **Spending this month** appears: "$170 of $150", a bar that's run past
     its target color, a thin marker showing where the month has gotten to,
     and a "past the target you set" note.
   - **Coming up** shows a card: the number of days until the anniversary,
     the title, and your note underneath.

**Covers:** setting a spending limit, logging purchases (including one dated
yesterday), the spending bar, the pace marker, the over-budget state, adding
an occasion, and the coming-up cards.

---

## Workflow 5 — Changing and finishing goals

*Works on an account with at least one active goal.*

1. Open **new**: **"push my 5k deadline out a month."**
   - The assistant confirms the new date.
2. Then: **"pause that goal for now."**
   - It goes quiet — it stops being offered for scheduling.
3. Open **schedule** (top of home).
   - If a goal is still active you get a proposal for it. If every goal is
     paused or done, you're sent back to the **new** screen instead — that's
     the intended behavior.
4. When you're done testing: **"mark the 5k goal done."**

**Covers:** changing a deadline, pausing and completing a goal, and what the
schedule screen does when there's nothing left to schedule.

---

## Workflow 6 — Google Calendar and reminder emails

*Needs a real Google account and real email delivery. Save for when you want
to check the plumbing, not every pass.*

1. On the schedule screen, tap **Connect Google Calendar** and approve it.
   - You return to the app; a line appears: "Google Calendar connected."
2. Regenerate the proposal.
   - Each slot now says how often that time has been free — "free on 8 of
     the last 10 Tuesday evenings" — instead of "checked against your
     scheduled blocks only."
3. **Accept these times** — the blocks appear as events in Google Calendar.
4. Move or drop one of those blocks from home — the calendar event moves or
   disappears with it.
5. Reminder emails — three kinds exist: a block is starting, a block ended
   and is still open, and an occasion coming up (7 days and 1 day before).
   They send on a timer in the background. To check them without waiting,
   run:

   ```
   npm run remind
   ```

   (or ask me to run it — there's a `--dry-run` flag that shows what would
   send without sending.)
6. In any reminder email, tap **stop these emails**.
   - A page confirms they're off, with a "turn them back on" link. Click it
     to make sure re-subscribing works too.

**Covers:** connecting Google, free/busy-aware scheduling, events being
written, moved, and deleted, all three reminder emails, and the unsubscribe
/ re-subscribe links.

---

## Small checks that don't need a full walkthrough

- **Your timezone is picked up automatically** on the first home load —
  times should match your clock, no setting to find.
- **Loading:** on a slow connection the home screen shows grey placeholder
  shapes while it fetches.
- **Empty states:** with no current block you get "the time is yours."; with
  nothing later, "nothing else today."
- **Signing out:** there is currently no way to sign out from inside the
  app — the capability exists behind the scenes but no button exposes it.
  That's a gap worth noting, not a test step.

## Coverage map

| Feature | Walkthrough |
|---|---|
| Sign-in / first run | 1 |
| Creating a goal by conversation | 1 |
| Schedule proposal (all its controls) | 1, 6 |
| Home screen sections and footer | 1, 2, 3, 4 |
| Running a block, getting help mid-block | 2 |
| Moving / dropping / finishing blocks | 2, 3 |
| Missed blocks surfacing | 3 |
| Spending limits and logging | 4 |
| Occasions and coming-up cards | 4 |
| Editing, pausing, completing goals | 5 |
| Google Calendar sync | 6 |
| Reminder emails and unsubscribe | 6 |
| Assistant scheduling/editing by chat | 2, 3, 4, 5 |

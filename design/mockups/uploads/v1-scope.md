# Build plan — v1

Revised. Supersedes all earlier versions.

**What this is now:** a tool built for one user (you), architected so that
commercializing later is a set of additions rather than a rewrite.

---

## The bet

Build the thing you want. Use it for three months against real deadlines
and real spending. That produces two assets:

1. A working tool you actually use
2. Evidence about which parts get opened and which got built and ignored

The second one is what you said you were missing. It can't be researched,
only lived.

---

## The only rule that matters

**Build for one user. Architect for many. Defer everything else.**

Some decisions are cheap now and brutal to reverse later. Those get made
correctly on day one, even though you're the only user and they buy you
nothing today. Everything else waits until there's a reason.

The list below is short on purpose. Anything not on it is deferred.

---

## Do now — expensive to reverse

### 1. Multi-tenant from the first migration
Every table carries `user_id`. Every query filters on it. No hardcoded
"me", no singleton assumptions, no `WHERE id = 1`.

Costs an hour now. Retrofitting tenancy into a working app is a rewrite,
and it's the single most common reason a personal tool can't become a
product.

### 2. Real auth
Even with one account. Email + magic link is fine. No hardcoded session,
no skipping the login screen "for now."

### 3. Adapters behind an interface
Bank data comes through a `sync()` / `project()` contract, not direct
SimpleFIN calls scattered through the codebase.

You'll use SimpleFIN ($15/year, personal use, read-only). A commercial
version needs Teller or Plaid — SimpleFIN's license doesn't permit resale.
If SimpleFIN's response shape leaks into your schema, swapping is a
migration. If it stays behind the adapter, it's one file.

Same pattern for calendar (Google now, Outlook/Apple later) and messaging
(SMS now, push later).

### 4. The LLM writes through a tool layer, never raw SQL
The chat calls defined functions — `create_goal`, `update_deadline`,
`schedule_block`, `log_gift_idea` — with validated arguments. It does not
generate queries.

Today this stops it corrupting your data. Later it's where permissions,
rate limits, and guardrails attach without touching the model layer. It's
also what makes the behavior testable.

### 5. Log every LLM interaction
Prompt, response, tool calls made, what changed in the database, and
whether you corrected it afterward.

**This is your most valuable commercial asset.** Three months of real
conversations tells you exactly which interactions repeat, which ones need
templates instead of a model call, and where the tone lands wrong. It's
the eval set and the product spec for a multi-user version, and you can
only get it by using the thing.

### 6. Deadline lock + break log at the database level
Write-once trigger on `direction`, `target_value`, `deadline`. Changing
them requires an explicit `goal_breaks` row that never goes away.

Not for legal reasons now. Because you built this to hold you accountable,
and the version that lets you quietly edit a deadline at 11pm is the
version that stops working. This is a constraint on you, from you, and it's
the entire point.

### 7. Secrets in env, cost tracking on
API keys never committed. Log token spend per call even at one user —
you'll want to know what a user costs before you ever price anything.

---

## Build — the actual v1

**Chat is the interface.** No goal-creation form. You talk, it creates and
updates projects. Dashboard renders current state.

1. **Schema + auth + tool layer.** The functions the chat can call.
2. **Chat that creates and updates projects.** Working conversation → real
   rows in the database.
3. **Dashboard.** The home screen already mocked up: one current thing,
   later today, spending bars, upcoming occasion, kept-blocks ratio.
4. **Google Calendar writes.** Blocks appear in your real calendar.
   Calendar alerts are your first reminder channel — free, and they already
   ring on your phone.
5. **SimpleFIN + spending goals.** Behind the adapter.
6. **SMS.** Sole proprietor A2P registration, ~$4, hobbyist use case. Only
   once calendar alerts prove insufficient.
7. **Weekly digest to yourself.** One LLM call, Sunday.

Occasions, gift chains, and the interest log all fall out of the chat
naturally — no separate feature build. You tell it about your mom's
birthday and it creates the goal and the lead time. That's the whole
argument for chat-first: features become conversations.

---

## Deferred — cheap to add when there's a reason

Not rejected. Just not now, and each is genuinely additive:

- Privacy policy, consent flow, opt-in page
- A2P standard brand + EIN (sole prop is enough for one user)
- Business entity and the accountant conversation
- Landing page, onboarding, billing, pricing
- Teller/Plaid migration (adapter makes this small)
- Rate limiting, abuse handling, cost caps per user
- Tone tuning for strangers — currently free, because the only user
  corrects it in real time
- Native app / Capacitor (trigger: health connectors)
- Accountability partner (trigger: you want one)
- ICP work, kill criteria, market research

**Note on the last one:** the earlier version of this doc had kill criteria
and an ADHD ICP. Both were written for a business you're not building yet.
They're not wrong — if you commercialize, the ADHD-adult analysis still
holds and the kill criteria are still the right questions. They're just
premature. Keep them in mind, not in scope.

---

## The one thing to watch

Chat-first makes features cheap to add, which means scope creep costs
nothing to *start* and everything to *finish*. Three features arrived in
one hour of conversation earlier today.

With one user there's no change-control board and no reason for one. The
substitute: **if you haven't used the last thing you built for two weeks,
don't build the next thing.** Usage is the gate.

---

## Time

Evenings and weekends alongside the new role. Steps 1–4 is the tool —
call it four to six weeks at that pace. 5–7 is another two or three.

If it's usable at step 4 and you're still opening it in November, you have
something. That's the only milestone that matters.

# PDPA and Personal Data

## TL;DR

- **No biometrics.** This document is roughly a tenth the size of its CV
  counterpart, and that's the point.
- We still hold personal data: name, NUS email, Telegram handle and user id,
  and a borrowing history. **PDPA still applies** — just lightly.
- **Telegram is a foreign service.** Message content is minimal, but members
  should be told the bot is the interface and Telegram sees the messages.
- Members join **only with an admin-issued join code** (N people, M minutes).
  They see the notice in the join form and must accept it. Acceptance is
  recorded as `members.notice_accepted_at`. Roster-imported members still get
  the notice at club registration.
- Deletion on leaving: clear `telegram_user_id`, deactivate, retain the
  inventory history (club records, not personal profiling).
- **Annual review at the start of the academic year**, owned by a named
  committee *position*.

> Engineering checklist, not legal advice. Have it reviewed by whoever handles
> data protection for the club's parent body before launch.

---

## What personal data this system holds

| Data | Why | Sensitivity |
|---|---|---|
| Full name, display name | Identify the borrower | Ordinary |
| NUS email | Admin contact, account recovery | Ordinary |
| Telegram handle + user id | The identity mechanism | Ordinary |
| Borrowing history | The entire point of the system | Ordinary, but see below |
| Destination (which robot) | Answers "where did our motors end up" | Ordinary |

**No biometric data.** No face images, no embeddings, no camera anywhere in the
system. This removes the single largest compliance burden the CV approach
carried, along with its consent flow, retention rules, and the constraint that
its face model could never be changed without re-enrolling everyone.

Borrowing history is ordinary personal data, but it is still a record of an
individual's activity over time. Treat it as club operational data with
purpose limitation, not as something to mine.

## Obligations and how they're met

**Notification.** Members are told at club registration that their Telegram
handle will be used for the parts system and that their borrowing is logged.
One paragraph in the existing registration form. Members who join with a code
see the same paragraph in the Mini App join form
(`src/app/store/components/JoinForm.tsx`) and must tick it before submitting.
The time they accepted is stored on their row. Keep the two texts in step.

**Purpose limitation.** The stated purpose is *inventory tracking for the club
parts store*. Not attendance, not activity monitoring, not performance review.
Any future feature that widens this needs a fresh notice.

**Access and correction.** A member can see their own history in the Mini App
and ask an admin to correct an error.

**Withdrawal / deletion.** On leaving the club, or on request: clear
`telegram_user_id`, set `active = false`, unlink the Telegram binding.

## Retention

| Data | Retained |
|---|---|
| Telegram binding (`telegram_user_id`) | Until the member leaves — then cleared |
| Member record | Deactivated on leaving; kept for historical attribution |
| Borrowing history | Retained as club inventory records |
| `telegram_bind_attempts` | 90 days, then purged |
| `join_code_attempts` | 90 days, then purged (same cron) |

Rationale for keeping history: "who had the Livox LiDAR in 2026" is a legitimate
club record, and stripping it would make the ledger useless for its actual
purpose. It stops being linked to a live Telegram account once the binding is
cleared.

The bind-attempts table is the one thing that accumulates data about *non*-
members (visitors who scanned a sticker out of curiosity). Purge it on a
schedule; it exists to clear a queue, not to build a log of who wandered
through the lab.

## Telegram as a third party

Worth being straightforward about, because it's the one thing a careful
committee member will ask:

- **Telegram sees the messages.** In practice that's `/start <code>` and the
  bot's replies. The Mini App's cart traffic goes to our own API, not through
  Telegram's message infrastructure.
- **Telegram is not in Singapore.** Message content is minimal and contains no
  sensitive data, but the club should know the bot is a foreign service rather
  than assume everything stays in-country.
- **Our own data is currently in Mumbai, not Singapore.** The Supabase
  project runs in `ap-south-1` (AWS Mumbai), despite earlier drafts of these
  docs claiming a Singapore region — corrected here on 2026-09-12 once the
  live project was actually checked. The club intends to **self-host Supabase**
  later, which is why the project was not migrated to `ap-southeast-1` when
  this was found. Until then, club data does leave Singapore, and whoever
  reviews this for the parent body should be told that plainly rather than
  discovering it.
- Members already use Telegram for club communication, so this doesn't
  introduce a new relationship, only a new use of an existing one.

If the committee is uncomfortable with any of this, the honest alternative is a
plain web app with its own login — more friction, no Telegram dependency. Worth
raising rather than discovering later.

## Design rules

Binding on the implementation:

1. **Service-role key and bot token never reach the browser.** Server-side
   only, in Vercel env vars.
2. **Validate `initData` on every API request.** Identity comes from the
   verified HMAC, never from client-supplied fields. See
   [architecture.md](architecture.md).
3. **No open self-enrolment.** A record is created only for someone holding a
   live admin-issued join code (0026: use-limited, time-limited, revocable,
   every attempt logged). Anyone else is refused rather than having a record
   created for them. A typed email never links someone to a staff account.
4. **RLS enforces that members read only their own history.** Not left to
   application code.
5. **Deactivation is immediate and effective.** Clearing the binding must lock
   the account out on the next request, not at the next deploy.

## Notice text (draft, for the registration form)

> **Parts store system**
>
> We use a Telegram bot to track what's borrowed from the parts store. Your
> Telegram handle is used to identify you when you scan an item, and we log
> what you borrow, when, and which robot it's for.
>
> This is used only for managing club inventory. It isn't used for attendance
> or any kind of monitoring.
>
> You can see your own borrowing history in the app at any time. When you leave
> the club, your Telegram account is unlinked. Ask [role/email] if you have
> questions or want something corrected.

## Annual review

At the start of each academic year:

- [ ] Unlink Telegram accounts for members who have left
- [ ] Purge `telegram_bind_attempts` older than 90 days
- [ ] Confirm the named data owner *position* is filled
- [ ] Confirm the registration notice is still accurate
- [ ] Rotate the bot token and service-role key as part of handover

Name the **position**, not the individual — an obligation attached to a
graduated member is an obligation nobody holds.

## Open questions

- Does NUS have a policy on student clubs using third-party messaging platforms
  for member-facing systems? Worth checking before launch.
- Should members be able to see *other* members' borrowing (e.g. "who has the
  oscilloscope")? Useful for the club, and arguably why the ledger exists — but
  it's a purpose extension and should be decided deliberately rather than by
  accident. Leaning: yes for asset location, no for browsing an individual's
  history.
- Is a 90-day purge on bind attempts right, or shorter? Shorter is better if
  the queue is cleared promptly.

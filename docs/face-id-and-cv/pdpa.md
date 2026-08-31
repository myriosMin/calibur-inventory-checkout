# PDPA and Biometric Data

## TL;DR

- Face embeddings of members are **personal data** under Singapore's PDPA, and
  biometrics are treated as sensitive. This is an engineering checklist, **not
  legal advice** — get it reviewed before launch.
- Four obligations shape everything: **consent, purpose limitation,
  notification, and the right to access / correct / withdraw.**
- Seven binding design rules: store embeddings **never photographs**; no frame
  retention at the kiosk; **camera off at idle** (it only wakes when someone
  presses Borrow); a non-biometric path that works equally well; deletion that
  actually deletes; admin/service-role access only, enforced by RLS; data kept
  in the **Singapore region**.
- **Face enrollment is opt-in and declining costs you nothing** — QR
  self-identification on your phone, one scan slower. This is both a compliance
  requirement and the system's failure fallback.
- Retention: embeddings deleted when a member leaves; annual review each
  academic year. Transaction history is kept — different purpose, different
  basis.
- **The cost of "never store photos": changing the face model later means
  re-enrolling all ~80 members in person.** Accepted knowingly — so pick that
  model once and stay on it.
- A drafted consent text is included, ready to put in front of members.
- **Name the responsible *position*, not the person** — this system outlives
  committees, and an obligation attached to a graduate is one nobody holds.

---

Face embeddings derived from club members are **personal data** under
Singapore's Personal Data Protection Act, and biometric data is generally
treated as sensitive. This document is the practical compliance checklist for
the build.

> This is an engineering checklist written to make the system defensible by
> design. It is not legal advice. Before launch, have it reviewed by whoever
> handles data protection for the club's parent body (NUS / the faculty club
> office), and check whether the university has its own biometric-data policy
> that is stricter than the PDPA baseline.

## The four obligations that shape the design

**Consent.** Face enrollment is opt-in, separately and explicitly, at
enrollment time. Joining the club is not consent to biometric processing.

**Purpose limitation.** The stated purpose is *identifying the member at the
inventory kiosk*. Face data is not used for attendance, access control,
analytics, or anything else — and no future feature should quietly widen this
without re-consent.

**Notification.** Members are told what is collected, why, how long it is kept,
who can see it, and how to withdraw. In plain language, not buried in a form.

**Access, correction, withdrawal.** A member can ask what is held, have it
deleted, and withdraw consent — after which the system must still work for
them.

## Design rules that follow

These are binding on the implementation, not suggestions.

1. **Store embeddings, never photographs.** Enrollment frames are embedded and
   the raw images are discarded in the same operation. Nothing writes an image
   to disk.

   The cost of this rule is real and should be accepted knowingly: because
   there are no stored photos to re-embed from, **changing the face model later
   means re-enrolling every member in person** — including any who have since
   graduated. Product reference photos are kept precisely because they are not
   personal data. See [operations.md](operations.md) §3.

2. **No frame retention at the kiosk.** Live frames are processed in memory and
   dropped. No recording, no debug frame dumps in production, no "just for
   troubleshooting" cache. If debugging needs frames, it happens on a dev
   machine with synthetic or consented data.

3. **The camera runs only during an active identification.** The kiosk is idle
   and the camera is off until someone presses Borrow or Return. An always-on
   camera watching the room is both a much larger privacy surface and an easier
   thing to object to. (This is why [flows.md](flows.md) starts at a touch, not
   at continuous face-watching.)

4. **A non-biometric path must always exist and be equally functional.** QR
   self-identification on the member's phone. A member who declines face
   enrollment gets a system that works exactly as well, one scan slower.
   This is both a compliance requirement and the system's failure fallback.

5. **Deletion is real deletion.** `on delete cascade` on
   `member_face_embeddings` in [data-model.md](data-model.md), plus a
   "delete my face data" button in the admin UI that an admin can action within
   days, not months. Deleting face data must not delete the member's
   transaction history — the inventory record is a separate purpose with a
   separate basis.

6. **Access is restricted to the service role and admins.** Face embeddings are
   never exposed to the frontend, never included in any API response the
   browser can reach, and never in an export. RLS enforces this; it is not left
   to application code.

7. **Data residency.** Use the Supabase Singapore region. Cross-border transfer
   under the PDPA requires the receiving jurisdiction to offer comparable
   protection; keeping data in-country avoids the question.

8. **Retention.** Face embeddings are deleted when a member leaves the club.
   Concretely: an annual review at the start of each academic year deletes
   embeddings for members with `left_at` set or who are no longer on the
   roster. Transaction history is retained (it is club inventory data, not
   biometric data) but stops being linked to biometrics.

## Consent record

Stored on `members.consent`:

```json
{
  "face_enrollment": {
    "granted": true,
    "granted_at": "2026-09-14T10:22:00+08:00",
    "text_version": "v1",
    "method": "in_person_admin_ui",
    "withdrawn_at": null
  }
}
```

`text_version` matters: if the consent wording changes materially, existing
consents were given against the old text and may need refreshing. Keep the
versioned texts in the repo under `docs/consent/`.

## Consent text (draft v1)

> **Face recognition for the parts store — optional**
>
> To make checking parts in and out faster, the store kiosk can recognise your
> face instead of asking you to scan a code.
>
> If you opt in, we take a few photos of you now, convert them into a numeric
> code (an "embedding"), and store only that code. **The photos are deleted
> immediately and are never stored.** The stored code cannot be turned back
> into a photograph of you.
>
> It is used for one thing only: recognising you at the parts store kiosk. It
> is not used for attendance, building access, or anything else. Only the club
> committee members who administer the system can access it.
>
> The kiosk camera only switches on when someone starts a checkout. It does not
> record the room.
>
> **This is entirely optional.** If you say no — or change your mind later —
> you can use the store exactly as normal by scanning a QR code with your
> phone. Nothing else changes.
>
> Your face data is deleted when you leave the club, or at any time you ask.
> To withdraw or ask what is held, contact [data owner name / email].
>
> [ ] I agree to face recognition being used to identify me at the parts store.

## Responsibilities

| Role | Who | Responsible for |
|---|---|---|
| Data owner | *(to fill in — a committee position, not a person, so it survives handover)* | Consent records, deletion requests, annual retention review |
| System admin | Inventory/logistics lead | Admin UI access, member enrollment |
| Technical | Project maintainer | RLS, key handling, no-retention guarantees |

Name the **position**, not the individual — this system is meant to run for
years across committee handovers, and an obligation attached to a graduated
member is an obligation nobody holds.

## Handover checklist

Because committees turn over annually, whoever inherits this must be told:

- [ ] Face embeddings exist and are personal data
- [ ] Where the consent records live and how to action a deletion request
- [ ] The annual retention review is their job, at the start of the academic year
- [ ] The service-role key is a secret; rotating it is part of handover
- [ ] Adding a feature that uses face data for a new purpose requires new consent

## Pre-launch checklist

- [ ] Consent text reviewed by the club's data-protection contact
- [ ] Consent flow implemented and tested, including the decline path
- [ ] QR fallback verified as fully functional end-to-end
- [ ] Confirmed: no code path writes a frame or photo to disk
- [ ] Camera confirmed off at idle
- [ ] RLS policies tested against face-embedding tables with a non-admin token
- [ ] Supabase project confirmed in the Singapore region
- [ ] Deletion path tested: delete face data, confirm the member can still use
      the kiosk via QR, confirm their history is intact
- [ ] Data owner position named in writing

## Open questions

- Does NUS have a biometric-data policy or an approval process for
  student-club systems? Needs checking before launch, not after.
- Should members be able to see their own borrow history in the phone app?
  Good for transparency and for the honour-system framing; low cost.
- If the club ever wants a "who has the oscilloscope right now" public board,
  that is a purpose extension — inventory data, not biometric, so likely fine,
  but worth deciding deliberately rather than by accident.

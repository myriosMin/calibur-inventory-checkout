# Data questions — 14 Sep 2026

**TL;DR:** 18 review items are still open after the clean-up triage (146 dismissed).
They come down to 1 safety action, 2 decisions about people, 1 chat about
unrecorded loans, and a few physical counts. Most can be closed in one
walk-around of the store plus the robots.

Close each item in `/admin/review` with a note saying what you found.
Member handles are left out on purpose (the repo is kept free of member
data), so open the review item to see who to ask.

---

## 1. Do first: safety

**#165 DJI TB47S battery.** 9 of 10 packs are recorded swollen or bad. The system
shows 9 in the store and 1 on Kirbee.

- Pull all TB47S packs, including the one on Kirbee, and check each one.
- Swollen packs go to the lab's battery disposal. Don't lend them out.
- Ask the lab manager how battery disposal works.
- In the app: count the disposed packs out in **Stocktake**, then resolve.

## 2. Decisions (club leadership)

**#171 Roles.** 10 people were admins in the old app, and all are plain members now.

- Ask the club leads which of them should get **procurement** (can edit the
  catalog, restock, stocktake, review) and which should get **admin**
  (developers only: members, scan codes, labels).
- In the app: set the roles in `/admin/members`.

**#170 Telegram handles.** 40 legacy accounts have only an email, so nobody can link a
Telegram account yet.

- Ask: can we get the roster with names and Telegram handles?
- Other option: skip the roster and let people link themselves with `/start`,
  then approve them in `/admin/bind-queue`.

## 3. Loans from the old app (ask 2 people)

**#166 Legacy loans not imported.** The old app shows 23 open loans. The item lists
both people. The loans cover a Jetson AGX Orin, a Livox LiDAR, a RealSense, a
Hikvision camera, referee modules, motors, ESCs and dev boards, plus 9 DM3519
motors on a second person. None were imported, so the store still counts
these items as on the shelf.

Loan length doesn't matter. Ask each person:

- Is this item actually with you, on a robot, or back in the store?
- Were the burst checkouts real, or a competition pack-out or test run?

In the app, for each item:

- **With them:** they borrow it in the Mini App.
- **On a robot:** count it onto that robot in **Stocktake**.
- **In the store:** nothing to do.

## 4. Physical counts

### 4a. Robots hold more than was recorded

The robot view adds up to more than the recorded total, so the system seeded
the store with 0. Count what is physically on each robot and in the store,
and ask each robot lead whether their numbers are right.

| # | Part | Recorded | On robots now | Over by |
|---|---|---|---|---|
| 193 | DJI C610 ESC | 9 | 11 (DarkNUS 4, Sentry 2, 5 others 1 each) | 2 |
| 194 | DJI C620 ESC | 72 | 77 (DarkNUS 24, Hero 18, Sentry 13, Kirbee 6, …) | 5 |
| 198 | DJI M2006 motor | 6 | 12 (DarkNUS 4, Sentry 2, Engineer 2.0 2, …) | 6 |
| 200 | DJI M3508 motor | 64 | 73 (DarkNUS 24, Hero 13, Sentry 11, Kirbee 8, …) | 9 |
| 226 | ESC center board 2 | 24 | 26 (DarkNUS 8, Sentry 5, …) | 2 |

Ask: is DarkNUS still built? If it has been stripped, its 24 C620s and 24
M3508s are probably back in the store.

In the app: **Stocktake** each robot, then the store.

### 4b. Possibly missing parts

The labelled units in the register are fewer than the old app's totals.

| # | Part | Register | Old app | System now |
|---|---|---|---|---|
| 209 | Small Armor Module AM02 | 61 | 74 | store 51, Sentry 2, "Standard (unspecified)" 8 |
| 207 | RFID Interaction Card TC01 | 14 | 21 | store 14 |
| 220 | DJI TB48S battery | 13 | 16 | store 10, 3 on robots |

- Ask the referee-system keeper: were the extra AM02s and TC01s never
  labelled, lost, or broken at a competition?
- Ask whoever looks after the batteries: where are the 3 missing TB48S?
- Also for AM02: which Standard robot has the 8 "unspecified" modules?
- In the app: count them in **Stocktake**. Any unlabelled units that turn up
  need a label (`/admin/labels`).

**#219 DJI RoboMaster Development Board Type C.** The system has 31 (18 in the store,
13 on robots) and the summary sheet had 19. Count the store shelf. If it's
about 6, the old app's 31 was wrong.

**#245 NVIDIA Jetson Orin NX.** The sheets say 2, but the register has 1, recorded as
faulty and on Aerial. The old log may record one overvoltage incident twice.

- Ask the Aerial lead: how many Orin NX exist, and does the one on Aerial work?
- In the app: fix the unit's condition in `/admin/products` → units. If a
  second board turns up, add it.

### 4c. Faulty units: find which ones

The old app reports faulty units without saying which ones. Test them, and
mark those units faulty so they don't get lent out.

- **#201 Large Armor Module AM12.** 2 faulty, out of 14 in the store and 5 on Hero.
- **#217 VTM Transmitter VT03.** 2 faulty, out of 6 in the store.

Ask the referee-system keeper whether they already know which ones are bad.

### 4d. DM3519 / DM3520: probably a duplicate

- **#221 DM3519 motor.** 41 in the store. They were added twice in the old app and
  merged into one entry.
- **#222 DM3520 motor.** Also 41, added a minute after DM3519. Not in stock
  (held back).

Ask whoever ordered the DM motors: did we buy 41 motors, and which model?

- **Duplicate:** count the DM3519s, then dismiss #222.
- **Both real:** add DM3520 stock through **Restock**.

---

## Checklist

- [ ] #165 Pull and dispose of the swollen TB47S packs
- [ ] #171 Get roles from club leads
- [ ] #170 Get the roster with Telegram handles, or open `/start` linking
- [ ] #166 Ask both people about the legacy loans
- [ ] Stocktake every robot and the store: #193 #194 #198 #200 #226 #219
- [ ] #209 #207 #220 Count AM02, TC01, TB48S
- [ ] #201 #217 Test AM12 / VT03 units
- [ ] #245 Confirm the Orin NX count and condition with the Aerial lead
- [ ] #221 #222 Confirm the DM motor order

## Open questions

- Does a stocktake on a robot correct the "Recorded" totals above, or do the
  items need closing by hand afterwards? (They need closing by hand: stocktake
  doesn't touch review items.)
- Who is the referee-system keeper and who is the battery owner? This doc
  assumes those roles exist.

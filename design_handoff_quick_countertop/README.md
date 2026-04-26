# Handoff: Quick Countertop & Cabinets — Live Remnant Inventory

## Overview

Quick Countertop & Cabinets is a family-run countertop fabricator and installer. This bundle covers a redesign of their **public-facing remnant inventory**, a **slab detail view**, a **staff sign-in screen**, and a planned **internal management console**.

The site's job is to let homeowners and small contractors browse the live yard of remnant slabs (offcuts from larger projects, sold at a discount) and request a hold on anything they're interested in. Staff sign in to a separate "Manage" surface to keep the public listings honest — adding new remnants, swapping photos, marking pieces as sold, and putting things on hold for customers.

The brand voice for this redesign:

> **Less waste. More kitchens.**

Editorial, quiet, honest. Not flashy. The customer should feel like they are walking the yard.

---

## About the Design Files

The files in `source/` are **design references** — HTML/JSX prototypes built with React 18 + inline Babel + plain `<style>` tags. They are *not* production code. They demonstrate intended look, feel, layout, copy, interaction, and component decomposition.

Your task is to **recreate these designs in a Next.js codebase** using the project's established patterns and libraries (App Router, Server Components where appropriate, Tailwind or CSS Modules per the team's preference, a real component library like shadcn/ui or your own primitives).

If the project is greenfield, recommended stack:

- **Next.js 14+ App Router**
- **TypeScript**
- **Tailwind CSS** (the design system is token-based and maps cleanly to Tailwind theme extensions — see `Design Tokens` below)
- **shadcn/ui** primitives (Input, Button, Checkbox, Dialog) restyled against the design tokens
- **Lucide React** for icons (the prototype uses inline SVGs that match Lucide's stroke style)
- A real DB for slab data (Postgres + Drizzle/Prisma works fine; data shape is in `source/data.js`)

Do **not** ship the JSX from `source/` directly — it uses a Babel-in-the-browser pattern, inline-style objects, and global `window.*` registration that are inappropriate for a real Next.js app.

---

## Fidelity

**High-fidelity.** All colors, typography, spacing, copy, and interaction details in this bundle are final unless explicitly marked otherwise. Pixel-match where reasonable. The visual language is intentional and minimalist — do not "improve" it by adding gradients, drop shadows, rounded corners, or glassmorphism. Specifically:

- Corners are **2px** on cards, inputs, and buttons. Not 8px, not 16px. The original (`ManageScreen.jsx`) uses 16–28px radii — it predates this redesign and is **not** the source of truth. The screenshot in `screenshots/03-sign-in.png` and the inventory shots are the source of truth.
- Borders are **1px hairlines** at `rgba(0,0,0,0.10)`. No drop shadows on cards.
- Typography is **Inter** for everything, with **Instrument Serif italic** as a single accent face for editorial moments (one or two phrases per screen, never more).

---

## Screens / Views

### 1. Inventory (public, default landing surface)

**File:** `source/app.jsx` — the `surface === "public"` branch
**Components:** `Header.jsx`, `HeroSection.jsx`, `FilterPanel.jsx`, `RemnantGrid.jsx`, `RemnantCard.jsx`, `StatusBadge.jsx`, `Footer.jsx`
**Screenshot:** `screenshots/01-inventory-public.png`, `screenshots/02-inventory-grid-detail.png`

**Purpose:** Browse all available remnant slabs. Customers can filter by material, color, finish, dimensions, and status, and request a hold on any individual slab.

**Layout (top to bottom):**

1. **Header** — full-bleed, 32px horizontal padding, 1px bottom hairline. Left: Quick Countertop logo (orange "Q" mark + wordmark, see `assets/quick-logo.svg` if present in your kit; otherwise recreate from the screenshot). Right: nav links `Inventory · Manage` then a sharp-cornered ink-black `Sign in` button.
2. **Hero** — left-aligned editorial headline. **"Find your remnant"** in ink black + **"before someone else does."** in gray. Eyebrow above: small orange dot + `LIVE REMNANT INVENTORY`. Right side: large numeric count of slabs in stock with `REMNANTS IN STOCK` label. Faint orange radial blur behind the headline (~10% opacity).
3. **Filter panel** — single horizontal row, 1px-bordered rectangle. Search input (with magnifying glass icon, placeholder `Search stone, brand, finish, or ID #741`), `Min W"` numeric, `Min H"` numeric, status chips (`Available`, `On Hold`, `Sold` — each with a colored dot prefix), result count on the right. Below the input row: material chips (`All`, `Quartz`, `Granite`, `Marble`, `Quartzite`, `Porcelain`, `Soapstone`) and color swatches (small circles in `#e7d9c2`, `#c9b08a`, `#b08a5e`, `#7a6b4f`, `#3a3a3a`, `#1a1a1a`, `#1f3a5f`, `#0e3b2e`, etc.).
4. **Remnant grid** — 4 columns at desktop (≥1280px), 3 at tablet, 2 at mobile-large, 1 at mobile-small. 24px gap.
5. **Footer** — see Footer section below.

**Remnant card** (`RemnantCard.jsx`):

- 1px hairline border, 2px corners, white background, no shadow.
- **Image area** — square, full-bleed top of card. Background photo of the slab. In the **top-left corner** (16px inset), a small status pill: green dot + `#741` for Available, amber dot + `#615` for On Hold, rose dot + `#933` for Sold. The pill background matches status (mint / amber / rose, very pale). In the **bottom-left corner** of dark slabs, a small inverted color-disc icon shows the slab's primary color tones.
- **Body** — 16px padding.
  - Eyebrow: brand · material in orange (`CAESARSTONE · QUARTZ`), 10px, 0.18em tracking, uppercase.
  - Title: stone name in ink (`Calacatta Borghini`), Inter Medium, ~17px.
  - Color row: 2 small color circles + labels separated by ` · ` (e.g. `White · Gray`).
  - Footer row: split into three columns: `SIZE · 120″ × 60″` and below `3cm`, then `FINISH · Polished`. Mono-spaced cm value.
  - **L-shaped pieces** (e.g. #615 Carrara Venato): size renders as `120″ × 34″ + 30″ × 30″` and an inline `L` chip appears next to the `SIZE` label.
- **Hover state:** border darkens to `rgba(0,0,0,0.18)`, no transform.
- **Click:** open Slab Detail view (see #2).

**Hold request:** Bottom-right of the card or on detail view, a `Request hold` button. On click, show a transient toast at the bottom of the screen: ink-black pill, `Hold request sent for #741. Our team will review it and follow up soon.` — auto-dismiss after 4s.

**Empty state:** when filters return zero results — center-aligned italic Instrument Serif `No matches.` in `#4a4a4a`, plus a small `Clear filters` link in ink black.

---

### 2. Slab Detail (planned — not yet mocked)

**Status:** Spec only — no working mock. Build this fresh, matching the inventory's visual language exactly.

**Purpose:** Deep view of a single remnant. Customer arrives here by clicking a card on the inventory grid, or via a direct URL like `/slab/[id]`.

**Layout (recommended):**

- Two-column at desktop, stacked on mobile.
- **Left column (60% width):** Image gallery. Primary photo at the top (16:9 or 4:3 aspect). Below it, a horizontal strip of 3–6 thumbnails. Click a thumbnail to swap the primary. Optional: a `View full size` link that opens a lightbox.
- **Right column (40% width, sticky to top):**
  - Eyebrow: same brand · material in orange.
  - Title: stone name in display weight, ~32px.
  - Status pill below title (Available / On Hold / Sold).
  - Spec table: a tight 2-column key/value list. Rows: `Material`, `Brand`, `Color`, `Size`, `Thickness`, `Finish`, `ID`, `Added`. Use mono for numeric values (sizes, ID, dates).
  - `Request hold` primary button — full-width, ink black, sharp corners, arrow icon, identical to the sign-in CTA.
  - Below the button: small honest copy — italic Instrument Serif `One slab. First come, first served.` in `#4a4a4a`.
  - Below that: a `← Back to inventory` link.
- **Footer** — same as inventory.

**Behavior:**

- If a customer lands on a `Sold` slab, replace the `Request hold` button with a disabled `Sold` state and a link `See similar remnants →` that returns them to the inventory pre-filtered by material + color.
- If `On Hold`, show `Currently on hold` as the button label, disabled, plus `Notify me if it becomes available →` (this can be an `mailto:` link or a real form — your call).

---

### 3. Sign in (`PortalScreen.jsx`)

**File:** `source/PortalScreen.jsx`
**Screenshot:** `screenshots/03-sign-in.png`

**Purpose:** Staff-only access to the management workspace. Reachable from the `Sign in` button in the global header.

**Layout:**

- Two-column grid, vertically centered. `1.1fr` left, `380–440px` right. 64px gap. Max width 1240px, 72px vertical padding, 32px horizontal.
- Faint orange radial wash bleeding in from top-left (`rgba(247,134,57,0.06)`, 120px blur, 480×480).

**Left column** — editorial pitch:

- Eyebrow: orange dot + `MANAGEMENT PORTAL`, 10.5px, 0.24em tracking, in `#8a8a8a`.
- H1: **"Keep the yard"** (ink) **"online."** (italic Instrument Serif, gray `#4a4a4a`). `clamp(2.4rem, 4.4vw, 3.4rem)`, line-height 1.05, weight 500, letter-spacing -0.02em.
- Subhead: `Add remnants, update status, swap photos. Changes go live the moment you save — customers see the same inventory you do.` in `#4a4a4a`, 14.5px, line-height 1.6, max-width 520px.
- Live status pill: green pulsing dot + mono `Inventory live · 47 slabs · updated 2m ago` in `#4a4a4a`, 11.5px.

**Right column** — sign-in card:

- White background, 1px hairline border, **2px corners**, 32px padding, no shadow.
- Eyebrow: `SIGN IN` in `#8a8a8a`, 10px, 0.22em tracking.
- H2: `Welcome back.` Inter Medium, 22px, letter-spacing -0.015em.
- Form fields: `Email`, `Password`. Each has a small uppercase 10px label above (0.20em tracking, `#8a8a8a`), then a 42px-tall input. Inputs are 1px bordered rectangles, 2px corners, 14px padding, focus state = solid `#0f0f0f` border (no glow).
- Below fields, a row split flex: `[checkbox] Stay signed in` (default checked) on the left, `Forgot password?` link with hairline underline on the right.
- Primary button: full-width, 44px tall, ink `#0f0f0f`, white text, 2px corners, label `Enter workspace` + right-arrow icon, 10px gap. Hover: lightens to `#232323`.
- Footer of card: 1px top hairline, 18px above and 24px below. Left: mono `Staff access only` in `#8a8a8a`. Right: `← Back to inventory` link in `#4a4a4a` (hover → ink).

**Behavior:**

- Form submits via your auth provider (NextAuth, Clerk, or custom). On success, redirect to `/manage`.
- `Forgot password?` opens a password-reset flow (out of scope for this handoff — wire to your auth provider's default).
- `← Back to inventory` returns to `/`.
- Show an error state above the email field on auth failure — same hairline rectangle, ink-black left edge accent (no other color), small italic Instrument Serif copy `Couldn't sign you in. Try again?` in `#9f1239`. Avoid bright red — keep it editorial.

---

### 4. Manage (planned — partial mock exists, redesign required)

**Existing file:** `source/ManageScreen.jsx`
**Status:** ⚠️ The existing `ManageScreen.jsx` was built before this redesign and uses the **old** visual language (28px rounded corners, gradient orange buttons, uppercase ALL CAPS, glassmorphism). It is shipped here for reference of *intent and data shape only*. The actual `Manage` page should be rebuilt from scratch in the redesigned visual language — i.e., it should look almost identical to the public Inventory grid.

**Purpose:** Internal sales-rep tool to keep the public inventory accurate. After signing in, staff land here.

**Recommended layout:**

- Same Header as public, but the `Manage` nav link is active and the right-side `Sign in` button is replaced with a small avatar + signed-in user's name + a `Sign out` link.
- Sub-header bar (under the main header): a single hairline row containing
  - left: `Manage inventory` H2 in display, ~22px;
  - right: a primary ink-black `+ Add remnant` button (sharp corners, 44px tall).
- **Same filter panel** as the public inventory.
- **Same grid + card layout** as the public inventory — *except* each card has additional staff-only affordances:
  - A small kebab `⋯` button in the top-right of the image area (mirroring the status pill on the left).
  - Click the kebab to reveal a popover with three actions, each with an icon:
    - `Put on hold` (amber dot icon)
    - `Mark as sold` (rose dot icon)
    - `Make available` (green dot icon — only shown if status is currently `On Hold` or `Sold`)
    - Divider
    - `Edit details…` (opens a side drawer or modal — see below)
    - `Replace photo…` (file picker)
    - `Remove from inventory` (destructive, red text only — no red background)
  - The card's status pill is **clickable** as a shortcut; clicking it opens the same popover anchored to the pill.

**Edit details modal/drawer:**

- Side drawer, slides in from the right, 480px wide, white, hairline left border.
- Header: `Edit #741 — Calacatta Borghini` in display, 20px. Close `×` on the right.
- Form fields, all using the same input style as sign-in: stone name, brand, material, finish, color tags (multi-select chips), width/height/thickness numerics, shape (`Rectangle` / `L-shape` segmented control — when L is selected, two extra numeric fields appear: `Width 2`, `Height 2`), photo gallery management, internal notes (textarea).
- Footer of drawer: `Cancel` ghost button on the left, `Save changes` ink button on the right.

**Behavior on action:**

- Hold/Sold/Available actions update optimistically. Show the same bottom-of-screen toast pattern as the public site: `#741 marked as sold.` with a small `Undo` link inside the toast for 6 seconds.
- All changes broadcast over your real-time channel (Supabase Realtime, Pusher, or a polling approach) so other staff sessions and the public inventory update without reload.
- The `47 slabs · updated 2m ago` indicator in the public site's hero / footer / sign-in screen reads from the real `last_updated_at` of the inventory collection.

**Out of scope for this handoff:** detailed sales-rep account management, audit log, bulk import, photo cropping. Note them as future work.

---

## Footer (used on Inventory and Manage)

**File:** `source/Footer.jsx`

- Full-bleed, 1px top hairline, 32px horizontal padding, content max-width 1680px.
- 3-column grid (2fr / 1fr / 1fr).
- **Column 1 — Brand:**
  - *Less waste. More kitchens.* — Instrument Serif italic, 22px, `#4a4a4a`.
  - **Quick Countertop & Cabinets** — display, 28px, weight 500, ink, max-width 18ch, 10px above.
  - `quickcountertop.com →` — 15px, ink, hairline underline, 14px above.
  - Live status pill, 22px above: green pulsing dot + `47 slabs · updated 2m ago`.
- **Column 2 — Visit:** small uppercase `VISIT` colTitle, then address lines, hours, phone.
- **Column 3 — Inventory:** small uppercase `INVENTORY` colTitle, then `Browse remnants`, `New this week`, `Sold archive`, `About`.
- Bottom strip (under a hairline): copyright on the left, `Staff sign in →` link on the right (hairline underlined).

---

## Interactions & Behavior

| Interaction | Where | Detail |
|---|---|---|
| Filter chip click | FilterPanel | Toggle the chip; rebuild the grid. URL query string should reflect filters (`?material=marble&color=gray`) so filtered views are linkable. |
| Card hover | Inventory grid | Border darkens from `rgba(0,0,0,0.10)` → `rgba(0,0,0,0.18)`. No transform. 120ms. |
| Card click | Inventory grid | Navigate to `/slab/[id]`. |
| `Request hold` | Slab detail / card | POST → optimistic toast. |
| Status pill click | Manage cards | Open the action popover. |
| Sign-in submit | PortalScreen | Auth provider call → redirect to `/manage`. |
| Toast | Anywhere | Bottom-center, ink pill, white text, 13px, 14×20 padding, `box-shadow: 0 18px 45px rgba(15,23,39,0.18)`. Auto-dismiss 4s (sales rep actions: 6s with Undo). |
| Pulsing dot | Hero, footer, sign-in | `qcPulse` keyframe — 1.8s ease-in-out infinite, scale 1 → 0.85, opacity 1 → 0.5. |
| Live update polling | Inventory + Manage | Every 30s OR via realtime channel. The "updated 2m ago" line is a `Intl.RelativeTimeFormat` of the latest update timestamp. |

---

## State Management

**Public inventory:**

- `slabs` — list, fetched from `/api/slabs` (server) or directly from your DB in a Server Component.
- `filters` — controlled client state: `{ materials: string[], colors: string[], stone: string, minWidth: number, minHeight: number, status: "available"|"hold"|"sold"|"" }`.
- Synced to URL search params for shareable links.

**Slab detail:**

- `slab` — single record, fetched on the page route.

**Sign in:**

- Standard auth-provider state (NextAuth session, Clerk user, etc.).

**Manage:**

- Same as inventory, plus mutations: `holdSlab(id)`, `markSold(id)`, `makeAvailable(id)`, `updateSlab(id, patch)`, `addSlab(payload)`, `removeSlab(id)`, `replacePhoto(id, file)`.
- Use Server Actions or tRPC mutations with optimistic updates via React 19's `useOptimistic`.

---

## Design Tokens

The full token set is in `source/colors_and_type.css`. **Important caveat:** that file contains *both* the old palette (cream auth screen, gradient buttons, 28px radii) and the redesigned palette. Use this as the canonical subset for the redesign:

### Colors

```css
/* Surface */
--bg-page:        #fafaf9;
--bg-surface:     #ffffff;

/* Ink */
--ink-1:          #0f0f0f;   /* primary text, buttons */
--ink-2:          #4a4a4a;   /* secondary text */
--ink-3:          #8a8a8a;   /* tertiary, eyebrows, placeholders */

/* Hairlines */
--line-default:   rgba(0, 0, 0, 0.10);
--line-strong:    rgba(0, 0, 0, 0.18);   /* card hover */

/* Brand accent (used sparingly — eyebrow dots, hero wash, logo) */
--brand-orange:   #f78639;
--brand-orange-wash: rgba(247, 134, 57, 0.06);   /* hero / sign-in radial blur */

/* Status */
--status-available-fg: #065f46;
--status-available-bg: #d1fae5;
--status-available-dot: #16a34a;
--status-hold-fg:      #78350f;
--status-hold-bg:      #fef3c7;
--status-hold-dot:     #d97706;
--status-sold-fg:      #9f1239;
--status-sold-bg:      #ffe4e6;
--status-sold-dot:     #e11d48;

/* Editorial accent text color (italic Instrument Serif) */
--accent-italic: #4a4a4a;
```

### Typography

```css
/* Families */
--font-sans:    "Inter", "Helvetica Neue", Arial, sans-serif;
--font-display: "Inter", "Helvetica Neue", Arial, sans-serif;  /* same family, used at higher weights */
--font-italic:  "Instrument Serif", Georgia, serif;            /* italic accent — load from Google Fonts */
--font-mono:    ui-monospace, "SF Mono", Menlo, monospace;     /* numerics, IDs, status timestamps */

/* Weights actually used */
400 — body
500 — display H1/H2, button labels, card titles
600 — almost never; reserve for emphasis
```

Load Inter (400, 500, 600, 700) and Instrument Serif (400 italic) from Google Fonts. The prototype falls back to system stacks if Stolzl Display is missing — in production, use Inter for everything.

### Spacing & Sizing

The prototype is on an implicit 4px scale — most paddings are 16/20/24/32px. Use Tailwind's default scale, no extension needed.

### Border Radius

```
Cards, inputs, buttons:   2px  (this is non-negotiable — the redesign's signature)
Status pills, dot pills:  9999px (fully round)
Avatar, color swatches:   50%
```

### Shadows

**There are essentially no card shadows in this redesign.** The toast and the lightbox are the only elements with a shadow.

```
Toast:    0 18px 45px rgba(15, 23, 39, 0.18)
Lightbox: 0 32px 90px rgba(0, 0, 0, 0.38)
```

### Motion

```
Hover transitions: 120ms ease-out
Toast slide-in:    200ms cubic-bezier(0.16, 1, 0.3, 1)
qcPulse keyframe:  1.8s ease-in-out infinite (status dot)
```

---

## Assets

The prototype uses:

- **Slab thumbnails** — placeholder photos baked into `source/data.js`. Replace with real Cloudinary/S3-hosted slab photography. Recommend `next/image` with `priority` on the first 8 cards (above the fold).
- **Logo** — Inline SVG of the orange "Q" + "QUICK" wordmark + "COUNTERTOP" subscript. See `Header.jsx` for the inline SVG, or recreate from `screenshots/01-inventory-public.png` top-left.
- **Icons** — Lucide stroke style at 1.8 stroke-width: search (magnifying glass), arrow-right, ellipsis (kebab), x (close). All inline SVG in the prototype; switch to `lucide-react` in production.

No proprietary fonts ship with this bundle — use the Google Font links above.

---

## Files

In `source/`:

| File | Role |
|---|---|
| `index.html` | Prototype shell. Loads React, Babel, and all `*.jsx` files via `<script type="text/babel">`. Reference for global font setup and the Inter override block. |
| `app.jsx` | Top-level `<App>` with surface state machine (`public` / `portal` / `manage`) and global toast. |
| `Header.jsx` | Global header with logo + nav + Sign-in button. |
| `HeroSection.jsx` | Inventory hero with editorial headline + remnant count. |
| `FilterPanel.jsx` | Search + dimension + status + material chips + color swatches. |
| `RemnantGrid.jsx` | Grid layout for `RemnantCard`. |
| `RemnantCard.jsx` | The single source of truth for what a slab looks like in a list. |
| `StatusBadge.jsx` | The colored status pill component (Available / On Hold / Sold). |
| `Footer.jsx` | Site footer. |
| `PortalScreen.jsx` | Sign-in screen. |
| `ManageScreen.jsx` | ⚠️ Old design language. Reference for data and intent only. Rebuild fresh. |
| `data.js` | Sample slab data. The canonical schema is here — match it on the server. |
| `colors_and_type.css` | The full token file. ⚠️ Contains both old and redesigned tokens — use the redesigned subset listed in `Design Tokens` above. |

In `screenshots/`:

- `01-inventory-public.png` — full inventory page, hero + filter panel + first row of cards.
- `02-inventory-grid-detail.png` — scrolled view showing more cards.
- `03-sign-in.png` — sign-in screen.

---

## Suggested Next.js route structure

```
app/
├── layout.tsx           # global font loading, header/footer
├── page.tsx             # Inventory (Server Component, fetch slabs)
├── slab/
│   └── [id]/
│       └── page.tsx     # Slab detail
├── sign-in/
│   └── page.tsx         # PortalScreen
├── manage/
│   ├── layout.tsx       # auth guard — redirect to /sign-in if not staff
│   ├── page.tsx         # Manage inventory grid
│   └── [id]/
│       └── edit/
│           └── page.tsx # Optional: dedicated edit route (or use a parallel modal route)
└── api/
    ├── slabs/
    │   └── route.ts     # GET (list), POST (add)
    └── slabs/[id]/
        └── route.ts     # GET, PATCH, DELETE
```

---

## Open questions (worth confirming with the client before you start)

1. **Auth provider** — NextAuth, Clerk, Auth.js, or custom? Affects the sign-in form's submission wiring.
2. **DB & realtime** — does Quick Countertop already have a CMS / Airtable / spreadsheet for slabs, or is this greenfield? If they're using Airtable today, a one-way sync may be the cheapest first step.
3. **Photography** — who shoots the slabs? Resolution and aspect ratio assumptions affect the grid card crop.
4. **Hold workflow** — does a customer's hold request notify staff via email, SMS, or in-app? Confirm the channel.
5. **Sold archive** — should sold slabs stay visible (greyed, "Sold" badge) for some period, or disappear immediately? The footer link `Sold archive` suggests they stay.

Confirm these and remove this section before kickoff.

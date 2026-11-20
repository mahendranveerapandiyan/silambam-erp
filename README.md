# Silambam ERP

A date-effective, lookup-driven ERP for a Silambam training school: students, staff, attendance (manual + QR), fees, exams, events, inventory, finance and a parent/student portal.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL 16 · Tailwind CSS. Works on phones (QR scanning uses the phone camera; needs HTTPS in production).

## Quick start (development)

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL and SESSION_SECRET
npm run db:reset                  # creates schema + base config + demo data (DESTROYS existing data)
npm run dev                       # http://localhost:3000
```

Demo logins: `admin / admin123` · `incharge1 … incharge10 / pass123` · `parent1 / pass123`.

For a real installation run `npm run db:migrate` then `node scripts/seed.mjs` (base configuration only, no demo data) and log in as `admin / admin123` – you are asked to change the password.

## Design principles

| Principle | How it works |
|---|---|
| **Date-effective** | Every structure (locations, legal employers, business units, classes, sections, grades, houses, jobs, positions …), every person and every assignment is stored as dated versions (`*_f` tables, `effective_start_date`/`effective_end_date`, end of time = 4712-12-31). PostgreSQL exclusion constraints forbid overlapping versions. The **As-of date** in the header changes what every screen shows. Edits are **Update** (new version from a date) or **Correct** (fix the current version); history is always visible. |
| **Lookup-driven** | Every list of values – including Yes/No – is a lookup (`Configuration › Lookups`). Access levels: SYSTEM (fixed), EXTENSIBLE (add values), USER (fully editable). Values have start/end dates, display order, tags and parent codes (State depends on Country). |
| **Configurable** | Number generation (auto/manual, Enterprise/LE/BU level, prefix, suffix, year, yearly reset), UI theme (header/menu/body/text colours, font), actions and statuses mapped to system behaviour, fee structures per academic year, exam eligibility rules. |
| **Data security** | Roles: Administrator, Class Incharge, Staff, Accountant, Parent, Student. Class incharges see and act only on students in the classes they are in charge of on that date. |

## Modules

- **Configuration** – enterprise, locations, divisions, legal employers, business units (branches), classes, sections, lookups, number generation, UI theme, users & roles.
- **Academic structure** – academic years (enterprise level), grades/levels (with next grade and minimum months), houses, clubs, communities, subjects, subject types, student actions, statuses, person types.
- **Students** – admission ("hire") with parents and portal login, date-effective assignment (branch, class, section, grade, house, club, community, fee frequency), actions (promotion, transfer, suspension, withdrawal, re-admission), photo, QR ID cards.
- **Workforce structure & Staff** – jobs, grades, departments, positions, employment types/categories, person types, assignment statuses (payroll eligible), payroll statuses, actions; hire / transfer / terminate / rehire; class incharge assignments.
- **Attendance** – class register for incharges/admin, camera QR scan (students: present; staff: check-in / check-out) with typed-number fallback, staff attendance with manual override, monthly report.
- **Fees** – fee structures per academic year (optionally per branch/class/grade, amount per frequency), copy to next year with % change, per-student frequency (monthly, bi-monthly, quarterly, half-yearly, annual), generation of installments, Mark Paid / Partially Paid / Exception (full or partial, with approval for incharges), unpaid balances carried forward, receipts, incharge payment QR shown to parents, full summary (due / paid / pending / exception by branch, fee type, status and student).
- **Exams** – Grade Exams (one per student per academic year, promotes passed students to the target grade as a date-effective action), Assessments (any number), Term Exams; subjects with Theory/Practical/Viva, max & pass marks; eligibility rules (grade, attendance %, fees cleared, months in grade, age); exam fee by grade added to the fee page automatically.
- **Events** – create events, assign students, optional event fee posted to fees, achievements.
- **Inventory** – items (sticks, uniforms, gear) with stock per branch, receipts/adjustments, sales to students posted to their fee page.
- **Finance** – other income and expenses, income vs expenses, monthly collection by branch and mode, branch dashboard.
- **Portal** – parents (multiple children) and students: profile, attendance, fees with payment QR, receipts, exam results, events.

## Project layout

```
db/migrations/      SQL schema (001 core & structures, 002 operations)
scripts/            migrate.mjs, seed.mjs (--demo)
lib/                db, auth, date-effective engine (dt.ts), entity registry (entities.ts),
                    lookups, numbering, scope (data security), fees, exams, people
app/(app)/          staff-facing screens (setup/[entity] is the generic date-tracked editor)
app/portal/         parent / student portal
app/api/            photo, QR, payment QR, logo images
```

Adding a new date-tracked setup object = one `erp_create_dt(...)` line in a migration + one entry in `lib/entities.ts`; list/create/update/correct/history/end-date screens come for free.

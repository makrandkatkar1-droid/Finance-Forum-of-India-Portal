# FFOI Weekly Plan Portal

A real, working portal for Finance Forum of India: faculty track module progress,
post assignments and deadlines, schedule tests, and enter formative assessment
marks — all visible live to the Operations team and students.

This is a genuine full-stack app: Next.js frontend + API, PostgreSQL database,
real password authentication (bcrypt-hashed, never stored in plain text), and a
full audit log of every change. It was built and tested end-to-end against a
real local PostgreSQL database before being handed to you — every button in the
UI is wired to a real database write.

## What's inside

- `app/` — pages and API routes (Next.js App Router)
- `lib/` — database connection, authentication, and permission helpers
- `db/schema.sql` — the full database schema
- `db/seed.ts` — populates the 7 faculty, their courses, modules, and
  assessment components exactly as given in the instructor notes

## Login credentials (seeded)

| Role | Username | Password |
|---|---|---|
| Admin (Operations Head) | `admin` | `admin123` |
| Student (shared, all seats) | `student` | `student123` |
| Ajith Shah | `ajith.shah` | `ajith123` |
| Amreen Luthra | `amreen.luthra` | `amreen123` |
| Fenil Zaveri | `fenil.zaveri` | `fenil123` |
| Meghna Lohia | `meghna.lohia` | `meghna123` |
| Vishal Bhojani | `vishal.bhojani` | `vishal123` |
| Vivek Jagtap | `vivek.jagtap` | `vivek123` |
| Yogesh Bhavnani | `yogesh.bhavnani` | `yogesh123` |

**You no longer need to touch the seed script to change any of these** —
log in as admin and go to the **Credentials** tab in the sidebar. Every
password and username above can be changed there, and it takes effect
immediately (real bcrypt-hashed passwords, real database).

## What's in this version

- **Sidebar dashboard** with Organization dashboard (admin), Monthly
  calendar, Weekly schedule, Credentials (admin), and Audit log (admin)
- **Modules**: not started / in progress / completed, with completion dates
  tracked automatically
- **Weekly plan**: log either a module session or another activity (guest
  lecture, revision, etc.), fully editable and deletable
- **Assignments**: title, description, and submission date
- **Tests**: internal or surprise, with date
- **Attendance**: faculty log each lecture date and mark who attended; this
  automatically fills in the "Attendance" formative mark
- **Marks**: formative components (which differ for Business Statistics and
  Advance Excel — Test 1–4 + Attendance — versus every other course — Micro
  Project, Viva, Attendance & Attitude, Presentation & Viva), external/
  summative marks out of 50, and a grand total out of 100
- **Excel export**: admin-only, downloads formative + summative marks per course
- **Notifications**: a bell icon shows assignments/tests due in the next 7 days
- **Student roster**: give each of the 50 seats a real name from the
  Credentials tab — it replaces "Student 01" etc. everywhere
- **Full audit log** of every change, by whom, and when

## Deploying for real (Supabase + Vercel, both free tier)

You'll need your own free accounts on Supabase and Vercel — I can't create
these for you, but here's exactly what to click.

### 1. Create the database (Supabase)

1. Go to https://supabase.com and sign up (free).
2. Click **New Project**. Pick any name and a strong database password — save that password.
3. Once it's ready, go to **SQL Editor** (left sidebar) → **New query**.
4. Open `db/schema.sql` from this project, paste the whole thing in, and click **Run**.
5. Go to **Project Settings → Database → Connection string → URI**. Copy it —
   this is your `DATABASE_URL`. Replace `[YOUR-PASSWORD]` in that string with
   the database password you saved in step 2.

### 2. Seed the real data

On your own computer (with Node.js installed):

```bash
# unzip this project, then inside the folder:
npm install
echo 'DATABASE_URL="paste-your-supabase-connection-string-here"' > .env.local
echo 'JWT_SECRET="'$(openssl rand -base64 32)'"' >> .env.local
npx tsx db/seed.ts
```

You should see "Seed complete." — your 7 faculty, courses, and modules are now
in the real Supabase database.

### 3. Deploy the app (Vercel)

1. Push this project to a GitHub repository (or use Vercel's CLI: `npx vercel`).
2. Go to https://vercel.com, sign up, click **Add New → Project**, and import
   your repository.
3. Before deploying, add Environment Variables (same two from `.env.local`):
   - `DATABASE_URL` — your Supabase connection string
   - `JWT_SECRET` — the random string you generated
4. Click **Deploy**. In about a minute you'll get a live URL
   (e.g. `ffoi-portal.vercel.app`) that faculty, students, and Operations can
   all log into from any device.

### 4. Give this URL + each person's login to your team

Faculty, students, and you (Operations) can now log in from the live URL —
phone, laptop, anywhere with internet.

## What's simplified for now (flagged honestly)

- **Admin-controlled granular permissions** (deciding per-person, per-course
  access for Operations staff) — the database and logic support it
  (`permissions` table, `canEditCourse` check), but there's no UI yet for you
  to grant/revoke access through clicks. Tell me if you want that built next.
- **Student accounts** are currently one shared login for all 50, as you
  requested. When you're ready to move to individual student logins (so you
  can, for example, track individual attendance), that's a straightforward
  next step.
- **Password reset / change password** isn't built yet — for now, changing a
  password means re-running the seed script with a new password for that person.

## Running it locally to test changes

```bash
npm install
npm run build
npm start
# visit http://localhost:3000
```

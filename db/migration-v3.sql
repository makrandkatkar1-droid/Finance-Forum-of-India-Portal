-- ============================================
-- FFOI PORTAL — MIGRATION v3
-- Adds: batches, individual student logins, faculty pay rate + sessions,
-- fee plans + payments, results publishing, calendar events
-- Safe to run on top of the existing v2 schema.
-- ============================================

-- 1. Batches
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Courses: link to a batch, and whether results are published to students
ALTER TABLE courses ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS results_published BOOLEAN NOT NULL DEFAULT false;

-- 3. Faculty pay rate (on users, only meaningful for role='faculty')
ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_rate NUMERIC(8,2);

-- 4. Student roster: individual login credentials, batch, fee category
ALTER TABLE student_roster ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE;
ALTER TABLE student_roster ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE student_roster ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);
ALTER TABLE student_roster ADD COLUMN IF NOT EXISTS fee_category VARCHAR(20) DEFAULT 'General';

-- 5. Faculty payout sessions (admin logs hours worked per day, independent of attendance)
CREATE TABLE IF NOT EXISTS faculty_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id),
    session_date DATE NOT NULL,
    topic VARCHAR(200),
    hours NUMERIC(5,2) NOT NULL,
    rate NUMERIC(8,2) NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Fee plans: token + 4 installment amounts, per batch, per category
CREATE TABLE IF NOT EXISTS fee_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    category VARCHAR(20) NOT NULL,
    token NUMERIC(10,2) NOT NULL DEFAULT 0,
    inst1 NUMERIC(10,2) NOT NULL DEFAULT 0,
    inst2 NUMERIC(10,2) NOT NULL DEFAULT 0,
    inst3 NUMERIC(10,2) NOT NULL DEFAULT 0,
    inst4 NUMERIC(10,2) NOT NULL DEFAULT 0,
    UNIQUE (batch_id, category)
);

-- 7. Per-student fee payments (actual amount paid, supports partial payments)
CREATE TABLE IF NOT EXISTS student_fee_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_roster_id UUID NOT NULL REFERENCES student_roster(id) ON DELETE CASCADE,
    field VARCHAR(10) NOT NULL CHECK (field IN ('token','inst1','inst2','inst3','inst4')),
    amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (student_roster_id, field)
);

-- 8. Calendar events (guest lectures / batch-wide announcements)
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES batches(id),
    event_date DATE NOT NULL,
    title VARCHAR(200) NOT NULL,
    note VARCHAR(300),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_batch ON courses(batch_id);
CREATE INDEX IF NOT EXISTS idx_student_roster_batch ON student_roster(batch_id);
CREATE INDEX IF NOT EXISTS idx_faculty_sessions_faculty ON faculty_sessions(faculty_id);
CREATE INDEX IF NOT EXISTS idx_fee_plans_batch ON fee_plans(batch_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_payments_roster ON student_fee_payments(student_roster_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_batch ON calendar_events(batch_id);

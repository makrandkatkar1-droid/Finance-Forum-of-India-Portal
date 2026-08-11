-- ============================================
-- FFOI FACULTY PORTAL — DATABASE SCHEMA (PostgreSQL) v2
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'faculty', 'operations', 'student')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    day_allocated VARCHAR(20),
    day_parity VARCHAR(10) CHECK (day_parity IN ('odd', 'even') OR day_parity IS NULL),
    total_hours INT,
    faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    access_level VARCHAR(10) NOT NULL CHECK (access_level IN ('view', 'edit')),
    granted_by UUID NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE TABLE student_roster (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(50) NOT NULL,
    name VARCHAR(150) DEFAULT '',
    seat_number INT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_number INT NOT NULL,
    module_name VARCHAR(200),
    status VARCHAR(15) NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'completed')),
    completed_date DATE,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, module_number)
);

CREATE TABLE weekly_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id),
    week_number INT NOT NULL,
    week_start_date DATE NOT NULL,
    session_type VARCHAR(10) NOT NULL DEFAULT 'module' CHECK (session_type IN ('module', 'activity')),
    activity_name VARCHAR(200),
    topics TEXT NOT NULL,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    weekly_plan_id UUID REFERENCES weekly_plans(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    deadline TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    test_type VARCHAR(10) NOT NULL CHECK (test_type IN ('internal', 'surprise')),
    test_date DATE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    component_name VARCHAR(150) NOT NULL,
    max_marks INT NOT NULL,
    display_order INT NOT NULL,
    UNIQUE (course_id, display_order)
);

CREATE TABLE student_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_roster_id UUID NOT NULL REFERENCES student_roster(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES assessment_components(id) ON DELETE CASCADE,
    marks_obtained NUMERIC(5,2) NOT NULL,
    graded_by UUID NOT NULL REFERENCES users(id),
    graded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (student_roster_id, component_id)
);

CREATE TABLE summative_marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_roster_id UUID NOT NULL REFERENCES student_roster(id) ON DELETE CASCADE,
    marks_obtained NUMERIC(5,2) NOT NULL,
    graded_by UUID NOT NULL REFERENCES users(id),
    graded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, student_roster_id)
);

CREATE TABLE attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_roster_id UUID NOT NULL REFERENCES student_roster(id) ON DELETE CASCADE,
    present BOOLEAN NOT NULL DEFAULT false,
    marked_by UUID REFERENCES users(id),
    marked_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (session_id, student_roster_id)
);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    actor_name VARCHAR(150) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    action VARCHAR(300) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_courses_faculty ON courses(faculty_id);
CREATE INDEX idx_permissions_user ON permissions(user_id);
CREATE INDEX idx_permissions_course ON permissions(course_id);
CREATE INDEX idx_modules_course ON modules(course_id);
CREATE INDEX idx_weekly_plans_course ON weekly_plans(course_id);
CREATE INDEX idx_assignments_course ON assignments(course_id);
CREATE INDEX idx_tests_course ON tests(course_id);
CREATE INDEX idx_assessment_components_course ON assessment_components(course_id);
CREATE INDEX idx_student_scores_roster ON student_scores(student_roster_id);
CREATE INDEX idx_student_scores_component ON student_scores(component_id);
CREATE INDEX idx_summative_course ON summative_marks(course_id);
CREATE INDEX idx_summative_roster ON summative_marks(student_roster_id);
CREATE INDEX idx_attendance_sessions_course ON attendance_sessions(course_id);
CREATE INDEX idx_attendance_records_session ON attendance_records(session_id);
CREATE INDEX idx_attendance_records_roster ON attendance_records(student_roster_id);
CREATE INDEX idx_audit_log_changed ON audit_log(changed_at DESC);
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

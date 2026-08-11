-- ============================================
-- FFOI PORTAL — SEED DATA (run this in Supabase SQL Editor)
-- Safe to re-run: uses ON CONFLICT so it won't duplicate anything.
-- ============================================

-- Admin
INSERT INTO users (name, username, password_hash, role)
VALUES ('Operations Head', 'admin', '$2b$10$JKdCkF/vuoMz1DgJrAdM7er8xT4ALVwOFgxhOuh9dgooHrYThhx2u', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Shared student login
INSERT INTO users (name, username, password_hash, role)
VALUES ('Student', 'student', '$2b$10$kyJIaysbhv.wc1y4IDeaL.4nZqq3lkd6rdMaeTWheND6B2pXr9qm6', 'student')
ON CONFLICT (username) DO NOTHING;

-- 50-seat student roster
INSERT INTO student_roster (label, name, seat_number)
SELECT 'Student ' || LPAD(n::text, 2, '0'), '', n
FROM generate_series(1, 50) AS n
ON CONFLICT (seat_number) DO NOTHING;

-- Faculty logins
INSERT INTO users (name, username, password_hash, role) VALUES
  ('Mr. Ajith Shah', 'ajith.shah', '$2b$10$MBsEDs4RrkJhF9UIAbbdwekAODPRhLJiQ5ZKaOXT6mJJf.ywvY4kq', 'faculty'),
  ('Ms. Amreen Luthra', 'amreen.luthra', '$2b$10$yDCgyCJ.m2vh1IvRR/8HU.9XqNipznBNxBTQ6hQwpmFjczNOVpqbG', 'faculty'),
  ('Mr. Fenil Zaveri', 'fenil.zaveri', '$2b$10$IHN4ZKJYCryVC08M1IMeMe.GFBynrMKOcS5VLeaJC7ObMvxM47qzS', 'faculty'),
  ('Ms. Meghna Lohia', 'meghna.lohia', '$2b$10$tly/JsGwEo2fTTbNfnj3SucuGiW5o.aQ4iyzE9z/B1.TcqDLEk.wK', 'faculty'),
  ('Mr. Vishal Bhojani', 'vishal.bhojani', '$2b$10$U.I6H6dD2X8BzTDZtGh5sOYhFKwpCnptVh0GclNAySOhzqWt7ctZG', 'faculty'),
  ('Mr. Vivek Jagtap', 'vivek.jagtap', '$2b$10$runf9gP8AC9Svg85smloWeygj6c8J/uwgk3lOlJQO6KYHD5BNyJuS', 'faculty'),
  ('Mr. Yogesh Bhavnani', 'yogesh.bhavnani', '$2b$10$hdjctmsrAxjkMXHjKJ3SO.nuxpI0E8XH2Z1FnI8MSR0jbBNiE8RG6', 'faculty')
ON CONFLICT (username) DO NOTHING;

-- Courses (one per faculty)
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Financial Markets & Institutions', 'FMI', 'Saturday', NULL, 30, id FROM users WHERE username = 'ajith.shah'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Business Communication & Literacy', 'BCL', 'Thursday', NULL, 30, id FROM users WHERE username = 'amreen.luthra'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Business Statistics', 'BSTAT', 'Wednesday', NULL, 30, id FROM users WHERE username = 'fenil.zaveri'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Corporate Finance & Company Analysis', 'CFCA', 'Sunday', NULL, 30, id FROM users WHERE username = 'meghna.lohia'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Financial Adaptive Skills', 'FAS', 'Monday', NULL, 30, id FROM users WHERE username = 'vishal.bhojani'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Advance Excel', 'AEXL', 'Tuesday', 'even', 30, id FROM users WHERE username = 'vivek.jagtap'
ON CONFLICT (code) DO NOTHING;
INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id)
SELECT 'Fundamentals of Economics & Indian Economy', 'FEIE', 'Tuesday', 'odd', 45, id FROM users WHERE username = 'yogesh.bhavnani'
ON CONFLICT (code) DO NOTHING;

-- Modules per course
INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
JOIN (VALUES
  (1,'Introduction to Financial Markets'),(2,'Stakeholders & Market Participants'),
  (3,'Evolution of Indian Financial Markets'),(4,'Closed & Discontinued Indian Exchanges'),
  (5,'Indian Financial Exchanges - Active'),(6,'Major Global Exchanges - Overview'),
  (7,'Financial Institutions in India'),(8,'Financial Regulators & Market Infrastructure')
) AS m(n, name) ON true
WHERE c.code = 'FMI'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c, generate_series(1,8) AS n WHERE c.code = 'BCL'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
JOIN (VALUES
  (1,'Introduction to Data & Descriptive Statistics'),(2,'Probability: Concepts & Distributions'),
  (3,'Sampling & Estimation'),(4,'Hypothesis Testing'),(5,'Correlation & Regression Analysis')
) AS m(n, name) ON true
WHERE c.code = 'BSTAT'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c, generate_series(1,8) AS n WHERE c.code = 'CFCA'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
JOIN (VALUES
  (1,'What is a Financial Instrument'),(2,'Equity Instruments & Products'),
  (3,'Fixed Income Instruments & Products'),(4,'Commodities as an Asset Class'),
  (5,'Insurance Products'),(6,'Tax-Saving Schemes & Government Products'),
  (7,'Real Assets, Alternatives & Global Products')
) AS m(n, name) ON true
WHERE c.code = 'FAS'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c, generate_series(1,8) AS n WHERE c.code = 'AEXL'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
JOIN (VALUES
  (1,'Economic Systems'),(2,'Production Cost'),(3,'Market Structure'),(4,'Demand and Supply'),
  (5,'National Income Accounting'),(6,'Monetary Economics'),(7,'Fiscal Policy & Government Budget'),
  (8,'International Trade & Balance of Payments'),(9,'Interest Rates & Inflation'),
  (10,'Macroeconomic Equilibrium & Price Dynamics')
) AS m(n, name) ON true
WHERE c.code = 'FEIE'
ON CONFLICT (course_id, module_number) DO NOTHING;

-- Assessment components (formative marks structure)
-- Standard structure: Micro Project / Viva / Attendance & Attitude / Presentation & Viva
INSERT INTO assessment_components (course_id, component_name, max_marks, display_order)
SELECT c.id, x.name, x.max, x.ord FROM courses c
JOIN (VALUES
  ('Micro Project',10,1),('Viva (Micro Project)',10,2),('Attendance & Attitude',10,3),('Presentation & Viva',20,4)
) AS x(name, max, ord) ON true
WHERE c.code IN ('FMI','BCL','CFCA','FAS','FEIE')
ON CONFLICT (course_id, display_order) DO NOTHING;

-- Test-based structure: Test 1-4 / Attendance (Business Statistics + Advance Excel)
INSERT INTO assessment_components (course_id, component_name, max_marks, display_order)
SELECT c.id, x.name, x.max, x.ord FROM courses c
JOIN (VALUES
  ('Test 1',10,1),('Test 2',10,2),('Test 3',10,3),('Test 4',10,4),('Attendance',10,5)
) AS x(name, max, ord) ON true
WHERE c.code IN ('BSTAT','AEXL')
ON CONFLICT (course_id, display_order) DO NOTHING;

-- Confirmation
SELECT 'Seed complete. Users:' AS status, count(*) FROM users
UNION ALL SELECT 'Courses:', count(*) FROM courses
UNION ALL SELECT 'Modules:', count(*) FROM modules
UNION ALL SELECT 'Student roster:', count(*) FROM student_roster
UNION ALL SELECT 'Assessment components:', count(*) FROM assessment_components;

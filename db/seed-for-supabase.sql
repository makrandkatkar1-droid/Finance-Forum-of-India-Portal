-- ============================================
-- FFOI PORTAL — SEED DATA (paste into Supabase SQL Editor and Run)
-- Passwords are already securely hashed below (bcrypt).
-- Plain-text passwords for your reference, to log in with:
--   admin           / admin123
--   student         / student123
--   ajith.shah      / ajith123
--   amreen.luthra   / amreen123
--   fenil.zaveri    / fenil123
--   meghna.lohia    / meghna123
--   vishal.bhojani  / vishal123
--   vivek.jagtap    / vivek123
--   yogesh.bhavnani / yogesh123
-- ============================================

-- Admin
INSERT INTO users (name, username, password_hash, role)
VALUES ('Operations Head', 'admin', '$2b$10$3E8DmGeKPkOGu4UT5yjZruVw94GbAC/pLttzWsOM0x0gCQDOl1l4K', 'admin')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Shared student login
INSERT INTO users (name, username, password_hash, role)
VALUES ('Student', 'student', '$2b$10$AULASJSvFEw99MnAOw85bO8taoOL7vJe3uO7pcBJP7fDc9fXbkZUK', 'student')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Faculty
INSERT INTO users (name, username, password_hash, role) VALUES
  ('Mr. Ajith Shah', 'ajith.shah', '$2b$10$D3bmDTn/KJ5i.LmZ8m3/zucMVtsO6t0DJMqE43Hz1sTOY2RTiZuM2', 'faculty'),
  ('Ms. Amreen Luthra', 'amreen.luthra', '$2b$10$34XJ1IvCs9V0FedaiyG6N.otudqt2bxh5PNeKxRekbv8qljASn.TW', 'faculty'),
  ('Mr. Fenil Zaveri', 'fenil.zaveri', '$2b$10$EwTuPHFEuvdkKZoSW/yI3e4LR9Tbf74wtzl6BCQqCDSdj.goF3ZHC', 'faculty'),
  ('Ms. Meghna Lohia', 'meghna.lohia', '$2b$10$egF4Kp93M.wpJuEg5/AzJOVE0XM7shp9VxQmPmtep0Ql8dm2sb4HG', 'faculty'),
  ('Mr. Vishal Bhojani', 'vishal.bhojani', '$2b$10$9YFfNLzwyx2OvowTF6oiiOoG7zKKW696KhuiAZ4IILPMTcwPNAGpi', 'faculty'),
  ('Mr. Vivek Jagtap', 'vivek.jagtap', '$2b$10$zG7rns7ZAzLB7HAmBUe3Xelv4uw2UGWtISZdXT80z80qZfzXT/dTm', 'faculty'),
  ('Mr. Yogesh Bhavnani', 'yogesh.bhavnani', '$2b$10$fUaQlOhm7YBd0TsmAVwjuOw8DQ8SQtxo4Z.PEzIibgaB5yx4rm7pK', 'faculty')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 50-seat student roster (names blank, admin fills in from the Credentials tab)
INSERT INTO student_roster (label, name, seat_number)
SELECT 'Student ' || LPAD(n::text, 2, '0'), '', n
FROM generate_series(1, 50) AS n
ON CONFLICT (seat_number) DO NOTHING;

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
CROSS JOIN (VALUES
  (1, 'Introduction to Financial Markets'), (2, 'Stakeholders & Market Participants'),
  (3, 'Evolution of Indian Financial Markets'), (4, 'Closed & Discontinued Indian Exchanges'),
  (5, 'Indian Financial Exchanges - Active'), (6, 'Major Global Exchanges - Overview'),
  (7, 'Financial Institutions in India'), (8, 'Financial Regulators & Market Infrastructure')
) AS m(n, name)
WHERE c.code = 'FMI'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c CROSS JOIN generate_series(1, 8) AS n WHERE c.code = 'BCL'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
CROSS JOIN (VALUES
  (1, 'Introduction to Data & Descriptive Statistics'), (2, 'Probability: Concepts & Distributions'),
  (3, 'Sampling & Estimation'), (4, 'Hypothesis Testing'), (5, 'Correlation & Regression Analysis')
) AS m(n, name)
WHERE c.code = 'BSTAT'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c CROSS JOIN generate_series(1, 8) AS n WHERE c.code = 'CFCA'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
CROSS JOIN (VALUES
  (1, 'What is a Financial Instrument'), (2, 'Equity Instruments & Products'),
  (3, 'Fixed Income Instruments & Products'), (4, 'Commodities as an Asset Class'),
  (5, 'Insurance Products'), (6, 'Tax-Saving Schemes & Government Products'),
  (7, 'Real Assets, Alternatives & Global Products')
) AS m(n, name)
WHERE c.code = 'FAS'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, n, NULL FROM courses c CROSS JOIN generate_series(1, 8) AS n WHERE c.code = 'AEXL'
ON CONFLICT (course_id, module_number) DO NOTHING;

INSERT INTO modules (course_id, module_number, module_name)
SELECT c.id, m.n, m.name FROM courses c
CROSS JOIN (VALUES
  (1, 'Economic Systems'), (2, 'Production Cost'), (3, 'Market Structure'), (4, 'Demand and Supply'),
  (5, 'National Income Accounting'), (6, 'Monetary Economics'), (7, 'Fiscal Policy & Government Budget'),
  (8, 'International Trade & Balance of Payments'), (9, 'Interest Rates & Inflation'),
  (10, 'Macroeconomic Equilibrium & Price Dynamics')
) AS m(n, name)
WHERE c.code = 'FEIE'
ON CONFLICT (course_id, module_number) DO NOTHING;

-- Assessment components: Standard structure (Micro Project / Viva / Attendance & Attitude / Presentation & Viva)
-- for every course EXCEPT Business Statistics and Advance Excel, which use the Test-based structure.
DELETE FROM assessment_components WHERE course_id IN (SELECT id FROM courses WHERE code IN ('FMI','BCL','CFCA','FAS','FEIE'));
INSERT INTO assessment_components (course_id, component_name, max_marks, display_order)
SELECT c.id, x.name, x.max, x.ord FROM courses c
CROSS JOIN (VALUES
  ('Micro Project', 10, 1), ('Viva (Micro Project)', 10, 2),
  ('Attendance & Attitude', 10, 3), ('Presentation & Viva', 20, 4)
) AS x(name, max, ord)
WHERE c.code IN ('FMI','BCL','CFCA','FAS','FEIE');

DELETE FROM assessment_components WHERE course_id IN (SELECT id FROM courses WHERE code IN ('BSTAT','AEXL'));
INSERT INTO assessment_components (course_id, component_name, max_marks, display_order)
SELECT c.id, x.name, x.max, x.ord FROM courses c
CROSS JOIN (VALUES
  ('Test 1', 10, 1), ('Test 2', 10, 2), ('Test 3', 10, 3), ('Test 4', 10, 4), ('Attendance', 10, 5)
) AS x(name, max, ord)
WHERE c.code IN ('BSTAT','AEXL');

-- Audit log entry
INSERT INTO audit_log (user_id, actor_name, table_name, action)
SELECT id, 'System', 'system', 'Database seeded with faculty, courses, modules, and student roster'
FROM users WHERE username = 'admin';

-- Done! Check the "No rows returned" message is fine here too — these are
-- all inserts, and Supabase only echoes rows back for SELECT queries.

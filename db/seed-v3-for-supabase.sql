-- ============================================
-- FFOI PORTAL — MIGRATION v3 SEED DATA
-- Run this AFTER migration-v3.sql, in Supabase's SQL Editor.
-- Sets up: batches, individual student logins, faculty pay rates, fee plans.
--
-- Student login pattern: username = student01..student50
--                         password = pass01 + 1001 (e.g. pass011001), ...pass50 + 1050
-- (Change any of these later from the Credentials tab as admin.)
-- ============================================

-- 1. Batches
INSERT INTO batches (name) VALUES ('FFOI Powered Batch 2026-28') ON CONFLICT DO NOTHING;
INSERT INTO batches (name) VALUES ('IBOP Batch') ON CONFLICT DO NOTHING;

-- 2. Assign existing courses to the first batch
UPDATE courses SET batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE batch_id IS NULL;

-- 3. Default faculty pay rate
UPDATE users SET pay_rate = 800 WHERE role = 'faculty' AND pay_rate IS NULL;

-- 4. Individual student credentials (only sets ones not already set)
UPDATE student_roster SET username = 'student10', password_hash = '$2b$10$pqVZQGHcsAVCzFEvSivP7.QrTP2gsGyE7lun1Cnm04KhLCYjM9qDW', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 10 AND username IS NULL;
UPDATE student_roster SET username = 'student11', password_hash = '$2b$10$FEarnT8uxwEOZy2OlsZPZOg6.A9z0Cl7iGCL5FpgmzAHFkmEYMI4.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 11 AND username IS NULL;
UPDATE student_roster SET username = 'student12', password_hash = '$2b$10$WzWqhvEggDxB3BVJqGOtcu2YKqZdxLdnk0lnPAdZMFrlQAxfIr5w.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 12 AND username IS NULL;
UPDATE student_roster SET username = 'student13', password_hash = '$2b$10$tmII7BpHkJbG/959weM8U.aup3HH7VJA9.iMQoQ9b3PS884xYkEWq', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 13 AND username IS NULL;
UPDATE student_roster SET username = 'student14', password_hash = '$2b$10$XClVsx7M7qQFl.M4cUMypuwBsfaxHBpPWSc3R.3xDwYLDtX.ot7XW', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 14 AND username IS NULL;
UPDATE student_roster SET username = 'student15', password_hash = '$2b$10$ZfhbRGnttu3WwAYNbAi19e6NEo.pv0D5XxOO/yYJCWUsiPBubnMe6', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 15 AND username IS NULL;
UPDATE student_roster SET username = 'student16', password_hash = '$2b$10$xarDGGJokcleIbMc32QImO9JHB.YwpBNQfwbUJz.r5jFTlTmOzD/i', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 16 AND username IS NULL;
UPDATE student_roster SET username = 'student17', password_hash = '$2b$10$LoRsJoqZaIF4lAFm77l7W.vs5UONq9A6Y3A5.akZLBzcHCNOOLZgC', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 17 AND username IS NULL;
UPDATE student_roster SET username = 'student18', password_hash = '$2b$10$VxLMZxDt5OXIBEqOBwS4rOedljp6PQWQR2XLU6NFoviQ1zRue5J5S', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 18 AND username IS NULL;
UPDATE student_roster SET username = 'student19', password_hash = '$2b$10$yTQfXmNVgcDBL9KyTQlUlerS1L3.jgTDtd69WNh8Bl6.VqkEZLbWu', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 19 AND username IS NULL;
UPDATE student_roster SET username = 'student20', password_hash = '$2b$10$1a5VTWnSGqzhvONS7Bekd.ksEy.nXZ/xR8Huy1eNZQMNEu0taqHwC', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 20 AND username IS NULL;
UPDATE student_roster SET username = 'student21', password_hash = '$2b$10$/PuKHNJWZD1P0JtU4MfgJehfAAkknTBDPJITj5a4ugZcdQ4Ag8Jd.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 21 AND username IS NULL;
UPDATE student_roster SET username = 'student22', password_hash = '$2b$10$LebRhvM0zsJo1dBXyYk6/uWb8BvMgPmjaRIC0.dUmIWIZgyMC9hLK', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 22 AND username IS NULL;
UPDATE student_roster SET username = 'student23', password_hash = '$2b$10$mATFDf1yA02pKmQILbDgoONP.TFo.aBee/hQKvMmVlTKJRHntlS9W', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 23 AND username IS NULL;
UPDATE student_roster SET username = 'student24', password_hash = '$2b$10$50jqLBe6mulqtwU4CqV.6.o4a7.fMI4uqT8iB7X7wOWidDkXoBxiy', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 24 AND username IS NULL;
UPDATE student_roster SET username = 'student25', password_hash = '$2b$10$tgMxFic6yrisOZbSfSnPeOw0N4iBvnviy2ps8Y1rpLsFjV5aPy3q6', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 25 AND username IS NULL;
UPDATE student_roster SET username = 'student26', password_hash = '$2b$10$C9rlLlKuv0hCV5DnrI.tmuilszM19Dyz4qOtJC.yvvNBWJ74C6FTS', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 26 AND username IS NULL;
UPDATE student_roster SET username = 'student27', password_hash = '$2b$10$2xAWvEo90LPQaYcagVdXR.l/KcutMOe9CJmKuhISZ6ILS42doyFtO', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 27 AND username IS NULL;
UPDATE student_roster SET username = 'student28', password_hash = '$2b$10$12qgBiqbeCJyDjQ9GN88/O35nfsJyIVmmkyYyprNFpoFvVmxi.oz2', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 28 AND username IS NULL;
UPDATE student_roster SET username = 'student29', password_hash = '$2b$10$kuAfYFp1VlbaOrL0Or9lb.dX6UIu0okepmDAQnCu0Uoz9n/rRsGl6', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 29 AND username IS NULL;
UPDATE student_roster SET username = 'student30', password_hash = '$2b$10$SlGvtmvFg35Faxt4c1xO3uMTt58Zfa83GL41noMFjdi05XpaUotce', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 30 AND username IS NULL;
UPDATE student_roster SET username = 'student31', password_hash = '$2b$10$WUoTcJwnfK1FGEbvsU7sPe5ShpU5lv4vxW083cN2bsxFHh80PFmWa', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 31 AND username IS NULL;
UPDATE student_roster SET username = 'student32', password_hash = '$2b$10$pktzdAAtP7kFXtKAHrDEF.PBCORVLK9ykvEoaciuhSDwYeWbXVJvW', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 32 AND username IS NULL;
UPDATE student_roster SET username = 'student33', password_hash = '$2b$10$WCZGHUFASYzk9tSxSm740eoyj8Mhds7TEE6isadGTrRs57tV61TRO', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 33 AND username IS NULL;
UPDATE student_roster SET username = 'student34', password_hash = '$2b$10$lAY5IsOkKkNYBbySy1F7xOdnjyK9v2J7lMJrpqV08tFANaj3ELmTu', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 34 AND username IS NULL;
UPDATE student_roster SET username = 'student35', password_hash = '$2b$10$zkQIzrAxF2Ndb1PreWxEceQoeonsDMXuUb.6dhLquQzo7OkeIzVtC', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 35 AND username IS NULL;
UPDATE student_roster SET username = 'student36', password_hash = '$2b$10$6vYU04HE2yi748h0EfGw.OE75gEWjWuLyOpbloDK/W6Ju5LcBLgC.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 36 AND username IS NULL;
UPDATE student_roster SET username = 'student37', password_hash = '$2b$10$sBzrvfsySmsHvwPuxoi1beJsbvxFQyHwtVzr/hG1QhxfV287YERuq', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 37 AND username IS NULL;
UPDATE student_roster SET username = 'student38', password_hash = '$2b$10$WVN9EGaMMQhdiE6rVXi1euVGSBmv9rGzZTOxUTYSC6k9a3WluRu5a', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 38 AND username IS NULL;
UPDATE student_roster SET username = 'student39', password_hash = '$2b$10$zVxiB97t75x0igGrEAjnweIlJjRTRm9.hwNYpFwOM8CNQUOBvrReG', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 39 AND username IS NULL;
UPDATE student_roster SET username = 'student40', password_hash = '$2b$10$ee4FpTogUSlATIOu9A/8J.ed6imfCUQaRkI2JqrmIAGJyH8HkTTSe', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 40 AND username IS NULL;
UPDATE student_roster SET username = 'student41', password_hash = '$2b$10$6wJOzPcLiqINolfvhWY/COstdlkNrbhZu3rE8zbQbOSTCqxH60Pm6', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 41 AND username IS NULL;
UPDATE student_roster SET username = 'student42', password_hash = '$2b$10$GM7WC3KnWErmwoWAJ3UXkO4oO.7k5dwjlIFEaJ9NmzbAfOMgFt1oa', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 42 AND username IS NULL;
UPDATE student_roster SET username = 'student43', password_hash = '$2b$10$4VLpL00pH6mz52RF0PNq2.ao9MmXxndEn18DZekf0LwEREDyrDGKK', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 43 AND username IS NULL;
UPDATE student_roster SET username = 'student44', password_hash = '$2b$10$UVj7RBnl1iaO8dobhuFoi.GVz.LYCyHAON.2iVlnzNCFN/oAxp6UK', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 44 AND username IS NULL;
UPDATE student_roster SET username = 'student45', password_hash = '$2b$10$vhpM9WOt7Cz7q7yUzY6Uhe53086UoFTF1IXC.tb3g41myI.TyC4lO', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 45 AND username IS NULL;
UPDATE student_roster SET username = 'student46', password_hash = '$2b$10$fXZ10Z/ZhI0sEb5TUx/mPeEnepUDm/lMcdN60db5f0BrH2TLZXFJ.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 46 AND username IS NULL;
UPDATE student_roster SET username = 'student47', password_hash = '$2b$10$qIPr7w/zxi1pIkw/Z1qoyuKtcLxNnL7y3WK0QMSo0h3ZroghVNNuq', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 47 AND username IS NULL;
UPDATE student_roster SET username = 'student48', password_hash = '$2b$10$Z1YXfMBbKNKIjMkGUAYjzeuRJAu62GF6ByIKjdmXGQ2pE90o45t92', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 48 AND username IS NULL;
UPDATE student_roster SET username = 'student49', password_hash = '$2b$10$af48dR40XJjajEZcoXChjOqm1Wl1lhDUYiLDSmlnKItf0aoz7Dl4G', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 49 AND username IS NULL;
UPDATE student_roster SET username = 'student50', password_hash = '$2b$10$vmkWWdJ3QhdqjwXOcx.Hbe7fCej3g5vJN54Iu8ELbCbrjfPpifvXO', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 50 AND username IS NULL;
UPDATE student_roster SET username = 'student01', password_hash = '$2b$10$/Lg9FVM7i97ikvwFSiXqtOQcqzFrlkfjAjkBwofKDLSHYrtayWVmW', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 1 AND username IS NULL;
UPDATE student_roster SET username = 'student02', password_hash = '$2b$10$zDaonSHAQsDIyqZOw7SJQuZyansOKFJWFFrw2Fjaa/9h.LrFMfwUC', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 2 AND username IS NULL;
UPDATE student_roster SET username = 'student03', password_hash = '$2b$10$vAAomor4V6UeYjHbN730w.NWbQWvURCY4A243mgcdo9XrLMSNL5bi', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 3 AND username IS NULL;
UPDATE student_roster SET username = 'student04', password_hash = '$2b$10$Ym3B8pZ6wV9wz3.aujysbuZP/BL88cbJDSDPerUA.2Fes6gxg7Xbu', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 4 AND username IS NULL;
UPDATE student_roster SET username = 'student05', password_hash = '$2b$10$MxG5WzWImWWTsRW1wpLNHOYwfJbteDJul4/Idpbog8387.zbBEgZq', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 5 AND username IS NULL;
UPDATE student_roster SET username = 'student06', password_hash = '$2b$10$EXL8ounWKBtjUUawnbVz/OsQPZAw6jlhSaCWQPP6qiUD.AUQsVfX.', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 6 AND username IS NULL;
UPDATE student_roster SET username = 'student07', password_hash = '$2b$10$K.jGWZHDKX7yBOB1cE6YJeXYuWnIUdL.lpkGGV3UvWIxtdYV/5.Ve', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 7 AND username IS NULL;
UPDATE student_roster SET username = 'student08', password_hash = '$2b$10$osxoKU0HLPTRUWFBcAXTKuB7B0WYUMdmu.VMQcRILJXjLSzadIpza', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 8 AND username IS NULL;
UPDATE student_roster SET username = 'student09', password_hash = '$2b$10$8smN6ngvX/1pwKXZmiMz1.zeoQhEFL2t0/jAtr8BcV5NQYAMrIv8K', batch_id = (SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28') WHERE seat_number = 9 AND username IS NULL;

-- 5. Fee plans for both batches (fully editable later from Student Fees)
INSERT INTO fee_plans (batch_id, category, token, inst1, inst2, inst3, inst4)
SELECT id, 'General', 15000, 82500, 97500, 97500, 107500 FROM batches WHERE name = 'FFOI Powered Batch 2026-28'
ON CONFLICT (batch_id, category) DO NOTHING;
INSERT INTO fee_plans (batch_id, category, token, inst1, inst2, inst3, inst4)
SELECT id, 'Reserved', 15000, 47500, 62500, 62500, 70000 FROM batches WHERE name = 'FFOI Powered Batch 2026-28'
ON CONFLICT (batch_id, category) DO NOTHING;
INSERT INTO fee_plans (batch_id, category, token, inst1, inst2, inst3, inst4)
SELECT id, 'General', 15000, 50000, 50000, 50000, 50000 FROM batches WHERE name = 'IBOP Batch'
ON CONFLICT (batch_id, category) DO NOTHING;
INSERT INTO fee_plans (batch_id, category, token, inst1, inst2, inst3, inst4)
SELECT id, 'Reserved', 15000, 30000, 30000, 30000, 30000 FROM batches WHERE name = 'IBOP Batch'
ON CONFLICT (batch_id, category) DO NOTHING;

-- 6. Audit trail entry
INSERT INTO audit_log (actor_name, table_name, action)
VALUES ('System', 'system', 'Migration v3 seed: batches, individual student logins, faculty pay rates, fee plans');

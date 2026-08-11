import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STANDARD_COMPONENTS = [
  ["Micro Project", 10],
  ["Viva (Micro Project)", 10],
  ["Attendance & Attitude", 10],
  ["Presentation & Viva", 20],
];
const TEST_BASED_COMPONENTS = [
  ["Test 1", 10],
  ["Test 2", 10],
  ["Test 3", 10],
  ["Test 4", 10],
  ["Attendance", 10],
];

const FACULTY = [
  { username: "ajith.shah", password: "ajith123", name: "Mr. Ajith Shah",
    subject: "Financial Markets & Institutions", code: "FMI", day: "Saturday", dayParity: null, hours: 30,
    modules: ["Introduction to Financial Markets", "Stakeholders & Market Participants", "Evolution of Indian Financial Markets",
      "Closed & Discontinued Indian Exchanges", "Indian Financial Exchanges - Active", "Major Global Exchanges - Overview",
      "Financial Institutions in India", "Financial Regulators & Market Infrastructure"],
    components: STANDARD_COMPONENTS },
  { username: "amreen.luthra", password: "amreen123", name: "Ms. Amreen Luthra",
    subject: "Business Communication & Literacy", code: "BCL", day: "Thursday", dayParity: null, hours: 30,
    modules: Array(8).fill(""),
    components: STANDARD_COMPONENTS },
  { username: "fenil.zaveri", password: "fenil123", name: "Mr. Fenil Zaveri",
    subject: "Business Statistics", code: "BSTAT", day: "Wednesday", dayParity: null, hours: 30,
    modules: ["Introduction to Data & Descriptive Statistics", "Probability: Concepts & Distributions", "Sampling & Estimation",
      "Hypothesis Testing", "Correlation & Regression Analysis"],
    components: TEST_BASED_COMPONENTS },
  { username: "meghna.lohia", password: "meghna123", name: "Ms. Meghna Lohia",
    subject: "Corporate Finance & Company Analysis", code: "CFCA", day: "Sunday", dayParity: null, hours: 30,
    modules: Array(8).fill(""),
    components: STANDARD_COMPONENTS },
  { username: "vishal.bhojani", password: "vishal123", name: "Mr. Vishal Bhojani",
    subject: "Financial Adaptive Skills", code: "FAS", day: "Monday", dayParity: null, hours: 30,
    modules: ["What is a Financial Instrument", "Equity Instruments & Products", "Fixed Income Instruments & Products",
      "Commodities as an Asset Class", "Insurance Products", "Tax-Saving Schemes & Government Products",
      "Real Assets, Alternatives & Global Products"],
    components: STANDARD_COMPONENTS },
  { username: "vivek.jagtap", password: "vivek123", name: "Mr. Vivek Jagtap",
    subject: "Advance Excel", code: "AEXL", day: "Tuesday", dayParity: "even", hours: 30,
    modules: Array(8).fill(""),
    components: TEST_BASED_COMPONENTS },
  { username: "yogesh.bhavnani", password: "yogesh123", name: "Mr. Yogesh Bhavnani",
    subject: "Fundamentals of Economics & Indian Economy", code: "FEIE", day: "Tuesday", dayParity: "odd", hours: 45,
    modules: ["Economic Systems", "Production Cost", "Market Structure", "Demand and Supply", "National Income Accounting",
      "Monetary Economics", "Fiscal Policy & Government Budget", "International Trade & Balance of Payments",
      "Interest Rates & Inflation", "Macroeconomic Equilibrium & Price Dynamics"],
    components: STANDARD_COMPONENTS },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const adminHash = await bcrypt.hash("admin123", 10);
    const adminRes = await client.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ($1,$2,$3,'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      ["Operations Head", "admin", adminHash]
    );
    const adminId = adminRes.rows[0].id;

    const studentHash = await bcrypt.hash("student123", 10);
    await client.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ($1,$2,$3,'student')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ["Student", "student", studentHash]
    );

    // 50-seat student roster (editable names, admin-managed)
    for (let i = 1; i <= 50; i++) {
      await client.query(
        `INSERT INTO student_roster (label, name, seat_number) VALUES ($1, '', $2)
         ON CONFLICT (seat_number) DO NOTHING`,
        [`Student ${String(i).padStart(2, "0")}`, i]
      );
    }

    for (const f of FACULTY) {
      const hash = await bcrypt.hash(f.password, 10);
      const userRes = await client.query(
        `INSERT INTO users (name, username, password_hash, role) VALUES ($1,$2,$3,'faculty')
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [f.name, f.username, hash]
      );
      const facultyId = userRes.rows[0].id;

      const courseRes = await client.query(
        `INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, day_parity = EXCLUDED.day_parity RETURNING id`,
        [f.subject, f.code, f.day, f.dayParity, f.hours, facultyId]
      );
      const courseId = courseRes.rows[0].id;

      for (let i = 0; i < f.modules.length; i++) {
        await client.query(
          `INSERT INTO modules (course_id, module_number, module_name) VALUES ($1,$2,$3)
           ON CONFLICT (course_id, module_number) DO NOTHING`,
          [courseId, i + 1, f.modules[i] || null]
        );
      }

      // Clear and re-insert components so structure changes (like this one) apply cleanly
      await client.query(`DELETE FROM assessment_components WHERE course_id = $1`, [courseId]);
      for (let i = 0; i < f.components.length; i++) {
        const [name, max] = f.components[i];
        await client.query(
          `INSERT INTO assessment_components (course_id, component_name, max_marks, display_order) VALUES ($1,$2,$3,$4)`,
          [courseId, name, max, i + 1]
        );
      }

      console.log(`Seeded course: ${f.subject} (${f.username})`);
    }

    await client.query(
      `INSERT INTO audit_log (user_id, actor_name, table_name, action) VALUES ($1,$2,'system','Database seeded with faculty, courses, modules, and student roster')`,
      [adminId, "System"]
    );

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

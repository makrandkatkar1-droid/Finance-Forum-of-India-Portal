import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Batches
    const b1 = await client.query(
      `INSERT INTO batches (name) VALUES ('FFOI Powered Batch 2026-28')
       ON CONFLICT DO NOTHING RETURNING id`
    );
    let batch1Id = b1.rows[0]?.id;
    if (!batch1Id) {
      const existing = await client.query(`SELECT id FROM batches WHERE name = 'FFOI Powered Batch 2026-28'`);
      batch1Id = existing.rows[0].id;
    }
    const b2 = await client.query(
      `INSERT INTO batches (name) VALUES ('IBOP Batch')
       ON CONFLICT DO NOTHING RETURNING id`
    );
    let batch2Id = b2.rows[0]?.id;
    if (!batch2Id) {
      const existing = await client.query(`SELECT id FROM batches WHERE name = 'IBOP Batch'`);
      batch2Id = existing.rows[0].id;
    }
    console.log("Batches ready:", batch1Id, batch2Id);

    // 2. Assign all existing courses to batch 1
    await client.query(`UPDATE courses SET batch_id = $1 WHERE batch_id IS NULL`, [batch1Id]);

    // 3. Faculty pay rate default (₹800/hr), only where not already set
    await client.query(`UPDATE users SET pay_rate = 800 WHERE role = 'faculty' AND pay_rate IS NULL`);

    // 4. Individual student credentials + assign to batch 1
    for (let i = 1; i <= 50; i++) {
      const n = String(i).padStart(2, "0");
      const username = `student${n}`;
      const password = `pass${n}${1000 + i}`;
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `UPDATE student_roster SET username = $1, password_hash = $2, batch_id = $3
         WHERE seat_number = $4 AND username IS NULL`,
        [username, hash, batch1Id, i]
      );
    }
    console.log("Student credentials set (see README for the list).");

    // 5. Fee plans for both batches (editable later from the Student Fees tab)
    const feePlanRows = [
      [batch1Id, "General", 15000, 82500, 97500, 97500, 107500],
      [batch1Id, "Reserved", 15000, 47500, 62500, 62500, 70000],
      [batch2Id, "General", 15000, 50000, 50000, 50000, 50000],
      [batch2Id, "Reserved", 15000, 30000, 30000, 30000, 30000],
    ];
    for (const [batchId, category, token, inst1, inst2, inst3, inst4] of feePlanRows) {
      await client.query(
        `INSERT INTO fee_plans (batch_id, category, token, inst1, inst2, inst3, inst4)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (batch_id, category) DO NOTHING`,
        [batchId, category, token, inst1, inst2, inst3, inst4]
      );
    }
    console.log("Fee plans seeded.");

    await client.query(
      `INSERT INTO audit_log (actor_name, table_name, action) VALUES ('System', 'system', 'Migration v3 seed: batches, individual student logins, faculty pay rates, fee plans')`
    );

    await client.query("COMMIT");
    console.log("Seed v3 complete.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

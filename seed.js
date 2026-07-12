import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Error: DATABASE_URL is not set in environment or .env file');
  process.exit(1);
}

// Helper to escape values for generating seed.sql
function escapeVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${val.toString().replace(/'/g, "''")}'`;
}

async function main() {
  console.log('Reading JSON state and weekly reports files...');
  const statePath = path.resolve('data/state.json');
  const reportsPath = path.resolve('data/weekly_reports.json');
  const schemaPath = path.resolve('schema.sql');

  if (!fs.existsSync(statePath) || !fs.existsSync(reportsPath)) {
    console.error('Error: state.json or weekly_reports.json not found in data/ directory.');
    process.exit(1);
  }

  const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const REPORTS = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
  const DDL = fs.readFileSync(schemaPath, 'utf8');

  console.log('Connecting to PostgreSQL...');
  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log('Connected successfully!');

  // Array to collect SQL statements for outputting seed.sql
  const sqlStatements = [];
  sqlStatements.push('-- PAI CRM Database Backup / Seed Export');
  sqlStatements.push('-- Generated on: ' + new Date().toISOString());
  sqlStatements.push('');
  sqlStatements.push(DDL);
  sqlStatements.push('');

  try {
    console.log('Running DDL to create tables...');
    await client.query('BEGIN');
    await client.query(DDL);

    console.log('Seeding ranks...');
    const ranks = S.ranks || [];
    for (let i = 0; i < ranks.length; i++) {
      const rank = ranks[i];
      const q = 'INSERT INTO ranks (name, order_index) VALUES ($1, $2)';
      await client.query(q, [rank, i]);
      sqlStatements.push(`INSERT INTO ranks (name, order_index) VALUES (${escapeVal(rank)}, ${i});`);
    }

    console.log('Seeding members...');
    const members = S.members || [];
    for (const m of members) {
      const q = 'INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
      const name = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '';
      await client.query(q, [
        m.id,
        m.firstName || '',
        m.lastName || '',
        name,
        m.gameId || '',
        m.rank || null,
        m.ooc || '-',
        m.phone || '',
        m.bank || ''
      ]);
      sqlStatements.push(`INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES (${escapeVal(m.id)}, ${escapeVal(m.firstName || '')}, ${escapeVal(m.lastName || '')}, ${escapeVal(name)}, ${escapeVal(m.gameId || '')}, ${escapeVal(m.rank || null)}, ${escapeVal(m.ooc || '-')}, ${escapeVal(m.phone || '')}, ${escapeVal(m.bank || '')});`);
    }

    console.log('Seeding activities...');
    const activities = S.activities || [];
    for (const a of activities) {
      const q = 'INSERT INTO activities (id, code, name, points, high_staff, note) VALUES ($1, $2, $3, $4, $5, $6)';
      await client.query(q, [
        a.id,
        a.code || '',
        a.name || '',
        parseInt(a.points) || 0,
        !!a.highStaff,
        a.note || ''
      ]);
      sqlStatements.push(`INSERT INTO activities (id, code, name, points, high_staff, note) VALUES (${escapeVal(a.id)}, ${escapeVal(a.code || '')}, ${escapeVal(a.name || '')}, ${parseInt(a.points) || 0}, ${!!a.highStaff}, ${escapeVal(a.note || '')});`);
    }

    console.log('Seeding weekly scores...');
    const weeklyScores = S.weeklyScores || {};
    for (const [memberId, scores] of Object.entries(weeklyScores)) {
      // Check if member exists to avoid integrity violation
      const exists = members.some(m => m.id === memberId);
      if (!exists) continue;

      for (const [activityId, count] of Object.entries(scores || {})) {
        const actExists = activities.some(a => a.id === activityId);
        if (!actExists) continue;

        const valCount = parseInt(count) || 0;
        const q = 'INSERT INTO weekly_scores (member_id, activity_id, count) VALUES ($1, $2, $3)';
        await client.query(q, [memberId, activityId, valCount]);
        sqlStatements.push(`INSERT INTO weekly_scores (member_id, activity_id, count) VALUES (${escapeVal(memberId)}, ${escapeVal(activityId)}, ${valCount});`);
      }
    }

    console.log('Seeding reprimands...');
    const reprimands = S.reprimands || {};
    for (const [memberId, reps] of Object.entries(reprimands)) {
      const exists = members.some(m => m.id === memberId);
      if (!exists) continue;

      const v = Math.min(2, Math.max(0, parseInt(reps.verbal) || 0));
      const s = Math.min(2, Math.max(0, parseInt(reps.strict) || 0));
      const q = 'INSERT INTO reprimands (member_id, verbal, strict) VALUES ($1, $2, $3)';
      await client.query(q, [memberId, v, s]);
      sqlStatements.push(`INSERT INTO reprimands (member_id, verbal, strict) VALUES (${escapeVal(memberId)}, ${v}, ${s});`);
    }

    console.log('Seeding questions...');
    const questions = S.questions || [];
    for (const qObj of questions) {
      const q = 'INSERT INTO questions (id, q, a) VALUES ($1, $2, $3)';
      await client.query(q, [qObj.id, qObj.q || '', qObj.a || '']);
      sqlStatements.push(`INSERT INTO questions (id, q, a) VALUES (${escapeVal(qObj.id)}, ${escapeVal(qObj.q || '')}, ${escapeVal(qObj.a || '')});`);
    }

    console.log('Seeding meetings...');
    const meetings = S.meetings || [];
    for (const mtg of meetings) {
      const q = 'INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
      await client.query(q, [
        mtg.id,
        mtg.title || 'Собрание',
        mtg.date || '',
        mtg.time || '',
        mtg.type || 'weekly',
        mtg.note || '',
        !!mtg.reprimandsIssued,
        mtg.createdAt || mtg.date || ''
      ]);
      sqlStatements.push(`INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES (${escapeVal(mtg.id)}, ${escapeVal(mtg.title || 'Собрание')}, ${escapeVal(mtg.date || '')}, ${escapeVal(mtg.time || '')}, ${escapeVal(mtg.type || 'weekly')}, ${escapeVal(mtg.note || '')}, ${!!mtg.reprimandsIssued}, ${escapeVal(mtg.createdAt || mtg.date || '')});`);

      // Attendance
      const att = mtg.attendance || {};
      for (const [memberId, statusObj] of Object.entries(att)) {
        const memExists = members.some(m => m.id === memberId);
        if (!memExists) continue;

        const status = statusObj.status || 'none';
        const note = statusObj.note || '';
        const attQ = 'INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES ($1, $2, $3, $4)';
        await client.query(attQ, [mtg.id, memberId, status, note]);
        sqlStatements.push(`INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES (${escapeVal(mtg.id)}, ${escapeVal(memberId)}, ${escapeVal(status)}, ${escapeVal(note)});`);
      }
    }

    console.log('Seeding weekly history...');
    const weeklyHistory = S.weeklyHistory || [];
    for (const hist of weeklyHistory) {
      const q = 'INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES ($1, $2, $3, $4, $5, $6)';
      await client.query(q, [
        hist.id,
        hist.date || '',
        hist.archivedAt || '',
        hist.dateFrom || '',
        hist.dateTo || '',
        parseInt(hist.weekNum) || 0
      ]);
      sqlStatements.push(`INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES (${escapeVal(hist.id)}, ${escapeVal(hist.date || '')}, ${escapeVal(hist.archivedAt || '')}, ${escapeVal(hist.dateFrom || '')}, ${escapeVal(hist.dateTo || '')}, ${parseInt(hist.weekNum) || 0});`);

      // History scores
      const scores = hist.scores || {};
      for (const [memberId, actScores] of Object.entries(scores)) {
        for (const [activityId, count] of Object.entries(actScores || {})) {
          const valCount = parseInt(count) || 0;
          const histQ = 'INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES ($1, $2, $3, $4)';
          await client.query(histQ, [hist.id, memberId, activityId, valCount]);
          sqlStatements.push(`INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES (${escapeVal(hist.id)}, ${escapeVal(memberId)}, ${escapeVal(activityId)}, ${valCount});`);
        }
      }
    }

    console.log('Seeding monthly logs...');
    const monthlyLog = S.monthlyLog || [];
    for (const log of monthlyLog) {
      const q = 'INSERT INTO monthly_log (id, type, date, data) VALUES ($1, $2, $3, $4)';
      await client.query(q, [log.id, log.type, log.date || '', log.data || {}]);
      sqlStatements.push(`INSERT INTO monthly_log (id, type, date, data) VALUES (${escapeVal(log.id)}, ${escapeVal(log.type)}, ${escapeVal(log.date || '')}, ${escapeVal(log.data || {})});`);
    }

    console.log('Seeding settings (singular meeting, etc.)...');
    const meetingSingular = S.meeting || { date: '', attendance: {} };
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['meeting', meetingSingular]);
    sqlStatements.push(`INSERT INTO settings (key, value) VALUES ('meeting', ${escapeVal(meetingSingular)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);

    // Call Candidates and Scores
    console.log('Seeding active call info...');
    const callObj = S.call || { date: '', candidates: [], scores: {} };
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['call_date', { date: callObj.date || '' }]);
    sqlStatements.push(`INSERT INTO settings (key, value) VALUES ('call_date', ${escapeVal({ date: callObj.date || '' })}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);

    const candidates = callObj.candidates || [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.id) c.id = 'c' + i + Date.now();
      const q = 'INSERT INTO call_candidates (id, name, game_id, order_index) VALUES ($1, $2, $3, $4)';
      await client.query(q, [c.id, c.name || '', c.gameId || '', i]);
      sqlStatements.push(`INSERT INTO call_candidates (id, name, game_id, order_index) VALUES (${escapeVal(c.id)}, ${escapeVal(c.name || '')}, ${escapeVal(c.gameId || '')}, ${i});`);
    }

    const callScores = callObj.scores || {};
    for (const [qi, ciScores] of Object.entries(callScores)) {
      const qExists = questions.some(qObj => qObj.id === qi);
      if (!qExists) continue;

      for (const [ci, val] of Object.entries(ciScores || {})) {
        const candExists = candidates.some(c => c.id === ci);
        if (!candExists) continue;

        const valScore = parseFloat(val) || 0;
        const q = 'INSERT INTO call_scores (candidate_id, question_id, score) VALUES ($1, $2, $3)';
        await client.query(q, [ci, qi, valScore]);
        sqlStatements.push(`INSERT INTO call_scores (candidate_id, question_id, score) VALUES (${escapeVal(ci)}, ${escapeVal(qi)}, ${valScore});`);
      }
    }

    // Weekly reports from reports file
    console.log('Seeding submitted reports...');
    for (const rep of REPORTS) {
      const q = 'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)';
      await client.query(q, [
        rep.id,
        rep.weekKey || '',
        rep.weekLabel || '',
        rep.submittedAt || '',
        rep.name || '',
        rep.firstName || '',
        rep.lastName || '',
        rep.gameId || '',
        rep.status || 'pending',
        parseInt(rep.totalPts) || 0,
        rep.modNote || '',
        rep.reviewedAt || null
      ]);
      sqlStatements.push(`INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES (${escapeVal(rep.id)}, ${escapeVal(rep.weekKey || '')}, ${escapeVal(rep.weekLabel || '')}, ${escapeVal(rep.submittedAt || '')}, ${escapeVal(rep.name || '')}, ${escapeVal(rep.firstName || '')}, ${escapeVal(rep.lastName || '')}, ${escapeVal(rep.gameId || '')}, ${escapeVal(rep.status || 'pending')}, ${parseInt(rep.totalPts) || 0}, ${escapeVal(rep.modNote || '')}, ${escapeVal(rep.reviewedAt || null)});`);

      const aspects = rep.aspects || [];
      for (const a of aspects) {
        const aspectQ = 'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id';
        const res = await client.query(aspectQ, [
          rep.id,
          a.actId || '',
          a.code || '',
          a.name || '',
          parseInt(a.points) || 0,
          parseInt(a.count) || 0,
          parseInt(a.totalPts) || 0
        ]);
        const aspectInsertedId = res.rows[0].id;
        sqlStatements.push(`-- Aspect row will be inserted (auto-increment id). Note: report_aspects has foreign key constraint.`);

        // In SQL insert we need to get the serial or insert a placeholder comment
        // Let's generate a precise SELECT for getting the parent report aspect row if needed, or simply output SQL with the exact aspect insertions.
        // To build a self-contained SQL file, we can do it directly:
        // We can define variables or use nested inserts, or just a simple WITH query:
        const aspectValStr = `WITH inserted_aspect AS (
  INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) 
  VALUES (${escapeVal(rep.id)}, ${escapeVal(a.actId || '')}, ${escapeVal(a.code || '')}, ${escapeVal(a.name || '')}, ${parseInt(a.points) || 0}, ${parseInt(a.count) || 0}, ${parseInt(a.totalPts) || 0}) 
  RETURNING id
)`;

        const links = a.links || [];
        for (const lnk of links) {
          const linkQ = 'INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1, $2)';
          await client.query(linkQ, [aspectInsertedId, lnk]);
          
          sqlStatements.push(`${aspectValStr}
INSERT INTO report_aspect_links (aspect_id, link) 
SELECT id, ${escapeVal(lnk)} FROM inserted_aspect;`);
        }
        if (links.length === 0) {
          sqlStatements.push(`INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES (${escapeVal(rep.id)}, ${escapeVal(a.actId || '')}, ${escapeVal(a.code || '')}, ${escapeVal(a.name || '')}, ${parseInt(a.points) || 0}, ${parseInt(a.count) || 0}, ${parseInt(a.totalPts) || 0});`);
        }
      }
    }

    await client.query('COMMIT');
    console.log('Seeding transaction committed successfully!');

    console.log('Writing seed.sql script to disk...');
    fs.writeFileSync('seed.sql', sqlStatements.join('\n'), 'utf8');
    console.log('seed.sql created successfully!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction rollback occurred due to error:', err);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

main();

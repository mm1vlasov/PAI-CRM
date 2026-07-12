/**
 * PAI CRM — Database seed script (data only, schema already exists)
 * Reads from data/state.json and data/weekly_reports.json
 * Drops existing data and re-inserts everything fresh.
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Error: DATABASE_URL is not set');
  process.exit(1);
}

function escapeVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${val.toString().replace(/'/g, "''")}'`;
}

async function main() {
  const statePath = path.resolve('data/state.json');
  const reportsPath = path.resolve('data/weekly_reports.json');

  if (!fs.existsSync(statePath)) {
    console.error('Error: data/state.json not found');
    process.exit(1);
  }

  const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const REPORTS = fs.existsSync(reportsPath) ? JSON.parse(fs.readFileSync(reportsPath, 'utf8')) : [];

  console.log('Connecting to PostgreSQL...');
  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log('Connected!');

  const sql = [];
  sql.push('-- PAI CRM Seed Data (data-only, schema must already exist)');
  sql.push('-- Generated: ' + new Date().toISOString());
  sql.push('');

  try {
    await client.query('BEGIN');

    // ── Clear in reverse FK order ────────────────────────────────────
    console.log('Clearing existing data...');
    for (const t of [
      'report_aspect_links','report_aspects','reports',
      'call_scores','call_candidates','settings',
      'monthly_log','weekly_history_scores','weekly_history',
      'meeting_attendance','meetings','reprimands','weekly_scores',
      'activities','members','ranks','questions'
    ]) {
      await client.query(`DELETE FROM ${t}`);
      sql.push(`DELETE FROM ${t};`);
    }
    sql.push('');

    // ── Ranks ────────────────────────────────────────────────────────
    console.log('Seeding ranks...');
    const ranks = S.ranks || [];
    for (let i = 0; i < ranks.length; i++) {
      await client.query('INSERT INTO ranks (name, order_index) VALUES ($1, $2)', [ranks[i], i]);
      sql.push(`INSERT INTO ranks (name, order_index) VALUES (${escapeVal(ranks[i])}, ${i});`);
    }

    // ── Members ──────────────────────────────────────────────────────
    console.log('Seeding members...');
    const members = S.members || [];
    for (const m of members) {
      const name = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '';
      await client.query(
        'INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [m.id, m.firstName||'', m.lastName||'', name, m.gameId||'', m.rank||null, m.ooc||'-', m.phone||'', m.bank||'']
      );
      sql.push(`INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES (${escapeVal(m.id)},${escapeVal(m.firstName||'')},${escapeVal(m.lastName||'')},${escapeVal(name)},${escapeVal(m.gameId||'')},${escapeVal(m.rank||null)},${escapeVal(m.ooc||'-')},${escapeVal(m.phone||'')},${escapeVal(m.bank||'')});`);
    }

    // ── Activities ───────────────────────────────────────────────────
    console.log('Seeding activities...');
    const activities = S.activities || [];
    for (const a of activities) {
      await client.query(
        'INSERT INTO activities (id, code, name, points, high_staff, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [a.id, a.code||'', a.name||'', parseInt(a.points)||0, !!a.highStaff, a.note||'']
      );
      sql.push(`INSERT INTO activities (id, code, name, points, high_staff, note) VALUES (${escapeVal(a.id)},${escapeVal(a.code||'')},${escapeVal(a.name||'')},${parseInt(a.points)||0},${!!a.highStaff},${escapeVal(a.note||'')});`);
    }

    // ── Weekly Scores ─────────────────────────────────────────────────
    console.log('Seeding weekly scores...');
    const ws = S.weeklyScores || {};
    for (const [mid, scores] of Object.entries(ws)) {
      if (!members.find(m => m.id === mid)) continue;
      for (const [aid, count] of Object.entries(scores||{})) {
        if (!activities.find(a => a.id === aid)) continue;
        const c = parseInt(count)||0;
        await client.query('INSERT INTO weekly_scores (member_id, activity_id, count) VALUES ($1,$2,$3)', [mid, aid, c]);
        sql.push(`INSERT INTO weekly_scores (member_id, activity_id, count) VALUES (${escapeVal(mid)},${escapeVal(aid)},${c});`);
      }
    }

    // ── Reprimands ────────────────────────────────────────────────────
    console.log('Seeding reprimands...');
    const reps = S.reprimands || {};
    for (const [mid, r] of Object.entries(reps)) {
      if (!members.find(m => m.id === mid)) continue;
      const v = Math.min(2, Math.max(0, parseInt(r.verbal)||0));
      const s2 = Math.min(2, Math.max(0, parseInt(r.strict)||0));
      await client.query('INSERT INTO reprimands (member_id, verbal, strict) VALUES ($1,$2,$3)', [mid, v, s2]);
      sql.push(`INSERT INTO reprimands (member_id, verbal, strict) VALUES (${escapeVal(mid)},${v},${s2});`);
    }

    // ── Questions ─────────────────────────────────────────────────────
    console.log('Seeding questions...');
    const questions = S.questions || [];
    for (const q of questions) {
      await client.query('INSERT INTO questions (id, q, a) VALUES ($1,$2,$3)', [q.id, q.q||'', q.a||'']);
      sql.push(`INSERT INTO questions (id, q, a) VALUES (${escapeVal(q.id)},${escapeVal(q.q||'')},${escapeVal(q.a||'')});`);
    }

    // ── Meetings ──────────────────────────────────────────────────────
    console.log('Seeding meetings...');
    const meetings = S.meetings || [];
    for (const mtg of meetings) {
      await client.query(
        'INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [mtg.id, mtg.title||'Собрание', mtg.date||'', mtg.time||'', mtg.type||'weekly', mtg.note||'', !!mtg.reprimandsIssued, mtg.createdAt||mtg.date||'']
      );
      sql.push(`INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES (${escapeVal(mtg.id)},${escapeVal(mtg.title||'Собрание')},${escapeVal(mtg.date||'')},${escapeVal(mtg.time||'')},${escapeVal(mtg.type||'weekly')},${escapeVal(mtg.note||'')},${!!mtg.reprimandsIssued},${escapeVal(mtg.createdAt||mtg.date||'')});`);
      
      const att = mtg.attendance || {};
      for (const [mid, statObj] of Object.entries(att)) {
        if (!members.find(m => m.id === mid)) continue;
        const status = statObj.status || 'none';
        const note = statObj.note || '';
        await client.query('INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES ($1,$2,$3,$4)', [mtg.id, mid, status, note]);
        sql.push(`INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES (${escapeVal(mtg.id)},${escapeVal(mid)},${escapeVal(status)},${escapeVal(note)});`);
      }
    }

    // ── Weekly History ────────────────────────────────────────────────
    console.log('Seeding weekly history...');
    const wh = S.weeklyHistory || [];
    for (const h of wh) {
      await client.query(
        'INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES ($1,$2,$3,$4,$5,$6)',
        [h.id, h.date||'', h.archivedAt||'', h.dateFrom||'', h.dateTo||'', parseInt(h.weekNum)||0]
      );
      sql.push(`INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES (${escapeVal(h.id)},${escapeVal(h.date||'')},${escapeVal(h.archivedAt||'')},${escapeVal(h.dateFrom||'')},${escapeVal(h.dateTo||'')},${parseInt(h.weekNum)||0});`);
      for (const [mid, actScores] of Object.entries(h.scores||{})) {
        for (const [aid, count] of Object.entries(actScores||{})) {
          const c = parseInt(count)||0;
          await client.query('INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES ($1,$2,$3,$4)', [h.id, mid, aid, c]);
          sql.push(`INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES (${escapeVal(h.id)},${escapeVal(mid)},${escapeVal(aid)},${c});`);
        }
      }
    }

    // ── Monthly Log ───────────────────────────────────────────────────
    console.log('Seeding monthly log...');
    const log = S.monthlyLog || [];
    for (const l of log) {
      await client.query('INSERT INTO monthly_log (id, type, date, data) VALUES ($1,$2,$3,$4)', [l.id, l.type, l.date||'', l.data||{}]);
      sql.push(`INSERT INTO monthly_log (id, type, date, data) VALUES (${escapeVal(l.id)},${escapeVal(l.type)},${escapeVal(l.date||'')},${escapeVal(l.data||{})});`);
    }

    // ── Settings ─────────────────────────────────────────────────────
    console.log('Seeding settings...');
    const meeting = S.meeting || { date: '', attendance: {} };
    await client.query("INSERT INTO settings (key, value) VALUES ('meeting', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [meeting]);
    sql.push(`INSERT INTO settings (key, value) VALUES ('meeting', ${escapeVal(meeting)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);
    
    const callObj = S.call || { date: '', candidates: [], scores: {} };
    await client.query("INSERT INTO settings (key, value) VALUES ('call_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [{ date: callObj.date||'' }]);
    sql.push(`INSERT INTO settings (key, value) VALUES ('call_date', ${escapeVal({ date: callObj.date||'' })}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);

    // ── Call Candidates ───────────────────────────────────────────────
    console.log('Seeding call candidates...');
    const candidates = callObj.candidates || [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.id) c.id = 'c' + i;
      await client.query('INSERT INTO call_candidates (id, name, game_id, order_index) VALUES ($1,$2,$3,$4)', [c.id, c.name||'', c.gameId||'', i]);
      sql.push(`INSERT INTO call_candidates (id, name, game_id, order_index) VALUES (${escapeVal(c.id)},${escapeVal(c.name||'')},${escapeVal(c.gameId||'')},${i});`);
    }

    const callScores = callObj.scores || {};
    for (const [qi, ciScores] of Object.entries(callScores)) {
      for (const [ci, val] of Object.entries(ciScores||{})) {
        const sc = parseFloat(val)||0;
        await client.query('INSERT INTO call_scores (candidate_id, question_id, score) VALUES ($1,$2,$3)', [ci, qi, sc]);
        sql.push(`INSERT INTO call_scores (candidate_id, question_id, score) VALUES (${escapeVal(ci)},${escapeVal(qi)},${sc});`);
      }
    }

    // ── Reports ───────────────────────────────────────────────────────
    console.log('Seeding submitted reports...');
    for (const rep of REPORTS) {
      await client.query(
        'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [rep.id, rep.weekKey||'', rep.weekLabel||'', rep.submittedAt||'', rep.name||'', rep.firstName||'', rep.lastName||'', rep.gameId||'', rep.status||'pending', parseInt(rep.totalPts)||0, rep.modNote||'', rep.reviewedAt||null]
      );
      sql.push(`INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES (${escapeVal(rep.id)},${escapeVal(rep.weekKey||'')},${escapeVal(rep.weekLabel||'')},${escapeVal(rep.submittedAt||'')},${escapeVal(rep.name||'')},${escapeVal(rep.firstName||'')},${escapeVal(rep.lastName||'')},${escapeVal(rep.gameId||'')},${escapeVal(rep.status||'pending')},${parseInt(rep.totalPts)||0},${escapeVal(rep.modNote||'')},${escapeVal(rep.reviewedAt||null)});`);

      for (const a of (rep.aspects||[])) {
        const res = await client.query(
          'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [rep.id, a.actId||'', a.code||'', a.name||'', parseInt(a.points)||0, parseInt(a.count)||0, parseInt(a.totalPts)||0]
        );
        const aspId = res.rows[0].id;
        sql.push(`INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES (${escapeVal(rep.id)},${escapeVal(a.actId||'')},${escapeVal(a.code||'')},${escapeVal(a.name||'')},${parseInt(a.points)||0},${parseInt(a.count)||0},${parseInt(a.totalPts)||0});`);
        for (const lnk of (a.links||[])) {
          await client.query('INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1,$2)', [aspId, lnk]);
          sql.push(`INSERT INTO report_aspect_links (aspect_id, link) SELECT id, ${escapeVal(lnk)} FROM report_aspects WHERE report_id=${escapeVal(rep.id)} AND act_id=${escapeVal(a.actId||'')} ORDER BY id DESC LIMIT 1;`);
        }
      }
    }

    await client.query('COMMIT');
    console.log('✓ Database seeded successfully!');

    fs.writeFileSync('seed.sql', sql.join('\n'), 'utf8');
    console.log('✓ seed.sql written!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

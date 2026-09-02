import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Serve frontend files
app.use(express.static(__dirname));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
  } else {
    console.log('PostgreSQL connection test successful:', res.rows[0].now);
  }
});

// Serve report.html on /report
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'report.html'));
});

// Serve index.html on /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ==========================================================================
   API: STATE ENDPOINTS
   ========================================================================== */

app.get('/api/state', async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. Ranks
    const ranksRes = await client.query('SELECT name FROM ranks ORDER BY order_index ASC');
    const ranks = ranksRes.rows.map(r => r.name);

    // 2. Members
    const membersRes = await client.query('SELECT * FROM members');
    const members = membersRes.rows.map(m => ({
      id: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      name: m.name,
      gameId: m.game_id,
      rank: m.rank,
      ooc: m.ooc,
      phone: m.phone,
      bank: m.bank
    }));

    // 3. Activities
    const activitiesRes = await client.query('SELECT * FROM activities');
    const activities = activitiesRes.rows.map(a => ({
      id: a.id,
      code: a.code,
      name: a.name,
      points: a.points,
      highStaff: a.high_staff,
      note: a.note
    }));

    // 4. Weekly Scores
    const wsRes = await client.query('SELECT * FROM weekly_scores');
    const weeklyScores = {};
    wsRes.rows.forEach(row => {
      if (!weeklyScores[row.member_id]) weeklyScores[row.member_id] = {};
      weeklyScores[row.member_id][row.activity_id] = row.count;
    });

    // 5. Reprimands
    const repsRes = await client.query('SELECT * FROM reprimands');
    const reprimands = {};
    repsRes.rows.forEach(row => {
      reprimands[row.member_id] = {
        verbal: row.verbal,
        strict: row.strict
      };
    });

    // 6. Questions
    const questionsRes = await client.query('SELECT * FROM questions');
    const questions = questionsRes.rows.map(q => ({
      id: q.id,
      q: q.q,
      a: q.a
    }));

    // 7. Meetings and Attendance
    const meetingsRes = await client.query('SELECT * FROM meetings ORDER BY date, time');
    const attRes = await client.query('SELECT * FROM meeting_attendance');
    
    const attendanceByMtg = {};
    attRes.rows.forEach(row => {
      if (!attendanceByMtg[row.meeting_id]) attendanceByMtg[row.meeting_id] = {};
      attendanceByMtg[row.meeting_id][row.member_id] = {
        status: row.status,
        note: row.note
      };
    });

    const meetings = meetingsRes.rows.map(m => ({
      id: m.id,
      title: m.title,
      date: m.date,
      time: m.time,
      type: m.type,
      note: m.note,
      reprimandsIssued: m.reprimands_issued,
      createdAt: m.created_at,
      attendance: attendanceByMtg[m.id] || {}
    }));

    // 8. Weekly History
    const historyRes = await client.query('SELECT * FROM weekly_history');
    const histScoresRes = await client.query('SELECT * FROM weekly_history_scores');

    const scoresByHist = {};
    histScoresRes.rows.forEach(row => {
      if (!scoresByHist[row.history_id]) scoresByHist[row.history_id] = {};
      if (!scoresByHist[row.history_id][row.member_id]) scoresByHist[row.history_id][row.member_id] = {};
      scoresByHist[row.history_id][row.member_id][row.activity_id] = row.count;
    });

    const weeklyHistory = historyRes.rows.map(h => ({
      id: h.id,
      date: h.date,
      archivedAt: h.archived_at,
      dateFrom: h.date_from,
      dateTo: h.date_to,
      weekNum: h.week_num,
      scores: scoresByHist[h.id] || {}
    }));

    // 9. Monthly Log
    const logRes = await client.query('SELECT * FROM monthly_log ORDER BY date');
    const monthlyLog = logRes.rows.map(l => ({
      id: l.id,
      type: l.type,
      date: l.date,
      data: l.data
    }));

    // 10. Settings (singular meeting & call_date)
    const settingsRes = await client.query('SELECT * FROM settings');
    let meeting = { date: '', attendance: {} };
    let callDate = '';

    settingsRes.rows.forEach(row => {
      if (row.key === 'meeting') meeting = row.value;
      if (row.key === 'call_date') callDate = row.value.date || '';
    });

    // 11. Call candidates and scores
    const candRes = await client.query('SELECT * FROM call_candidates ORDER BY order_index ASC');
    const callScoresRes = await client.query('SELECT * FROM call_scores');

    const callScores = {};
    callScoresRes.rows.forEach(row => {
      if (!callScores[row.question_id]) callScores[row.question_id] = {};
      callScores[row.question_id][row.candidate_id] = Number(row.score);
    });

    const call = {
      date: callDate,
      candidates: candRes.rows.map(c => ({
        id: c.id,
        name: c.name,
        gameId: c.game_id
      })),
      scores: callScores
    };

    res.json({
      ranks,
      members,
      activities,
      weeklyScores,
      reprimands,
      questions,
      meetings,
      weeklyHistory,
      monthlyLog,
      meeting,
      call
    });
  } catch (err) {
    console.error('Error fetching state from DB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

app.post('/api/state', async (req, res) => {
  const S = req.body;
  if (!S) return res.status(400).json({ error: 'Missing state payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear tables
    await client.query('DELETE FROM call_scores');
    await client.query('DELETE FROM call_candidates');
    await client.query('DELETE FROM settings WHERE key IN (\'meeting\', \'call_date\')');
    await client.query('DELETE FROM monthly_log');
    await client.query('DELETE FROM weekly_history_scores');
    await client.query('DELETE FROM weekly_history');
    await client.query('DELETE FROM meeting_attendance');
    await client.query('DELETE FROM meetings');
    await client.query('DELETE FROM reprimands');
    await client.query('DELETE FROM weekly_scores');
    await client.query('DELETE FROM members');
    await client.query('DELETE FROM activities');
    await client.query('DELETE FROM ranks');
    await client.query('DELETE FROM questions');

    // 1. Ranks
    const ranks = S.ranks || [];
    for (let i = 0; i < ranks.length; i++) {
      await client.query('INSERT INTO ranks (name, order_index) VALUES ($1, $2)', [ranks[i], i]);
    }

    // 2. Members
    const members = S.members || [];
    for (const m of members) {
      const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '';
      await client.query(
        'INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [m.id, m.firstName || '', m.lastName || '', fullName, m.gameId || '', m.rank || null, m.ooc || '-', m.phone || '', m.bank || '']
      );
    }

    // 3. Activities
    const activities = S.activities || [];
    for (const a of activities) {
      await client.query(
        'INSERT INTO activities (id, code, name, points, high_staff, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [a.id, a.code, a.name, Number(a.points) || 0, !!a.highStaff, a.note || '']
      );
    }

    // 4. Weekly Scores
    const weeklyScores = S.weeklyScores || {};
    for (const [memberId, scores] of Object.entries(weeklyScores)) {
      // make sure member exists
      const memExists = members.some(m => m.id === memberId);
      if (!memExists) continue;

      for (const [activityId, count] of Object.entries(scores || {})) {
        const actExists = activities.some(a => a.id === activityId);
        if (!actExists) continue;

        await client.query(
          'INSERT INTO weekly_scores (member_id, activity_id, count) VALUES ($1, $2, $3)',
          [memberId, activityId, Number(count) || 0]
        );
      }
    }

    // 5. Reprimands
    const reprimands = S.reprimands || {};
    for (const [memberId, reps] of Object.entries(reprimands)) {
      const memExists = members.some(m => m.id === memberId);
      if (!memExists) continue;

      await client.query(
        'INSERT INTO reprimands (member_id, verbal, strict) VALUES ($1, $2, $3)',
        [memberId, Number(reps.verbal) || 0, Number(reps.strict) || 0]
      );
    }

    // 6. Questions
    const questions = S.questions || [];
    for (const q of questions) {
      await client.query('INSERT INTO questions (id, q, a) VALUES ($1, $2, $3)', [q.id, q.q, q.a]);
    }

    // 7. Meetings & Attendance
    const meetings = S.meetings || [];
    for (const mtg of meetings) {
      await client.query(
        'INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [mtg.id, mtg.title || 'Собрание', mtg.date || '', mtg.time || '', mtg.type || 'weekly', mtg.note || '', !!mtg.reprimandsIssued, mtg.createdAt || mtg.date || '']
      );

      const att = mtg.attendance || {};
      for (const [memberId, statObj] of Object.entries(att)) {
        const memExists = members.some(m => m.id === memberId);
        if (!memExists) continue;

        await client.query(
          'INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES ($1, $2, $3, $4)',
          [mtg.id, memberId, statObj.status || 'none', statObj.note || '']
        );
      }
    }

    // 8. Weekly History
    const weeklyHistory = S.weeklyHistory || [];
    for (const h of weeklyHistory) {
      await client.query(
        'INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES ($1, $2, $3, $4, $5, $6)',
        [h.id, h.date || '', h.archivedAt || '', h.dateFrom || '', h.dateTo || '', Number(h.weekNum) || 0]
      );

      const scores = h.scores || {};
      for (const [memberId, actScores] of Object.entries(scores)) {
        for (const [activityId, count] of Object.entries(actScores || {})) {
          await client.query(
            'INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES ($1, $2, $3, $4)',
            [h.id, memberId, activityId, Number(count) || 0]
          );
        }
      }
    }

    // 9. Monthly Log
    const monthlyLog = S.monthlyLog || [];
    for (const log of monthlyLog) {
      await client.query(
        'INSERT INTO monthly_log (id, type, date, data) VALUES ($1, $2, $3, $4)',
        [log.id, log.type, log.date || '', log.data || {}]
      );
    }

    // 10. Settings (singular meeting & call_date)
    const meetingSingular = S.meeting || { date: '', attendance: {} };
    await client.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['meeting', meetingSingular]
    );

    const call = S.call || { date: '', candidates: [], scores: {} };
    await client.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['call_date', { date: call.date || '' }]
    );

    // Call candidates
    const candidates = call.candidates || [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await client.query(
        'INSERT INTO call_candidates (id, name, game_id, order_index) VALUES ($1, $2, $3, $4)',
        [c.id, c.name || '', c.gameId || '', i]
      );
    }

    // Call scores
    const callScores = call.scores || {};
    for (const [qi, ciScores] of Object.entries(callScores)) {
      for (const [ci, val] of Object.entries(ciScores || {})) {
        await client.query(
          'INSERT INTO call_scores (candidate_id, question_id, score) VALUES ($1, $2, $3)',
          [ci, qi, Number(val) || 0]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving state to DB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

/* ==========================================================================
   API: REPORTS ENDPOINTS
   ========================================================================== */

app.get('/api/reports', async (req, res) => {
  const client = await pool.connect();
  try {
    const reportsRes = await client.query('SELECT * FROM reports');
    const aspectsRes = await client.query('SELECT * FROM report_aspects');
    const linksRes = await client.query('SELECT * FROM report_aspect_links');

    // Group links by aspect_id
    const linksByAspect = {};
    linksRes.rows.forEach(lnk => {
      if (!linksByAspect[lnk.aspect_id]) linksByAspect[lnk.aspect_id] = [];
      linksByAspect[lnk.aspect_id].push(lnk.link);
    });

    // Group aspects by report_id
    const aspectsByReport = {};
    aspectsRes.rows.forEach(a => {
      if (!aspectsByReport[a.report_id]) aspectsByReport[a.report_id] = [];
      aspectsByReport[a.report_id].push({
        actId: a.act_id,
        code: a.code,
        name: a.name,
        points: a.points,
        count: a.count,
        totalPts: a.total_pts,
        links: linksByAspect[a.id] || []
      });
    });

    // Assemble reports
    const reports = reportsRes.rows.map(rep => ({
      id: rep.id,
      weekKey: rep.week_key,
      weekLabel: rep.week_label,
      submittedAt: rep.submitted_at,
      name: rep.name,
      firstName: rep.first_name,
      lastName: rep.last_name,
      gameId: rep.game_id,
      status: rep.status,
      totalPts: rep.total_pts,
      modNote: rep.mod_note,
      reviewedAt: rep.reviewed_at,
      aspects: aspectsByReport[rep.id] || []
    }));

    res.json(reports);
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// Single report submission
app.post('/api/reports/submit', async (req, res) => {
  const rep = req.body;
  if (!rep) return res.status(400).json({ error: 'Missing report payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [rep.id, rep.weekKey || '', rep.weekLabel || '', rep.submittedAt || '', rep.name || '', rep.firstName || '', rep.lastName || '', rep.gameId || '', rep.status || 'pending', Number(rep.totalPts) || 0, rep.modNote || '', rep.reviewedAt || null]
    );

    const aspects = rep.aspects || [];
    for (const a of aspects) {
      const aspRes = await client.query(
        'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [rep.id, a.actId, a.code, a.name, Number(a.points) || 0, Number(a.count) || 0, Number(a.totalPts) || 0]
      );
      const aspectId = aspRes.rows[0].id;

      const links = a.links || [];
      for (const lnk of links) {
        await client.query('INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1, $2)', [aspectId, lnk]);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error submitting report:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// Bulk reports update (from index.html reports moderator save)
app.post('/api/reports', async (req, res) => {
  const reports = req.body;
  if (!Array.isArray(reports)) return res.status(400).json({ error: 'Payload must be an array of reports' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear reports and aspects
    await client.query('DELETE FROM report_aspect_links');
    await client.query('DELETE FROM report_aspects');
    await client.query('DELETE FROM reports');

    for (const rep of reports) {
      await client.query(
        'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [rep.id, rep.weekKey || '', rep.weekLabel || '', rep.submittedAt || '', rep.name || '', rep.firstName || '', rep.lastName || '', rep.gameId || '', rep.status || 'pending', Number(rep.totalPts) || 0, rep.modNote || '', rep.reviewedAt || null]
      );

      const aspects = rep.aspects || [];
      for (const a of aspects) {
        const aspRes = await client.query(
          'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [rep.id, a.actId, a.code, a.name, Number(a.points) || 0, Number(a.count) || 0, Number(a.totalPts) || 0]
        );
        const aspectId = aspRes.rows[0].id;

        const links = a.links || [];
        for (const lnk of links) {
          await client.query('INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1, $2)', [aspectId, lnk]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating reports:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running locally on http://localhost:${PORT}`);
});

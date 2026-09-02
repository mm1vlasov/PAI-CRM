import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword, verifyPassword } from './lib/password.js';
import { signSessionToken, SESSION_COOKIE } from './lib/session.js';
import {
  publicUser, isAdmin, isSenior, isEmployee, canAssignRole, USER_ROLES, ROLE_LABELS
} from './lib/roles.js';
import {
  authenticateRequest, setSessionCookie, clearSessionCookie, requireAuth,
  requireEmployee, requireSenior, requireAdmin
} from './lib/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

app.locals.pool = pool;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('PostgreSQL connection error:', err.message);
  else console.log('PostgreSQL connected:', res.rows[0].now);
});

/* ==========================================================================
   HELPERS
   ========================================================================== */

async function fetchState(client) {
  const ranksRes = await client.query('SELECT name FROM ranks ORDER BY order_index ASC');
  const ranks = ranksRes.rows.map(r => r.name);

  const membersRes = await client.query('SELECT * FROM members');
  const members = membersRes.rows.map(m => ({
    id: m.id, firstName: m.first_name, lastName: m.last_name, name: m.name,
    gameId: m.game_id, rank: m.rank, ooc: m.ooc, phone: m.phone, bank: m.bank
  }));

  const activitiesRes = await client.query('SELECT * FROM activities');
  const activities = activitiesRes.rows.map(a => ({
    id: a.id, code: a.code, name: a.name, points: a.points,
    highStaff: a.high_staff, note: a.note
  }));

  const wsRes = await client.query('SELECT * FROM weekly_scores');
  const weeklyScores = {};
  wsRes.rows.forEach(row => {
    if (!weeklyScores[row.member_id]) weeklyScores[row.member_id] = {};
    weeklyScores[row.member_id][row.activity_id] = row.count;
  });

  const repsRes = await client.query('SELECT * FROM reprimands');
  const reprimands = {};
  repsRes.rows.forEach(row => {
    reprimands[row.member_id] = { verbal: row.verbal, strict: row.strict };
  });

  const questionsRes = await client.query('SELECT * FROM questions');
  const questions = questionsRes.rows.map(q => ({ id: q.id, q: q.q, a: q.a }));

  const meetingsRes = await client.query('SELECT * FROM meetings ORDER BY date, time');
  const attRes = await client.query('SELECT * FROM meeting_attendance');
  const attendanceByMtg = {};
  attRes.rows.forEach(row => {
    if (!attendanceByMtg[row.meeting_id]) attendanceByMtg[row.meeting_id] = {};
    attendanceByMtg[row.meeting_id][row.member_id] = { status: row.status, note: row.note };
  });

  const meetings = meetingsRes.rows.map(m => ({
    id: m.id, title: m.title, date: m.date, time: m.time, type: m.type,
    note: m.note, reprimandsIssued: m.reprimands_issued, createdAt: m.created_at,
    attendance: attendanceByMtg[m.id] || {}
  }));

  const historyRes = await client.query('SELECT * FROM weekly_history');
  const histScoresRes = await client.query('SELECT * FROM weekly_history_scores');
  const scoresByHist = {};
  histScoresRes.rows.forEach(row => {
    if (!scoresByHist[row.history_id]) scoresByHist[row.history_id] = {};
    if (!scoresByHist[row.history_id][row.member_id]) scoresByHist[row.history_id][row.member_id] = {};
    scoresByHist[row.history_id][row.member_id][row.activity_id] = row.count;
  });

  const weeklyHistory = historyRes.rows.map(h => ({
    id: h.id, date: h.date, archivedAt: h.archived_at, dateFrom: h.date_from,
    dateTo: h.date_to, weekNum: h.week_num, scores: scoresByHist[h.id] || {}
  }));

  const logRes = await client.query('SELECT * FROM monthly_log ORDER BY date');
  const monthlyLog = logRes.rows.map(l => ({ id: l.id, type: l.type, date: l.date, data: l.data }));

  const settingsRes = await client.query('SELECT * FROM settings');
  let meeting = { date: '', attendance: {} };
  let callDate = '';
  settingsRes.rows.forEach(row => {
    if (row.key === 'meeting') meeting = row.value;
    if (row.key === 'call_date') callDate = row.value.date || '';
  });

  const candRes = await client.query('SELECT * FROM call_candidates ORDER BY order_index ASC');
  const callScoresRes = await client.query('SELECT * FROM call_scores');
  const callScores = {};
  callScoresRes.rows.forEach(row => {
    if (!callScores[row.question_id]) callScores[row.question_id] = {};
    callScores[row.question_id][row.candidate_id] = Number(row.score);
  });

  const call = {
    date: callDate,
    candidates: candRes.rows.map(c => ({ id: c.id, name: c.name, gameId: c.game_id })),
    scores: callScores
  };

  return { ranks, members, activities, weeklyScores, reprimands, questions, meetings, weeklyHistory, monthlyLog, meeting, call };
}

async function saveState(client, S) {
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

  const ranks = S.ranks || [];
  for (let i = 0; i < ranks.length; i++) {
    await client.query('INSERT INTO ranks (name, order_index) VALUES ($1, $2)', [ranks[i], i]);
  }

  const members = S.members || [];
  for (const m of members) {
    const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '';
    await client.query(
      'INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [m.id, m.firstName || '', m.lastName || '', fullName, m.gameId || '', m.rank || null, m.ooc || '-', m.phone || '', m.bank || '']
    );
  }

  const activities = S.activities || [];
  for (const a of activities) {
    await client.query(
      'INSERT INTO activities (id, code, name, points, high_staff, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [a.id, a.code, a.name, Number(a.points) || 0, !!a.highStaff, a.note || '']
    );
  }

  const weeklyScores = S.weeklyScores || {};
  for (const [memberId, scores] of Object.entries(weeklyScores)) {
    if (!members.some(m => m.id === memberId)) continue;
    for (const [activityId, count] of Object.entries(scores || {})) {
      if (!activities.some(a => a.id === activityId)) continue;
      await client.query('INSERT INTO weekly_scores (member_id, activity_id, count) VALUES ($1, $2, $3)', [memberId, activityId, Number(count) || 0]);
    }
  }

  const reprimands = S.reprimands || {};
  for (const [memberId, reps] of Object.entries(reprimands)) {
    if (!members.some(m => m.id === memberId)) continue;
    await client.query('INSERT INTO reprimands (member_id, verbal, strict) VALUES ($1, $2, $3)', [memberId, Number(reps.verbal) || 0, Number(reps.strict) || 0]);
  }

  const questions = S.questions || [];
  for (const q of questions) {
    await client.query('INSERT INTO questions (id, q, a) VALUES ($1, $2, $3)', [q.id, q.q, q.a]);
  }

  const meetings = S.meetings || [];
  for (const mtg of meetings) {
    await client.query(
      'INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [mtg.id, mtg.title || 'Собрание', mtg.date || '', mtg.time || '', mtg.type || 'weekly', mtg.note || '', !!mtg.reprimandsIssued, mtg.createdAt || mtg.date || '']
    );
    const att = mtg.attendance || {};
    for (const [memberId, statObj] of Object.entries(att)) {
      if (!members.some(m => m.id === memberId)) continue;
      await client.query('INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES ($1, $2, $3, $4)', [mtg.id, memberId, statObj.status || 'none', statObj.note || '']);
    }
  }

  const weeklyHistory = S.weeklyHistory || [];
  for (const h of weeklyHistory) {
    await client.query('INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES ($1, $2, $3, $4, $5, $6)', [h.id, h.date || '', h.archivedAt || '', h.dateFrom || '', h.dateTo || '', Number(h.weekNum) || 0]);
    for (const [memberId, actScores] of Object.entries(h.scores || {})) {
      for (const [activityId, count] of Object.entries(actScores || {})) {
        await client.query('INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES ($1, $2, $3, $4)', [h.id, memberId, activityId, Number(count) || 0]);
      }
    }
  }

  const monthlyLog = S.monthlyLog || [];
  for (const log of monthlyLog) {
    await client.query('INSERT INTO monthly_log (id, type, date, data) VALUES ($1, $2, $3, $4)', [log.id, log.type, log.date || '', log.data || {}]);
  }

  const meetingSingular = S.meeting || { date: '', attendance: {} };
  await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['meeting', meetingSingular]);

  const call = S.call || { date: '', candidates: [], scores: {} };
  await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['call_date', { date: call.date || '' }]);

  const candidates = call.candidates || [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    await client.query('INSERT INTO call_candidates (id, name, game_id, order_index) VALUES ($1, $2, $3, $4)', [c.id, c.name || '', c.gameId || '', i]);
  }

  const callScores = call.scores || {};
  for (const [qi, ciScores] of Object.entries(callScores)) {
    for (const [ci, val] of Object.entries(ciScores || {})) {
      await client.query('INSERT INTO call_scores (candidate_id, question_id, score) VALUES ($1, $2, $3)', [ci, qi, Number(val) || 0]);
    }
  }
}

async function fetchReports(client) {
  const reportsRes = await client.query('SELECT * FROM reports ORDER BY submitted_at DESC');
  const aspectsRes = await client.query('SELECT * FROM report_aspects');
  const linksRes = await client.query('SELECT * FROM report_aspect_links');

  const linksByAspect = {};
  linksRes.rows.forEach(lnk => {
    if (!linksByAspect[lnk.aspect_id]) linksByAspect[lnk.aspect_id] = [];
    linksByAspect[lnk.aspect_id].push(lnk.link);
  });

  const aspectsByReport = {};
  aspectsRes.rows.forEach(a => {
    if (!aspectsByReport[a.report_id]) aspectsByReport[a.report_id] = [];
    aspectsByReport[a.report_id].push({
      actId: a.act_id, code: a.code, name: a.name, points: a.points,
      count: a.count, totalPts: a.total_pts, links: linksByAspect[a.id] || []
    });
  });

  return reportsRes.rows.map(rep => ({
    id: rep.id, weekKey: rep.week_key, weekLabel: rep.week_label,
    submittedAt: rep.submitted_at, name: rep.name, firstName: rep.first_name,
    lastName: rep.last_name, gameId: rep.game_id, status: rep.status,
    totalPts: rep.total_pts, modNote: rep.mod_note, reviewedAt: rep.reviewed_at,
    userId: rep.user_id, aspects: aspectsByReport[rep.id] || []
  }));
}

/* ==========================================================================
   ROUTES
   ========================================================================== */

app.get('/report', (req, res) => res.sendFile(path.join(__dirname, 'report.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ── AUTH ── */

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, firstName, lastName, gameId } = req.body || {};
    const uname = (username || '').trim().toLowerCase();
    if (!uname || uname.length < 3 || !/^[a-z0-9_-]+$/.test(uname)) {
      return res.status(400).json({ error: 'Логин: 3+ символа, латиница/цифры/_-' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }

    const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [uname]);
    if (exists.rows.length) return res.status(409).json({ error: 'Логин уже занят' });

    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    const role = uname === adminUsername ? 'admin' : 'verification';
    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, first_name, last_name, game_id, role, last_sign_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [uname, passwordHash, firstName || '', lastName || '', gameId || '', role]
    );
    const user = result.rows[0];
    const token = signSessionToken({ userId: user.id });
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const uname = (username || '').trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1', [uname]);
    const user = result.rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Неверный логин или пароль' });
    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    await pool.query('UPDATE users SET last_sign_in_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
    const token = signSessionToken({ userId: user.id });
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await authenticateRequest(req, pool);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ user: publicUser(user) });
});

app.put('/api/auth/profile', requireAuth(async (req, res) => {
  try {
    const { firstName, lastName, gameId, password } = req.body || {};
    let passwordHash = null;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
      passwordHash = await hashPassword(password);
    }
    const result = await pool.query(
      `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        game_id = COALESCE($3, game_id),
        password_hash = COALESCE($4, password_hash),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [firstName ?? null, lastName ?? null, gameId ?? null, passwordHash, req.user.id]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
}));

/* ── USERS (role management) ── */

app.get('/api/users', requireSenior(async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, first_name, last_name, game_id, role, is_active, created_at, last_sign_in_at FROM users ORDER BY created_at DESC'
  );
  res.json({ users: result.rows.map(publicUser), roles: USER_ROLES, roleLabels: ROLE_LABELS });
}));

app.put('/api/users/:id/role', requireSenior(async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body || {};
    if (!USER_ROLES.includes(role)) return res.status(400).json({ error: 'Неверная роль' });
    if (!canAssignRole(req.user.role, role)) return res.status(403).json({ error: 'Нельзя выдать эту роль' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });

    const target = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.rows[0].role === 'admin' && !isAdmin(req.user.role)) {
      return res.status(403).json({ error: 'Нельзя изменить роль администратора' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, userId]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ error: 'Ошибка обновления роли' });
  }
}));

app.put('/api/users/:id/active', requireAdmin(async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { isActive } = req.body || {};
    if (userId === req.user.id) return res.status(400).json({ error: 'Нельзя деактивировать себя' });
    const result = await pool.query(
      'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [!!isActive, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('Active toggle error:', err);
    res.status(500).json({ error: 'Ошибка' });
  }
}));

/* ── STATE ── */

app.get('/api/activities', requireEmployee(async (req, res) => {
  const client = await pool.connect();
  try {
    const activitiesRes = await client.query('SELECT * FROM activities');
    res.json(activitiesRes.rows.map(a => ({
      id: a.id, code: a.code, name: a.name, points: a.points,
      highStaff: a.high_staff, note: a.note
    })));
  } finally { client.release(); }
}));

app.get('/api/state', requireSenior(async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await fetchState(client));
  } catch (err) {
    console.error('GET state error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally { client.release(); }
}));

app.post('/api/state', requireSenior(async (req, res) => {
  const S = req.body;
  if (!S) return res.status(400).json({ error: 'Missing state payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await saveState(client, S);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST state error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally { client.release(); }
}));

/* ── REPORTS ── */

app.get('/api/reports', requireSenior(async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await fetchReports(client));
  } catch (err) {
    console.error('GET reports error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally { client.release(); }
}));

app.get('/api/reports/mine', requireEmployee(async (req, res) => {
  const client = await pool.connect();
  try {
    const all = await fetchReports(client);
    const mine = all.filter(r =>
      r.userId === req.user.id ||
      r.gameId === req.user.game_id ||
      (r.firstName?.toLowerCase() === req.user.first_name?.toLowerCase() &&
       r.lastName?.toLowerCase() === req.user.last_name?.toLowerCase())
    );
    res.json(mine);
  } finally { client.release(); }
}));

app.post('/api/reports/submit', requireEmployee(async (req, res) => {
  const rep = req.body;
  if (!rep) return res.status(400).json({ error: 'Missing report payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [rep.id, rep.weekKey || '', rep.weekLabel || '', rep.submittedAt || new Date().toISOString(),
       rep.name || '', rep.firstName || '', rep.lastName || '', rep.gameId || req.user.game_id || '',
       rep.status || 'pending', Number(rep.totalPts) || 0, rep.modNote || '', rep.reviewedAt || null, req.user.id]
    );
    for (const a of rep.aspects || []) {
      const aspRes = await client.query(
        'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [rep.id, a.actId, a.code, a.name, Number(a.points) || 0, Number(a.count) || 0, Number(a.totalPts) || 0]
      );
      for (const lnk of a.links || []) {
        await client.query('INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1, $2)', [aspRes.rows[0].id, lnk]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Submit report error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally { client.release(); }
}));

app.post('/api/reports', requireSenior(async (req, res) => {
  const reports = req.body;
  if (!Array.isArray(reports)) return res.status(400).json({ error: 'Payload must be an array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM report_aspect_links');
    await client.query('DELETE FROM report_aspects');
    await client.query('DELETE FROM reports');

    for (const rep of reports) {
      await client.query(
        'INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [rep.id, rep.weekKey || '', rep.weekLabel || '', rep.submittedAt || '', rep.name || '',
         rep.firstName || '', rep.lastName || '', rep.gameId || '', rep.status || 'pending',
         Number(rep.totalPts) || 0, rep.modNote || '', rep.reviewedAt || null, rep.userId || null]
      );
      for (const a of rep.aspects || []) {
        const aspRes = await client.query(
          'INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [rep.id, a.actId, a.code, a.name, Number(a.points) || 0, Number(a.count) || 0, Number(a.totalPts) || 0]
        );
        for (const lnk of a.links || []) {
          await client.query('INSERT INTO report_aspect_links (aspect_id, link) VALUES ($1, $2)', [aspRes.rows[0].id, lnk]);
        }
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk reports error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally { client.release(); }
}));

app.listen(PORT, () => {
  console.log(`PAI CRM running on http://localhost:${PORT}`);
});

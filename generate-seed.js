import fs from 'fs';
import path from 'path';
import { hashPassword } from './lib/password.js';

function escapeVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${val.toString().replace(/'/g, "''")}'`;
}

const statePath = path.resolve('data/state.json');
const reportsPath = path.resolve('data/weekly_reports.json');
const schemaPath = path.resolve('schema.sql');

const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const REPORTS = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
const DDL = fs.readFileSync(schemaPath, 'utf8');

const sql = [];
sql.push('-- PAI CRM Seed Script');
sql.push('-- Запуск: psql $DATABASE_URL -f seed.sql');
sql.push('-- Админ: логин admin, пароль admin123');
sql.push('');
sql.push(DDL);
sql.push('');

const adminHash = await hashPassword('admin123');
sql.push(`INSERT INTO users (username, password_hash, first_name, last_name, game_id, role) VALUES ('admin', '${adminHash}', 'Admin', 'PAI', '', 'admin');`);
sql.push('');

const ranks = S.ranks || [];
ranks.forEach((rank, i) => sql.push(`INSERT INTO ranks (name, order_index) VALUES (${escapeVal(rank)}, ${i});`));

const members = S.members || [];
members.forEach(m => {
  const name = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '';
  sql.push(`INSERT INTO members (id, first_name, last_name, name, game_id, rank, ooc, phone, bank) VALUES (${escapeVal(m.id)}, ${escapeVal(m.firstName||'')}, ${escapeVal(m.lastName||'')}, ${escapeVal(name)}, ${escapeVal(m.gameId||'')}, ${escapeVal(m.rank||null)}, ${escapeVal(m.ooc||'-')}, ${escapeVal(m.phone||'')}, ${escapeVal(m.bank||'')});`);
});

(S.activities || []).forEach(a => {
  sql.push(`INSERT INTO activities (id, code, name, points, high_staff, note) VALUES (${escapeVal(a.id)}, ${escapeVal(a.code)}, ${escapeVal(a.name)}, ${Number(a.points)||0}, ${!!a.highStaff}, ${escapeVal(a.note||'')});`);
});

Object.entries(S.weeklyScores || {}).forEach(([memberId, scores]) => {
  Object.entries(scores || {}).forEach(([activityId, count]) => {
    sql.push(`INSERT INTO weekly_scores (member_id, activity_id, count) VALUES (${escapeVal(memberId)}, ${escapeVal(activityId)}, ${Number(count)||0});`);
  });
});

Object.entries(S.reprimands || {}).forEach(([memberId, reps]) => {
  sql.push(`INSERT INTO reprimands (member_id, verbal, strict) VALUES (${escapeVal(memberId)}, ${Number(reps.verbal)||0}, ${Number(reps.strict)||0});`);
});

(S.questions || []).forEach(q => {
  sql.push(`INSERT INTO questions (id, q, a) VALUES (${escapeVal(q.id)}, ${escapeVal(q.q)}, ${escapeVal(q.a)});`);
});

(S.meetings || []).forEach(mtg => {
  sql.push(`INSERT INTO meetings (id, title, date, time, type, note, reprimands_issued, created_at) VALUES (${escapeVal(mtg.id)}, ${escapeVal(mtg.title||'Собрание')}, ${escapeVal(mtg.date||'')}, ${escapeVal(mtg.time||'')}, ${escapeVal(mtg.type||'weekly')}, ${escapeVal(mtg.note||'')}, ${!!mtg.reprimandsIssued}, ${escapeVal(mtg.createdAt||mtg.date||'')});`);
  Object.entries(mtg.attendance || {}).forEach(([memberId, statObj]) => {
    sql.push(`INSERT INTO meeting_attendance (meeting_id, member_id, status, note) VALUES (${escapeVal(mtg.id)}, ${escapeVal(memberId)}, ${escapeVal(statObj.status||'none')}, ${escapeVal(statObj.note||'')});`);
  });
});

(S.weeklyHistory || []).forEach(h => {
  sql.push(`INSERT INTO weekly_history (id, date, archived_at, date_from, date_to, week_num) VALUES (${escapeVal(h.id)}, ${escapeVal(h.date||'')}, ${escapeVal(h.archivedAt||'')}, ${escapeVal(h.dateFrom||'')}, ${escapeVal(h.dateTo||'')}, ${Number(h.weekNum)||0});`);
  Object.entries(h.scores || {}).forEach(([memberId, actScores]) => {
    Object.entries(actScores || {}).forEach(([activityId, count]) => {
      sql.push(`INSERT INTO weekly_history_scores (history_id, member_id, activity_id, count) VALUES (${escapeVal(h.id)}, ${escapeVal(memberId)}, ${escapeVal(activityId)}, ${Number(count)||0});`);
    });
  });
});

(S.monthlyLog || []).forEach(log => {
  sql.push(`INSERT INTO monthly_log (id, type, date, data) VALUES (${escapeVal(log.id)}, ${escapeVal(log.type)}, ${escapeVal(log.date||'')}, ${escapeVal(log.data||{})});`);
});

const meeting = S.meeting || { date: '', attendance: {} };
sql.push(`INSERT INTO settings (key, value) VALUES ('meeting', ${escapeVal(meeting)});`);

const call = S.call || { date: '', candidates: [], scores: {} };
sql.push(`INSERT INTO settings (key, value) VALUES ('call_date', ${escapeVal({ date: call.date || '' })});`);

(call.candidates || []).forEach((c, i) => {
  sql.push(`INSERT INTO call_candidates (id, name, game_id, order_index) VALUES (${escapeVal(c.id)}, ${escapeVal(c.name||'')}, ${escapeVal(c.gameId||'')}, ${i});`);
});

Object.entries(call.scores || {}).forEach(([qi, ciScores]) => {
  Object.entries(ciScores || {}).forEach(([ci, val]) => {
    sql.push(`INSERT INTO call_scores (candidate_id, question_id, score) VALUES (${escapeVal(ci)}, ${escapeVal(qi)}, ${Number(val)||0});`);
  });
});

REPORTS.forEach(rep => {
  sql.push(`INSERT INTO reports (id, week_key, week_label, submitted_at, name, first_name, last_name, game_id, status, total_pts, mod_note, reviewed_at) VALUES (${escapeVal(rep.id)}, ${escapeVal(rep.weekKey||'')}, ${escapeVal(rep.weekLabel||'')}, ${escapeVal(rep.submittedAt||'')}, ${escapeVal(rep.name||'')}, ${escapeVal(rep.firstName||'')}, ${escapeVal(rep.lastName||'')}, ${escapeVal(rep.gameId||'')}, ${escapeVal(rep.status||'pending')}, ${Number(rep.totalPts)||0}, ${escapeVal(rep.modNote||'')}, ${rep.reviewedAt ? escapeVal(rep.reviewedAt) : 'NULL'});`);
  (rep.aspects || []).forEach(a => {
    sql.push(`INSERT INTO report_aspects (report_id, act_id, code, name, points, count, total_pts) VALUES (${escapeVal(rep.id)}, ${escapeVal(a.actId)}, ${escapeVal(a.code)}, ${escapeVal(a.name)}, ${Number(a.points)||0}, ${Number(a.count)||0}, ${Number(a.totalPts)||0});`);
    (a.links || []).forEach(lnk => {
      sql.push(`INSERT INTO report_aspect_links (aspect_id, link) SELECT id, ${escapeVal(lnk)} FROM report_aspects WHERE report_id = ${escapeVal(rep.id)} AND act_id = ${escapeVal(a.actId)} ORDER BY id DESC LIMIT 1;`);
    });
  });
});

fs.writeFileSync('seed.sql', sql.join('\n') + '\n');
console.log('seed.sql generated successfully');

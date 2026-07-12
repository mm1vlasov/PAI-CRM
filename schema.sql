-- PAI CRM Database Schema

DROP TABLE IF EXISTS report_aspect_links CASCADE;
DROP TABLE IF EXISTS report_aspects CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS call_scores CASCADE;
DROP TABLE IF EXISTS call_candidates CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS monthly_log CASCADE;
DROP TABLE IF EXISTS weekly_history_scores CASCADE;
DROP TABLE IF EXISTS weekly_history CASCADE;
DROP TABLE IF EXISTS meeting_attendance CASCADE;
DROP TABLE IF EXISTS meetings CASCADE;
DROP TABLE IF EXISTS reprimands CASCADE;
DROP TABLE IF EXISTS weekly_scores CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS ranks CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;

CREATE TYPE user_role AS ENUM (
  'verification',
  'pai_employee',
  'pai_senior',
  'admin'
);

-- Users (auth & profiles)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) DEFAULT '',
    last_name VARCHAR(100) DEFAULT '',
    game_id VARCHAR(50) DEFAULT '',
    role user_role NOT NULL DEFAULT 'verification',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ
);

CREATE INDEX idx_users_username ON users (LOWER(username));
CREATE INDEX idx_users_role ON users (role);

-- 1. Ranks Table
CREATE TABLE ranks (
    name TEXT PRIMARY KEY,
    order_index INTEGER DEFAULT 0
);

-- 2. Members Table
CREATE TABLE members (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    name TEXT NOT NULL,
    game_id TEXT NOT NULL,
    rank TEXT REFERENCES ranks(name) ON UPDATE CASCADE ON DELETE SET NULL,
    ooc TEXT DEFAULT '-',
    phone TEXT DEFAULT '',
    bank TEXT DEFAULT ''
);

-- 3. Activities Table
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    points INTEGER NOT NULL,
    high_staff BOOLEAN DEFAULT FALSE,
    note TEXT DEFAULT ''
);

-- 4. Weekly Scores Table
CREATE TABLE weekly_scores (
    member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
    activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (member_id, activity_id)
);

-- 5. Reprimands Table
CREATE TABLE reprimands (
    member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    verbal INTEGER NOT NULL DEFAULT 0,
    strict INTEGER NOT NULL DEFAULT 0
);

-- 6. Questions Table
CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    q TEXT NOT NULL,
    a TEXT NOT NULL
);

-- 7. Meetings Table
CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT DEFAULT '',
    reprimands_issued BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL
);

-- 8. Meeting Attendance Table
CREATE TABLE meeting_attendance (
    meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT DEFAULT '',
    PRIMARY KEY (meeting_id, member_id)
);

-- 9. Weekly History Table
CREATE TABLE weekly_history (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    week_num INTEGER NOT NULL
);

-- 10. Weekly History Scores Table
CREATE TABLE weekly_history_scores (
    history_id TEXT REFERENCES weekly_history(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (history_id, member_id, activity_id)
);

-- 11. Monthly Log Table
CREATE TABLE monthly_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    data JSONB NOT NULL
);

-- 12. Settings Table
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

-- 13. Call Candidates Table
CREATE TABLE call_candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    game_id TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

-- 14. Call Scores Table
CREATE TABLE call_scores (
    candidate_id TEXT REFERENCES call_candidates(id) ON DELETE CASCADE,
    question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
    score NUMERIC(3, 1) NOT NULL,
    PRIMARY KEY (candidate_id, question_id)
);

-- 15. Reports Table
CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    week_key TEXT NOT NULL,
    week_label TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    game_id TEXT NOT NULL,
    status TEXT NOT NULL,
    total_pts INTEGER NOT NULL,
    mod_note TEXT DEFAULT '',
    reviewed_at TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- 16. Report Aspects Table
CREATE TABLE report_aspects (
    id SERIAL PRIMARY KEY,
    report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,
    act_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    points INTEGER NOT NULL,
    count INTEGER NOT NULL,
    total_pts INTEGER NOT NULL
);

-- 17. Report Aspect Links Table
CREATE TABLE report_aspect_links (
    id SERIAL PRIMARY KEY,
    aspect_id INTEGER REFERENCES report_aspects(id) ON DELETE CASCADE,
    link TEXT NOT NULL
);

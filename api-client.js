'use strict';

const ROLE_LABELS = {
  verification: 'На верификации',
  pai_employee: 'Сотрудник PAI',
  pai_senior: 'Старший состав PAI',
  admin: 'Администратор сайта',
};

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function getMe() {
  try {
    const data = await apiFetch('/api/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

async function requireAuth(redirectTo = '/login') {
  const user = await getMe();
  if (!user) {
    window.location.href = redirectTo + '?next=' + encodeURIComponent(window.location.pathname);
    return null;
  }
  return user;
}

function isAdmin(role) { return role === 'admin'; }
function isSenior(role) { return role === 'pai_senior' || role === 'admin'; }
function isEmployee(role) { return role === 'pai_employee' || isSenior(role); }
function isVerified(role) { return role !== 'verification'; }

function formatUserName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || user.username;
}

function isoDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayOf(d) {
  const r = new Date(d);
  const day = r.getDay() || 7;
  r.setDate(r.getDate() - day + 1);
  r.setHours(12, 0, 0, 0);
  return r;
}

function getWeekKey(date = new Date()) {
  return isoDateLocal(getMondayOf(date));
}

window.PAI_API = {
  apiFetch, getMe, requireAuth,
  isAdmin, isSenior, isEmployee, isVerified,
  formatUserName, ROLE_LABELS,
  isoDateLocal, getMondayOf, getWeekKey,
};

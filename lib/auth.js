import { isAdmin, isSenior, isEmployee, isVerified } from './roles.js';
import { verifySessionToken, SESSION_COOKIE } from './session.js';

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function authenticateRequest(req, pool) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  const claim = verifySessionToken(token);
  if (!claim) return null;

  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
    [claim.userId]
  );
  return result.rows[0] || null;
}

export function requireAuth(handler) {
  return async (req, res) => {
    const user = await authenticateRequest(req, req.app.locals.pool);
    if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
    req.user = user;
    return handler(req, res);
  };
}

export function requireRole(check, handler) {
  return requireAuth(async (req, res) => {
    if (!check(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    return handler(req, res);
  });
}

export const requireVerified = (handler) => requireRole(isVerified, handler);
export const requireEmployee = (handler) => requireRole(isEmployee, handler);
export const requireSenior = (handler) => requireRole(isSenior, handler);
export const requireAdmin = (handler) => requireRole(isAdmin, handler);

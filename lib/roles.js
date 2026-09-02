export const USER_ROLES = [
  'verification',
  'pai_employee',
  'pai_senior',
  'admin',
];

export const ROLE_LABELS = {
  verification: 'На верификации',
  pai_employee: 'Сотрудник PAI',
  pai_senior: 'Старший состав PAI',
  admin: 'Администратор сайта',
};

export function isAdmin(role) {
  return role === 'admin';
}

export function isSenior(role) {
  return role === 'pai_senior' || role === 'admin';
}

export function isEmployee(role) {
  return role === 'pai_employee' || isSenior(role);
}

export function isVerified(role) {
  return role !== 'verification';
}

export function canAssignRole(actorRole, targetRole) {
  if (actorRole === 'admin') return true;
  if (actorRole === 'pai_senior') {
    return targetRole === 'verification' || targetRole === 'pai_employee' || targetRole === 'pai_senior';
  }
  return false;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    gameId: user.game_id,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at,
  };
}

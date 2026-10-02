export function companyUserAuditFields(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const userId = String(value.id || '').trim();
    const userName = String(value.name || '').trim();
    const userEmail = String(value.email || '').trim().toLowerCase();
    return {
      user: userName || userEmail || userId,
      userId,
      userName,
      userEmail
    };
  }

  const legacyUser = String(value || '').trim();
  return {
    user: legacyUser,
    userId: '',
    userName: legacyUser,
    userEmail: ''
  };
}

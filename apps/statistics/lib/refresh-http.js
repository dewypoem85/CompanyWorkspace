// Both legacy URLs use this boundary. A 202 confirms queue acceptance, not a
// completed dataset; authorization remains separate from queue confirmation.
export async function respondToRefresh({ user, force, requestRefresh, respond }) {
  if (force && !user.isAdmin) return respond(403, { error: '관리자만 1시간 제한을 무시하고 강제 갱신할 수 있습니다.' });
  try {
    const publication = await requestRefresh({ force, enforceCooldown: true });
    return respond(202, { ok: true, acceptance: 'accepted', publication });
  } catch (error) {
    if (error?.statusCode === 429) return respond(429, { error: error.message, retryAt: error.retryAt, canForce: user.isAdmin });
    throw error;
  }
}

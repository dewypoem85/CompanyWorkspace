const hasCompanySso = String(process.env.COMPANY_SSO_SHARED_SECRET || '').trim().length >= 32;
if (hasCompanySso) await import('./company-gateway.js');
else if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에서는 COMPANY_SSO_SHARED_SECRET 설정이 필요합니다.');
else await import('./app-server.js');

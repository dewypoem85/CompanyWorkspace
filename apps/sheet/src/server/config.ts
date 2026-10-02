import 'dotenv/config';
import process from 'node:process';

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

const companyPortalUrl = (process.env.COMPANY_PORTAL_URL ?? '').trim().replace(/\/$/, '');
const companySsoSecret = (process.env.COMPANY_SSO_SHARED_SECRET ?? '').trim();
const companySsoRequired = parseBoolean(process.env.COMPANY_SSO_REQUIRED);
const companySsoEnabled = Boolean(companyPortalUrl && companySsoSecret.length >= 32);

if (companySsoRequired && !companySsoEnabled) {
  throw new Error(
    'COMPANY_SSO_REQUIRED=true 환경에는 COMPANY_PORTAL_URL과 32자 이상의 COMPANY_SSO_SHARED_SECRET이 필요합니다.',
  );
}

export const config = {
  port: Number(process.env.PORT ?? 4173),
  defaultSpreadsheetId:
    process.env.TEST_SPREADSHEET_ID ?? '10ryam8K5qbNZ7EFjW1YjvOEzGbEf9uh5dR36daNQuog',
  allowWrites: process.env.ALLOW_SHEET_WRITES === 'true',
  hasGoogleCredentials: Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ),
  companySso: {
    required: companySsoRequired,
    enabled: companySsoEnabled,
    portalUrl: companyPortalUrl,
    issuer: (process.env.COMPANY_SSO_ISSUER ?? 'company-portal').trim(),
    sharedSecret: companySsoSecret,
    sessionMinutes: parseInteger(process.env.SHEET_SESSION_MINUTES, 10080, 5, 10080),
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE),
    trustProxy: parseBoolean(process.env.TRUST_PROXY),
  },
};

export const spreadsheetUrl = (spreadsheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

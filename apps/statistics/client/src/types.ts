export type Publication = {
  revision: string; status: string; inProgress: boolean; startedAt: string | null;
  completedAt: string | null; dataThrough: string | null; processedBlobs: number;
  processedEvents: number; currentProfile: string; error: string;
};

export type Filters = {
  from: string; to: string; version: string; mode: string;
  minModeLevel: string; afterFirstMiddleBoss: boolean;
};

export type Meta = {
  publication: Publication;
  range: { from: string | null; to: string | null };
  versions: Array<{ value: string; family: string; runs: number }>;
  modes: Array<{ value: string; runs: number; minLevel: number | null; maxLevel: number | null }>;
  generatedAt: string;
  uniquePlayersApproximate: boolean;
  retentionDays: number;
  currentUser?: { id: string; name: string; role: string; isAdmin: boolean };
};

export type Distribution = { sampleSize: number; medianMs: number | null; p90Ms: number | null };
export type BuildItem = Record<string, unknown> & {
  key: string; name: string; runs: number; clears: number; uniquePlayers: number;
  selectionRate: number; clearRate: number; playTime: Distribution;
  id?: string | number; characterId?: string | number; characterName?: string;
};
export type BossItem = Record<string, unknown> & {
  key: string; name: string; rank: string; encounterCount: number; killCount: number;
  matchedKills: number; uniquePlayers: number; encounterClearRate: number; fightDuration: Distribution;
};

export type Envelope = {
  revision: string; publishedAt: string | null; dataThrough: string | null;
  publication: Publication; uniquePlayersApproximate: boolean; filter: Filters;
};

export type DashboardResponse = Envelope & {
  summary: { activePlayers: number; totalRuns: number; clears: number; deaths: number; fails: number; completionRate: number; deathRate: number; playTime: Distribution };
  trend: Array<{ date: string; runs: number; clears: number; deaths: number; players: number }>;
  outcomes: Array<{ key: string; label: string; count: number; rate: number }>;
  topBuilds: BuildItem[]; topBosses: BossItem[];
};

export type ListResponse<T> = Envelope & {
  page: number; pageSize: number; total: number; sort: { key: string; direction: 'asc' | 'desc' }; items: T[];
};

export type UserMetricItem = Record<string, unknown> & {
  key: string; name: string; uniqueUsers: number; usageRate: number;
};

export type UserMetricsResponse = Envelope & {
  accountLinkedOnly: true;
  summary: { uniqueUsers: number; runs: number; oneRunUsers: number; oneRunRate: number; averageRuns: number; unknownChapterUsers: number };
  usage: Record<string, UserMetricItem[]>;
  chapters: Array<{ chapter: number; reachedUsers: number; reachRate: number }>;
  levels: Array<{ level: number; reachedUsers: number; retiredUsers: number; reachRate: number; retireRate: number }>;
  firstPlay: Array<{ bucket: string; users: number; oneRunUsers: number; exitRate: number }>;
  definitions: { uniqueUser: string; usageRate: string; chapter: string; retirement: string; firstPlay: string };
};

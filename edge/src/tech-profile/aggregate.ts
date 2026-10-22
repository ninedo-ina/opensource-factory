/**
 * 个人技术画像聚合（M9-01）。
 *
 * 输入：当前用户 D1 `my_repositories` 行、分类名与 `repo_tags` 标签行。
 * 输出：语言 / 框架分布、收藏与仓库活跃度、近 N 月收藏趋势、Top 收藏与确定性洞察。
 *
 * 口径：
 * - 语言与框架识别复用 M6-04 `tech-stack/aggregate.ts`，保证与「技术栈图谱」数字一致；
 * - 收藏趋势按 `created_at` 的 UTC 月份聚合（D1 入库时间，非 GitHub starred_at）；
 * - 活跃仓库 = `pushed_at` 距生成时间 ≤ 90 天；沉寂仓库 = > 180 天且未归档；
 * - 活跃度分 = 活跃仓库占比 × 50% + 近 90 天新增收藏占比 × 30% +
 *   近 6 个月有新增收藏的月份占比 × 20%，结果取整 0–100；
 * - 所有聚合均为纯函数，不访问 D1 / 网络，便于单测与后续复用。
 */
import { FRAMEWORK_CATALOG } from '../tech-stack/catalog.ts';
import {
  matchFrameworks,
  normalizeLanguage,
} from '../tech-stack/aggregate.ts';

export interface TechProfileRepoRow {
  id: string;
  name: string;
  language: string | null;
  stars: number | null;
  forks: number | null;
  description: string | null;
  readme_summary: string | null;
  created_at: string | null;
  pushed_at: string | null;
  health_status: string | null;
  category_id: string | null;
  category_name?: string | null;
  archived?: number | null;
  html_url?: string | null;
}

export interface TechProfileTagRow {
  repo_id: string;
  name: string;
}

export type ActivityLevel = 'high' | 'medium' | 'low';
export type ProfileType =
  | '多语言探索者'
  | '单栈深耕者'
  | '全栈实践者'
  | '均衡开发者';
export type PushBucketKey =
  | '7d'
  | '30d'
  | '90d'
  | '180d'
  | '365d'
  | 'older'
  | 'unknown';
export type TechProfileInsightKind =
  | 'language'
  | 'framework'
  | 'activity'
  | 'rhythm'
  | 'diversity'
  | 'empty';

export interface TechProfileLanguage {
  name: string;
  repoCount: number;
  starCount: number;
  share: number;
  avgStars: number;
}

export interface TechProfileFramework {
  name: string;
  category: string;
  repoCount: number;
  starCount: number;
  share: number;
  languages: string[];
}

export interface TechProfileCategory {
  name: string;
  repoCount: number;
  share: number;
}

export interface TechProfileMonthPoint {
  month: string;
  added: number;
  cumulative: number;
}

export interface TechProfilePushBucket {
  key: PushBucketKey;
  label: string;
  repoCount: number;
  share: number;
}

export interface TechProfileTopRepo {
  id: string;
  name: string;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string | null;
  healthStatus: string | null;
}

export interface TechProfileInsight {
  kind: TechProfileInsightKind;
  title: string;
  description: string;
}

export interface TechProfileSummary {
  totalRepos: number;
  totalStars: number;
  totalForks: number;
  languageCount: number;
  frameworkCount: number;
  categoryCount: number;
  withLanguage: number;
  withFramework: number;
  activeRepos: number;
  staleRepos: number;
  archivedRepos: number;
  activeRatio: number;
  activityScore: number;
  activityLevel: ActivityLevel;
  profileType: ProfileType;
  topLanguage: string | null;
  topFramework: string | null;
}

export interface TechProfileActivity {
  periodMonths: number;
  months: TechProfileMonthPoint[];
  recent: {
    last7d: number;
    last30d: number;
    last90d: number;
    last365d: number;
  };
  pushBuckets: TechProfilePushBucket[];
  activeRatio: number;
  peakMonth: { month: string; added: number } | null;
  streakMonths: number;
  firstCollectedAt: string | null;
  latestCollectedAt: string | null;
}

export interface TechProfileResponse {
  summary: TechProfileSummary;
  languages: TechProfileLanguage[];
  frameworks: TechProfileFramework[];
  categories: TechProfileCategory[];
  activity: TechProfileActivity;
  topRepos: TechProfileTopRepo[];
  insights: TechProfileInsight[];
  generatedAt: string;
}

export interface BuildTechProfileOptions {
  months?: number;
  topRepos?: number;
  now?: Date;
}

const DAY_MS = 86400000;
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 24;

const FRAMEWORK_CATEGORY = new Map<string, string>();
const FRAMEWORK_ORDER = new Map<string, number>();
FRAMEWORK_CATALOG.forEach((spec, index) => {
  FRAMEWORK_CATEGORY.set(spec.name, spec.category);
  FRAMEWORK_ORDER.set(spec.name, index);
});

const PUSH_BUCKETS: Array<{ key: PushBucketKey; label: string; maxDays: number }> = [
  { key: '7d', label: '7 天内', maxDays: 7 },
  { key: '30d', label: '30 天内', maxDays: 30 },
  { key: '90d', label: '90 天内', maxDays: 90 },
  { key: '180d', label: '180 天内', maxDays: 180 },
  { key: '365d', label: '一年内', maxDays: 365 },
  { key: 'older', label: '一年以上', maxDays: Number.POSITIVE_INFINITY },
];

function num(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return round1((part / total) * 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 解析 D1 / ISO 时间；D1 的 `YYYY-MM-DD HH:MM:SS` 按 UTC 处理 */
export function parseProfileDate(
  value: string | null | undefined
): Date | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** UTC 月份键：YYYY-MM */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 月份键平移（delta 可为负） */
export function shiftMonth(month: string, delta: number): string {
  const parts = month.split('-');
  const year = Number(parts[0] ?? 0);
  const monthIndex = Number(parts[1] ?? 1) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return monthKey(date);
}

function recentMonthKeys(months: number, now: Date): string[] {
  const current = monthKey(now);
  const keys: string[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    keys.push(shiftMonth(current, -offset));
  }
  return keys;
}

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

interface LanguageAcc {
  name: string;
  repoCount: number;
  starCount: number;
}

interface FrameworkAcc {
  name: string;
  repoCount: number;
  starCount: number;
  languages: Set<string>;
}

/**
 * 聚合个人技术画像。
 *
 * 纯函数，不访问 D1 / 网络；`now` 仅用于计算活跃度与固定 `generatedAt`。
 */
export function buildTechProfile(
  repos: readonly TechProfileRepoRow[],
  tagRows: readonly TechProfileTagRow[] = [],
  options: BuildTechProfileOptions = {}
): TechProfileResponse {
  const now = options.now ?? new Date();
  const months = clamp(
    Math.trunc(options.months ?? DEFAULT_MONTHS),
    1,
    MAX_MONTHS
  );
  const topRepoLimit = Math.max(1, options.topRepos ?? 5);
  const totalRepos = repos.length;

  const tagsByRepo = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByRepo.get(row.repo_id);
    if (list) list.push(row.name);
    else tagsByRepo.set(row.repo_id, [row.name]);
  }

  const languageAgg = new Map<string, LanguageAcc>();
  const frameworkAgg = new Map<string, FrameworkAcc>();
  const categoryAgg = new Map<string, number>();
  const createdMonths = new Map<string, number>();

  let totalStars = 0;
  let totalForks = 0;
  let withLanguage = 0;
  let withFramework = 0;
  let activeRepos = 0;
  let staleRepos = 0;
  let archivedRepos = 0;
  let withPush = 0;
  let firstCollected: Date | null = null;
  let latestCollected: Date | null = null;
  const recent = { last7d: 0, last30d: 0, last90d: 0, last365d: 0 };
  const pushCounts = new Map<PushBucketKey, number>();
  for (const bucket of PUSH_BUCKETS) pushCounts.set(bucket.key, 0);
  pushCounts.set('unknown', 0);

  for (const repo of repos) {
    const stars = num(repo.stars);
    totalStars += stars;
    totalForks += num(repo.forks);

    const language = normalizeLanguage(repo.language);
    if (language) {
      withLanguage += 1;
      const acc = languageAgg.get(language);
      if (acc) {
        acc.repoCount += 1;
        acc.starCount += stars;
      } else {
        languageAgg.set(language, {
          name: language,
          repoCount: 1,
          starCount: stars,
        });
      }
    }

    const frameworks = matchFrameworks(
      repo,
      tagsByRepo.get(repo.id) ?? []
    );
    if (frameworks.length > 0) withFramework += 1;
    for (const name of frameworks) {
      const acc = frameworkAgg.get(name);
      if (acc) {
        acc.repoCount += 1;
        acc.starCount += stars;
        if (language) acc.languages.add(language);
      } else {
        frameworkAgg.set(name, {
          name,
          repoCount: 1,
          starCount: stars,
          languages: new Set(language ? [language] : []),
        });
      }
    }

    const category = (repo.category_name ?? '').trim() || '未分类';
    categoryAgg.set(category, (categoryAgg.get(category) ?? 0) + 1);

    const created = parseProfileDate(repo.created_at);
    if (created) {
      const age = daysSince(created, now);
      if (age >= 0) {
        if (age <= 7) recent.last7d += 1;
        if (age <= 30) recent.last30d += 1;
        if (age <= 90) recent.last90d += 1;
        if (age <= 365) recent.last365d += 1;
      }
      const key = monthKey(created);
      createdMonths.set(key, (createdMonths.get(key) ?? 0) + 1);
      if (!firstCollected || created < firstCollected) firstCollected = created;
      if (!latestCollected || created > latestCollected) latestCollected = created;
    }

    if (num(repo.archived) > 0) {
      archivedRepos += 1;
    }

    const pushed = parseProfileDate(repo.pushed_at);
    if (pushed) {
      withPush += 1;
      const age = daysSince(pushed, now);
      if (age <= 90) activeRepos += 1;
      if (age > 180 && num(repo.archived) === 0) staleRepos += 1;
      const bucket = PUSH_BUCKETS.find((item) => age <= item.maxDays);
      const key = bucket?.key ?? 'older';
      pushCounts.set(key, (pushCounts.get(key) ?? 0) + 1);
    } else {
      pushCounts.set('unknown', (pushCounts.get('unknown') ?? 0) + 1);
    }
  }

  const languages: TechProfileLanguage[] = [...languageAgg.values()]
    .map((acc) => ({
      name: acc.name,
      repoCount: acc.repoCount,
      starCount: acc.starCount,
      share: percent(acc.repoCount, totalRepos),
      avgStars: acc.repoCount > 0 ? round1(acc.starCount / acc.repoCount) : 0,
    }))
    .sort(
      (a, b) =>
        b.repoCount - a.repoCount ||
        b.starCount - a.starCount ||
        a.name.localeCompare(b.name)
    );

  const frameworks: TechProfileFramework[] = [...frameworkAgg.values()]
    .map((acc) => ({
      name: acc.name,
      category: FRAMEWORK_CATEGORY.get(acc.name) ?? '其他',
      repoCount: acc.repoCount,
      starCount: acc.starCount,
      share: percent(acc.repoCount, totalRepos),
      languages: [...acc.languages].sort((a, b) => a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        b.repoCount - a.repoCount ||
        b.starCount - a.starCount ||
        (FRAMEWORK_ORDER.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
          (FRAMEWORK_ORDER.get(b.name) ?? Number.MAX_SAFE_INTEGER)
    );

  const categories: TechProfileCategory[] = [...categoryAgg.entries()]
    .map(([name, repoCount]) => ({
      name,
      repoCount,
      share: percent(repoCount, totalRepos),
    }))
    .sort(
      (a, b) => b.repoCount - a.repoCount || a.name.localeCompare(b.name)
    );

  const activeRatio = percent(activeRepos, withPush);
  const recentRatio = percent(recent.last90d, totalRepos);
  const lastSixMonths = recentMonthKeys(6, now);
  const consistencyMonths = lastSixMonths.filter(
    (month) => (createdMonths.get(month) ?? 0) > 0
  ).length;
  const consistency = percent(consistencyMonths, 6);
  const activityScore = clamp(
    Math.round(activeRatio * 0.5 + recentRatio * 0.3 + consistency * 0.2),
    0,
    100
  );
  const activityLevel: ActivityLevel =
    activityScore >= 70 ? 'high' : activityScore >= 40 ? 'medium' : 'low';

  const topLanguage = languages[0]?.name ?? null;
  const topFramework = frameworks[0]?.name ?? null;
  const topLanguageShare = languages[0]?.share ?? 0;
  const topFrameworkShare = frameworks[0]?.share ?? 0;

  let profileType: ProfileType;
  if (languages.length >= 6 && topLanguageShare < 40) {
    profileType = '多语言探索者';
  } else if (topLanguageShare >= 60) {
    profileType = '单栈深耕者';
  } else if (frameworks.length >= 6 && topFrameworkShare < 30) {
    profileType = '全栈实践者';
  } else {
    profileType = '均衡开发者';
  }

  const windowMonths = recentMonthKeys(months, now);
  const firstWindowMonth = windowMonths[0] ?? monthKey(now);
  let cumulative = 0;
  for (const [month, count] of createdMonths.entries()) {
    if (month < firstWindowMonth) cumulative += count;
  }
  const monthPoints: TechProfileMonthPoint[] = windowMonths.map((month) => {
    const added = createdMonths.get(month) ?? 0;
    cumulative += added;
    return { month, added, cumulative };
  });

  let peakMonth: { month: string; added: number } | null = null;
  for (const point of monthPoints) {
    if (point.added > 0 && (!peakMonth || point.added > peakMonth.added)) {
      peakMonth = { month: point.month, added: point.added };
    }
  }

  const currentMonth = monthKey(now);
  let streakStart = createdMonths.has(currentMonth)
    ? currentMonth
    : shiftMonth(currentMonth, -1);
  let streakMonths = 0;
  while (createdMonths.has(streakStart)) {
    streakMonths += 1;
    streakStart = shiftMonth(streakStart, -1);
  }

  const pushBuckets: TechProfilePushBucket[] = [
    ...PUSH_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      repoCount: pushCounts.get(bucket.key) ?? 0,
      share: percent(pushCounts.get(bucket.key) ?? 0, totalRepos),
    })),
    {
      key: 'unknown' as const,
      label: '未知',
      repoCount: pushCounts.get('unknown') ?? 0,
      share: percent(pushCounts.get('unknown') ?? 0, totalRepos),
    },
  ];

  const topRepos: TechProfileTopRepo[] = [...repos]
    .sort(
      (a, b) =>
        num(b.stars) - num(a.stars) ||
        num(b.forks) - num(a.forks) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, topRepoLimit)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      url: repo.html_url ?? `https://github.com/${repo.id}`,
      language: normalizeLanguage(repo.language),
      stars: num(repo.stars),
      forks: num(repo.forks),
      pushedAt: repo.pushed_at ?? null,
      healthStatus: repo.health_status ?? null,
    }));

  const insights: TechProfileInsight[] = [];
  if (totalRepos === 0) {
    insights.push({
      kind: 'empty',
      title: '还没有可分析的收藏',
      description:
        '先同步 GitHub Starred 或从热榜收藏项目，技术画像会在下次刷新时自动生成。',
    });
  } else {
    const topLang = languages[0];
    if (topLang) {
      const topThree = languages
        .slice(0, 3)
        .map((item) => `${item.name} ${item.repoCount}`)
        .join(' / ');
      insights.push({
        kind: 'language',
        title: `主力语言：${topLang.name}`,
        description: `${topLang.repoCount} 个仓库（${topLang.share}%）使用 ${topLang.name}，前三语言为 ${topThree}。`,
      });
    }

    const topFw = frameworks[0];
    if (topFw) {
      insights.push({
        kind: 'framework',
        title: `常用框架：${topFw.name}`,
        description: `${topFw.repoCount} 个仓库使用 ${topFw.name}（${topFw.category}），框架识别覆盖率 ${percent(withFramework, totalRepos)}%。`,
      });
    }

    if (activityLevel === 'high') {
      insights.push({
        kind: 'activity',
        title: '收藏与维护节奏活跃',
        description: `近 90 天有推送的仓库占 ${activeRatio}%，近 90 天新增收藏 ${recent.last90d} 个，活跃度分 ${activityScore}。`,
      });
    } else if (activityLevel === 'medium') {
      insights.push({
        kind: 'activity',
        title: '活跃度平稳',
        description: `近 90 天有推送的仓库占 ${activeRatio}%，近 90 天新增收藏 ${recent.last90d} 个，可关注沉寂仓库的替代方案。`,
      });
    } else {
      insights.push({
        kind: 'activity',
        title: '活跃度偏低',
        description: `近 90 天有推送的仓库仅占 ${activeRatio}%，近 90 天新增收藏 ${recent.last90d} 个，建议从推荐或热榜补充新鲜项目。`,
      });
    }

    if (peakMonth) {
      insights.push({
        kind: 'rhythm',
        title: `收藏高峰：${peakMonth.month}`,
        description: `该月新增 ${peakMonth.added} 个收藏，已连续 ${streakMonths} 个月保持新增。`,
      });
    }

    insights.push({
      kind: 'diversity',
      title: `画像类型：${profileType}`,
      description: `共覆盖 ${languages.length} 种语言、${frameworks.length} 个框架、${categories.length} 个分类分组。`,
    });
  }

  return {
    summary: {
      totalRepos,
      totalStars,
      totalForks,
      languageCount: languages.length,
      frameworkCount: frameworks.length,
      categoryCount: categories.filter((item) => item.name !== '未分类').length,
      withLanguage,
      withFramework,
      activeRepos,
      staleRepos,
      archivedRepos,
      activeRatio,
      activityScore,
      activityLevel,
      profileType,
      topLanguage,
      topFramework,
    },
    languages,
    frameworks,
    categories,
    activity: {
      periodMonths: months,
      months: monthPoints,
      recent,
      pushBuckets,
      activeRatio,
      peakMonth,
      streakMonths,
      firstCollectedAt: firstCollected?.toISOString() ?? null,
      latestCollectedAt: latestCollected?.toISOString() ?? null,
    },
    topRepos,
    insights,
    generatedAt: now.toISOString(),
  };
}

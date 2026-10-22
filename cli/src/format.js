/**
 * 终端输出格式化：纯文本表格（无第三方依赖），支持中日韩宽字符对齐。
 */

/** 估算显示宽度：CJK / 全角字符按 2 列计算。 */
export function displayWidth(text) {
  const value = String(text ?? '');
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff);
    width += wide ? 2 : 1;
  }
  return width;
}

/** 按显示宽度截断，超出时以 … 结尾。 */
export function truncate(text, maxWidth) {
  const value = String(text ?? '');
  if (displayWidth(value) <= maxWidth) return value;
  let result = '';
  let width = 0;
  for (const char of value) {
    const next = width + displayWidth(char);
    if (next > maxWidth - 1) break;
    result += char;
    width = next;
  }
  return `${result}…`;
}

/** 右侧补空格到指定显示宽度。 */
export function padEndWidth(text, width) {
  const value = String(text ?? '');
  const gap = width - displayWidth(value);
  return gap > 0 ? `${value}${' '.repeat(gap)}` : value;
}

/**
 * 渲染表格。
 * @param {{title: string, key: string, max?: number, align?: 'left'|'right'}[]} columns
 * @param {Record<string, unknown>[]} rows
 */
export function renderTable(columns, rows) {
  const cells = rows.map((row) =>
    columns.map((column) => {
      const raw = row[column.key];
      const text = raw === null || raw === undefined ? '' : String(raw);
      return column.max ? truncate(text, column.max) : text;
    })
  );
  const widths = columns.map((column, index) => {
    const contentWidth = cells.reduce((max, row) => Math.max(max, displayWidth(row[index])), 0);
    return Math.max(displayWidth(column.title), Math.min(contentWidth, column.max ?? 40));
  });

  const formatRow = (row) =>
    row
      .map((cell, index) =>
        columns[index].align === 'right'
          ? `${' '.repeat(Math.max(0, widths[index] - displayWidth(cell)))}${cell}`
          : padEndWidth(cell, widths[index])
      )
      .join('  ')
      .replace(/\s+$/, '');

  const header = formatRow(columns.map((column) => column.title));
  const divider = widths.map((width) => '─'.repeat(width)).join('  ');
  return [header, divider, ...cells.map(formatRow)].join('\n');
}

export function formatRepoList(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) {
    return '还没有收藏任何仓库。用 `of add <owner/repo>` 收藏第一个。';
  }
  const table = renderTable(
    [
      { title: '仓库', key: 'fullName', max: 48 },
      { title: '语言', key: 'language', max: 14 },
      { title: 'Star', key: 'stars', max: 8, align: 'right' },
      { title: '分类', key: 'category', max: 16 },
      { title: '简介', key: 'description', max: 40 },
    ],
    items
  );
  const total = payload?.total ?? items.length;
  return `共 ${total} 个收藏（本页 ${items.length} 条）\n${table}`;
}

export function formatRepoDetail(repo) {
  const lines = [
    `${repo.fullName}`,
    `  地址：${repo.url ?? ''}`,
    `  语言：${repo.language ?? '—'}     Star：${repo.stars ?? 0}     Fork：${repo.forks ?? 0}`,
    `  分类：${repo.category ?? '—'}     标签：${(repo.tags ?? []).join(', ') || '—'}`,
    `  简介：${repo.description ?? '—'}`,
    `  摘要：${repo.summary ?? '—'}`,
    `  更新：${repo.updatedAt ?? '—'}`,
  ];
  return lines.join('\n');
}

export function formatTrending(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) return '暂无热榜数据。';
  const table = renderTable(
    [
      { title: '#', key: 'rank', max: 4, align: 'right' },
      { title: '仓库', key: 'fullName', max: 48 },
      { title: '语言', key: 'language', max: 14 },
      { title: '今日+', key: 'starsToday', max: 8, align: 'right' },
      { title: '总Star', key: 'stars', max: 10, align: 'right' },
    ],
    items
  );
  const date = payload?.date ? `（${payload.date}）` : '';
  return `今日热榜${date}\n${table}`;
}

export function formatRecommendations(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) return '暂无推荐。';
  const table = renderTable(
    [
      { title: '仓库', key: 'repoId', max: 48 },
      { title: '语言', key: 'language', max: 14 },
      { title: 'Star', key: 'stars', max: 8, align: 'right' },
      { title: '推荐理由', key: 'reason', max: 44 },
    ],
    items
  );
  return `推荐（${payload?.status ?? 'new'}）\n${table}`;
}

export function formatMe(payload) {
  const user = payload?.user ?? {};
  const token = payload?.token;
  const lines = [`已登录：${user.login ?? user.id ?? 'unknown'}${user.name ? `（${user.name}）` : ''}`];
  if (token) {
    lines.push(`令牌：${token.hint}    权限：${(token.scopes ?? []).join(', ')}`);
    lines.push(`创建：${token.createdAt ?? '—'}    最近使用：${token.lastUsedAt ?? '—'}`);
  } else {
    lines.push('当前使用浏览器会话（未使用个人令牌）。');
  }
  return lines.join('\n');
}

export function printJson(out, data) {
  out(JSON.stringify(data, null, 2));
}

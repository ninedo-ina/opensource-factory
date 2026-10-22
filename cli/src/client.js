/**
 * 零依赖 HTTP 客户端：只封装 fetch + Bearer 令牌 + 统一错误。
 */
import { normalizeApiUrl } from './config.js';

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, body?: unknown}} [detail]
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = detail.status ?? 0;
    this.body = detail.body;
  }
}

/** @param {Record<string, unknown>|undefined} query */
export function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export class ApiClient {
  /**
   * @param {{baseUrl: string, token?: string, fetchImpl?: typeof fetch}} options
   */
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch }) {
    this.baseUrl = normalizeApiUrl(baseUrl);
    this.token = token ?? '';
    this.fetchImpl = fetchImpl;
  }

  /**
   * @param {string} path 以 `/api/v1` 开头
   * @param {{method?: string, query?: Record<string, unknown>, body?: unknown}} [options]
   */
  async request(path, options = {}) {
    const { method = 'GET', query, body } = options;
    const url = `${this.baseUrl}${path}${buildQuery(query)}`;
    const headers = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(`无法连接 ${this.baseUrl}：${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const detail = data && typeof data === 'object' ? data : {};
      const message =
        (typeof detail.message === 'string' && detail.message) ||
        (typeof detail.error === 'string' && detail.error) ||
        `HTTP ${response.status}`;
      throw new ApiError(message, { status: response.status, body: data });
    }
    return data;
  }

  get(path, query) {
    return this.request(path, { query });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}

/** 构造客户端；未配置地址时给出可读错误。 */
export function createClient({ baseUrl, token, fetchImpl } = {}) {
  const url = normalizeApiUrl(baseUrl ?? '');
  if (!url) throw new ApiError('未配置 API 地址，请先运行 `of config set url https://api.example.com`');
  return new ApiClient({ baseUrl: url, token, fetchImpl });
}

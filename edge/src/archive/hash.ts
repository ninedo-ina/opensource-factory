/**
 * SHA-256 摘要工具（归档校验和）。
 *
 * 使用 Web Crypto，Workers 与 Node 18+ 均原生支持，不引入第三方依赖。
 */

const encoder = new TextEncoder();

/** 返回小写十六进制 SHA-256。 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

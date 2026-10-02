export type TextPart = { text: string; href?: string };

// Keep sentence punctuation outside links, but retain balanced URL parentheses.
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []; let end = 0;
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    let label = match[0].replace(/[.,!?;:。，！？、]+$/, '');
    while (/[)\]}]$/.test(label)) {
      const close = label.at(-1)!; const open = { ')': '(', ']': '[', '}': '{' }[close]!;
      if (label.split(close).length <= label.split(open).length) break;
      label = label.slice(0, -1).replace(/[.,!?;:。，！？、]+$/, '');
    }
    if (match.index! > end) parts.push({ text: text.slice(end, match.index) });
    let href: string | undefined;
    try { const url = new URL(/^www\./i.test(label) ? `https://${label}` : label); if (['http:', 'https:'].includes(url.protocol) && label.length <= 4096) href = url.href; } catch { /* Invalid URLs stay plain text. */ }
    parts.push({ text: label, href }); end = match.index! + label.length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}

export function taskLink(href: string, origin: string) {
  try {
    const url = new URL(href);
    if (url.username || url.password || ![origin, 'https://schedule.example.com'].includes(url.origin)) return null;
    const match = /^\/tasks\/([1-9]\d*)\/?$/.exec(url.pathname);
    if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
    const comment = /^#comment-([1-9]\d*)$/.exec(url.hash);
    const commentId = comment && Number.isSafeInteger(Number(comment[1])) ? Number(comment[1]) : undefined;
    return { id: Number(match[1]), commentId, href: `/tasks/${match[1]}${commentId ? `#comment-${commentId}` : ''}` };
  } catch { return null; }
}

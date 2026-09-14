export function conversationTimeLabel(time: number, now = Date.now()) {
  const date = new Date(time), today = new Date(now);
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const prefix = day(date) === day(today) ? '今天' : day(date) === day(yesterday) ? '昨天' : `${date.getFullYear() === today.getFullYear() ? '' : date.getFullYear() + '年'}${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function needsConversationTime(time: number | undefined, previous?: number) {
  if (!time || !Number.isFinite(time)) return false;
  return !previous || time - previous >= 5 * 60_000 || new Date(time).toDateString() !== new Date(previous).toDateString();
}
// Only record a timestamp when this browser actually sends/receives a new
// message. Never assign today's time to imported historical messages.
export function messageTime(canvas: string, id: string, create = false): number | undefined {
  try {
    const key = 'heiyan:message-time:' + encodeURIComponent(canvas);
    const values = JSON.parse(localStorage.getItem(key) || '{}');
    if (Number.isFinite(values[id]) && values[id] > 0) return values[id];
    if (!create) return undefined;
    const time = Date.now(); values[id] = time;
    const entries = Object.entries(values).slice(-2000);
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    return time;
  } catch { return create ? Date.now() : undefined; }
}

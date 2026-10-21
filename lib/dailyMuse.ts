/** Everyone gets the same daily rhythm, resetting at midnight in Lagos. */
export function museDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const ordinal = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  return { day, ordinal, nextAt: new Date(Date.parse(`${day}T00:00:00+01:00`) + 86400000).toISOString() };
}
const prompts = [
  { theme: "A color worth keeping", prompt: "Find one color you would bring into your own space." },
  { theme: "Look a little closer", prompt: "Notice a small detail you missed at first glance." },
  { theme: "A feeling in a frame", prompt: "What is the first feeling this work brings to mind?" },
  { theme: "Follow the lines", prompt: "Let your eyes follow one line from beginning to end." },
  { theme: "The story outside the frame", prompt: "Imagine what might be happening just beyond the edges." },
  { theme: "Something unexpected", prompt: "Find the part you would not have thought to create yourself." },
  { theme: "Make room for wonder", prompt: "Take a quiet moment with this work. What stays with you?" },
];
export function musePrompt(ordinal: number) { return prompts[((ordinal % prompts.length) + prompts.length) % prompts.length]; }
export function museIndex(ordinal: number, count: number) { return count > 0 ? ((ordinal % count) + count) % count : 0; }
export type MusePage = { day: string; items: string[] };
const validDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
/** Local notebook: no wallet, identity, purchase, or consecutive-day requirement. */
export function readMuseNotebook(value: unknown): MusePage[] {
  if (!Array.isArray(value)) return [];
  const pages = new Map<string, Set<string>>();
  for (const entry of value.slice(-732)) {
    if (!entry || !validDay(entry.day) || !Array.isArray(entry.items)) continue;
    const items = entry.items.filter((id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 2);
    if (items.length) pages.set(entry.day, new Set([...(Array.from(pages.get(entry.day) || [])), ...items]));
  }
  return Array.from(pages, ([day, items]) => ({ day, items: Array.from(items).slice(0, 2) })).sort((a, b) => a.day.localeCompare(b.day)).slice(-366);
}
export function stampMuse(pages: MusePage[], day: string, itemId: string): MusePage[] {
  return readMuseNotebook([...pages, { day, items: [itemId] }]);
}
export type DailyMuseData = { day: string; nextAt: string; theme: string; prompt: string; items: { id: string; itemType: "NFT" | "WEB2_ART"; title: string; imageUrl: string | null; creator: { id: string; username: string | null; walletAddress: string | null } }[] };

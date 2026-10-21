// api/member-week.js — 원스동 멤버의 주간 방송 일정 (팬 공개, 안전 필드만)
// ───────────────────────────────────────────────────────────────────────────
// GET /api/member-week?id=<멤버 page id>&start=YYYY-MM-DD  →  { name, color, start, days: [{ date, items: [...] }] }
//
// 보안(타협 불가):
//   - 멤버 명단은 서버 환경변수 NOTION_READONLY_TOKEN 으로만 읽는다.
//   - 그 멤버의 '노션토큰'·'일정DB'는 서버 안에서만 쓰고 응답에 절대 담지 않는다.
//   - '승인 = true' 멤버만. 노션토큰·일정DB가 비어 있으면 404 (노션 연동 안 한 멤버).
//   - 응답 항목: 날짜·시각·컨텐츠(제목)·게임 이름·회차·태그·합방 여부만.
// proxy.py 의 _handle_member_week 와 같은 JSON 을 낸다.

const NOTION_VERSION = '2022-06-28';
const MEMBERS_DB = (process.env.NOTION_MEMBERS_DB || '3b756ebfd5754e1f8308310b50330806').replace(/-/g, '');
const BASE = (process.env.NOTION_API_BASE || 'https://api.notion.com').replace(/\/$/, '');

function txt(p) {
  if (!p) return '';
  if (p.type === 'title') return (p.title || []).map((t) => t.plain_text || '').join('').trim();
  if (p.type === 'rich_text') return (p.rich_text || []).map((t) => t.plain_text || '').join('').trim();
  if (p.type === 'url') return (p.url || '').trim();
  return '';
}

function dbId(v) {
  const m = String(v || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}

async function notion(token, method, path, body) {
  const r = await fetch(`${BASE}/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 방송일정 한 줄 → 안전 항목 (subcal.html fetchBroadcast 와 같은 규칙: 방송·합방·특별 방송 태그만)
export function toItem(page) {
  const p = page.properties || {};
  const dateVal = ((p['날짜'] || p['일시'] || p['Date'] || {}).date || {}).start || '';
  if (!dateVal) return null;
  const tags = ((p['컨텐츠 종류'] || {}).multi_select || []).map((t) => t.name);
  if (tags.some((t) => t === '업데이트' || t === '픽업')) return null;
  if (!tags.some((t) => t.startsWith('방송') || t === '합방' || t === '특별 방송')) return null;
  const titleProp = p['컨텐츠'] || p['이름'] || p['제목'] || p['Name'] || {};
  const title = (titleProp.title || titleProp.rich_text || []).map((t) => t.plain_text || '').join('').trim();
  const ep = (p['컨텐츠 회차'] || p['회차'] || {}).number;
  return {
    date: dateVal.slice(0, 10),
    time: dateVal.includes('T') ? dateVal.slice(11, 16) : '',
    title,
    gameIds: ((p['게임'] || {}).relation || []).map((r) => r.id),
    episode: typeof ep === 'number' ? ep : null,
    tags,
    collab: tags.some((t) => t.includes('합방')),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const token = process.env.NOTION_READONLY_TOKEN;
  if (!token) return res.status(503).json({ error: 'NOTION_READONLY_TOKEN not configured on server' });
  const id = String(req.query.id || '').replace(/-/g, '');
  const start = String(req.query.start || '');
  if (!/^[0-9a-f]{32}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: 'id / start(YYYY-MM-DD) required' });
  }

  try {
    // 승인된 멤버 중 그 id (멤버 DB 안에서만 찾는다 — 다른 페이지 id로 우회 불가)
    const members = await notion(token, 'POST', `databases/${MEMBERS_DB}/query`,
      { filter: { property: '승인', checkbox: { equals: true } }, page_size: 100 });
    const page = (members.results || []).find((m) => String(m.id).replace(/-/g, '') === id.toLowerCase()
      || String(m.id).replace(/-/g, '') === id);
    if (!page) return res.status(404).json({ error: 'member not found' });
    const mp = page.properties || {};
    const mTok = txt(mp['노션토큰']);
    const mDb = dbId(txt(mp['일정DB']));
    if (!mTok || !mDb) return res.status(404).json({ error: 'schedule not linked' });

    const end = addDays(start, 6);
    const q = await notion(mTok, 'POST', `databases/${mDb}/query`, {
      filter: { and: [{ property: '날짜', date: { on_or_after: start } }, { property: '날짜', date: { on_or_before: end } }] },
      sorts: [{ property: '날짜', direction: 'ascending' }],
      page_size: 100,
    });
    const items = (q.results || []).map(toItem).filter(Boolean);
    // 게임 relation 이름 (멤버 토큰으로)
    const ids = [...new Set(items.flatMap((x) => x.gameIds))].slice(0, 30);
    const names = {};
    await Promise.all(ids.map(async (pid) => {
      try {
        const pg = await notion(mTok, 'GET', `pages/${pid}`);
        const t = Object.values(pg.properties || {}).find((v) => v.type === 'title');
        names[pid] = t ? txt(t) : '';
      } catch { names[pid] = ''; }
    }));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      days.push({
        date,
        items: items.filter((x) => x.date === date).map((x) => ({
          time: x.time, title: x.title, games: x.gameIds.map((g) => names[g]).filter(Boolean),
          episode: x.episode, tags: x.tags, collab: x.collab,
        })),
      });
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ name: txt(mp['이름']), color: txt(mp['멤버색상']), start, days });
  } catch (e) {
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ error: e.message || 'notion error' });
  }
}

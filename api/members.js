// api/members.js — 원스동 멤버 명단 (팬 공개용, 안전 필드만)
// ───────────────────────────────────────────────────────────────────────────
// 보안(타협 불가):
//   - 토큰은 서버 환경변수(NOTION_READONLY_TOKEN)에서만 사용.
//   - 응답에는 이름·치지직·유튜브·생일·소속반·멤버색상(+page id)만 포함.
//     '노션토큰'·'일정DB'·'문서DB' 칸은 응답에 절대 담지 않는다.
//   - '승인 = true' 멤버만 노출(Notion 서버 필터 + 이름 없는 빈 행 제거).
//   - 이 DB는 notion-public.js 공개 화이트리스트에 넣지 않는다(전용 엔드포인트).

const NOTION_VERSION = '2022-06-28';
const MEMBERS_DB = (process.env.NOTION_MEMBERS_DB || '3b756ebfd5754e1f8308310b50330806').replace(/-/g, '');

function txt(p) {
  if (!p) return '';
  if (p.type === 'title') return (p.title || []).map((t) => t.plain_text || '').join('').trim();
  if (p.type === 'rich_text') return (p.rich_text || []).map((t) => t.plain_text || '').join('').trim();
  return '';
}

// Notion 페이지 → 공개 안전 객체 (토큰/일정DB/문서DB는 의도적으로 누락)
function toSafe(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: txt(p['이름']),
    chzzk: txt(p['치지직']),
    youtube: [txt(p['유튜브1']), txt(p['유튜브2']), txt(p['유튜브3'])].filter(Boolean),
    birthday: (p['생일'] && p['생일'].date && p['생일'].date.start) || '',
    classes: ((p['소속반'] && p['소속반'].multi_select) || []).map((o) => o.name),
    color: txt(p['멤버색상']),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const token = process.env.NOTION_READONLY_TOKEN;
  if (!token) return res.status(503).json({ error: 'NOTION_READONLY_TOKEN not configured on server' });

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${MEMBERS_DB}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      // 승인 체크박스 true 인 멤버만 (빈 행=false 자동 제외)
      body: JSON.stringify({ filter: { property: '승인', checkbox: { equals: true } }, page_size: 100 }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: e.message || 'notion error' });
    }
    const data = await r.json();
    const members = (data.results || []).map(toSafe).filter((m) => m.name); // 이름 없는 행 제거
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(members);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

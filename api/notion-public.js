// api/notion-public.js — 팬 공개용 "읽기 전용" Notion 프록시
// ───────────────────────────────────────────────────────────────────────────
// 목적: 팬/시청자가 방송일정·문서 DB를 "읽기만" 할 수 있게 한다.
// 안전장치:
//   1) 토큰은 서버 환경변수(NOTION_READONLY_TOKEN)에서만 사용 → 브라우저에 노출 안 됨.
//      (이 토큰은 Notion에서 "Read content" 권한만 부여한 읽기 전용 Integration 토큰이어야 함)
//   2) GET 외 메서드(POST/PATCH/PUT/DELETE)는 전부 405로 거부 → 쓰기 불가.
//   3) 화이트리스트 DB(방송일정·문서)만 조회 가능, 그 외 db는 403.
//   4) 쿼리 바디를 서버가 구성(클라이언트 임의 바디 불허) → 임의 요청 차단.
// 쓰기(등록/동기화/setup)는 api/notion.js(관리자, 브라우저 토큰)에서만 처리한다.

const NOTION_VERSION = '2022-06-28';

// 대시 제거 + 소문자 정규화 (Notion ID 비교용)
const norm = (id) => (id || '').replace(/-/g, '').toLowerCase();

// 공개 읽기 허용 DB. 환경변수 NOTION_PUBLIC_DB_IDS(콤마 구분)로 덮어쓸 수 있고,
// 없으면 아래 기본값(방송일정 / 문서 DB) 사용.
const DEFAULT_DB_IDS = [
  '1de66cc1f1b581c7a69cc00da09d16c4', // 방송일정(스트리밍 달력)
  '20466cc1f1b58060b379eb16721bd1e4', // 문서 목록
];
function allowedDbSet() {
  const env = process.env.NOTION_PUBLIC_DB_IDS;
  const ids = env ? env.split(',') : DEFAULT_DB_IDS;
  return new Set(ids.map(norm).filter(Boolean));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // (2) 쓰기 차단: GET 외 전부 거부
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'read-only endpoint: GET only' });
  }

  // (1) 읽기 전용 토큰은 서버 환경변수에서만
  const token = process.env.NOTION_READONLY_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'NOTION_READONLY_TOKEN not configured on server' });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
  const { action = 'query', db, ids } = req.query;

  try {
    // ── relation 페이지 제목 일괄 조회 (읽기) ───────────────────────────────
    if (action === 'pages') {
      const list = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
      const out = {};
      await Promise.all(list.map(async (pid) => {
        try {
          const r = await fetch(`https://api.notion.com/v1/pages/${pid}`, { headers });
          const page = await r.json();
          const props = page.properties || {};
          let title = '';
          for (const v of Object.values(props)) {
            if (v.type === 'title') {
              title = (v.title || []).map((t) => t.plain_text || '').join('').trim();
              break;
            }
          }
          out[pid] = title || String(pid).slice(0, 8);
        } catch { out[pid] = '?'; }
      }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(out);
    }

    // ── DB 쿼리 (읽기) — (3) 화이트리스트 검사 ──────────────────────────────
    if (!db || !allowedDbSet().has(norm(db))) {
      return res.status(403).json({ error: 'db not allowed (public read is limited to whitelisted DBs)' });
    }
    // (4) 바디는 서버가 구성. Notion query는 POST지만, 읽기 전용 토큰이라 조회만 가능.
    const body = JSON.stringify({ page_size: 100 });
    const r = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: 'POST', headers, body,
    });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

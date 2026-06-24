// api/notion.js - Notion API 통합 프록시 (관리자 쓰기용)
// 지원: GET/POST/PATCH 모든 Notion API 경로
// 보안: 서버 환경변수 토큰을 쓰지 않고 "호출자가 보낸 Authorization 헤더"를 그대로 중계한다.
//       → 팬(토큰 없음)은 401. 브라우저 설정창에 본인 토큰을 넣은 관리자만 쓰기 가능.
//       팬 공개 읽기는 api/notion-public.js(읽기 전용·환경변수 토큰)에서 별도 처리.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Notion-Version');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = req.headers.authorization;
  const nv = req.headers['notion-version'] || '2022-06-28';
  if (!auth) return res.status(401).json({ error: 'Authorization required' });

  // path: URL의 /api/notion?path=pages/xxx 형태로 받음
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'path required' });

  const notionUrl = `https://api.notion.com/v1/${path}`;

  try {
    const fetchOpts = {
      method: req.method,
      headers: {
        'Authorization': auth,
        'Notion-Version': nv,
        'Content-Type': 'application/json',
      },
    };
    if (req.method !== 'GET') {
      // Vercel auto-parses JSON body; re-stringify for Notion API
      const bodyData = req.body || {};
      if (Object.keys(bodyData).length > 0) {
        fetchOpts.body = JSON.stringify(bodyData);
      }
    }

    const r = await fetch(notionUrl, fetchOpts);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

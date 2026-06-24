// api/notion-pages.js - 여러 페이지 제목 일괄 조회 (relation resolve용)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Notion-Version');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = req.headers.authorization;
  const nv = req.headers['notion-version'] || '2022-06-28';
  const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);

  if (!auth || !ids.length) return res.status(400).json({});

  const result = {};
  await Promise.all(ids.slice(0, 30).map(async (pid) => {
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${pid}`, {
        headers: { 'Authorization': auth, 'Notion-Version': nv }
      });
      const page = await r.json();
      const props = page.properties || {};
      let title = '';
      for (const v of Object.values(props)) {
        if (v.type === 'title') {
          title = (v.title || []).map(t => t.plain_text || '').join('').trim();
          if (title) break;
        }
      }
      result[pid] = title || pid.slice(0, 8);
    } catch { result[pid] = '?'; }
  }));

  res.setHeader('Cache-Control', 's-maxage=3600');
  return res.status(200).json(result);
}

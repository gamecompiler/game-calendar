// api/hoyo.js - HoYoLAB BBS API 프록시
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    return res.status(204).end();
  }

  const { url, ...rest } = req.query;
  if (!url || !url.startsWith('https://bbs-api-os.hoyolab.com')) {
    return res.status(400).json({ error: 'invalid url' });
  }

  const qs = new URLSearchParams(rest).toString();
  const finalUrl = qs ? `${url}?${qs}` : url;

  try {
    const r = await fetch(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.hoyolab.com/',
        'Origin': 'https://www.hoyolab.com',
      }
    });
    const data = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

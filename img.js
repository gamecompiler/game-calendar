// api/img.js - 게임 배너/아이콘 이미지 프록시
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).end();
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const ALLOWED = [
    'hoyoverse.com', 'hoyolab.com', 'hoyo.link',
    'i.ytimg.com', 'yt3.googleusercontent.com',
    'cdn.kurogames.com', 'tapimg.com', 'taptap.io',
    'play-lh.googleusercontent.com',
  ];
  const host = new URL(url).hostname;
  if (!ALLOWED.some(d => host.endsWith(d))) {
    return res.status(403).json({ error: 'domain not allowed' });
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.hoyolab.com/',
      }
    });
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(200).send(Buffer.from(buf));
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

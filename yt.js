// api/yt.js - YouTube RSS 파싱 + 채널 아이콘
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).end();
  }

  const { type, channel, chzzk } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── YouTube RSS ──────────────────────────────────────────────
  if (type === 'rss' && channel) {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml = await r.text();
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 's-maxage=1800');
      return res.status(200).send(xml);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── YouTube 채널 아이콘 ──────────────────────────────────────
  if (type === 'icon' && channel) {
    const HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    };
    for (const url of [
      `https://www.youtube.com/channel/${channel}`,
      `https://www.youtube.com/@${channel}`,
    ]) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        const html = await r.text();
        const patterns = [
          /"avatar":\{"thumbnails":\[{"url":"(https:\/\/yt3[^"]+)"/,
          /"url":"(https:\/\/yt3\.googleusercontent\.com\/ytc\/[^"]+)"/,
          /<meta property="og:image" content="(https:\/\/yt3[^"]+)"/,
        ];
        for (const pat of patterns) {
          const m = html.match(pat);
          if (m) {
            res.setHeader('Cache-Control', 's-maxage=86400');
            return res.json({ url: m[1] });
          }
        }
      } catch { /* try next */ }
    }
    return res.json({ url: '' });
  }

  // ── Chzzk 채널 아이콘 ────────────────────────────────────────
  if (type === 'chzzk' && chzzk) {
    try {
      const r = await fetch(
        `https://api.chzzk.naver.com/service/v1/channels/${chzzk}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://chzzk.naver.com/' } }
      );
      const d = await r.json();
      const iconUrl = d?.content?.channelImageUrl || '';
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.json({ url: iconUrl });
    } catch (e) {
      return res.json({ url: '' });
    }
  }

  return res.status(400).json({ error: 'type required (rss|icon|chzzk)' });
}

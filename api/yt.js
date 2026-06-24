// api/yt.js - YouTube RSS 파싱 + 채널 아이콘

// proxy.py _handle_yt_rss 의 KNOWN_IDS 와 동일 (별칭 → 실제 채널 ID)
const KNOWN_IDS = {
  honkaistarrail_kr: 'UCH33CJMcI0XZUpIhWRHiUuw',
  genshinimpact_kr:  'UCcum1rCJ5GJeQ_xv0xrohqg',
  zzz_ko:            'UCmry1hfaRHI_iTfxUMhC8mA',
  wutheringwaves:    'UCKuq0c-RXYaulECSuu5hFug',
  honkai3rdofficial: 'UCHnxdu0qphnV3vrERNtCqpw',
  hsr_kr:            'UCH33CJMcI0XZUpIhWRHiUuw',
};

function resolveChannelId(channel) {
  if (channel.startsWith('UC') && channel.length === 24) return channel;
  return KNOWN_IDS[channel.replace(/^@/, '').toLowerCase()] || channel;
}

// XML 엔티티 디코드 (RSS 제목용)
function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#3?9;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// YouTube RSS XML → [{title,url,date,thumb,isShort}] (proxy.py _handle_yt_rss 와 동일 출력)
function parseYtRss(xml) {
  const items = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let em;
  while ((em = entryRe.exec(xml)) !== null) {
    const entry = em[1];
    const vid = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
    const rawTitle = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const title = xmlUnescape(rawTitle).trim();
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const date = published ? published.slice(0, 10) : '';
    if (!(vid && title && date)) continue;
    const tl = title.toLowerCase();
    const isShort = tl.includes('#shorts') || tl.includes('short:') ||
                    tl.startsWith('shorts ') || tl.endsWith(' shorts');
    items.push({
      title,
      url: `https://youtu.be/${vid}`,
      date,
      thumb: `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
      isShort,
    });
  }
  return items;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).end();
  }

  const { type, channel, chzzk } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── YouTube RSS → JSON 배열 (HTML이 r.json() 으로 기대) ───────
  if (type === 'rss' && channel) {
    const realId = resolveChannelId(channel);
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${realId}`;
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
      });
      // 채널 RSS 없음(404) 등 → 빈 배열 (proxy.py 와 동일)
      if (!r.ok) return res.status(200).json([]);
      const xml = await r.text();
      const items = parseYtRss(xml);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
      return res.status(200).json(items);
    } catch (e) {
      // 실패 시에도 빈 배열로 (HTML 의 catch 부담 줄임, proxy.py 거동과 일치)
      return res.status(200).json([]);
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

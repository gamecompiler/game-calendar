// api/wuwa.js — 명조(Wuthering Waves) 공식 CDN 뉴스 수집
// Kuro Games 공식 런처 API 사용: prod-alicdn-gamestarter.kurogame.com

const BASE = "https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153";
const CDN_URLS = [
  `${BASE}/information/ko.json`,
  `${BASE}/information/zh-Hans.json`,
  `${BASE}/information/en.json`,
];
const CFG_URL = `${BASE.replace("/50004_", "/launcher/50004_")}/index.json`;

const FETCH_HEADERS = {
  "User-Agent": "KurogameStarter/4.0 (Windows)",
  "Accept": "application/json, */*",
  "Referer": "https://wutheringwaves.kurogames.com/",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

// 우선순위 순서: 영상 > 특별 방송 > 픽업 > 업데이트 > 이벤트
const KEYWORDS = [
  ["영상",     ["pv「","pv |"," pv ","trailer","teaser"," mv ","홍보 영상","애니메이션","character video"]],
  ["특별 방송", ["special program","livestream","live stream","preview program","특별 프로그램","특별방송","특별 방송","special preview"]],
  ["픽업",     ["convene","resonator banner","rate-up","limited supply","픽업 소환","픽업 이벤트","limited convene"]],
  ["업데이트", ["version update","update maintenance","update notice","maintenance notice","점검 안내","패치 노트","patch note","업데이트 안내","버전 업데이트"]],
];
const SKIP = ["fan art","wallpaper","survey","feedback","fanart","guide","beginner","wiki","설문","커뮤니티"];

function detectType(title) {
  const t = title.toLowerCase();
  if (SKIP.some(s => t.includes(s))) return null;
  for (const [type, kws] of KEYWORDS) {
    if (kws.some(k => t.includes(k))) return type;
  }
  return "이벤트";
}

function extractDate(item) {
  const ts = item.showTime || item.publishTime || item.publish_time ||
             item.created_at || item.createTime || item.startTime ||
             item.time || item.date || "";
  if (!ts) return "";
  if (typeof ts === "number" && ts > 0) {
    const sec = ts > 1e11 ? ts / 1000 : ts;
    return new Date(sec * 1000).toISOString().slice(0, 10);
  }
  const m = String(ts).match(/(\d{4}[-/]\d{2}[-/]\d{2})/);
  return m ? m[1].replace(/\//g, "-") : "";
}

function collectItems(obj, depth = 0) {
  if (depth > 5) return [];
  const KEYS = ["news","message","notices","events","newsList","noticeList",
                "articleList","list","data","newsVo","noticeVo","items","result"];
  if (Array.isArray(obj)) {
    const direct = obj.filter(x => x && typeof x === "object" &&
      Object.keys(x).some(k => ["title","articleTitle","subject","postTitle","name"].includes(k)));
    if (direct.length > 0) return direct;
    return obj.flatMap(x => collectItems(x, depth + 1));
  }
  if (obj && typeof obj === "object") {
    return KEYS.flatMap(k => obj[k] ? collectItems(obj[k], depth + 1) : []);
  }
  return [];
}

function parseItems(raw, currentVer) {
  const items = collectItems(raw);
  const result = [];
  for (const item of items) {
    const title = (item.articleTitle || item.title || item.subject || item.postTitle || item.name || "").trim();
    if (!title) continue;
    const date = extractDate(item);
    if (!date) continue;
    const type = detectType(title);
    if (!type) continue;
    const img = (item.articleImg || item.cover || item.img || item.imgUrl || item.thumbnail || "");
    const postId = String(item.articleId || item.postId || item.id || "");
    const link = item.articleUrl || item.link || item.url ||
      (postId ? `https://wutheringwaves.kurogames.com/kr/main/news/detail/${postId}` : "");
    const vm = title.match(/(\d+\.\d+)/);
    result.push({
      title, date, type,
      version: vm ? vm[1] : (type === "업데이트" ? currentVer : null),
      img: img.startsWith("//") ? "https:" + img : img,
      url: link,
    });
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  // 현재 버전 조회
  let currentVer = null;
  try {
    const cfg = await fetch(CFG_URL, { headers: FETCH_HEADERS }).then(r => r.json());
    currentVer = cfg?.default?.config?.version || null;
  } catch { /* 무시 */ }

  // 뉴스 API 순차 시도
  for (const url of CDN_URLS) {
    try {
      const r = await fetch(url, { headers: FETCH_HEADERS });
      if (!r.ok) continue;
      const raw = await r.json();
      const items = parseItems(raw, currentVer);
      console.log(`[wuwa] ${url.split("/").pop()} OK → ${items.length}개`);
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
      return res.status(200).json(items);
    } catch (e) {
      console.log(`[wuwa] ${url.split("/").pop()} 실패: ${e.message}`);
    }
  }

  console.log("[wuwa] 모든 CDN 실패 → 빈 배열");
  return res.status(200).json([]);
}

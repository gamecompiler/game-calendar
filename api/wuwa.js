// api/wuwa.js — 명조(Wuthering Waves) 공식 CDN 뉴스 수집
// Kuro Games 공식 런처 API 사용: prod-alicdn-gamestarter.kurogame.com
// proxy.py _handle_wuwa_news 의 파싱 로직을 그대로 이식 (동일 JSON 출력)

const BASE = "https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153";
const CDN_URLS = [
  `${BASE}/information/ko.json`,
  `${BASE}/information/zh-Hans.json`,
  `${BASE}/information/en.json`,
];
const CFG_URL = `${BASE}/index.json`;   // (기존 /launcher/launcher/ 중복 버그 수정)

// proxy.py HDRS 와 동일 (Cloudflare 우회 위해 Chrome UA + Origin)
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://wutheringwaves.kurogames.com/",
  "Origin": "https://wutheringwaves.kurogames.com",
};

// 우선순위 순서: 영상 > 특별 방송 > 픽업 > 업데이트 > 이벤트 (proxy.py KEYWORDS 와 동일)
const KEYWORDS = [
  ["영상",     ["pv「","pv |"," pv ","trailer","teaser"," mv ","홍보 영상","애니메이션","character video","캐릭터 영상","ost"]],
  ["특별 방송", ["special program","livestream","live stream","preview program","특별 프로그램","특별방송","특별 방송","special preview","생방송","미리보기 방송"]],
  ["픽업",     ["convene","resonator banner","rate-up","limited supply","픽업 소환","픽업 이벤트","limited convene","기간 한정 모집","공명자","한정 모집","픽업","음률 시뮬레이션"]],
  ["업데이트", ["version update","update maintenance","update notice","maintenance notice","점검 안내","패치 노트","patch note","업데이트 안내","버전 업데이트","업데이트 점검","점검 공지"]],
];
const SKIP = ["fan art","wallpaper","survey","feedback","fanart","beginner","wiki","terms","privacy","설문","커뮤니티","팬아트"];

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
  if (ts === "" || ts == null) return "";
  // 숫자 타임스탬프 (초/밀리초) → UTC 날짜
  if (typeof ts === "number" && ts > 0) {
    const sec = ts < 1e11 ? ts : ts / 1000;
    return new Date(sec * 1000).toISOString().slice(0, 10);
  }
  const s = String(ts);
  // YYYY-MM-DD (구분자 - / .)
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // MM-DD (연도 없음) → 올해, 30일 넘게 미래면 작년 (proxy.py 와 동일)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const now = new Date();
    const mo = Number(m[1]), d = Number(m[2]);
    let year = now.getFullYear();
    const cand = new Date(year, mo - 1, d);
    if ((cand - now) / 86400000 > 30) year -= 1;
    return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

// proxy.py collect() 와 동일: contents 키를 카테고리로 인식하고 내부 게시글만 수집
function collectItems(raw) {
  const all = [];
  const TITLE_KEYS = ["title", "articleTitle", "subject", "postTitle", "contentTitle", "jumpUrl"];
  function walk(obj, depth) {
    if (depth > 8) return;
    if (Array.isArray(obj)) {
      for (const x of obj) walk(x, depth + 1);
    } else if (obj && typeof obj === "object") {
      // 카테고리 노드: contents 배열 보유 → 내부만 수집 (자신은 항목 아님)
      if (Array.isArray(obj.contents)) {
        for (const c of obj.contents) walk(c, depth + 1);
        return;
      }
      // 실제 게시글: title류 키 보유
      if (TITLE_KEYS.some(k => k in obj)) {
        all.push(obj);
        return;
      }
      // 그 외 dict는 값들을 재귀 탐색
      for (const v of Object.values(obj)) {
        if (v && typeof v === "object") walk(v, depth + 1);
      }
    }
  }
  walk(raw, 0);
  return all;
}

function parseItems(raw, currentVer) {
  const items = collectItems(raw);
  const result = [];
  for (const item of items) {
    // 명조 CDN: 제목은 'content' 필드 (title 아님)
    const title = (item.content || item.articleTitle || item.title ||
                   item.contentTitle || item.subject || item.postTitle ||
                   item.name || "").trim();
    if (!title) continue;
    const type = detectType(title);
    if (!type) continue;
    const date = extractDate(item);
    if (!date) continue;
    let img = (item.articleImg || item.cover || item.img || item.imgUrl ||
               item.thumbnail || item.bg || "");
    if (img.startsWith("//")) img = "https:" + img;
    const postId = String(item.articleId || item.postId || item.id || "");
    // 링크 (명조: jumpUrl = 네이버 라운지)
    let link = item.jumpUrl || item.articleUrl || item.link || item.url || "";
    if (!link && postId) link = `https://wutheringwaves.kurogames.com/kr/main/news/detail/${postId}`;
    const vm = title.match(/(\d+\.\d+)/);
    result.push({
      title,
      date,
      type,
      version: vm ? vm[1] : (type === "업데이트" ? currentVer : null),
      img,
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

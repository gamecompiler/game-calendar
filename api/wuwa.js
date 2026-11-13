// api/wuwa.js — 명조(Wuthering Waves) 공식 홈페이지 뉴스 수집
// 쿠로게임즈 공식 홈페이지(website2.0) 뉴스 피드 MainMenu.json 사용
// (기존 런처 CDN information/*.json 은 빈 목록만 돌려줘 일정이 사라졌다)
// proxy.py _handle_wuwa_news 의 파싱 로직을 그대로 이식 (동일 JSON 출력)

const FEEDS = [
  "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/kr/MainMenu.json",
  "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/MainMenu.json",
];
const DETAIL_URL = "https://wutheringwaves.kurogames.com/kr/main/news/detail/";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://wutheringwaves.kurogames.com/",
  "Origin": "https://wutheringwaves.kurogames.com",
};

// 우선순위 순서: 영상 > 특별 방송 > 픽업 > 업데이트 (proxy.py KEYWORDS 와 동일)
const KEYWORDS = [
  ["영상",     ["pv「","pv |"," pv ","trailer","teaser"," mv ","홍보 영상","애니메이션","character video","캐릭터 영상","ost"]],
  ["특별 방송", ["special program","livestream","live stream","preview program","특별 프로그램","특별방송","특별 방송","special preview","생방송","미리보기 방송"]],
  ["픽업",     ["convene","resonator banner","rate-up","limited supply","픽업 소환","픽업 이벤트","limited convene","기간 한정 모집","공명자","한정 모집","픽업","음률 시뮬레이션","튜닝"]],
  ["업데이트", ["version update","update maintenance","update notice","maintenance notice","점검 안내","패치 노트","patch note","업데이트 안내","버전 업데이트","업데이트 점검","점검 공지","버전 내용 안내"]],
];
const SKIP = ["fan art","wallpaper","survey","feedback","fanart","beginner","wiki","terms","privacy","설문","커뮤니티","팬아트"];

function versionOf(title) {
  const m = String(title).match(/(\d+)\.(\d+)/);
  if (!m) return null;
  return { text: m[0], key: [Number(m[1]), Number(m[2])] };
}

function dateOf(item) {
  let ts = item.startTime || item.createTime || item.showTime || item.publishTime ||
           item.publish_time || item.created_at || item.time || item.date;
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

function parseFeed(raw) {
  const articles = raw && typeof raw === "object" ? raw.article : null;
  if (!Array.isArray(articles)) return null;

  // 같은 articleId 가 '전체'(articleType 0) + '분류'로 2건씩 들어옴 → articleId 기준 중복 제거,
  // 분류가 붙은 항목(articleType≠0)을 남긴다.
  const byId = new Map();
  for (const a of articles) {
    if (!a || typeof a !== "object") continue;
    const aid = a.articleId;
    if (aid === undefined || aid === null || aid === "") continue;
    const key = String(aid);
    const prev = byId.get(key);
    if (!prev || ((prev.articleType === 0 || prev.articleType == null) &&
                  !(a.articleType === 0 || a.articleType == null))) {
      byId.set(key, a);
    }
  }

  // 제목에서 뽑은 최신 버전 (버전명 없는 업데이트 공지에 채워 넣기 위함)
  let latest = null;
  for (const a of byId.values()) {
    const v = versionOf(a.articleTitle || a.title || "");
    if (v && (!latest || v.key[0] > latest.key[0] ||
              (v.key[0] === latest.key[0] && v.key[1] > latest.key[1]))) {
      latest = v;
    }
  }

  const result = [];
  for (const [key, a] of byId) {
    const title = String(a.articleTitle || a.title || "").trim();
    if (!title) continue;
    const low = title.toLowerCase();
    if (SKIP.some(s => low.includes(s))) continue;
    const date = dateOf(a);
    if (!date) continue;
    let type = null;
    for (const [t, kws] of KEYWORDS) {
      if (kws.some(k => low.includes(k))) { type = t; break; }
    }
    type = type || "이벤트";
    let img = String(a.suggestCover || a.articleImg || a.cover || a.img || a.imgUrl || a.thumbnail || "");
    if (img.startsWith("//")) img = "https:" + img;
    let link = String(a.jumpUrl || a.articleUrl || a.link || a.url || "");
    if (!link) link = DETAIL_URL + key;
    const v = versionOf(title);
    result.push({
      title,
      date,
      type,
      version: v ? v.text : (type === "업데이트" && latest ? latest.text : null),
      img,
      url: link,
    });
  }
  result.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  return result;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: FETCH_HEADERS });
      if (!r.ok) { console.log(`[wuwa] HTTP ${r.status}: ${url}`); continue; }
      const raw = await r.json();
      const out = parseFeed(raw);
      if (out === null) { console.log(`[wuwa] 예상과 다른 응답(article 배열 없음): ${url}`); continue; }
      console.log(`[wuwa] ${url.split("/").slice(-2)[0]} 피드 OK → ${out.length}개`);
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
      return res.status(200).json(out);
    } catch (e) {
      console.log(`[wuwa] 실패 ${url}: ${e.message}`);
    }
  }

  console.log("[wuwa] 모든 피드 실패 → 빈 배열");
  return res.status(200).json([]);
}

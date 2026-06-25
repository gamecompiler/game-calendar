#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request, urllib.parse, urllib.error, os, sys, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def _load_dotenv():
    """프로젝트 루트의 .env(untracked)에서 환경변수 로드 (이미 설정된 값은 보존).
    로컬에서 NOTION_READONLY_TOKEN / NOTION_MEMBERS_DB 등을 배포와 동일하게 다루기 위함.
    토큰을 코드에 하드코딩하지 않음."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip(); v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass

_load_dotenv()

def make_headers(url):
    """요청 대상에 따라 적절한 헤더 반환"""
    h = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    }
    if "hoyolab.com" in url or "hoyoverse.com" in url:
        h["x-rpc-language"] = "ko-kr"
        h["Accept-Language"] = "ko-KR,ko;q=0.9,en;q=0.8"
        h["Referer"] = "https://www.hoyolab.com/"
        h["Origin"] = "https://www.hoyolab.com"
    elif "kurogames" in url or "epicardgame" in url:
        h["Accept-Language"] = "ko-KR,ko;q=0.9"
        h["Referer"] = "https://wutheringwaves.kurogames.com/"
    return h

class Handler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        # ── 새 경로 (HTML v90+ 에서 사용) ─────────────────────────────────────
        if self.path.startswith("/api/hoyo"):
            # /api/hoyo?url=...&param=... → HoYoLAB BBS API
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            u = qs.get("url", [""])[0]
            if not u:
                self.send_response(400); self.end_headers(); return
            # 나머지 파라미터도 URL에 붙임
            extra = {k: v[0] for k, v in qs.items() if k != "url"}
            if extra:
                u += ("&" if "?" in u else "?") + urllib.parse.urlencode(extra)
            try:
                req = urllib.request.Request(u, headers=make_headers(u))
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(str(e).encode())
        elif self.path.startswith("/api/hoyo-post"):
            # getPostFull - 개별 게시글 본문 (점검일 추출용)
            qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            pid = qs.get("post_id",[""])[0]
            gids = qs.get("gids",["2"])[0]
            if not pid:
                self.send_response(400); self.end_headers(); return
            try:
                url = f"https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id={pid}&gids={gids}&read=1"
                req = urllib.request.Request(url, headers=make_headers(url))
                with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(200)
                self.send_header("Content-Type","application/json")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(('{"error":"'+str(e)+'"}').encode())
        elif self.path.startswith("/api/yt"):
            # /api/yt?type=rss&channel=... or type=icon/chzzk
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            t = qs.get("type", [""])[0]
            if t == "rss":
                self._handle_yt_rss_new(qs)
            elif t in ("icon", "chzzk"):
                self.path = "/yt-icon?" + urllib.parse.urlencode({
                    ("chzzk" if t == "chzzk" else "channel"): qs.get("chzzk" if t == "chzzk" else "channel", [""])[0]
                })
                self._handle_yt_icon()
            else:
                self.send_response(400); self.end_headers()
        elif self.path.startswith("/api/img"):
            # /api/img?url=...
            self.path = "/img-proxy" + (self.path[8:] if len(self.path) > 8 else "")
            self._handle_img_proxy()
        elif self.path.startswith("/api/notion-pages"):
            # /api/notion-pages?ids=...
            self.path = "/notion-pages" + (self.path[17:] if len(self.path) > 17 else "")
            self._handle_notion_pages()
        elif self.path.startswith("/api/notion-setup"):
            # GET /api/notion-setup (초기 설정 - 실제로 POST이지만 방어 처리)
            self.send_response(405)
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
        elif self.path.startswith("/api/notion"):
            # GET /api/notion?path=... → Notion API 프록시
            # /query 경로는 Notion이 POST 필요하므로 자동 변환
            qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            npath = qs.get("path",[""])[0]
            auth = self.headers.get("Authorization","")
            nv = self.headers.get("Notion-Version","2022-06-28")
            if not npath:
                self.send_response(400); self.end_headers(); return
            try:
                notion_url = f"https://api.notion.com/v1/{npath}"
                # DB 쿼리(/query) 및 검색(/search)은 Notion API가 POST 필요
                method = "POST" if (npath.endswith("/query") or npath == "search") else "GET"
                body = b"{}" if method == "POST" else None
                req = urllib.request.Request(notion_url, data=body, method=method,
                    headers={"Authorization":auth,"Notion-Version":nv,"Content-Type":"application/json"})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                    data = r.read()
                self.send_response(200)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(data)
            except urllib.error.HTTPError as e:
                err=e.read()
                self.send_response(e.code)
                self.send_header("Content-Type","application/json")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(err)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type","text/plain")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(str(e).encode())
        elif self.path.startswith("/api/wuwa"):
            self._handle_wuwa_news()
        elif self.path.startswith("/api/members"):
            self._handle_members()
        # ── 기존 경로 (하위 호환) ───────────────────────────────────────────────
        elif self.path.startswith("/api-proxy?"):
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            u = qs.get("url", [""])[0]
            if not u:
                self.send_response(400); self.end_headers(); return
            try:
                req = urllib.request.Request(u, headers=make_headers(u))
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(str(e).encode())
        elif self.path.startswith("/wuwa-news"):
            self._handle_wuwa_news()
        elif self.path.startswith("/yt-rss"):
            self._handle_yt_rss()
        elif self.path.startswith("/img-proxy"):
            self._handle_img_proxy()
        elif self.path.startswith("/notion-pages"):
            self._handle_notion_pages()
        elif self.path.startswith("/yt-icon"):
            self._handle_yt_icon()
        elif self.path.startswith("/notion-search"):
            self._handle_notion_search()
        elif self.path.startswith("/notion-db"):
            self._handle_notion_read()
        else:
            super().do_GET()

    def _handle_yt_rss_new(self, qs):
        """새 경로 /api/yt?type=rss 처리"""
        channel = qs.get("channel", [""])[0]
        if not channel:
            self.send_response(400); self.end_headers(); return
        # 기존 핸들러 재활용을 위해 path 변환
        self.path = f"/yt-rss?channel={urllib.parse.quote(channel)}"
        self._handle_yt_rss()

    def _handle_img_proxy(self):
        """이미지 CDN proxy - 로컬 캐시 우선, CDN 실패시 fallback"""
        import json, os, hashlib
        try:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            img_url = qs.get("url", [""])[0]
            if not img_url:
                self.send_response(400); self.end_headers(); return

            # 로컬 캐시 확인 (script와 같은 폴더의 .icon_cache/)
            script_dir = os.path.dirname(os.path.abspath(__file__))
            cache_dir  = os.path.join(script_dir, ".icon_cache")
            os.makedirs(cache_dir, exist_ok=True)
            cache_key  = hashlib.md5(img_url.encode()).hexdigest() + ".bin"
            cache_path = os.path.join(cache_dir, cache_key)
            ct_path    = cache_path + ".ct"

            # 캐시 히트
            if os.path.exists(cache_path):
                with open(cache_path, "rb") as f: data = f.read()
                ct = open(ct_path).read() if os.path.exists(ct_path) else "image/png"
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(data)
                return

            # CDN 요청
            if "hoyolab.com" in img_url or "hoyoverse.com" in img_url:
                ref = "https://www.hoyolab.com/"
            elif "kurogames" in img_url:
                ref = "https://wutheringwaves.kurogames.com/"
            else:
                ref = img_url

            req = urllib.request.Request(img_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                "Referer": ref,
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                data = r.read()
                ct = r.headers.get("Content-Type", "image/png")

            # 캐시 저장
            with open(cache_path, "wb") as f: f.write(data)
            with open(ct_path, "w") as f: f.write(ct)
            print(f"IMG-PROXY cached: {img_url[-40:]}")

            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)

        except Exception as e:
            code = getattr(e, 'code', 0)
            deny = ''
            if hasattr(e, 'headers'): deny = (e.headers or {}).get('x-deny-reason', '')
            print(f"IMG-PROXY FAIL {code}: {e} deny={deny}")
            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"error":"img fetch failed"}')
            except: pass

    def _handle_yt_rss(self):
        """YouTube RSS → [{title, url, date, thumb, isShort}] JSON"""
        import json
        from xml.etree import ElementTree as ET
        try:
            qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            channel_id = qs.get("channel",[""])[0]
            if not channel_id:
                self.send_response(400); self.end_headers(); return

            # UCxxx(24자) → 직접 사용 / 그 외 → KNOWN_IDS 조회
            KNOWN_IDS = {
                "honkaistarrail_kr": "UCH33CJMcI0XZUpIhWRHiUuw",
                "genshinimpact_kr":  "UCcum1rCJ5GJeQ_xv0xrohqg",
                "zzz_ko":            "UCmry1hfaRHI_iTfxUMhC8mA",
                "wutheringwaves":    "UCKuq0c-RXYaulECSuu5hFug",
                "honkai3rdofficial": "UCHnxdu0qphnV3vrERNtCqpw",
                "hsr_kr":            "UCH33CJMcI0XZUpIhWRHiUuw",
            }
            if channel_id.startswith("UC") and len(channel_id) == 24:
                real_id = channel_id
            else:
                real_id = KNOWN_IDS.get(channel_id.lstrip("@").lower(), channel_id)

            rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={real_id}"
            print(f"YT-RSS fetching channel={real_id}")
            raw = None
            last_err = None
            for attempt in range(2):
                try:
                    req = urllib.request.Request(rss_url, headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept":     "application/rss+xml, application/xml, text/xml, */*",
                        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
                    })
                    with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
                        raw = r.read()
                    break
                except urllib.error.HTTPError as he:
                    last_err = he
                    if he.code == 404:
                        print(f"YT-RSS 404 (채널 RSS 없음): {real_id}")
                        self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(b"[]");return
                    import time as _t; _t.sleep(0.5)
                except Exception as e2:
                    last_err = e2
                    import time as _t; _t.sleep(0.5)
            if raw is None:
                print(f"YT-RSS 최종 실패: {last_err}")
                self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(b"[]");return

            # gzip 자동 해제
            import gzip as _gz
            if len(raw)>2 and raw[0]==31 and raw[1]==139:
                raw = _gz.decompress(raw)
            print(f"YT-RSS OK: {len(raw)} bytes")

            ns  = {"atom":"http://www.w3.org/2005/Atom",
                   "yt":  "http://www.youtube.com/xml/schemas/2015"}
            root = ET.fromstring(raw)
            items = []
            for entry in root.findall("atom:entry", ns):
                vid_id    = entry.findtext("yt:videoId",    namespaces=ns) or ""
                title     = entry.findtext("atom:title",    namespaces=ns) or ""
                published = entry.findtext("atom:published",namespaces=ns) or ""
                date      = published[:10] if published else ""
                if not (vid_id and title and date): continue
                tl       = title.lower()
                is_short = ("#shorts" in tl or "short:" in tl or
                            tl.startswith("shorts ") or tl.endswith(" shorts"))
                items.append({
                    "title":   title,
                    "url":     f"https://youtu.be/{vid_id}",
                    "date":    date,
                    "thumb":   f"https://img.youtube.com/vi/{vid_id}/mqdefault.jpg",
                    "isShort": is_short,
                })

            body = json.dumps(items, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            import traceback
            print(f"YT-RSS ERROR: {type(e).__name__}: {e}")
            traceback.print_exc()
            try:
                self.send_response(502)
                self.send_header("Content-Type","application/json")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(json.dumps({"error":str(e)}).encode())
            except: pass

    def _handle_wuwa_news(self):
        """명조 뉴스/이벤트 수집 — Kuro Games 공식 CDN API 사용"""
        import json as _j, re as _re
        from datetime import datetime

        # ── Kuro 공식 CDN 엔드포인트 (런처 뉴스 API) ──────────────────────────
        # 런처 앱 업데이트 시 해시값이 바뀔 수 있으므로 다중 BASE 시도
        # Kuro CDN 기본 경로 (해시값이 런처 업데이트마다 바뀔 수 있음)
        HASH = "50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c"
        _BASES = [
            f"https://prod-alicdn-gamestarter.kurogame.com/launcher/{HASH}/G153",
            f"https://pcdownload-alicdn.kurogame.com/launcher/{HASH}/G153",
            f"https://pcdownload-wangsu.kurogame.com/launcher/{HASH}/G153",
            f"https://pcdownload-wangsu.joymite.com/launcher/{HASH}/G153",
            f"https://prod-alicdn-gamestarter.kurogame.com/launcher/{HASH}/G000",
        ]
        BASE = _BASES[0]
        CDN_URLS = [f"{b}/information/{lang}.json"
                    for b in _BASES for lang in ("ko","zh-Hans","en")]
        CFG_URL = f"{BASE}/index.json"

        HDRS = {
            # 최신 크롬 User-Agent (Cloudflare 우회 개선)
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://wutheringwaves.kurogames.com/",
            "Origin": "https://wutheringwaves.kurogames.com",
            "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136"',
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
        }

        def send_json(data):
            body = _j.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def fetch_url(url):
            req = urllib.request.Request(url, headers=HDRS)
            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                raw = r.read()
            # gzip/deflate 자동 압축 해제
            import gzip as _gz, zlib as _zl
            if raw[:2] == b'\x1f\x8b':
                raw = _gz.decompress(raw)
            elif raw[:2] in (b'\x78\x9c', b'\x78\x01', b'\x78\xda'):
                raw = _zl.decompress(raw)
            return _j.loads(raw.decode('utf-8'))

        # ── 현재 버전 확인 ─────────────────────────────────────────────────────
        current_ver = None
        try:
            cfg = fetch_url(CFG_URL)
            current_ver = (cfg.get("default") or {}).get("config", {}).get("version")
            if current_ver:
                print(f"[wuwa] 현재 버전: {current_ver}")
        except Exception as e:
            print(f"[wuwa] config 조회 실패 (무시): {e}")

        # ── 뉴스 API 시도 ─────────────────────────────────────────────────────
        raw = None
        for url in CDN_URLS:
            try:
                raw = fetch_url(url)
                print(f"[wuwa] CDN OK: {url}")
                print(f"[wuwa] 응답 최상위 키: {list(raw.keys()) if isinstance(raw,dict) else type(raw)}")
                break
            except urllib.error.HTTPError as e:
                print(f"[wuwa] CDN HTTP {e.code}: ...{url[-40:]}")
            except Exception as e:
                print(f"[wuwa] CDN 실패: {type(e).__name__} ...{url[-40:]}: {e}")

        if not raw:
            # CDN 실패 시 공식 한국 페이지에서 JSON 탐색
            print("[wuwa] CDN 모두 실패, 공식 페이지 시도")
            ALT_HDRS2 = {"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                         "Accept":"text/html,*/*","Accept-Language":"ko-KR,ko;q=0.9"}
            for aurl in ["https://wutheringwaves.kurogames.com/kr/main/news",
                         "https://wutheringwaves.kurogames.com/en/main/news"]:
                try:
                    req2 = urllib.request.Request(aurl, headers=ALT_HDRS2)
                    with urllib.request.urlopen(req2, timeout=10, context=ctx) as r2:
                        hstr = r2.read(600000).decode("utf-8", errors="ignore")
                    import re as _r2
                    for pat in [r'"articleList"\s*:\s*(\[.{10,5000}\])',
                                 r'"newsList"\s*:\s*(\[.{10,5000}\])',
                                 r'"list"\s*:\s*(\[.{10,5000}\])'  ]:
                        mm = _r2.search(pat, hstr[:300000])
                        if mm:
                            try:
                                fallback = _j.loads(mm.group(1))
                                if fallback:
                                    raw = {"articleList": fallback}
                                    print(f"[wuwa] 공식 페이지 OK: {len(fallback)}건")
                                    break
                            except: pass
                    if raw: break
                except Exception as ef:
                    print(f"[wuwa] 공식 페이지 실패 {aurl}: {ef}")
        if not raw:
            print("[wuwa] 모든 방법 실패 — 빈 배열 반환")
            send_json([]); return

        # ── 응답 정규화 ───────────────────────────────────────────────────────
        # CDN JSON 구조 (2026): {"guidance": [{title:카테고리, contents:[게시글]}], "slideshow":[]}
        # 카테고리 노드(contents 키 보유)는 건너뛰고 contents 내부 게시글만 수집
        all_items = []
        def collect(obj, depth=0):
            if depth > 8: return
            if isinstance(obj, list):
                for x in obj:
                    collect(x, depth+1)
            elif isinstance(obj, dict):
                # 카테고리 노드: contents 배열을 가진 dict → 내부만 수집 (자신은 항목 아님)
                if "contents" in obj and isinstance(obj["contents"], list):
                    for c in obj["contents"]:
                        collect(c, depth+1)
                    return
                # 실제 게시글: title류 키 보유 + contents 없음
                if any(k in obj for k in ["title","articleTitle","subject","postTitle","contentTitle","jumpUrl"]):
                    all_items.append(obj)
                    return
                # 그 외 dict는 값들을 재귀 탐색
                for k, v in obj.items():
                    if isinstance(v, (list, dict)):
                        collect(v, depth+1)

        collect(raw)
        print(f"[wuwa] 수집 항목: {len(all_items)}개")
        if all_items:
            print(f"[wuwa] 첫 항목 키: {list(all_items[0].keys())[:12]}")
            print(f"[wuwa] 첫 항목 샘플: {str(all_items[0])[:200]}")

        if not all_items:
            print(f"[wuwa] 파싱 불가 — 전체 키: {list(raw.keys())[:8]}")
            if isinstance(raw, dict) and "guidance" in raw:
                g = raw["guidance"]
                print(f"[wuwa] guidance 타입: {type(g).__name__}")
                if isinstance(g, list) and g:
                    print(f"[wuwa] guidance[0] 키: {list(g[0].keys()) if isinstance(g[0],dict) else g[0]}")
            send_json([]); return

        # ── 타입 감지 키워드 ──────────────────────────────────────────────────
        # 우선순위 순서: 영상 > 특별 방송 > 픽업 > 업데이트 > 이벤트
        KEYWORDS = [
            ("영상",     ["pv「","pv |"," pv ","trailer","teaser"," mv ","홍보 영상","애니메이션","character video","캐릭터 영상","ost"]),
            ("특별 방송", ["special program","livestream","live stream","preview program","특별 프로그램","특별방송","특별 방송","special preview","생방송","미리보기 방송"]),
            ("픽업",     ["convene","resonator banner","rate-up","limited supply","픽업 소환","픽업 이벤트","limited convene","기간 한정 모집","공명자","한정 모집","픽업","음률 시뮬레이션"]),
            ("업데이트", ["version update","update maintenance","update notice","maintenance notice","점검 안내","패치 노트","patch note","업데이트 안내","버전 업데이트","업데이트 점검","점검 공지"]),
        ]
        SKIP_KW = ["fan art","wallpaper","survey","feedback","fanart",
                   "beginner","wiki","terms","privacy","설문","커뮤니티","팬아트"]

        result = []
        for item in all_items:
            # 명조 CDN: 제목은 'content' 필드 (title 아님)
            title = (item.get("content") or item.get("articleTitle") or item.get("title") or
                     item.get("contentTitle") or item.get("subject") or
                     item.get("postTitle") or item.get("name") or "").strip()
            if not title: continue
            t = title.lower()
            if any(s in t for s in SKIP_KW): continue

            # 날짜 추출 (다양한 필드명 대응)
            ts = (item.get("showTime") or item.get("publishTime") or
                  item.get("publish_time") or item.get("created_at") or
                  item.get("createTime") or item.get("startTime") or
                  item.get("time") or item.get("date") or "")
            date = ""
            if isinstance(ts, (int, float)) and ts > 0:
                sec = ts if ts < 1e11 else ts / 1000
                date = datetime.utcfromtimestamp(sec).strftime("%Y-%m-%d")
            elif ts:
                ts_str = str(ts)
                # YYYY-MM-DD 형식
                m = _re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", ts_str)
                if m:
                    date = f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
                else:
                    # MM-DD 형식 (연도 없음) → 올해, 미래면 작년
                    m2 = _re.match(r"(\d{1,2})[-/.](\d{1,2})", ts_str)
                    if m2:
                        now = datetime.now()
                        mo, d = int(m2.group(1)), int(m2.group(2))
                        year = now.year
                        try:
                            cand = datetime(year, mo, d)
                            if (cand - now).days > 30: year -= 1
                            date = f"{year}-{str(mo).zfill(2)}-{str(d).zfill(2)}"
                        except ValueError:
                            date = ""
            if not date: continue

            # 이미지
            img = (item.get("articleImg") or item.get("cover") or
                   item.get("img") or item.get("imgUrl") or
                   item.get("thumbnail") or item.get("bg") or "")
            if img and img.startswith("//"): img = "https:" + img

            # 링크 (명조: jumpUrl = 네이버 라운지)
            post_id = str(item.get("articleId") or item.get("postId") or
                          item.get("id") or "")
            link = (item.get("jumpUrl") or item.get("articleUrl") or
                    item.get("link") or item.get("url") or "")
            if not link and post_id:
                link = f"https://wutheringwaves.kurogames.com/kr/main/news/detail/{post_id}"

            # 이벤트 타입
            ev_type = None
            for typ, kws in KEYWORDS:
                if any(k in t for k in kws):
                    ev_type = typ; break

            # 버전 추출
            vm = _re.search(r"(\d+\.\d+)", title)
            version = vm.group(1) if vm else (current_ver if ev_type == "업데이트" else None)

            result.append({
                "title": title,
                "date": date,
                "type": ev_type or "이벤트",
                "version": version,
                "img": img,
                "url": link,
            })

        print(f"[wuwa] 최종 결과: {len(result)}개 (타입 있음: {sum(1 for r in result if r['type']!='이벤트')}개)")
        send_json(result)

    def _handle_notion_pages(self):
        """여러 Notion 페이지의 제목을 일괄 조회 (relation 필드 resolve용)"""
        import json as _json
        try:
            qs=urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            ids=qs.get("ids",[""])[0].split(",")
            ids=[i.strip() for i in ids if i.strip()]
            if not ids:
                self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(b"{}");return
            auth=self.headers.get("Authorization","")
            nv=self.headers.get("Notion-Version","2022-06-28")
            result={}
            for pid in ids[:30]:  # 최대 30개
                try:
                    req=urllib.request.Request(
                        f"https://api.notion.com/v1/pages/{pid}",
                        headers={"Authorization":auth,"Notion-Version":nv}
                    )
                    with urllib.request.urlopen(req,timeout=8,context=ctx) as r:
                        page=_json.loads(r.read())
                    # title 속성에서 제목 추출
                    props=page.get("properties",{})
                    title=""
                    for v in props.values():
                        if v.get("type")=="title":
                            title="".join(t.get("plain_text","") for t in v.get("title",[]))
                            break
                    result[pid]=title or page.get("id","")[:8]
                except urllib.error.HTTPError as pe:
                    print(f"NOTION-PAGE {pid[:8]}: HTTP {pe.code} {pe.reason}")
                    result[pid]="[오류:"+str(pe.code)+"]"
                except Exception as pe:
                    print(f"NOTION-PAGE {pid[:8]}: {pe}")
                    result[pid]="[오류]"
            data=_json.dumps(result,ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            try:
                self.send_response(502);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(str(e).encode())
            except: pass

    def _handle_yt_icon(self):
        """YouTube/Chzzk 채널 아이콘 URL 반환"""
        import json as _j, re, gzip
        qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
        cid = qs.get("channel",[""])[0]
        chzzk = qs.get("chzzk",[""])[0]
        def send_json(d):
            data=_j.dumps(d,ensure_ascii=False).encode("utf-8")
            self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(data)
        # Chzzk 채널 아이콘
        if chzzk:
            for url in [
                f"https://api.chzzk.naver.com/service/v1/channels/{chzzk}",
                f"https://chzzk.naver.com/api/v1/channels/{chzzk}",
            ]:
                try:
                    req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"application/json","Referer":"https://chzzk.naver.com/","Origin":"https://chzzk.naver.com"})
                    with urllib.request.urlopen(req,timeout=8,context=ctx) as r:
                        d=_j.loads(r.read())
                    img=d.get("content",{}).get("channelImageUrl","") or d.get("channelImageUrl","")
                    if img:
                        print(f"Chzzk icon OK: {img[:60]}"); send_json({"url":img}); return
                except Exception as e2:
                    print(f"Chzzk API fail {url}: {e2}")
            send_json({"url":"","error":"chzzk failed"}); return
        # YouTube 채널 아이콘
        if not cid:
            send_json({"url":"","error":"no channel"}); return
        HEADERS={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language":"ko-KR,ko;q=0.9,en-US;q=0.8","Accept-Encoding":"gzip, deflate",
            "Cache-Control":"max-age=0","Upgrade-Insecure-Requests":"1",
            "Sec-Fetch-Dest":"document","Sec-Fetch-Mode":"navigate","Sec-Fetch-Site":"none"}
        for url in [
            f"https://www.youtube.com/channel/{cid}",
            f"https://www.youtube.com/@{cid}",
        ]:
            try:
                req=urllib.request.Request(url,headers=HEADERS)
                with urllib.request.urlopen(req,timeout=12,context=ctx) as r:
                    raw=r.read()  # 전체 읽기 (avatar는 페이지 후반부에 있을 수 있음)
                    try: html_str=gzip.decompress(raw).decode("utf-8",errors="ignore")
                    except: html_str=raw.decode("utf-8",errors="ignore")
                # 아바타 전용 패턴 (배너/og:image 제외 - 그건 채널 헤더 이미지라 부정확)
                # YouTube 채널 아바타는 yt3.ggpht.com 또는 yt3.googleusercontent.com/ytc/ 형태
                patterns=[
                    # avatar 키 바로 뒤의 thumbnail (가장 정확)
                    r'"avatar":\{"thumbnails":\[\{"url":"(https://yt3\.(?:ggpht\.com|googleusercontent\.com)/[^"]+?)"',
                    # channelMetadataRenderer 내 avatar
                    r'"channelMetadataRenderer":\{[^}]*?"avatar":\{"thumbnails":\[\{"url":"(https://[^"]+?)"',
                    # ytc/ 경로 (채널 아바타 전용 경로)
                    r'"(https://yt3\.(?:ggpht\.com|googleusercontent\.com)/ytc/[A-Za-z0-9_\-]+=s\d+[^"\\]*)"',
                    # =s88 또는 =s176 등 아바타 크기 지정된 URL
                    r'"(https://yt3\.(?:ggpht\.com|googleusercontent\.com)/[A-Za-z0-9_\-]+=s(?:48|76|88|100|160|176)[^"\\]*)"',
                ]
                for pat in patterns:
                    m=re.search(pat,html_str)
                    if m:
                        icon=m.group(1).replace("\\u003d","=").replace("\\u0026","&").replace("\\/","/")
                        # =s48 등 작은 사이즈를 =s176으로 (고화질)
                        icon=re.sub(r'=s\d+',"=s176",icon)
                        print(f"YT avatar OK ({url[-30:]}): {icon[:70]}"); send_json({"url":icon}); return
                print(f"YT icon: no avatar pattern in {len(html_str)}B from {url[-30:]}")
            except Exception as e:
                print(f"YT icon fail {url[-30:]}: {e}")
        send_json({"url":"","error":"all attempts failed"})

    def _handle_notion_search(self):
        """접근 가능한 Notion DB 목록 반환"""
        import json as _json
        try:
            auth=self.headers.get("Authorization","")
            nv=self.headers.get("Notion-Version","2022-06-28")
            body=_json.dumps({"filter":{"value":"database","property":"object"},"page_size":30}).encode()
            req=urllib.request.Request("https://api.notion.com/v1/search",data=body,method="POST",
                headers={"Authorization":auth,"Notion-Version":nv,"Content-Type":"application/json"})
            with urllib.request.urlopen(req,timeout=15,context=ctx) as r:
                data=r.read()
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err=e.read()
            self.send_response(e.code); self.send_header("Content-Type","application/json"); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers(); self.wfile.write(err)
        except Exception as e:
            try: self.send_response(502); self.send_header("Content-Type","application/json"); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers(); self.wfile.write(str(e).encode())
            except: pass

    def _handle_notion_read(self):
        """Notion DB 조회 및 DB 구조 읽기"""
        import json as _json
        try:
            qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            db_id = qs.get("db",[""])[0]
            action = qs.get("action",["query"])[0]  # "schema" or "query"
            auth   = self.headers.get("Authorization","")
            notion_version = self.headers.get("Notion-Version","2022-06-28")
            if not db_id or not auth:
                self.send_response(400); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
                self.wfile.write(b'{"error":"db and Authorization required"}'); return

            if action=="schema":
                url = f"https://api.notion.com/v1/databases/{db_id}"
                req = urllib.request.Request(url, headers={"Authorization":auth,"Notion-Version":notion_version})
                method = "GET"
            else:
                # query: 최근 3개월 방송 일정 읽기
                from datetime import datetime, timedelta
                start = (datetime.now()-timedelta(days=30)).strftime("%Y-%m-%d")
                end   = (datetime.now()+timedelta(days=180)).strftime("%Y-%m-%d")
                # 방송/합방/특별방송 타입만 조회
                # 날짜 범위 필터 - 날짜 필드 없으면 전체 조회
                qs2 = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
                db_id_q = qs2.get("db",[""])[0]
                # 문서 목록 DB는 날짜 필드 없이 최근 문서 100개
                if db_id_q == "20466cc1-f1b5-8060-b379-eb16721bd1e4":
                    body = _json.dumps({
                        "sorts":[{"timestamp":"created_time","direction":"descending"}],
                        "page_size":100
                    }).encode("utf-8")
                else:
                    body  = _json.dumps({
                        "filter":{"and":[
                            {"property":"날짜","date":{"on_or_after":start}},
                            {"property":"날짜","date":{"on_or_before":end}}
                        ]},
                        "sorts":[{"property":"날짜","direction":"ascending"}],
                        "page_size":200
                    }).encode("utf-8")
                url = f"https://api.notion.com/v1/databases/{db_id}/query"
                req = urllib.request.Request(url, data=body, method="POST",
                    headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":notion_version})

            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                data = r.read()
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type","application/json")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(err)
            print("NOTION READ ERROR:", e.code, e.reason)
        except Exception as e:
            print("NOTION READ EXC:", e)
            try:
                self.send_response(502)
                self.send_header("Content-Type","application/json")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(str(e).encode())
            except: pass

    def _handle_members(self):
        """원스동 멤버 명단 (팬 공개, 안전 필드만). api/members.js 와 동일 출력.
        - 토큰은 환경변수 NOTION_READONLY_TOKEN 에서만 사용 (응답에 미포함)
        - 승인=true 멤버만 (이름 없는 빈 행 제거)
        - 노션토큰/일정DB/문서DB 칸은 응답에 절대 담지 않음"""
        import json as _j
        token = os.environ.get("NOTION_READONLY_TOKEN", "")
        db = (os.environ.get("NOTION_MEMBERS_DB") or "3b756ebfd5754e1f8308310b50330806").replace("-", "")

        def send(obj, code=200):
            body = _j.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        if not token:
            send({"error": "NOTION_READONLY_TOKEN not configured on server"}, 503); return
        try:
            url = f"https://api.notion.com/v1/databases/{db}/query"
            body = _j.dumps({"filter": {"property": "승인", "checkbox": {"equals": True}}, "page_size": 100}).encode()
            req = urllib.request.Request(url, data=body, method="POST",
                headers={"Authorization": "Bearer " + token, "Notion-Version": "2022-06-28", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                data = _j.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try: msg = _j.loads(e.read()).get("message", "")
            except Exception: msg = ""
            send({"error": msg or ("HTTP %d" % e.code)}, e.code); return
        except Exception as e:
            send({"error": str(e)}, 502); return

        def txt(p):
            if not p: return ""
            t = p.get("type")
            if t == "title": return "".join(x.get("plain_text", "") for x in p.get("title", [])).strip()
            if t == "rich_text": return "".join(x.get("plain_text", "") for x in p.get("rich_text", [])).strip()
            return ""

        out = []
        for page in data.get("results", []):
            p = page.get("properties", {})
            name = txt(p.get("이름"))
            if not name:
                continue
            out.append({
                "id": page.get("id"),
                "name": name,
                "chzzk": txt(p.get("치지직")),
                "youtube": [v for v in [txt(p.get("유튜브1")), txt(p.get("유튜브2")), txt(p.get("유튜브3"))] if v],
                "birthday": ((p.get("생일") or {}).get("date") or {}).get("start", ""),
                "classes": [o["name"] for o in ((p.get("소속반") or {}).get("multi_select") or [])],
                "color": txt(p.get("멤버색상")),
            })
        send(out)

    def do_PATCH(self):
        """Notion 페이지 업데이트 (PATCH) — /notion-patch?id=X 또는 /api/notion?path=pages/X"""
        import json as _j

        def _do_notion_patch(pid, body, auth, nv):
            req=urllib.request.Request(
                f"https://api.notion.com/v1/pages/{pid}",
                data=body, method="PATCH",
                headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":nv}
            )
            with urllib.request.urlopen(req,timeout=15,context=ctx) as r:
                return r.read(), 200

        if self.path.startswith("/api/notion"):
            # /api/notion?path=pages/{id}
            qs=urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            npath=qs.get("path",[""])[0]  # e.g. "pages/abc123"
            auth=self.headers.get("Authorization","")
            nv=self.headers.get("Notion-Version","2022-06-28")
            length=int(self.headers.get("Content-Length",0))
            body=self.rfile.read(length) if length else b"{}"
            try:
                url=f"https://api.notion.com/v1/{npath}"
                req=urllib.request.Request(url,data=body,method="PATCH",
                    headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":nv})
                with urllib.request.urlopen(req,timeout=15,context=ctx) as r:
                    data=r.read()
                self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(data)
            except urllib.error.HTTPError as e:
                err=e.read();self.send_response(e.code);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(err)
            except Exception as e:
                try:self.send_response(502);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(str(e).encode())
                except:pass
        elif self.path.startswith("/notion-patch"):
            qs=urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            pid=qs.get("id",[""])[0]
            if not pid:
                self.send_response(400);self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(b"{}");return
            try:
                length=int(self.headers.get("Content-Length",0))
                body=self.rfile.read(length) if length else b"{}"
                auth=self.headers.get("Authorization","")
                nv=self.headers.get("Notion-Version","2022-06-28")
                req=urllib.request.Request(
                    f"https://api.notion.com/v1/pages/{pid}",
                    data=body, method="PATCH",
                    headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":nv}
                )
                with urllib.request.urlopen(req,timeout=15,context=ctx) as r:
                    data=r.read()
                self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(data)
            except urllib.error.HTTPError as e:
                err=e.read();self.send_response(e.code);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(err)
            except Exception as e:
                try:self.send_response(502);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(str(e).encode())
                except:pass
        else:
            self.send_response(404);self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET,POST,PATCH,OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Authorization,Content-Type,Notion-Version")
        self.end_headers()

    def do_POST(self):
        # ── /api/notion?path=... (새 경로) ──────────────────────────────────
        if self.path.startswith("/api/notion") or self.path.startswith("/api/notion-setup"):
            qs = urllib.parse.parse_qs(self.path.split("?",1)[1] if "?" in self.path else "")
            npath = qs.get("path", ["pages"])[0]
            # /api/notion-setup → notion-setup 특별 처리
            if self.path.startswith("/api/notion-setup"):
                npath = "notion-setup-internal"
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            auth = self.headers.get("Authorization", "")
            nv = self.headers.get("Notion-Version", "2022-06-28")
            if npath == "notion-setup-internal":
                self._handle_notion_setup_post(auth, nv)
                return
            try:
                notion_url = f"https://api.notion.com/v1/{npath}"
                req = urllib.request.Request(
                    notion_url, data=body, method="POST",
                    headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":nv}
                )
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                self.wfile.write(data)
            except urllib.error.HTTPError as e:
                err_body=e.read();self.send_response(e.code);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(err_body)
            except Exception as e:
                self.send_response(502);self.send_header("Content-Type","text/plain");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(str(e).encode())
        # ── /notion-proxy (기존 경로 하위 호환) ─────────────────────────────
        elif self.path.startswith("/notion-proxy") or self.path.startswith("/notion-search"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            auth = self.headers.get("Authorization", "")
            nv = self.headers.get("Notion-Version", "2022-06-28")
            if self.path.startswith("/notion-search"):
                notion_url = "https://api.notion.com/v1/search"
            else:
                notion_url = "https://api.notion.com/v1/pages"
                if "?" in self.path:
                    params = urllib.parse.parse_qs(self.path.split("?",1)[1])
                    pid = params.get("id",[""])[0]
                    if pid: notion_url = f"https://api.notion.com/v1/pages/{pid}"
            try:
                req = urllib.request.Request(notion_url,data=body,method="POST",
                    headers={"Authorization":auth,"Content-Type":"application/json","Notion-Version":nv})
                with urllib.request.urlopen(req,timeout=15,context=ctx) as resp:
                    data=resp.read()
                self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(data)
            except urllib.error.HTTPError as e:
                err_body=e.read();self.send_response(e.code);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(err_body)
            except Exception as e:
                self.send_response(502);self.send_header("Content-Type","text/plain");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(str(e).encode())
        else:
            self.send_response(404); self.end_headers()

    def _handle_notion_setup_post(self, auth, nv):
        """신규 사용자 Notion DB 자동 생성"""
        import json as _j
        headers = {"Authorization":auth,"Notion-Version":nv,"Content-Type":"application/json"}
        def call(method, path, body=None):
            url = f"https://api.notion.com/v1/{path}"
            data = _j.dumps(body).encode() if body else None
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                return _j.loads(r.read())
        try:
            search = call("POST","search",{"filter":{"value":"page","property":"object"},"page_size":1})
            if not search.get("results"):
                raise ValueError("공유된 페이지가 없습니다. 통합에 최소 1개 페이지를 공유하세요.")
            root_page_id = search["results"][0]["id"]
            root = call("POST","pages",{"parent":{"type":"page_id","page_id":root_page_id},
                "icon":{"type":"emoji","emoji":"🎮"},
                "properties":{"title":{"title":[{"text":{"content":"스트리밍 캘린더"}}]}}})
            root_id = root["id"]
            game_db = call("POST","databases",{"parent":{"type":"page_id","page_id":root_id},
                "icon":{"type":"emoji","emoji":"🎮"},"is_inline":True,
                "title":[{"type":"text","text":{"content":"게임 목록"}}],
                "properties":{"이름":{"title":{}},"플랫폼":{"select":{"options":[
                    {"name":"HoYoverse","color":"blue"},{"name":"Kuro Games","color":"green"},{"name":"기타","color":"gray"}]}}}})
            game_db_id = game_db["id"]
            cal_db = call("POST","databases",{"parent":{"type":"page_id","page_id":root_id},
                "icon":{"type":"emoji","emoji":"📅"},"is_inline":True,
                "title":[{"type":"text","text":{"content":"스트리밍 달력"}}],
                "properties":{"컨텐츠":{"title":{}},"날짜":{"date":{}},"컨텐츠 종류":{"multi_select":{"options":[
                    {"name":"방송","color":"yellow"},{"name":"합방","color":"orange"},
                    {"name":"특별 방송","color":"green"},{"name":"업데이트","color":"blue"},
                    {"name":"픽업","color":"pink"},{"name":"메인 스토리","color":"purple"}]}},
                    "버전":{"rich_text":{}},"상세":{"rich_text":{}},"컨텐츠 회차":{"number":{"format":"number"}},
                    "픽업 캐릭터":{"rich_text":{}},"게임":{"relation":{"database_id":game_db_id,"single_property":{}}}}})
            cal_db_id = cal_db["id"]
            doc_db = call("POST","databases",{"parent":{"type":"page_id","page_id":root_id},
                "icon":{"type":"emoji","emoji":"📝"},"is_inline":True,
                "title":[{"type":"text","text":{"content":"문서 목록"}}],
                "properties":{"문서명":{"title":{}},"분류":{"select":{"options":[
                    {"name":"메모","color":"purple"},{"name":"대본","color":"green"},{"name":"정리","color":"blue"}]}},
                    "게임 목록":{"relation":{"database_id":game_db_id,"single_property":{}}},"산출물":{"url":{}}}})
            doc_db_id = doc_db["id"]
            result = _j.dumps({"success":True,"rootPageId":root_id,"calendarDbId":cal_db_id,"documentDbId":doc_db_id,"gameDbId":game_db_id},ensure_ascii=False).encode()
            self.send_response(200);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(result)
        except Exception as e:
            err=_j.dumps({"error":str(e)},ensure_ascii=False).encode()
            self.send_response(500);self.send_header("Content-Type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers();self.wfile.write(err)

    def log_message(self, fmt, *args):
        pass  # 로그 억제

    def handle_error(self, request, client_address):
        import sys
        exc = sys.exc_info()[1]
        # 클라이언트가 먼저 연결을 끊는 경우 (WinError 10053 등) 무시
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(sys.argv[0])))
    print("\n" + "="*50)
    print("  게임 캘린더 로컬 서버")
    print("  http://localhost:8080/subcal.html")
    print("  종료: Ctrl+C")
    print("="*50 + "\n")
    HTTPServer(("", 8080), Handler).serve_forever()

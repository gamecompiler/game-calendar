# CLAUDE.md

컴파일러(스트리머)용 게임 이벤트 캘린더. HoYoverse 4종(붕3rd·붕스·원신·ZZZ)과 명조 이벤트를 수집하고, 노션 방송일정·문서와 통합한다.

## 구조

- `subcal.html` — React(Babel standalone, CDN) 단일 파일 SPA. 캘린더 UI 전체.
- `proxy.py` — 포트 8080 로컬 CORS 프록시. HoYoLAB / Kuro CDN / YouTube RSS / Notion API를 서버사이드로 중계. **로컬 실행의 기준 구현.**
- `api/*.js` — Vercel 배포용 서버리스 함수. proxy.py의 각 엔드포인트를 이식한 버전.
  - `api/notion.js` — 관리자 쓰기용(호출자 토큰 중계). `api/notion-public.js` — 팬 공개 읽기 전용(환경변수 토큰, GET·화이트리스트 DB만).
  - `api/wuwa.js` — 명조 일정. 쿠로게임즈 공식 홈페이지 뉴스 피드(`hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/{kr,en}/MainMenu.json`)의 `article` 배열을 파싱한다. (기존 런처 CDN `information/*.json` 은 빈 목록만 돌려줘 폐기, 2026-11) 항목에 썸네일 필드가 없어 `img` 는 빈 문자열일 수 있다.
    - 한국어 피드가 비울 때가 많아(버전 픽업 공지를 거의 안 올림) **영문 피드의 Convene(픽업) 공지를 겹쳐 읽어 빠진 픽업만 보강**한다. 제목은 `3.8 픽업 소환 1단계 (공명자·무기)` 형태로 바꾸고 원문은 `titleEn` 에 남긴다. 같은 픽업 판정 = 버전 일치 또는 날짜 ±3일. proxy.py `_handle_wuwa_news` 와 같은 규칙·같은 JSON.
  - `api/yt.js` — YouTube RSS·채널 아이콘·치지직 아이콘 + **`type=chzzk_live&ids=ID,ID`** (원스동 멤버 라이브 상태 `{ID:{status:OPEN|CLOSE,title,viewers}}`, 캐시 없음). proxy.py `_handle_chzzk_live` 와 같은 출력.
- `slide.html` — 웹 슬라이드(설명회·토론회). `/slide/<덱>` 으로 열린다(React 없이 순수 JS, subcal.html과 무관). 호스트(암호)가 넘기면 접속한 화면이 따라오고(1초마다 `op=state` 확인), `?view=script`는 송출컴용 대본 화면. **CastEdit 앱이 이 파일을 미리 보기로 그대로 묶어 쓴다** — 고치면 cast-ops의 `tools/cast-edit/castedit/slides_web/slide.html`에도 같은 내용을 넣을 것.
  - `api/slide.js` — 덱·그림·대본·지금 페이지 보관(Upstash Redis: `KV_REST_API_URL`/`KV_REST_API_TOKEN`). 열쇠는 `X-Slide-Key` 헤더, 서버에는 해시만. 주인 열쇠(앱이 올릴 때) / 호스트 암호(넘기기·대본). proxy.py는 같은 주소·같은 응답을 `.slide-store.json`(git 제외)으로 낸다.
- `reading.html` — **낭독회** (`/read` 작품 목록 · `/read/<작품>` 무대 · `?view=script` 전체 대본). 작품 = 낭독 대본 + 비주얼 노벨(배경·인물·대사창·문단 효과음·연출). 진행 암호를 넣은 사람이 넘기면 접속자가 따라오고(1초마다 `op=state`), 따라가기를 끄면 혼자 앞뒤로 본다. 참여 암호를 건 작품은 암호가 있어야 본문·그림이 보인다. 섭캘 머리줄의 [📖 낭독회]가 입구. **CastEdit 앱의 [낭독회 웹에 올리기]가 올린다** (본문 포함 — 컴파일러 결정, 2026-11-13).
  - `api/reading.js` — 작품·회차·그림·소리·지금 자리 보관 (웹 슬라이드와 같은 Upstash Redis · 같은 주인 열쇠 `slide:owner`). 헤더 `X-Slide-Key` = 주인 열쇠 또는 진행 암호, `X-Read-Pass`(그림·소리는 `?k=`) = 참여 암호. 서버에는 해시만. proxy.py가 같은 주소·같은 응답(`.slide-store.json`).
- 로컬은 proxy.py, 배포는 `/api/*`를 쓴다(HTML의 `IS_LOCAL` 자동 분기).
- 섭캘 화면 기능 몇 가지: 원스동 멤버 바의 **치지직 라이브(ON AIR)** 표시(1분마다 `/api/yt?type=chzzk_live`), 방송 카드의 **⚡ 특방·⚠️ 업데이트 겹침** 칩(같은 날 공식 대형 일정), 상단 **[📋 이번 주 일정표]** — 이번 주(월~일) 노션 방송일정을 16:9 캔버스 카드로 그려 클립보드 이미지 복사(Shift+클릭은 PNG 저장).
- **액자 모드** (`/frame`, 로컬은 `subcal.html?frame`) — `subcal.html` 안의 `FrameMode`. 같은 자료(게임 일정·방송일정)로 태블릿 화면보호기용 화면만 다르게 그린다. 그림은 기기의 폴더에서 직접 읽고(서버 업로드 없음), 설정·즐겨찾기·제외·재생목록은 그 브라우저의 localStorage(`frame_cfg_v1`)·IndexedDB(`frame_db`)에만 둔다.

---

## 1. 절대 변경 금지

### 5개 게임 공식 유튜브 채널 ID (명시적 지시 없이 절대 변경 금지)
| 게임 | 채널 ID |
|------|---------|
| 붕3rd | `UCHnxdu0qphnV3vrERNtCqpw` |
| 붕스 | `UCH33CJMcI0XZUpIhWRHiUuw` |
| 원신 | `UCcum1rCJ5GJeQ_xv0xrohqg` |
| ZZZ | `UCmry1hfaRHI_iTfxUMhC8mA` |
| 명조 | `UCKuq0c-RXYaulECSuu5hFug` |

이 값들은 HTML의 `GAME_YT_CHANNELS` / `HOYO_CFGS[].ytChannel` 과 proxy.py·api/yt.js의 `KNOWN_IDS`에 들어있다.

### 기존에 동작하던 값 보존
이미 동작하던 값은 **명시적 요청 없이 바꾸지 말 것.** 특히:
- `HOYO_CFGS[].icon` 아이콘 URL
- 치지직 / 컴파일러 / 통파일러 채널 ID
- 하드코딩된 Notion DB ID (방송일정 / 문서 DB 등)

---

## 2. 작업 방식

- **큰 변경이면 코드 수정 전에 계획을 먼저 한국어로 설명하고 승인받을 것.**
- 큰 블록을 수정할 때 주변 코드(함수 정의 등)를 실수로 삭제하지 않게 주의할 것.
- 의미 있는 작업 단위가 끝나면 git 커밋할 것.
- 결과는 **코드가 아니라 한국어 요약으로 보고**할 것. (사용자는 코드를 직접 읽지 않음)

---

## 3. 검증

- **API / 파싱 관련 수정 후에는 반드시 `python proxy.py`를 실제 실행해서 응답을 확인할 것.** 정적 분석만으로 "고쳤다"고 판단하지 말 것.
- 수정이 **로컬(proxy.py) 동작을 깨지 않는지** 항상 확인할 것.
- 배포 함수(`api/*.js`) 수정 시에는 **proxy.py 결과와 비교 검증**할 것(동일 JSON 출력 확인).

---

## 4. 보안

- **토큰·비밀값을 코드에 하드코딩하지 말 것.** 환경변수(`process.env`)로만 다룰 것.
- 토큰의 실제 값을 출력하거나 로그에 남기지 말 것.

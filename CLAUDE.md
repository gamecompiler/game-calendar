# CLAUDE.md

컴파일러(스트리머)용 게임 이벤트 캘린더. HoYoverse 4종(붕3rd·붕스·원신·ZZZ)과 명조 이벤트를 수집하고, 노션 방송일정·문서와 통합한다.

## 구조

- `game-calendar-standalone.html` — React(Babel standalone, CDN) 단일 파일 SPA. 캘린더 UI 전체.
- `proxy.py` — 포트 8080 로컬 CORS 프록시. HoYoLAB / Kuro CDN / YouTube RSS / Notion API를 서버사이드로 중계. **로컬 실행의 기준 구현.**
- `api/*.js` — Vercel 배포용 서버리스 함수. proxy.py의 각 엔드포인트를 이식한 버전.
  - `api/notion.js` — 관리자 쓰기용(호출자 토큰 중계). `api/notion-public.js` — 팬 공개 읽기 전용(환경변수 토큰, GET·화이트리스트 DB만).
- 로컬은 proxy.py, 배포는 `/api/*`를 쓴다(HTML의 `IS_LOCAL` 자동 분기).

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

# CLAUDE.md

컴파일러(스트리머)용 게임 이벤트 캘린더. HoYoverse 4종(붕3rd·붕스·원신·ZZZ)과 명조 이벤트를 수집하고, 노션 방송일정·문서와 통합한다.

- `game-calendar-standalone.html` — React(Babel standalone, CDN) 단일 파일 SPA. 캘린더 UI 전체.
- `proxy.py` — 포트 8080 로컬 CORS 프록시. HoYoLAB / Kuro CDN / YouTube RSS / Notion API를 서버사이드로 중계.

## 절대 변경 금지 규칙

### 1. 5개 게임 공식 유튜브 채널 ID (절대 변경 금지)
| 게임 | 채널 ID |
|------|---------|
| 붕3rd | `UCHnxdu0qphnV3vrERNtCqpw` |
| 붕스 | `UCH33CJMcI0XZUpIhWRHiUuw` |
| 원신 | `UCcum1rCJ5GJeQ_xv0xrohqg` |
| ZZZ | `UCmry1hfaRHI_iTfxUMhC8mA` |
| 명조 | `UCKuq0c-RXYaulECSuu5hFug` |

이 값들은 HTML의 `GAME_YT_CHANNELS` / `HOYO_CFGS[].ytChannel` 과 proxy.py의 `KNOWN_IDS`에 들어있다. 어떤 경우에도 수정하지 말 것.

### 2. 기존 동작 값 보존
이미 동작하던 값(채널 ID, 아이콘 URL 등)은 사용자의 **명시적 요청 없이 변경 금지**. 특히:
- `HOYO_CFGS[].icon` 의 아이콘 URL
- 치지직/컴파일러/통파일러 채널 ID
- 하드코딩된 Notion DB ID / 토큰

### 3. 검증 의무
코드 수정 후에는 반드시 `python proxy.py` 를 실행해서 실제 응답을 검증할 것. 정적 분석만으로 "고쳤다"고 판단하지 말 것.

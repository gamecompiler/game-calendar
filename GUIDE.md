# 컴파일러의 서브컬쳐 캘린더 — 실행 가이드

## 📁 파일 구성

```
로컬 실행 (3개 파일)
├── subcal.html   ← 메인 앱
├── proxy.py                        ← 로컬 CORS 프록시 서버
└── launch.bat                      ← 원클릭 실행 (Windows)

웹 배포 (vercel-deploy 폴더)
└── vercel-deploy/
    ├── public/
    │   └── index.html              ← 앱 (HTML과 동일)
    ├── api/
    │   ├── hoyo.js                 ← HoYoLAB API 프록시
    │   ├── yt.js                   ← YouTube RSS + 채널 아이콘
    │   ├── img.js                  ← 이미지 프록시
    │   ├── notion.js               ← Notion CRUD
    │   ├── notion-pages.js         ← Notion 페이지 일괄 조회
    │   ├── notion-setup.js         ← 신규 사용자 DB 자동 생성
    │   └── wuwa.js                 ← 명조 Kuro CDN 뉴스
    ├── vercel.json
    └── package.json
```

---

## 🖥️ 로컬 실행 (Windows)

### 사전 준비
- **Python 3.8 이상** 설치 필요
  - 설치 확인: 명령 프롬프트에서 `python --version`
  - 미설치 시: https://www.python.org/downloads/

### 실행 방법
1. `subcal.html`, `proxy.py`, `launch.bat`을 **같은 폴더**에 놓기
2. **`launch.bat` 더블클릭**
3. 브라우저 자동 실행 → `http://localhost:8080/subcal.html`

### 수동 실행 (선택)
```batch
# 명령 프롬프트에서
cd C:\Users\...\calendar-folder
python proxy.py
# 브라우저에서 http://localhost:8080/subcal.html 열기
```

### 처음 실행 시 설정
1. 우상단 ⚙ 설정 탭 클릭
2. **Notion Integration Token** 입력 (`ntn_...`)
   - 발급: https://www.notion.so/my-integrations → 통합 만들기
3. **저장** 클릭
4. 방송/문서 DB가 이미 있다면 DB ID 입력 → 저장
5. DB가 없다면 **"🚀 Notion 초기 설정"** 버튼 → 자동 생성

---

## ☁️ 웹 배포 (Vercel)

### 사전 준비
- **Node.js 18 이상** 설치: https://nodejs.org/
- **Vercel 계정**: https://vercel.com/ (GitHub 계정으로 가입 가능)

### 방법 1: Vercel CLI (권장)
```bash
# 1. Vercel CLI 설치
npm install -g vercel

# 2. vercel-deploy 폴더로 이동
cd vercel-deploy

# 3. 배포
vercel deploy

# → 배포 URL 예시: https://streaming-calendar-xxx.vercel.app
```

### 방법 2: GitHub 연동 (자동 배포)
1. `vercel-deploy` 폴더 내용을 GitHub 저장소에 업로드
2. Vercel 대시보드 → **Add New Project** → GitHub 저장소 선택
3. Framework Preset: **Other** 선택
4. **Deploy** 클릭
5. 이후 `main` 브랜치에 push할 때마다 자동 배포

### 웹 배포 후 첫 사용 (신규 사용자)

```
1. Notion 통합 만들기
   notion.so/my-integrations → New integration → Internal
   → Token 복사 (ntn_...)
   → 원하는 Notion 페이지에서 공유 → 통합 이름 → Invite

2. 배포된 URL 접속
   https://your-app.vercel.app

3. ⚙ 설정 탭 → Token 입력 → 저장

4. "🚀 Notion 초기 설정" 버튼 클릭
   → 자동 생성:
      📅 스트리밍 달력 DB
      📝 문서 목록 DB
      🎮 게임 목록 DB

5. DB ID 자동 입력 확인 → 저장 → 완료
```

---

## 🎮 기능 사용법

### 게임 이벤트 수집
- 사이드바 각 게임 옆 **↻** 버튼 → 해당 게임 이벤트 수집
- **전체 재수집** 버튼 → 5개 게임 동시 수집
- 데이터는 6시간 캐시 (로컬 저장)

### 방송 일정 관리
- 날짜에 마우스 오버 → **+** 버튼 클릭
- 방송 탭 선택 → 컨텐츠명, 시간, 게임, 태그 입력 → Notion에 추가
- 기존 방송 카드 클릭 → 하단 편집 패널 → 수정/삭제

### 문서 관리
- 사이드바 **문서 목록** → **+** 버튼
- 제목, 분류(메모/대본/정리), 게임 선택 → Notion에 추가
- 문서 클릭 → 편집 팝업 → 수정/삭제/Notion에서 열기

### 캘린더 조작
- **주 클릭** → 숨겨진 이벤트 펼치기 (애니메이션)
- **주 hover** → 파란 하이라이트
- **월/일 요일 시작** → 우상단 토글
- **다크/라이트 모드** → 달 아이콘 토글

---

## ❓ 문제 해결

| 증상 | 해결 |
|---|---|
| 브라우저가 안 열림 | 수동으로 `http://localhost:8080/subcal.html` 접속 |
| "Script error." | Ctrl+F5 (강제 새로고침) |
| 이벤트 수집 안 됨 | 로그 버튼 클릭으로 오류 확인 |
| Notion 연동 안 됨 | Token 재입력, 통합이 페이지에 공유됐는지 확인 |
| 명조 이벤트 없음 | Kuro CDN이 응답 없을 때 — 잠시 후 재시도 |
| 채널 아이콘 없음 | YouTube 봇 차단 → 이모지로 자동 대체 (정상) |

---

## 📋 지원 게임
| 게임 | 이벤트 출처 |
|---|---|
| 붕괴3rd | HoYoLAB BBS API |
| 붕괴: 스타레일 | HoYoLAB BBS API |
| 원신 | HoYoLAB BBS API |
| 젠레스 존 제로 | HoYoLAB BBS API |
| 명조: 워더링 웨이브 | Kuro Games 공식 CDN API |

모든 게임: YouTube RSS 영상 포함

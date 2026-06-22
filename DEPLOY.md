# 🌐 인터넷에 배포하기 (어디서나 접속)

학교 와이파이 제약 없이, 학생들이 집·다른 교실 어디서든 공개 주소로 접속하게 하는 방법입니다.
**터미널 없이** 웹 화면 클릭만으로 가능합니다.

> ⚠️ Vercel·Netlify에는 올리지 마세요. 실시간 연결(WebSocket)을 지원하지 않아 이 게임은 동작하지 않습니다.

---

## 방법 A. Render (무료 · 신용카드 불필요) — 추천

15분간 아무도 안 들어오면 서버가 "잠들고", 다음 접속 때 30~60초 깨어나는 시간이 있습니다.
**수업 5분 전에 상황판을 한 번 열어 깨워두면** 문제없습니다. (이 게임은 끊겨도 자동 재접속됩니다.)

### 1단계 · GitHub에 코드 올리기 (터미널 불필요)
1. https://github.com 가입 후 로그인
2. 오른쪽 위 **＋ → New repository** → 이름 예: `tetris-battle` → **Public** 선택 → **Create repository**
3. **uploading an existing file** 링크 클릭
4. `tetris-battle` 폴더 안의 파일을 드래그해서 올립니다. **폴더 구조를 그대로** 올려야 합니다:
   ```
   server.js          ← 최상위(루트)
   package.json       ← 최상위(루트)
   public/index.html  ← public 폴더 안
   ```
   👉 `public` 폴더째 드래그하면 경로가 유지됩니다. (`server.js`와 `package.json`은 반드시 맨 위에)
5. 아래 **Commit changes** 클릭

### 2단계 · Render에 연결
1. https://render.com → **Get Started** → **GitHub로 로그인** (카드 필요 없음)
2. **New + → Web Service**
3. 방금 만든 `tetris-battle` 저장소 선택 → **Connect**
4. 설정:
   - **Region**: `Singapore` (한국에서 가장 가까움)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`  (보통 자동으로 채워짐)
   - **Instance Type**: **Free**
5. **Create Web Service** → 1~2분 빌드 후 `https://tetris-battle-xxxx.onrender.com` 같은 주소가 생깁니다.

### 3단계 · 수업에서 사용
- **교사(상황판)**: `https://...onrender.com/?host=1`
- **학생**: `https://...onrender.com`
- 상황판 위쪽에 **학생 접속 주소(공개 주소)** 가 자동으로 표시됩니다. 그걸 칠판에 적거나 공유하세요.

---

## 방법 B. Railway (항상 켜짐 · 카드 필요 · 약 $5/월)

잠들지 않아서 깨어나는 대기 시간이 없습니다. 가장 매끄럽지만 카드 등록이 필요합니다.

1. 위 **1단계(GitHub에 올리기)** 를 동일하게 진행
2. https://railway.com → **GitHub로 로그인** (카드 등록)
3. **New Project → Deploy from GitHub repo** → `tetris-battle` 선택 → 자동 빌드/배포
4. 서비스 클릭 → **Settings → Networking → Generate Domain** 으로 공개 주소 생성
5. 사용법은 Render와 동일: 교사 `주소/?host=1`, 학생 `주소`

---

## 자주 묻는 문제

- **화면은 뜨는데 "대기 중"에서 안 넘어가요** → 상황판에서 **▶ 시작**을 눌러야 시작됩니다.
- **첫 학생만 한참 기다려요 (Render)** → 잠들어 있던 서버가 깨는 중입니다(30~60초). 수업 전에 미리 한 번 열어두세요.
- **빌드 실패** → GitHub 저장소 최상위에 `server.js`와 `package.json`이 있는지, `index.html`이 `public/` 안에 있는지 확인하세요.
- **방장 권한** → 누구나 `/?host=1`로 상황판을 열 수 있습니다. 시작/리셋을 교사만 하려면 학생에게는 공개 주소(`/`)만 알려주세요.

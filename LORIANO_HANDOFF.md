# LORIANO 아카이브 인수인계

> 현황 기준: 2026-11-15. 민감한 API 키, 비밀번호, Cloudflare/GitHub 토큰 값은 기록하지 않습니다.

## 프로젝트와 기존 구조

- GitHub: https://github.com/subinan0204/loriano-archive/ (`main`)
- GitHub Pages: https://subinan0204.github.io/loriano-archive/
- 기존 단일 정적 HTML 앱과 별도 JS/CSS 파일 구성입니다.
- `index.html` 안의 `ArchiveEngine`은 IndexedDB `loriano-archive-v1` v1의 `videos`, `comments`, `meta`와 LocalStorage `loriano-settings-v1`를 사용합니다. 댓글/수집 상태/설정 등 개인 기록을 보관하므로 초기화·전체 덮어쓰기 금지.
- PWA 오프라인 fallback은 `sw.js`와 Workbox가 처리합니다. 앱 전용 `pwabuilder-page-v*` 캐시 외에는 삭제하지 마세요.
- 기존 화면: 달력, 영상 모아보기, 인기 영상, 키워드·검색, 상세 영상·댓글, 색상 아카이브 링크, 브라우저 내 채널 동기화/설정. 기존 API 설정·채널 수집 방식은 Worker와 별도로 보존해야 합니다.

## 현재 저장소 커밋과 배포

- 최신 확인 커밋: `eaa73953f5f0b4b7625cea92aeb2d0a78d3c3c71` (`Refresh player stylesheet cache version`). 앞의 주요 커밋: `539f708`(handoff/Worker), `9411330`(플로팅 CSS), `3ea3eed`(플레이어/SW), `eaa7395`(CSS 캐시 버전).
- `eaa7395` GitHub Pages 배포 상태는 `success` 확인. 이 문서 업데이트 커밋 뒤 Pages와 연결된 Cloudflare Worker 빌드도 별도 확인 필요.
- `index.html`은 이번 작업에서 수정하지 않았습니다. IndexedDB 스키마, 사용자 영상/댓글 데이터, LocalStorage 전체를 지우거나 마이그레이션하지 않았습니다.

## 주요 파일과 변경 내용

- `index.html`: 기존 앱/ArchiveEngine/달력/검색/댓글/분류/샘플·설정 UI. 대용량 파일, 통째 교체 금지.
- `mini-player-catalog.js`: 2026-11-15 기준 205곡 fallback.
- `mini-player-queue.js`: 네트워크·DB 부작용 없는 셔플/순차/반복·이력 큐.
- `mini-player.js`: 이번 수정에서 별도 `mpExpand` 열기 버튼을 런타임 제거하고, 재생 버튼으로 패널 표시·재생, 패널 안 닫기(정지), 공식 IFrame 재사용, Worker 공개 JSON 폴링(10분), queue state 재매핑을 연결했습니다. ArchiveEngine `getVideos()`를 read-only overlay로 감싸 Worker 목록이 있으면 목록/달력에 표시합니다. Worker/JSON이 없으면 기존 IndexedDB 결과 및 205곡 fallback 사용. 기존 DB·댓글은 삭제하지 않습니다. Worker feed가 아직 준비 전이므로 목록 통합 완료로 간주하면 안 됩니다.
- `mini-player.css`: 오른쪽 아래 fixed panel, 닫기 버튼, PC/모바일 반응형 규칙 추가. 최신 사용자 후속 요청으로 모바일 크기 최적화가 남아 있습니다. 현재 모바일 CSS는 폭 `calc(100vw - 20px)` 및 최소 높이 200px라 360px에서 16:9와 정확히 맞지 않습니다.
- `sw.js`: 플레이어 전용 캐시를 `pwabuilder-page-v4-mini-player`로 올리고 최신 CSS `?v=2`를 캐시하도록 변경.
- `LORIANO_HANDOFF.md`: 본 문서.
- `playlist-sync-worker.mjs`: Worker 구현 소스. 전체 페이지네이션 + 메타데이터, 페이지/응답 검증, 단일 KV snapshot만 성공 후 교체, `/health`, `/api/playlist`, `/api/sync`(관리 Secret 인증), CORS.
- `playlist-sync-worker.test.mjs`: 실제 YouTube 미호출 mock 테스트.
- `wrangler.toml`: 기존 KV binding/Worker/루트 엔트리/Cron 설정.
- `WORKER_SETUP.md`: Secret 이름과 endpoint 안내.

## 미니 플레이어 상태와 남은 검증

- 기존 구현은 재생/일시정지·정지·이전/다음·랜덤(한 순회 중복 방지)/순차/전체 반복·제목/시간·위치/모드/이력 저장 및 복원, 상세 영상과의 상호 정지를 지원합니다. 첫 접속 자동재생 없음.
- 새 변경은 별도 영상 열기 버튼 없이 재생 클릭 시 패널을 열고 공식 YouTube IFrame API를 사용하도록 했습니다. 닫기 버튼은 `닫기 ×`, 정지 후 숨김으로 설계. 같은 iframe/player 재사용.
- 새 CSS 전에는 브라우저가 이전 `mini-player.css?v=1`을 캐시해 인라인처럼 보였습니다. JS가 CSS URL을 v2로 바꾸고 SW도 v2를 캐시하도록 했습니다. 새 페이지에서 버튼 제거와 `position: fixed`는 확인했지만, 최신 커밋 기준 실제 재생/닫기 E2E와 각 viewport 플로팅 위치는 재검증해야 합니다.
- 오디오 전용/숨김 재생 금지. 모바일 자동재생 제한 메시지도 확인.

## Cloudflare Worker/KV/Cron/Secrets

- Worker: `loriano-playlist-sync`. KV: `loriano-playlist-catalog`, binding `PLAYLIST_KV` (namespace ID는 `wrangler.toml`). 검사 당시 KV는 0 B.
- 암호화된 Secret 이름이 이미 등록돼 있음을 확인: `YOUTUBE_API_KEY`, `ADMIN_TOKEN`. 값은 읽거나 기록하지 않았고 저장소/브라우저에 넣으면 안 됩니다.
- Wrangler Cron은 `17 0 * * *` UTC (한국 시간 매일 09:17). Git 연동 전 Cloudflare Settings 화면에는 Cron이 없었으므로 빌드 후 Trigger events에서 확인.
- Cloudflare Builds를 GitHub `subinan0204/loriano-archive`, branch `main`, Root `/`, Deploy command `npx wrangler deploy`로 연결했습니다. Build command는 None. Cloudflare UI는 연결 후 “push a commit to start your first build”를 표시했습니다. 이번 문서 갱신 커밋이 첫 빌드를 시작하므로 성공/Secret·KV 유지 여부 확인 필수.
- Quick Edit 첫 배포 시 중괄호 자동완성으로 `Uncaught SyntaxError: Unexpected token '}' at worker.js:164:40`가 발생했고 그 시도는 실패. `editor.autoClosingBrackets=never`로 바꾸고 수정 후 문법 오류 0을 확인하고 Quick Edit이 `Version saved`, version `359bc9c5`를 표시했습니다. 하지만 직후 실제 `/health` fetch는 JSON이 아니라 `Hello World!`를 반환해 production 동작을 확정하지 못했습니다. GitHub Worker build 후 재검증이 기준입니다.

## 테스트와 미검증

- 공개 `/mini-player-tests.html`: 기존 queue 회귀 테스트 **329 assertions / 205 tracks PASS**.
- Worker mock 브라우저 harness: 11개 묶음 확인 통과(205개/5페이지, metadata, 중간 페이지 실패 시 KV 미쓰기·이전 값 유지, CORS, 무인증 거부/관리자 인증). 실제 API/Secret 호출은 없었습니다.
- 저장소 `playlist-sync-worker.test.mjs`에는 `assert.*` 15개가 있지만 PowerShell 샌드박스의 Node 파일 경로 접근이 거부돼 테스트 파일 자체는 실행하지 못했습니다. Browser mock harness가 별도로 통과한 것입니다.
- 1440/768/390/360px viewport에서 문서 가로폭은 각각 1425/753/375/345px로 가로 overflow 없음. 데스크톱 Chrome viewport 결과입니다. 플로팅 패널 open 상태/가림/화면 밖 여부는 다시 확인해야 합니다. iPhone Safari/Android 실기기 미실행.
- 실제 YouTube 재생/정지/닫기/곡 전환/셔플/반복, Worker API 응답/첫 실동기화/실제 Cron/Archive overlay는 완료로 표시하면 안 됩니다.

## 다음 실행 순서

1. 이 handoff 커밋으로 Cloudflare 첫 Git build가 시작됐는지 Deployments에서 확인. 실패 시 logs를 읽고 기존 production/Secrets/KV를 지키며 수정.
2. 성공 후 Secret 이름, `PLAYLIST_KV`, Trigger events의 `17 0 * * *`를 확인. `/health` JSON의 `configured:true`, `/api/playlist`의 빈 KV 예상 503을 검증.
3. 관리자가 `POST /api/sync`를 `Authorization: Bearer <ADMIN_TOKEN>`으로 실행해 초기 전체 목록을 생성. 값은 채팅/명령 기록/repo에 쓰지 않음. 성공 후 `/health` count와 `/api/playlist` schema/약 205곡 확인.
4. 최신 Pages에서 Worker JSON이 player queue/기존 archive read-only overlay에 들어오는지 확인. 삭제된 항목은 보이는 목록에서만 숨기고 IndexedDB 영상/댓글 행은 보존.
5. 공식 YouTube iframe으로 재생, 일시정지, 정지, 이전/다음, 셔플, 반복, 닫기 후 재생, 상세 영상과 상호 정지를 확인. 새로고침 직후 자동재생 금지 확인.
6. **사용자가 추가한 후속 요청:** 현재 통합/배포 검증이 끝난 다음, 모바일 플로팅 YouTube 영상을 가능한 작은 실용 크기로 조정. 16:9, 오른쪽 아래 고정, 메뉴/아카이브 가림 최소화, 닫기 터치 영역 유지, PC 배치는 그대로. 360px/390px viewport에서 실제 확인하고, 재생 로직은 바꾸지 않음. YouTube 공식 최소 크기와 16:9 제약을 확인해 양립 가능한 크기 선택.
7. queue 329, Worker mock, 1440/768/390/360 overflow 및 open panel 가림 테스트, 실재 YouTube 동작, Pages/Cloudflare deployment 성공 확인 후 문서의 커밋/배포 상태 업데이트. 실제 기기 테스트 전 실기기 완료로 표기하지 않음.

## 데이터 보호 체크리스트

`indexedDB.deleteDatabase`, `clearDB`, 기존 store clear, LocalStorage 전체 clear를 실행하지 마세요. API 키/관리 토큰 값을 handoff, 문서, client JS, Worker source, GitHub commit에 포함하지 마세요. 부분 페이지/할당량/응답 오류면 KV 정상 snapshot을 덮어쓰지 않습니다.

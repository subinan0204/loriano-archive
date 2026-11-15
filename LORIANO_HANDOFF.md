# LORIANO 아카이브 인수인계

> 기록 시점: 2026-11-15. 이 문서는 기존 데이터와 기능을 보존한 채 작업을 이어가기 위한 현황 기록입니다. 민감한 키·토큰 값은 포함하지 않습니다.

## 1. 프로젝트 개요와 현재 배포

- 저장소: https://github.com/subinan0204/loriano-archive/ (`main` 브랜치)
- 공개 사이트: https://subinan0204.github.io/loriano-archive/
- 사이트는 정적 GitHub Pages 앱이며, 기록과 설정은 방문자 브라우저에 따로 저장됩니다.
- 조사 시점 최신 커밋: `7a8ec2ffc28275005d334358b1979e129e16945b` (`Add YouTube mini player without autoplay`). 저장소 화면과 GitHub Pages 배포에 성공 표시가 있었습니다.
- 사이트에서 확인된 기능: 달력, 영상 모아보기, 인기 영상, 키워드/검색, 색상 아카이브 링크, 설정, 수동/10분 주기 채널 동기화, 상세 영상 및 댓글. 현재 열어 본 브라우저 프로필에는 아카이브 영상이 0개로 표시됐습니다. 이것은 이 브라우저의 현재 화면 관찰이며 사용자의 다른 기기/브라우저 저장 데이터가 없다는 뜻은 아닙니다.

## 2. 기존 저장 구조와 보호 사항

- `index.html`의 `ArchiveEngine`가 IndexedDB `loriano-archive-v1` 버전 1을 사용합니다. 스토어는 `videos`, `comments`, `meta`입니다. 기존 DB 스키마와 저장된 행을 초기화/삭제하지 마세요.
- 채널/API 설정은 LocalStorage `loriano-settings-v1`에 저장됩니다. 플레이어 상태는 별도 `loriano-mini-player-v1` 키입니다. LocalStorage 전체 삭제 금지.
- `sample()`/`reset()`는 기존 UI의 파괴적 작업입니다. 인수인계 중 테스트에서 실행하지 않았습니다.
- `sw.js`는 Workbox와 앱 오프라인 fallback을 사용합니다. 수정 시 앱 소유 `pwabuilder-page-v*` 캐시만 교체하고 기존 캐시 동작을 보존하세요.
- 기존 채널 업로드 동기화는 브라우저 설정에 API 키와 채널 핸들이 있을 때 IndexedDB에 저장합니다. 댓글 수집 상태/페이지 커서는 `meta`에 보관됩니다.

## 3. 기존 미니 플레이어 상태

- 최근 커밋에서 `mini-player.js`, `mini-player-queue.js`, `mini-player-catalog.js`, `mini-player.css`, `mini-player-tests.html`가 추가되었고 `index.html`/`sw.js`가 제한적으로 수정되었습니다.
- 카탈로그 기준 205곡. 재생/일시정지, 정지, 이전/다음, 셔플(한 바퀴 중복 방지), 순차, 전체 반복, 제목/시간, 위치·모드·이력 저장 및 복원을 구현했습니다. 최초 접속은 자동 재생하지 않습니다. 기존 상세 iframe과 미니 플레이어 사이 재생 충돌도 관리합니다.
- 현재 배포본에는 재생바에 별도 `영상 패널 열기` 버튼이 남아 있고 영상 영역은 페이지 내 인라인입니다. 사용자가 요청한 오른쪽 아래 고정 플로팅 동작과 패널 내 닫기 버튼은 아직 배포되지 않았습니다. 현재 닫기 토글은 일시정지 중심이라 완전 정지/닫기/재생 재개 동작을 추가 검증해야 합니다.
- 최신 커밋의 플레이어 목록 갱신은 기존 브라우저 설정의 YouTube API 키를 재사용합니다. 새 구조에서는 플레이어용 재생목록을 Worker 공개 JSON에서 읽고, API 키는 Worker Secret에서만 사용하도록 전환해야 합니다. 기존 ArchiveEngine의 사용자 채널 동기화·설정 경로는 별도로 보존합니다.

## 4. Cloudflare Worker/KV/Cron 현황

- 확인한 Cloudflare 계정에 Worker `loriano-playlist-sync`가 이미 존재하지만, 프로덕션 코드의 응답은 현재 `Hello World!`입니다. 최신으로 확인한 배포 ID 앞부분은 `65bc1dc7`.
- Worker 설정에는 암호화 Secret 이름 `YOUTUBE_API_KEY`와 `ADMIN_TOKEN`이 있습니다. 값은 열람·기록하지 않았고, 저장소/브라우저로 옮기지 마세요.
- KV namespace `loriano-playlist-catalog`가 있고 Worker binding 이름은 `PLAYLIST_KV`입니다. 조사 시점 KV 사용량과 저장 용량은 0으로 표시됐습니다.
- 아직 Cron Trigger가 구성되지 않았습니다. 목표는 `17 0 * * *` UTC, 즉 한국 시간 매일 오전 9:17입니다.
- 재사용을 위해 Worker 코드 초안은 전체 페이지네이션, 페이지 토큰 반복/목록 변동/부분 응답 검증, videos.list 메타데이터 수집, 단일 KV 스냅샷 쓰기, 공개 GET JSON, Secret 인증 수동 POST, 상태 확인을 포함하도록 작성했습니다. **프로덕션 Worker에는 아직 배포되지 않았습니다.**
- 예정 Secret 이름만 문서화: `YOUTUBE_API_KEY`, `ADMIN_TOKEN`. API 키와 토큰의 실제 값은 절대 커밋하지 마세요.

## 5. 이번 세션 진행·수정 현황

- 저장소/Pages 최신 코드 및 GitHub 최신 커밋을 확인했습니다. 기존 queue 테스트를 공개 Pages에서 실행해 **329 assertions / 205 tracks 통과**를 확인했습니다.
- Worker 모의 브라우저 테스트 **11 assertions 통과**: 205개 5페이지, 메타데이터 보강, 중간 페이지 실패 시 기존 KV 스냅샷 유지/부분 쓰기 없음, 공개 JSON+CORS, 관리자 없는 POST 차단, 인증된 수동 동기화. 이 검사는 실제 YouTube API/실제 Secret을 호출하지 않았습니다.
- 작업 중 작성한 Worker 초안·`wrangler.toml`·Node 테스트·플레이어 JS/CSS/SW 초안은 이번 인수인계용 커밋에 파일로 보존할 예정입니다. 어느 것도 이 기록 시점에는 프로덕션 배포 완료로 간주하지 마세요.
- Cloudflare Quick Edit의 Monaco 편집 대상은 `textarea`가 읽기 전용이어서 자동 입력이 실패했고, 미배포 편집 초안 일부가 편집기 메모리에 남아 있을 수 있습니다. **Deploy를 누르지 않았고, 프로덕션 응답은 여전히 Hello World였습니다.** 다음 작업은 GitHub에 보존한 소스를 정본으로 사용하고 불완전한 Quick Edit 초안은 배포하지 마세요.
- GitHub 웹 편집기에서 큰 파일을 직접 채우는 시도도 일부 표시만 되어 커밋하지 않고 취소했습니다. 저장소의 기존 파일은 이 시점까지 변경되지 않았습니다.
- 이전 AI가 보고한 “Aside 서버 오류”는 이 저장소 커밋/현재 페이지에서 재현할 로그를 찾지 못해 원인 미상입니다.

## 6. 파일별 역할

- `index.html`: 정적 앱, ArchiveEngine, UI, IndexedDB 버전 1, 기존 댓글/검색/분류/달력. 대용량 파일이므로 전체 대체 금지.
- `mini-player.js`: YouTube IFrame API 제어, 플레이리스트, 상태 저장, iframe 간 충돌 방지.
- `mini-player-queue.js`: 네트워크/DB 부작용 없는 재생 큐.
- `mini-player-catalog.js`: 205곡 기준 카탈로그. Worker JSON이 준비될 때 fallback으로 유지.
- `mini-player.css`: 플레이어 전용 반응형 스타일.
- `mini-player-tests.html`: 큐 회귀 테스트. 공개 경로 `/mini-player-tests.html`.
- `sw.js`: Workbox/offline fallback과 앱 자산 캐시.
- 이번 커밋에 추가될 `playlist-sync-worker.mjs`, `wrangler.toml`, `playlist-sync-worker.test.mjs`, `WORKER_SETUP.md`: Worker 정본, 기존 KV/Cron 설정, mock 테스트, 설정 안내.

## 7. 미완성 작업과 다음 실행 순서

1. 이번 커밋의 `playlist-sync-worker.mjs`와 `wrangler.toml`이 배포 대상 Worker와 binding/cron 값에 맞는지 확인합니다. Cloudflare Git 연동 또는 검증된 소스 배포 절차를 사용합니다. 기존 encrypted Secrets와 `PLAYLIST_KV`를 덮어쓰거나 삭제하지 마세요.
2. Worker를 배포하고 설정 화면에서 Cron `17 0 * * *`을 확인합니다. 첫 동기화는 관리 인증 경로로 실행하고 `/health` 및 `/api/playlist`에서 정상 JSON/205개 이상 항목을 확인합니다. API 키/토큰을 출력하거나 커밋하지 마세요.
3. JSON 수집 실패·할당량 초과·페이지 토큰 반복·응답 형식 오류가 발생할 때 기존 KV 스냅샷이 유지되는지 mock 테스트를 다시 실행합니다. 실제 첫 production sync 전에는 빈 KV이므로 기존 정상 스냅샷이 없습니다.
4. `mini-player.js`에서 Worker JSON을 가져오도록 통합합니다. 보수적 검증 후 기존 Queue의 `snapshot()` 상태를 재사용해 현재 곡/셔플 방문 이력/위치를 보존합니다. 기존 개인 데이터는 건드리지 않습니다. Worker 목록은 기존 영상 행을 덮어쓰지 않는 읽기 전용 표시 오버레이로 연결하고, 목록에서 사라진 영상의 IndexedDB/댓글 기록은 삭제하지 않습니다.
5. 인라인 플레이어를 오른쪽 아래 반응형 고정 패널로 바꾸고, 별도 열기 버튼을 제거합니다. 재생 버튼 하나가 패널 표시와 재생을 담당하도록 하고, 닫기는 완전 정지 후 숨김, 다음 재생은 같은 단일 iframe 재사용으로 확인합니다. iframe 숨김 오디오 재생은 금지합니다.
6. `sw.js` 앱 캐시 버전을 갱신해 최신 JS/CSS 오프라인 캐시를 반영하고 기존 offline fallback/다른 앱 캐시에 영향을 주지 않는지 확인합니다.
7. GitHub Pages의 공개 queue 테스트, 실제 Worker GET, 재생/일시정지/정지/이전/다음/셔플/반복/닫기/상세영상 상호 정지를 확인합니다. PC 1440px, 태블릿 768px, 모바일 화면 390px/360px에서 `scrollWidth <= clientWidth`, 패널 화면 안 배치/주요 버튼 가림을 확인합니다. 실제 기기 테스트 전에는 실기기 완료로 표기하지 마세요.
8. GitHub Pages latest commit/deployment 성공을 확인하고 이 문서의 커밋, 배포, Worker/cron/API 실측 결과를 최종 업데이트합니다.

## 8. 아직 완료로 표시하면 안 되는 항목

- Worker 코드 프로덕션 배포 및 첫 실 API 동기화
- Cron Trigger의 실제 활성 여부와 다음 실행
- Worker JSON을 main archive list와 mini-player가 실제로 가져오는 통합
- 요청한 플로팅 UI의 브라우저/화면 크기 테스트와 실제 YouTube 재생·닫기 동작
- 이번 세션의 최종 GitHub Pages 배포 상태와 기기별 확인
- iOS Safari/Android 실기기 테스트 (이전 문서에도 미실행으로 기록됨)

## 9. 안전 규칙

IndexedDB 초기화/삭제, LocalStorage 전체 삭제, 기존 영상/댓글/달력 데이터 덮어쓰기, 기존 기능 축소, 서비스 워커 오프라인 기능 제거를 하지 마세요. 변경은 작은 호환성 있는 단위로 하고, 오류 시 기존 KV/브라우저 데이터 보존을 먼저 검증하세요.

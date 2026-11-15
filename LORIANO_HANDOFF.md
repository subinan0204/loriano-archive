# 2026-11-16 KST 미니 플레이어 v8 최신 변경

이 절이 아래 과거 v6/v7 UI 설명보다 우선합니다. 이 커밋은 프런트엔드·테스트·문서만 변경하며 Worker/KV/개인DB 스키마·원문을 변경하지 않습니다. 배포 후 검증은 별도 최종 보고로 보완합니다.

## 확인된 기준
- 시작 GitHub/Pages fda4aad5967b31d6cac95ac66a2bfc7b2d0e9f91, Pages workflow39 성공.
- Cloudflare 현재 f07113c6 Ready25s 실제 대시보드 확인. 이번 Worker 재배포 불필요. /health snapshot205, updatedAt 2026-11-15T02:18:04.480Z 유지.
- 기존 복구 ZIP C:\Users\Adnub\Downloads\LORIANO-PRIVATE-recovery-2026-11-15.zip 확인. 내부 private-backup 원문 SHA256 876d0c4604b6fe9297209827642084b168bc7b6b869d2c227c6a66bf894123e4 재검증. 공개 소스와 분리.
- 복구 ZIP에는 마지막 스마트폰 화면 PNG가 없었고 현행 repo에는 JSON 검증 기록만 있습니다. 이번 화면 증거는 별도 임시 검증 폴더 및 최종 인수인계에 제공.

## 실제 원인과 최소 수정
expand()가 .mp-bar를 mpStage에 append하여 하단패널로 바꾸던 로직과 관련 CSS를 제거. .mp-bar DOM 부모/순서 불변. header 종료 위치만 상단바 직전으로 조정하여 스크롤 sticky가 전체 앱에서 작동. 닫기도 상단바에 통합. 영상 아래 패널 없음.
크기와 버튼·비율은 MINI_PLAYER.md 참조. 정확한 양의 정수9:16 증거만 수동 쇼츠뷰로 사용. 개인원문/분류 projection/205큐는 변경하지 않음. SW v8-stable-topbar, player JS/CSS?v=8, catalog?v=7와 queue?v=6 유지.

## 재실행한 모의/정적 검증
Node26.13.1 임시 포터블, 원문 백업 read-only. data605/605, storage23/23, mini68/68, SW25/25, Worker base+55추가+52proxy PASS. 기존 상단바 이동 테스트를 불변성 검사로 대체하고 근거기반 portrait/복귀 검사 추가. 캐시 버전 기대값만 v8로 조정.

## 배포 전 실제 브라우저 검증
HTTPS운영origin에서 인메모리 새 UI, 기존 격리 DB loriano-validation-https-final-20261116 및 새 접두사 LS만 사용하는 테스트. private-validation HTML은 공개하지 않음. 원본DB가 아닌 사본577/2/1 모든필드 백업동일, readwrite차단기록0. UI 분류577/299/278/0. 최초iframe0/무자동재생, 일반·쇼츠state1와 시간증가, 상단pause/seek12초/stop0/모드3종/닫기iframe제거/새iframe재열기 확인. 320/390/768/1440 화면·상단8px·하단바0 확인.
YouTube API5페이지50/50/50/50/5=205고유ID, Worker와번들순서모두일치.
SW v7 activated 및 v7 캐시 존재 확인. v8 운영캐시·Pages검증은 배포후 별도.

## 확인 한계와 주의
[blocked] 원본577개프로필 미식별. 현재 원본명DB는0/0/0이나 복원·재수집 근거가 아님.
[blocked] 물리iOS/Android/tablet 및 기존OS설치PWA·완전망차단 미검증. 반응형모드나 SW모의검사와 혼동금지.
원본LocalStorage 전체불변은 확인하지 못함: 별도열린 운영v7플레이어탭의 재생상태키가 갱신되어 origin지문변경. 이번 격리 UI는 별도접두사키만 사용. 임의원복/초기화/이관안함. 개인아카이브DB와 재생상태LS를 구분.

최종 소스 패키지: 사용자에게 제공하는 loriano-source-2026-11-16-ui-v8.zip (개인백업/검증HTML/비밀정보 제외).

---

# LORIANO 아카이브 운영 인수인계

최신 갱신: 2026-11-15T16:00:44.582Z. 상태: 운영 배포 및 실제 핵심 재생 검증 완료, 최종 205개 번들 순서 교정 배포 진행. 원본577 프로필, 실기기·설치PWA 전체오프라인은 미확인.

## 1. 목적과 운영 위치
개인 브라우저에 보관한 찬양 피아노 영상·댓글·달력·검색을 보존하며, 지정 공개 재생목록 음악을 공식 YouTube IFrame으로 재생하는 정적 PWA입니다.
- GitHub main: https://github.com/subinan0204/loriano-archive/
- 운영: https://subinan0204.github.io/loriano-archive/
- Worker: https://loriano-playlist-sync.subinan0204.workers.dev
- Pages: main 루트. Worker Builds도 같은 main, root /, deploy npx wrangler deploy. 빌드/배포는 각각 확인해야 합니다.
- 기준 정상 commit: eb09c241a05aab9783a7c696d3993a1565e57ded. 원본 ZIP을 비공개 산출물 loriano-before-eb09c24.zip으로 보존.
- 기준 정상 Worker: https://9a6ac319-loriano-playlist-sync.subinan0204.workers.dev. 기존 feed205개 updatedAt=2026-11-15T02:18:04.480Z 확인.

## 2. 절대 지켜야 할 데이터 보호
코드 배포는 승인, 개인 데이터 쓰기·삭제·복원은 미승인입니다. loriano-archive-v1의 videos/comments/meta, 원래 LocalStorage, 검색/댓글/달력/재생 이력에 복원·마이그레이션·초기화·전체 재수집을 실행하지 않습니다. 원래577개의 프로필은 현재 브라우저와 동일한지 확인되지 않았습니다. 빈 DB 또는0개 표시는 복원/수집 근거가 아닙니다.
- init/getVideos/getComments는 읽기. 스키마/DB버전1 유지. 자동 sync/자동댓글 수집 중지, 직접 명시 조작 때만 수집.
- clearDB/reset는 보존 오류로 중단. UI 초기화 비활성화. 채널 변경과 샘플->실제 교체 차단, 보존 오류 catch에서도 meta를 쓰지 않음.
- sample은 videos/comments/meta 전부0이고 localStorage 모든 값이 비어 있어야 허용. 한 readwrite 트랜잭션 안에서 재검사 후 add만, 경합/실패 때 전체중단. 기존 데이터를 clear/put 교체하지 않음.
- 댓글 동기화 완료 시 API에 보이지 않는 기존 댓글 삭제 금지.
- 미니 상태는 사용자 직접 click/input 전에는 쓰지 않음. 원래 키 전체삭제 금지.
- API키/토큰은 Worker 환경 Secrets만 사용. 기존 개인LS의 legacy apiKey는 이번 배포에서 읽어 사용·출력·삭제·이관하지 않으며 키입력 UI/직접GoogleAPI 호출 제거. 설정 변경 시 기존 사용자설정은 병합 보존.
- 과거 일회성 삭제 도구 loriano-remove-one.html은 무동작 보호 안내로 대체. 원본은 기준 ZIP 보존.

## 3. 개인577개와 공개205개의 분리
개인577=IndexedDB 원문 아카이브. 공개205=PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-의 순서 있는 공식 재생 후보. 공개 피드가 개인 목록/달력/숫자를 대체하지 않습니다. getVideos는 non-writable 읽기전용 projection입니다.
- 랜덤/순차/반복 후보는 지정 재생목록만. 개인577 전체로 fallback 금지.
- bundled catalog205개는 확인된 기준 목록. Worker실패/중복/형식오류/누락/개수감소는 오류표시 후 마지막정상 유지. 개인자료를 대체후보로 사용하지 않음.
- 현재205개는 비율조사상 쇼츠0개. 따라서 개인쇼츠의 명시적 개별mini재생을 별도기능으로 지원. 상세의 '미니 플레이어로 보기'는 개인목록에서 ID를 읽기검증하고 manual상태로 재생, 랜덤큐/후보/이력에는 추가하지 않음. 개별재생끝에서 정지. 이전/다음은 public큐로 복귀.
- Worker는 전체페이지/totalResults/position/ID/세부정보완결성 검사 후 KV snapshot단1회교체. 중간실패시이전보존. 정상기준보다20%초과감소는 실패. 클라이언트는 소폭감소도 보수적으로 거부하므로 실제삭제는 조사후 catalog기준갱신 필요.

## 4. 분류와 표시
archive-policy.js + aspect-evidence.json은 DB행을 변경하지 않고 화면복사본만 분류합니다.
정수 width*16===height*9인 정확한 세로9:16만 short. width>=height는 long, 그외세로/치수없음/충돌은 review. 시간·제목·썸네일 추정 금지. 새영상근거없으면 검토필요.
577행 근거는 실제 YouTube 전달스트림: watch283 + youtubei294, 출처/시각/해상도/itag/치수일관성 포함. 서명미디어URL/쿠키/토큰 없음. 결과577/299/278/0. 모든short근거는정확9:16. 6nF6dD1X72U=1920x1080,178초,long. 원문backupshorts300/277은그대로보존. 목록/전체/유형/검색은동일videosprojection사용,검색결과수와전체수를구분.

## 5. 미니 플레이어 구조·반응형
공식YouTube IFrame API, 원본비율/letterbox유지, iframe crop/확대/오디오추출없음.
- viewport360/390: 영상280x157.5px, 오른쪽8px, 바닥safe-area/8px. 화면이더좁으면폭100vw-16px로축소하고16:9유지.
- tablet768: 영상320x180px, 오른쪽12px.
- PC1024/1440: 영상352x198px, 오른쪽16px.
- 영상과 외부패널 구분: 조작부포함 모바일높이약261.5,tablet284,PC302px. 닫기72x44는영상밖상단에배치. 모든버튼최소44px,완전폭하단시트아님. 컨트롤바는열린동안영상밑으로이동하여스크롤중에도조작가능.
- 재생/일시정지/정지/이전/다음/셔플/순차/전체반복/진행바/제목/상태복원보존.
- 최초/복원시iframe없음,자동재생없음. 닫기는stop+destroy+DOM제거,재열기새인스턴스,마지막위치유지. 정지만0초로복귀.
- mini가재생되면detail.pauseVideo,detail state1이면mini.pause. 의도된일시정지이며iframe파괴는닫기에서만. 상세는mini를한번도열지않아도APIbind. 수동재생은public큐와별도manual키필드로검증복원.
- 탭숨김/영상가시영역미달일시정지. 작은공식iframe에서광고/제어노출은YouTube정책/기기에영향받을수있음.

## 6. 저장구조·백업
IndexedDB loriano-archive-v1 v1: videos(keyPath id), comments(id, index videoId), meta(keyPath key, state.value).
LocalStorage loriano-settings-v1=개인설정, loriano-mini-player-v1=version/playlist/current/history/cursor/visited/mode/title/position/duration/manual/updatedAt. 기존기타키보존.
원문: loriano-private-backup-2026-11-15T03-54-43-435Z.json,707285bytes,SHA256 876d0c4604b6fe9297209827642084b168bc7b6b869d2c227c6a66bf894123e4. payload hash/ID무결성확인. videos577/comments2/meta1,playerState포함,API설정제외.
원래위치: C:\Users\Adnub\Downloads\LORIANO-PRIVATE-recovery-2026-11-15.zip 내부 private-backup/. 별도산출물 loriano-private-backup-ORIGINAL-2026-11-15.json. 비밀번호암호화백업이아니므로외부공개금지. 공개repo/소스ZIP에개인JSON/검증HTML포함금지.

## 7. Worker/KV/API
wrangler.toml: name loriano-playlist-sync,main playlist-sync-worker.mjs,compatibility2026-11-15. KV loriano-playlist-catalog binding PLAYLIST_KV,id71c79136ea7243a7ad7021cfaf83eb8b,key playlist:snapshot:v1. Secret이름 YOUTUBE_API_KEY,ADMIN_TOKEN,값은문서/코드/브라우저에기록금지.
Cron17 0 * * * UTC=매일09:17KST. /health,GET/api/playlist,관리인증POST/api/sync. 운영KV를직접덮어쓰거나지우지않음. 정상feed를그대로유지하며새코드만배포.
GET/api/youtube/{channels,playlistItems,videos,commentThreads,comments}: 기존명시적개인수집용읽기프록시. 고정채널UCusi43_1xufJnixaugM4_Ng,uploadsUUusi43_1xufJnixaugM4_Ng와지정playlist만허용,endpoint/params/part/ID수/소유권검사,comments는archiveVideoId검증후upstream에미전달. key/token/unknownparam/write거부,오류내용정제,60초publicCache-Control. 아직edge강제레이트제한없음(후속운영고도화).

## 8. 파일별역할과수정이유
index.html: 기존이미지/화면/ArchiveEngine유지,보존가드/동일데이터분류/수동수집/키없는Worker클라이언트.
archive-policy.js: exact화면비와excludedID(F5jQv9RPmhE)읽기필터.
aspect-evidence.json: 577개공개치수근거. 개인백업아님.
mini-player-catalog.js: 지정205기준순서/제목,mini-player-queue.js:순서/셔플/방문/이력(기존유지).
mini-player.js: public전용큐,검증된개별mini,공식iframe수명/상호pause/상태,오류보존.
mini-player.css: 반응형352/320/280영상영역,16:9,44px조작부,작은우하단패널.
sw.js: 외부Workbox의존없는범위별v7-production-safe,11개shell/policy/manifest/iconprecache,범위밖/API/미디어우회,네트워크우선·오프라인fallback,명시적SKIP_WAITING만. 다른앱/legacy캐시무차별삭제없음,개인저장소접근없음.
manifest.json/icon3개: 기존PWA설정유지.
playlist-sync-worker.mjs/.test.mjs: 완결성·보존·비밀키프록시,55+52추가회귀.
wrangler.toml: 기존binding/cron유지. WORKER_SETUP.md,MINI_PLAYER.md,README.md,TESTING.md: 최신운영문서.
mini-player-tests.html: 저장소변경없는공개큐329assertions.
tests/: Node데이터/저장소/플레이어/SW회귀,results/: 개인정보없는검증요약.

## 9. 테스트기록과한계
실행환경Node26.5.0. 모의/정적: data605/605,storage23/23,mini67/67(324assertions),SW25/25,Worker기본회귀+추가55+proxy52 PASS. 의도한Worker실패로그는보존시험. 테스트실행명령은TESTING.md.
실제브라우저사전검증: HTTPS운영origin에서로컬통합HTML을실행하되별도DB loriano-validation-https-final-20261116와별도LS prefix사용. 원래DB를열거나복원하지않음. 백업사본577/2/1로UI/비율확인,개인및사본추가쓰기0. 실제공식YouTube일반state1시간증가,개인쇼츠-V5UzDfnsdgstate1시간증가,detail/mini상호pause확인중. 5개viewport실측규격일치·overflow0·최소버튼44. 물리기기아닌데스크톱Chromium에뮬레이션.
사전테스트는운영배포완료증거가아님. 아래운영검증절을최종기준으로삼습니다.

## 10. 배포·운영검증(진행시갱신)
- 통합commit/push: ce4b35469b21b12c2c161452969d8abe2e351d9b GitHub main반영. 회귀파일추가32b1730.
- CloudflareWorker: 통합7bc9ae30 Ready23초, 테스트추가66ed37aa Ready22초. 같은검증된Worker소스,Secrets ADMIN_TOKEN/YOUTUBE_API_KEY encrypted,binding/Cron유지확인. 후속문서/목록commit도자동재배포.
- KV: 기존205정상snapshot보존,수동쓰기/삭제없음.
- GitHubPages: workflow#36(43초),#37(39초) completed successfully. 운영핵심6파일200+바이트일치.
- 실제YouTube13개검사: 일반/쇼츠mini state1시간증가,상세재생시mini2/detail1,mini재개시mini1/detail2,일시정지,진행12초,정지0초CUED,이전/다음,셔플/순차/반복,닫기iframe제거/재열기새instance,17초·순차·곡·이력무자동재생복원PASS. pagehide의updatedAt갱신은정상,재접속playback필드동일/iframe0/새페이지쓰기0.
- UI유형299/278/0/577,검색푯대3개와전체577구분,저장댓글2개,11월달력42칸PASS. 격리사본577/2/1의모든필드원문동일,추가DB쓰기0.
- 실제원본DB는readonly count만확인: videos0/comments0/meta0. 동일프로필미확인,복원·마이그레이션·재수집미실행.
- 실제브라우저서비스워커v6설치/대기->명시적업데이트->activated,11개캐시/manifest/icons확인. cachedindex는개인검증HTML아닌정상운영소스. v7새목록은후속재검증.
- [blocked] 브라우저전체network-offline전환API가없어완전망차단navigation/이미설치된OS PWA실행은미실행. 오프라인fallback은Node모의25PASS+실제브라우저캐시11개확인까지,실제완전오프라인통과로표시하지않음.
- [blocked] 물리iPhone/Android/tablet기기없음. 5개폭검증은데스크톱Chromium반응형모드.

## 11. 롤백
데이터롤백금지. 먼저현재main커밋/Workerversion/피드수보관. 기준commit eb09c24의소스ZIP보유. 새코드에문제가있으면GitHub에서통합commit revert 또는검증된기준파일복원커밋. SW의CACHE버전은새고유값으로높여명시적업데이트유도(개인저장소초기화금지). WorkerDeployments의기준9a6ac319버전을100%로배포하여코드롤백,Secrets/KVbinding과snapshot은유지. KV실패시기존정상값유지,정상데이터인지모르면아무것도덮어쓰지않음. 위험한구버전앱데이터초기화기능이있으므로구버전수집/샘플/초기화는사용금지.

## 12. 남은제약·다음담당자순서
1. 최신배포절/commit/version/운영실측을먼저읽고같은작업재시작금지.
2. 원본577개프로필식별은별도미해결. 현재프로필0을데이터없음으로단정하지말것. 사용자추가승인없이복원/마이그레이션/재수집금지.
3. 실제iOS/Android/물리tablet,이미설치된사용자PWA개별업데이트는실기기/기존프로필확인후별도검증. 에뮬레이션과구분.
4. 실제삭제로playlist205보다감소하면클라이언트보존가드작동. YouTube전체목록을독립검증한후baseline/catalog수정배포,개인목록fallback금지.
5. 새영상치수근거추가시원본backup/DBshorts수정하지말고evidence의출처/시각/일관성과ID정합검증후배포.
6. 프록시quota남용대비Cloudflareedgecache/rate-limit추가검토. 키는Secret만.
7. 변경때마다본인수인계/테스트/운영상태갱신후소스패키지재생성. 최종운영미검증을완료라고표시금지.

## 최종목록추가검증과수정
실제YouTube API5페이지50/50/50/50/5,205고유ID/position0..204연속확인. Worker기존205의ID/순서100%일치. 기존번들catalog마지막5ID가달랐으므로실제목록으로교정,개인DB/KV변경없음. 정확한마지막5:1KWuUrW7Puo,0X0eAtP6Vmo,ZMWnUZlg2L0,silsdSB0MsQ,1Rv3CAnvuho. catalog?v=7,SWv7-production-safe로갱신하고배포후다시검증.

## 운영배포추가이력
- 최종catalog/SWcodecommit3240c92a76659a8a78bd408d59f779240a8e9a6d. Worker f07113c6 Ready25초.
- Pages#38 첫시도는build25초성공,deploy16초단계GitHubAPI502로실패. 코드오류아님. 기존운영정상버전유지상태에서Re-run failed jobs로deploy만재실행.
- CloudflareBuilds watchpaths를 playlist-sync-worker.mjs 및 wrangler.toml로저장확인. 앞으로문서/프런트/테스트변경만으로동일Worker불필요재배포하지않음. Secrets/KV/Cron변경없음.
- 기준9a6ac319의More options에Rollback메뉴실재확인,실제롤백실행은안함.

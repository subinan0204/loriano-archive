# Worker 운영

구현/운영기준은 LORIANO_HANDOFF.md §7과§10. 기존Worker/KVbinding/Secrets/Cron을 유지하고 GitHub main연동으로 배포합니다. Secret이름:YOUTUBE_API_KEY,ADMIN_TOKEN. 값을 코드/클라이언트/문서에 넣지 않습니다.

GET /health, GET /api/playlist. POST /api/sync는관리자Secret인증과완결성검증이필요,정상205KV를이유없이덮어쓰지않습니다.

읽기전용 /api/youtube/channels,playlistItems,videos,commentThreads,comments는고정로리아노공개채널로제한됩니다. 상세는인수인계참조.

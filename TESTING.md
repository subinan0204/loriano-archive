# 테스트 실행과 증거 구분

Node26.5.0 기본모듈만 사용. PowerShell: `./tests/run-all.ps1 -PrivateBackup "별도비공개백업.json"`. 샌드박스Windows경로권한이슈면 node --preserve-symlinks-main 사용.

최종모의/정적 PASS: data605,storage23,mini67(324assertions),SW25,Worker기본+55추가+52proxy. results/run-all.log 및 각JSON에기록. 원본개인DB접속/미디어재생을증명하지않음.

실제브라우저는 HTTPS원본사이트의격리DB/LS복사본으로실제YouTube/viewport검사. 최종운영commit·파일바이트·배포·offline결과는 LORIANO_HANDOFF.md §10. 실기기아닌desktopChromium에뮬레이션. 개인577프로필미확인은별도기록.

과거 build-file-validation.mjs/serve-isolated.mjs는모의미디어하네스이며운영검증대체불가. 생성HTML은개인백업을포함하므로절대공개하지말것. 이전worker-safety.mjs는구형Worker기준이며현재정식suite는루트playlist-sync-worker.test.mjs.

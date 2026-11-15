# 테스트 실행과 증거 구분

Node26.5.0 기본모듈만 사용. PowerShell: `./tests/run-all.ps1 -PrivateBackup "별도비공개백업.json"`. 샌드박스Windows경로권한이슈면 node --preserve-symlinks-main 사용.

최종모의/정적 PASS: data605,storage23,mini67(324assertions),SW25,Worker기본+55추가+52proxy. results/run-all.log 및 각JSON에기록. 원본개인DB접속/미디어재생을증명하지않음.

실제브라우저는 HTTPS원본사이트의격리DB/LS복사본으로실제YouTube/viewport검사. 최종운영commit·파일바이트·배포·offline결과는 LORIANO_HANDOFF.md §10. 실기기아닌desktopChromium에뮬레이션. 개인577프로필미확인은별도기록.

과거 별도 복구ZIP의 file/server 하네스는 모의 미디어용이며 현행소스패키지에는 포함하지 않습니다. 현행 정식 Worker suite는 루트 playlist-sync-worker.test.mjs입니다. 개인백업을 포함한 검증HTML은 절대 공개하지 마세요. 현재 tests/는 data-regression.mjs, storage-safety.mjs, mini-player-regression.mjs, sw-regression.mjs, run-all.ps1 다섯 파일입니다.

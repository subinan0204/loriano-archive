# 신규 영상 분류 수정: 운영 게이트 실패로 중단 및 코드 복구

## 실제 결과
- 작업 전 기준: aa3a6c240c83306f5025a23b0b845a6447f1ba9f, Pages#41, 운영프런트엔드v8.
- 단계 Worker 커밋: 2a0856c82c3265d9dea8fc5b8951d3bf3c28acc5, Workers Builds 성공, API dimensionsVersion v1-20261118 배포 확인.
- 실제Worker GET /api/video-dimensions로 신규3개 mq1lk0uTm0s /1zYk3516rEA /tfYSAdIo-ps 모두502 pending반환. 실측응답획득실패. 응답은의도적으로정제돼있어이결과만으로실패단계를단정할수없음.
- 프런트엔드수정은미배포. archive-policy.js/index.html/sw.js/기존577근거는기준그대로유지.
- 이복구커밋에서Worker엔트리파일을검증된기준소스와바이트동일하게복원. KV/Secrets/개인DB/LS복구·초기화실행안함.

## 확인된 원인과 미완료
현재분류문제의직접원인은고정577개ID실측근거만읽고신규ID의실제width/height를수집하는연결이없다는것. 신규DataAPI메타데이터에는실제크기가없고썸네일은세로영상도1280×720. duration/제목/shortsURL을분류에쓰지않음.
브라우저실제·익명YouTube응답으로신규치수1080×1920/1920×1080/1080×1920확인. 개발후보는기존577불변과비동기자동분류를통과했으나Cloudflare실제수집게이트를통과하지못했으므로채택안함.

## 검사 구분
격리검사: data605, storage23, player68, SW25, 새분류26, 새Worker70, 기존Worker+55+52PASS. 실제Cloudflare신규실측3개실패. 모의PASS를운영PASS로보고하지않음.
원본DB에추가쓰기없고기존격리577/2/1모든필드백업동일,이작업중LocalStorage전체지문동일. 원본577프로필미식별(현재원본명DB0/0/0),복원미실행.

## 백업·복구
작업전소스ZIP loriano-source-before-classification-2026-11-18.zip, 46파일모두고정커밋과해시일치, SHA256 61cf3502fd5b9177f04c444452d1256f38e21940ec6dc52b50be9b94ecc7d3fd. Worker/wrangler포함,개인백업미포함.
개인백업은기존LORIANO-PRIVATE-recovery-2026-11-15.zip과별도원문SHA256 876d0c4604b6fe9297209827642084b168bc7b6b869d2c227c6a66bf894123e4를보존.
추후계속하려면정제된Worker실패단계/로그를확인해실제환경에서사용가능한실측수집경로를확보해야함. 현재CF대시보드로그인만료로직접버전UUID/로그조회불가. 인증정보를코드에넣거나임의우회하지않음.

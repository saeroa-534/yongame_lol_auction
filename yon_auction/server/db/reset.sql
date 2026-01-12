PRAGMA foreign_keys = ON;

BEGIN;

-- 자식 테이블부터 삭제
DELETE FROM auction_log;
DELETE FROM auction_state;
DELETE FROM auction_queue;
DELETE FROM team_roster;

-- 부모 테이블 삭제
DELETE FROM teams;
DELETE FROM players;

-- 설정(단일 row) 삭제
DELETE FROM auction_config;

COMMIT;

-- DB 파일 용량/파편 정리 (원하면 지워도 됨)
VACUUM;
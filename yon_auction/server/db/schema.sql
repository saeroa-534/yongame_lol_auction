PRAGMA foreign_keys = ON;

-- 선수 (팀장 6명 + 팀원 24명; 총 30명)
CREATE TABLE IF NOT EXISTS players (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  position    TEXT    NOT NULL CHECK (position IN ('TOP','MID','JUG','ADC','SUP')),
  tier        TEXT,
  bio         TEXT,
  img_url     TEXT,
  is_captain  INTEGER NOT NULL DEFAULT 0 CHECK (is_captain IN (0,1))
);

-- 팀 (6팀)
CREATE TABLE IF NOT EXISTS teams (
  id                  TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL UNIQUE,                                    -- 팀명
  captain_player_id   TEXT    NOT NULL UNIQUE,                                    -- 팀장
  
  point_now           INTEGER NOT NULL DEFAULT 1000 CHECK (point_now >= 0),       -- 보유 포인트
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (captain_player_id) REFERENCES players(id) ON DELETE RESTRICT
);

-- 팀 로스터(슬롯별 1명)
CREATE TABLE IF NOT EXISTS team_roster (
  -- 팀 로스터
  team_id      TEXT    NOT NULL,
  slot         TEXT    NOT NULL CHECK (slot IN ('TOP','MID','JUG','ADC','SUP')),        -- 포지션 슬롯
  player_id    TEXT    NOT NULL UNIQUE,                                                 -- 한 선수는 한 팀에만
  
  -- 팀 로스터 (입찰 정보)
  price_paid   INTEGER NOT NULL DEFAULT 0 CHECK (price_paid >= 0),                      -- 입찰가
  acquired_via TEXT    NOT NULL CHECK (acquired_via IN ('captain','bid','admin')),      -- 낙찰 방식
  
  -- 시간 기록
  acquired_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, slot),
  FOREIGN KEY (team_id)   REFERENCES teams(id)   ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
);

-- action 값 설정(단일 row) / 고정 값
CREATE TABLE IF NOT EXISTS auction_config (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  timer_seconds               INTEGER NOT NULL DEFAULT 10,
  min_bid_start               INTEGER NOT NULL DEFAULT 5,     -- 최소 입찰가(초기값)   (고정)
  min_bid_increment_on_unsold INTEGER NOT NULL DEFAULT 10,    -- 최소 입찰가 증가 단위  (고정)
  bid_step_low                INTEGER NOT NULL DEFAULT 5,     -- 호가 단위           (고정)
  bid_step_high               INTEGER NOT NULL DEFAULT 10,    -- 300pt 이상 호가 단위 (고정)
  bid_step_threshold          INTEGER NOT NULL DEFAULT 300,   -- 호가 단위 상승 기준   (고정)
  point_init                  INTEGER NOT NULL DEFAULT 1000    -- 초기 포인트        (고정)
  
);

-- 경매 큐(라인별)
CREATE TABLE IF NOT EXISTS auction_queue (
  -- 선수별 경매 상태 id
  id         TEXT    PRIMARY KEY,
  
  -- 선수별 경매 상태
  phase      TEXT    NOT NULL CHECK (phase IN ('TOP','MID','BOTTOM')),                           -- 경매 단계
  player_id  TEXT    NOT NULL,                                                                   -- 선수        <참조>
  sequence   INTEGER NOT NULL,                                                                   -- 선수 순서
  status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('SOLD','UNSOLD', 'PENDING')),  -- 선수 상태
  
  -- 시간 기록
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,                                         -- 수정 시각
  UNIQUE (phase, sequence),
  UNIQUE (phase, player_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
);


-- 현재 진행 상태 (단일 row)
CREATE TABLE IF NOT EXISTS auction_state (
  -- 경매 id (단일 row)
  id                   INTEGER PRIMARY KEY CHECK (id = 1),   

  -- 경매 (선수)
  current_queue_id     TEXT,                                                    -- 현재 경매                   <참조>
  current_player_id    TEXT,                                                    -- 현재 경매 선수               <참조>
  
  -- 경매 (팀)
  current_high_bid     INTEGER NOT NULL DEFAULT 0,                              -- 현재 최고 입찰가
  current_high_team_id TEXT,                                                    -- 현재 최고 입찰가를 제시한 팀    <참조>
  
  -- 경매 정보
  global_min_bid       INTEGER NOT NULL DEFAULT 5,                              -- 현재 최소 입찰가
  unsold_count         INTEGER NOT NULL DEFAULT 0,                              -- 현재 유찰 횟수
  
  -- 시간 기록
  last_tick_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,            
  FOREIGN KEY (current_queue_id)  REFERENCES auction_queue(id),
  FOREIGN KEY (current_player_id)    REFERENCES players(id),
  FOREIGN KEY (current_high_team_id) REFERENCES teams(id)
);

-- LOG --
-- 입찰 로그
CREATE TABLE IF NOT EXISTS auction_log (
  -- 로그 id
  id             TEXT    PRIMARY KEY,
  
  -- 로그 분류 및 텍스트 고지
  event_type     TEXT    CHECK (event_type IN ('BID','ADMIN')),
  act            TEXT,
  
  -- 경매 관련
  queue_id       TEXT,
  player_id      TEXT,
  team_id        TEXT,
  price          INTEGER,

  -- 시간 기록
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (queue_id)  REFERENCES auction_queue(id) ON DELETE RESTRICT,
  FOREIGN KEY (player_id) REFERENCES players(id)      ON DELETE RESTRICT,
  FOREIGN KEY (team_id)   REFERENCES teams(id)        ON DELETE RESTRICT
);


-- 인덱스(자주 조회하는 것들)
CREATE INDEX IF NOT EXISTS idx_bids_queue_time ON auction_log(queue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roster_team     ON team_roster(team_id);
CREATE INDEX IF NOT EXISTS idx_queue_phase_pos ON auction_queue(phase, sequence);
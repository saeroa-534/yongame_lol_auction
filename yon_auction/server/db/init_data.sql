BEGIN;
PRAGMA foreign_keys = ON;

-- =========================================================
-- 0) auction_config (단일 row)
-- =========================================================
INSERT OR REPLACE INTO auction_config (
  id,
  timer_seconds,
  min_bid_start,
  min_bid_increment_on_unsold,
  bid_step_low,
  bid_step_high,
  bid_step_threshold,
  point_init
) VALUES (
  1,
  10,
  5,
  10,
  5,
  10,
  300,
  1000
);

-- =========================================================
-- 1) players (총 30명: JUG(팀장) 6 + TOP 6 + MID 6 + ADC 6 + SUP 6)
--    tier/bio/img_url 전부 PLACEHOLDER로 채움
-- =========================================================
INSERT INTO players (id, name, position, tier, bio, img_url, is_captain) VALUES
-- 팀장(정글) 6명
('P_JUG_01','구효성','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','/assets/players/P_JUG_01.webp',1),
('P_JUG_02','김정우','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',1),
('P_JUG_03','김태현','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',1),
('P_JUG_04','심지민','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',1),
('P_JUG_05','홍성원','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',1),
('P_JUG_06','황동근','JUG','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',1),

-- TOP 6
('P_TOP_01','PLACEHOLDER_TOP_01','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_TOP_02','PLACEHOLDER_TOP_02','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_TOP_03','PLACEHOLDER_TOP_03','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_TOP_04','PLACEHOLDER_TOP_04','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_TOP_05','PLACEHOLDER_TOP_05','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_TOP_06','PLACEHOLDER_TOP_06','TOP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),

-- MID 6
('P_MID_01','PLACEHOLDER_MID_01','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_MID_02','PLACEHOLDER_MID_02','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_MID_03','PLACEHOLDER_MID_03','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_MID_04','PLACEHOLDER_MID_04','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_MID_05','PLACEHOLDER_MID_05','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_MID_06','PLACEHOLDER_MID_06','MID','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),

-- ADC 6
('P_ADC_01','PLACEHOLDER_ADC_01','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_ADC_02','PLACEHOLDER_ADC_02','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_ADC_03','PLACEHOLDER_ADC_03','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_ADC_04','PLACEHOLDER_ADC_04','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_ADC_05','PLACEHOLDER_ADC_05','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_ADC_06','PLACEHOLDER_ADC_06','ADC','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),

-- SUP 6
('P_SUP_01','PLACEHOLDER_SUP_01','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_SUP_02','PLACEHOLDER_SUP_02','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_SUP_03','PLACEHOLDER_SUP_03','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_SUP_04','PLACEHOLDER_SUP_04','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_SUP_05','PLACEHOLDER_SUP_05','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0),
('P_SUP_06','PLACEHOLDER_SUP_06','SUP','PLACEHOLDER_TIER','PLACEHOLDER_BIO','PLACEHOLDER_IMG_URL',0);

-- =========================================================
-- 2) teams (6팀, name UNIQUE)
-- =========================================================
INSERT INTO teams (id, name, captain_player_id, point_now) VALUES
('T1','PLACEHOLDER_TEAM_1','P_JUG_01',1000),
('T2','PLACEHOLDER_TEAM_2','P_JUG_02',1000),
('T3','PLACEHOLDER_TEAM_3','P_JUG_03',1000),
('T4','PLACEHOLDER_TEAM_4','P_JUG_04',1000),
('T5','PLACEHOLDER_TEAM_5','P_JUG_05',1000),
('T6','PLACEHOLDER_TEAM_6','P_JUG_06',1000);

-- =========================================================
-- 3) team_roster (팀장들은 JUG 슬롯에 미리 포함)
-- =========================================================
INSERT INTO team_roster (team_id, slot, player_id, price_paid, acquired_via) VALUES
('T1','JUG','P_JUG_01',0,'captain'),
('T2','JUG','P_JUG_02',0,'captain'),
('T3','JUG','P_JUG_03',0,'captain'),
('T4','JUG','P_JUG_04',0,'captain'),
('T5','JUG','P_JUG_05',0,'captain'),
('T6','JUG','P_JUG_06',0,'captain');

-- =========================================================
-- 4) auction_queue (TOP 6 / MID 6 / BOTTOM 12(ADC+SUP))
-- =========================================================
-- TOP
INSERT INTO auction_queue (id, phase, player_id, sequence, status) VALUES
('Q_TOP_01','TOP','P_TOP_01',1,'PENDING'),
('Q_TOP_02','TOP','P_TOP_02',2,'PENDING'),
('Q_TOP_03','TOP','P_TOP_03',3,'PENDING'),
('Q_TOP_04','TOP','P_TOP_04',4,'PENDING'),
('Q_TOP_05','TOP','P_TOP_05',5,'PENDING'),
('Q_TOP_06','TOP','P_TOP_06',6,'PENDING');

-- MID
INSERT INTO auction_queue (id, phase, player_id, sequence, status) VALUES
('Q_MID_01','MID','P_MID_01',1,'PENDING'),
('Q_MID_02','MID','P_MID_02',2,'PENDING'),
('Q_MID_03','MID','P_MID_03',3,'PENDING'),
('Q_MID_04','MID','P_MID_04',4,'PENDING'),
('Q_MID_05','MID','P_MID_05',5,'PENDING'),
('Q_MID_06','MID','P_MID_06',6,'PENDING');

-- BOTTOM (ADC+SUP 섞어서 12명)
INSERT INTO auction_queue (id, phase, player_id, sequence, status) VALUES
('Q_BOT_01','BOTTOM','P_ADC_01',1,'PENDING'),
('Q_BOT_02','BOTTOM','P_SUP_01',2,'PENDING'),
('Q_BOT_03','BOTTOM','P_ADC_02',3,'PENDING'),
('Q_BOT_04','BOTTOM','P_SUP_02',4,'PENDING'),
('Q_BOT_05','BOTTOM','P_ADC_03',5,'PENDING'),
('Q_BOT_06','BOTTOM','P_SUP_03',6,'PENDING'),
('Q_BOT_07','BOTTOM','P_ADC_04',7,'PENDING'),
('Q_BOT_08','BOTTOM','P_SUP_04',8,'PENDING'),
('Q_BOT_09','BOTTOM','P_ADC_05',9,'PENDING'),
('Q_BOT_10','BOTTOM','P_SUP_05',10,'PENDING'),
('Q_BOT_11','BOTTOM','P_ADC_06',11,'PENDING'),
('Q_BOT_12','BOTTOM','P_SUP_06',12,'PENDING');

-- =========================================================
-- 5) auction_state (단일 row) - 시작 상태를 PLACEHOLDER처럼 채움
--    (current_high_team_id도 NULL 대신 T1로 채움)
-- =========================================================
INSERT OR REPLACE INTO auction_state (
  id,
  current_queue_id,
  current_player_id,
  current_high_bid,
  current_high_team_id,
  global_min_bid,
  unsold_count
) VALUES (
  1,
  'Q_TOP_01',
  'P_TOP_01',
  0,
  'T1',
  5,
  0
);

-- =========================================================
-- 6) auction_log (통합 로그) - 최소 2개 예시(입찰/운영자)
-- =========================================================
INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price) VALUES
('LOG_001','BID','PLACEHOLDER_BID_ACT','Q_TOP_01','P_TOP_01','T1',0),
('LOG_002','ADMIN','PLACEHOLDER_ADMIN_ACT','Q_TOP_01','P_TOP_01','T1',0);

COMMIT;
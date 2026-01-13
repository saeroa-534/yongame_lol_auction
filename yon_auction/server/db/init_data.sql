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
('P_JUG_01','구효성','JUG','DIAMOND','정글 Baby 입니다.','/assets/img_players/구효성.webp',1),
('P_JUG_02','김정우','JUG','EMERALD','이x끼는 그냥 롤을 잘함','/assets/img_players/김정우.webp',1),
('P_JUG_03','김태현','JUG','EMERALD','좀 더 조숙해진 정글러','/assets/img_players/김태현02.webp',1),
('P_JUG_04','심지민','JUG','DIAMOND','요청하는 모든메뉴 가능','/assets/img_players/심지민.webp',1),
('P_JUG_05','홍성원','JUG','EMERALD','연낳대 최초 유일 로열로더 투핏','/assets/img_players/홍성원.webp',1),
('P_JUG_06','황동근','JUG','EMERALD','3회 우승하고 졸업하겠습니다.','/assets/img_players/황동근.webp',1),

-- TOP 6
('P_TOP_01','구교법','TOP','EMERALD','뻐스태워주세요~~~','/assets/img_players/구교법.webp',0),
('P_TOP_02','김동현','TOP','SILVER','포 잘 쏩니다.','/assets/img_players/김동현.webp',0),
('P_TOP_03','박건희05','TOP','GOLD','첫 연낳대입니당 ><','/assets/img_players/박건희05.webp',0),
('P_TOP_04','장준하','TOP','EMERALD','AP랑, AP탱커형 미드 좋아해요 좋아하고 캐리하는 것보단 팀을 위한 플레이를 많이 하는 편입니다','/assets/img_players/장준하.webp',0),
('P_TOP_05','조영준','TOP','IRON','재밌게 해보고 싶습니다. 백번 죽어도 백일번 죽으러 탑라인 갑니다','/assets/img_players/조영준.webp',0),
('P_TOP_06','최종두','TOP','PLATINUM','정글한테 갱을 가드리겠습니다','/assets/img_players/최종두.webp',0),

-- MID 6
('P_MID_01','강동우','MID','IRON','연낳대 첫 출전, 19년도 이후 협곡 경험 <10회, 이리잘함. 중국이리 관광왔습니다. 개못하지만 열심히 배울 의향 있습니다. 협곡 찐뉴비 이리견 데려가서 가르쳐주실 주인님 구해요.','/assets/img_players/강동우.webp',0),
('P_MID_02','김규민','MID','UNRANKED','24년 1학기 연낳대 이후 약 2년간 칼바람 수련 했습니다. 그때의 제가 아닙니다 (아마도)','/assets/img_players/김규민.webp',0),
('P_MID_03','소은정','MID','SILVER','주서가 ( ᴗ͈ˬᴗ͈)ഒ','/assets/img_players/소은정.webp',0),
('P_MID_04','송주현','MID','PLATINUM','최근 노틸 장인으로 거듭나고 있으며, 내전 시 럭스, 소라카 밴을 당해 강제 챔프 폭을 넓히는 중인데, 무한한 가능성을 바탕으로 모든 서폿 챔을 마스터할 수 있다 믿어 의심치 않습니다. ','/assets/img_players/송주현.webp',0),
('P_MID_05','이정섭','MID','SILVER','든든한 서폿! 하라는거 다 하는 서폿!','/assets/img_players/이정섭.webp',0),
('P_MID_06','최지은','MID','PLATINUM','첫 연낳대 잘부탁드립니다😱','/assets/img_players/최지은.webp',0),

-- ADC 6
('P_ADC_01','박건희02','ADC','DIAMOND','연겜 활동 못한지 꽤 오래됐지만 롤 실력은 녹슬지 않았음을 보여드리겠습니다.','/assets/img_players/박건희02.webp',0),
('P_ADC_02','박진우','ADC','EMERALD','2회 출전 2회 우승(뒤에서) 입니다 이번에도 우승?할게요','/assets/img_players/박진우.webp',0),
('P_ADC_03','송건회','ADC','PLATINUM','시즌 4 우승, 시즌 5 준우승, 플레이 스타일: 각도기','/assets/img_players/송건회.webp',0),
('P_ADC_04','신세웅','ADC','EMERALD','AFK 키우기 식 원딜, 방치형 플레이 최적화, 알아서 잘 챙겨먹고 잘 사립니다','/assets/img_players/신세웅.webp',0),
('P_ADC_05','오제민','ADC','PLATINUM','5회 출전 결승 4회진출, 결승 보내드립니다','/assets/img_players/오제민.webp',0),
('P_ADC_06','오혜성','ADC','EMERALD','<ER Demigod> 겜잘하고 오더잘함, 연낳대 팀장으로 진두지휘 경험 1회','/assets/img_players/오혜성.webp',0),

-- SUP 6
('P_SUP_01','구영휴','SUP','EMERALD','서폿이 하고싶다','/assets/img_players/구영휴.webp',0),
('P_SUP_02','권강현','SUP','EMERALD','판이 커졌다..','/assets/img_players/권강현.webp',0),
('P_SUP_03','권용근','SUP','PLATINUM','서폿 탑레 에메!!','/assets/img_players/권용근.webp',0),
('P_SUP_04','김종훈','SUP','EMERALD','목표: 깨지지 않을 최고령 참가자 기록','/assets/img_players/김종훈.webp',0),
('P_SUP_05','김태진','SUP','PLATINUM','무한듀랭각오한원딜구함/무한자랭각오한팀장구함','/assets/img_players/김태진.webp',0),
('P_SUP_06','박진효','SUP','GOLD','열심히 하겠습니다!','/assets/img_players/박진효.webp',0);
-- =========================================================
-- 2) teams (6팀, name UNIQUE)
-- =========================================================
INSERT INTO teams (id, name, captain_player_id, point_now) VALUES
('T1','팀_구효성','P_JUG_01',1000),
('T2','팀_김정우','P_JUG_02',1000),
('T3','팀_김태현','P_JUG_03',1000),
('T4','팀_심지민','P_JUG_04',1000),
('T5','팀_홍성원','P_JUG_05',1000),
('T6','팀_황동근','P_JUG_06',1000);

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
  NULL,
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

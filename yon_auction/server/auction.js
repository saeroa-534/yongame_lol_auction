/**
 * auction.js
 * 경매 핵심 로직 모듈
 * 
 * 경매 순서: TOP → MID → BOTTOM(ADC+SUP)
 * 유찰 시: 최소 입찰가 +10pt 증가 후 해당 포지션 마지막으로 이동
 */

const fs = require('fs');
const path = require('path');

const PHASE_ORDER = ['TOP', 'MID', 'BOTTOM'];  // 포지션 경매 순서
const LOG_FILE_PATH = path.join(__dirname, 'db', 'auction_log.txt');

/**
 * Auction 클래스
 * - DB와 연동하여 경매 상태를 관리
 * - 실시간 경매 진행 로직 처리
 */
class Auction {
  constructor(db) {
    this.db = db;
    this.timerHandle = null;      // 경매 타이머
    this.countdownHandle = null;  // 카운트다운 타이머
    this.endsAt = null;           // 경매 종료 예정 시각 (timestamp)
    this.pausedRemainingMs = null; // 일시정지 시 남은 시간 저장
    this.isCountingDown = false;  // 카운트다운 중인지
    this.countdownSeconds = 0;    // 현재 카운트다운 초
    this.onStateChange = null;    // 상태 변경 시 콜백 (브로드캐스트용)
    this.onCountdown = null;      // 카운트다운 콜백
  }

  // ============================================================
  // DB Helper (Promise 래핑)
  // ============================================================
  
  dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ============================================================
  // 설정 조회
  // ============================================================

  async getConfig() {
    const config = await this.dbGet('SELECT * FROM auction_config WHERE id = 1');
    return config || {
      timer_seconds: 10,
      min_bid_start: 5,
      min_bid_increment_on_unsold: 10,
      bid_step_low: 5,
      bid_step_high: 10,
      bid_step_threshold: 300,
      point_init: 1000
    };
  }

  // ============================================================
  // 경매 상태 조회
  // ============================================================

  async getAuctionState() {
    return await this.dbGet('SELECT * FROM auction_state WHERE id = 1');
  }

  async getCurrentQueueItem() {
    const state = await this.getAuctionState();
    if (!state || !state.current_queue_id) return null;
    
    return await this.dbGet(`
      SELECT q.*, p.name as player_name, p.position, p.tier, p.bio, p.img_url
      FROM auction_queue q
      JOIN players p ON q.player_id = p.id
      WHERE q.id = ?
    `, [state.current_queue_id]);
  }

  async getCurrentHighTeam() {
    const state = await this.getAuctionState();
    if (!state || !state.current_high_team_id) return null;

    return await this.dbGet(`
      SELECT t.*, p.name as captain_name
      FROM teams t
      JOIN players p ON t.captain_player_id = p.id
      WHERE t.id = ?
    `, [state.current_high_team_id]);
  }

  // ============================================================
  // 팀 정보 조회
  // ============================================================

  async getTeams() {
    return await this.dbAll(`
      SELECT t.*, p.name as captain_name
      FROM teams t
      JOIN players p ON t.captain_player_id = p.id
      ORDER BY t.id
    `);
  }

  async getTeamById(teamId) {
    return await this.dbGet(`
      SELECT t.*, p.name as captain_name
      FROM teams t
      JOIN players p ON t.captain_player_id = p.id
      WHERE t.id = ?
    `, [teamId]);
  }

  async getTeamRoster(teamId) {
    return await this.dbAll(`
      SELECT tr.*, p.name as player_name, p.position, p.img_url
      FROM team_roster tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = ?
      ORDER BY 
        CASE tr.slot 
          WHEN 'TOP' THEN 1 
          WHEN 'JUG' THEN 2 
          WHEN 'MID' THEN 3 
          WHEN 'ADC' THEN 4 
          WHEN 'SUP' THEN 5 
        END
    `, [teamId]);
  }

  /**
   * 모든 팀의 로스터 조회
   */
  async getAllTeamRosters() {
    const teams = await this.getTeams();
    const result = {};
    
    for (const team of teams) {
      const roster = await this.getTeamRoster(team.id);
      result[team.id] = {
        team: {
          id: team.id,
          name: team.name,
          captainName: team.captain_name,
          pointNow: team.point_now,
          pointInit: team.point_init
        },
        roster: roster.map(r => ({
          slot: r.slot,
          playerName: r.player_name,
          position: r.position,
          pricePaid: r.price_paid,
          imgUrl: r.img_url
        }))
      };
    }
    
    return result;
  }

  // ============================================================
  // 경매 큐 조회
  // ============================================================

  /**
   * 현재 phase에서 다음 PENDING 선수 가져오기
   */
  async getNextPendingInPhase(phase) {
    return await this.dbGet(`
      SELECT q.*, p.name as player_name, p.position
      FROM auction_queue q
      JOIN players p ON q.player_id = p.id
      WHERE q.phase = ? AND q.status = 'PENDING'
      ORDER BY q.sequence ASC
      LIMIT 1
    `, [phase]);
  }

  /**
   * 현재 phase의 모든 선수 가져오기 (순서대로)
   */
  async getQueueByPhase(phase) {
    return await this.dbAll(`
      SELECT q.*, p.name as player_name, p.position, p.tier
      FROM auction_queue q
      JOIN players p ON q.player_id = p.id
      WHERE q.phase = ?
      ORDER BY q.sequence ASC
    `, [phase]);
  }

  /**
   * 전체 경매 큐 현황 가져오기
   */
  async getFullQueue() {
    const result = {};
    for (const phase of PHASE_ORDER) {
      result[phase] = await this.getQueueByPhase(phase);
    }
    return result;
  }

  // ============================================================
  // 경매 낙찰/유찰 결과 조회
  // ============================================================

  async getAuctionResults() {
    // 낙찰 결과 (team_roster에서)
    const soldResults = await this.dbAll(`
      SELECT 
        tr.team_id, t.name as team_name,
        tr.slot, tr.player_id, p.name as player_name, p.position,
        tr.price_paid, tr.acquired_via, tr.acquired_at,
        'sold' as result_type
      FROM team_roster tr
      JOIN players p ON tr.player_id = p.id
      JOIN teams t ON tr.team_id = t.id
      WHERE tr.acquired_via IN ('bid', 'admin')
    `);
    
    // 유찰 결과 (auction_log에서)
    const unsoldResults = await this.dbAll(`
      SELECT 
        al.player_id, p.name as player_name, p.position,
        al.created_at as acquired_at,
        'unsold' as result_type
      FROM auction_log al
      JOIN players p ON al.player_id = p.id
      WHERE al.act = 'UNSOLD'
    `);
    
    // 통합 후 시간순 정렬 (최신이 앞으로)
    // 타임스탬프 포맷 통일 (SQLite: "2026-01-13 07:42:56" vs ISO: "2026-01-13T07:42:43.109Z")
    const allResults = [...soldResults, ...unsoldResults]
      .map(r => ({
        ...r,
        // SQLite 형식을 ISO로 변환 (공백을 T로, Z 추가)
        _sortTime: r.acquired_at.includes('T') 
          ? new Date(r.acquired_at).getTime()
          : new Date(r.acquired_at.replace(' ', 'T') + 'Z').getTime()
      }))
      .sort((a, b) => b._sortTime - a._sortTime);
    
    return { soldResults, unsoldResults, allResults };
  }

  /**
   * 유찰 이력 조회 (DB에서)
   */
  async getUnsoldHistory(limit = 100) {
    const unsoldResults = await this.dbAll(`
      SELECT 
        al.player_id as playerId, p.name as playerName, p.position,
        al.created_at as timestamp,
        'unsold' as type
      FROM auction_log al
      JOIN players p ON al.player_id = p.id
      WHERE al.act = 'UNSOLD'
      ORDER BY al.created_at DESC
      LIMIT ?
    `, [limit]);
    return unsoldResults;
  }

  // ============================================================
  // 클라이언트로 보낼 Public State
  // ============================================================

  async getPublicState() {
    const state = await this.getAuctionState();
    const config = await this.getConfig();
    const currentItem = await this.getCurrentQueueItem();
    const currentHighTeam = await this.getCurrentHighTeam();
    const teams = await this.getTeams();
    const { soldResults, unsoldResults, allResults } = await this.getAuctionResults();

    // 현재 phase의 큐
    const currentPhase = currentItem?.phase || this.getCurrentPhase(state);
    const phaseQueue = currentPhase ? await this.getQueueByPhase(currentPhase) : [];

    // 각 phase 진행 상황
    const phaseProgress = {};
    for (const phase of PHASE_ORDER) {
      const queue = await this.getQueueByPhase(phase);
      const total = queue.length;
      const sold = queue.filter(q => q.status === 'SOLD').length;
      phaseProgress[phase] = { total, sold, remaining: total - sold };
    }

    return {
      // 경매 상태
      phase: currentPhase,
      isRunning: this.timerHandle !== null,
      isPaused: this.pausedRemainingMs !== null,
      isCountingDown: this.isCountingDown,
      countdownSeconds: this.countdownSeconds,
      endsAt: this.endsAt,

      // 현재 경매 대상
      currentPlayer: currentItem ? {
        queueId: currentItem.id,
        playerId: currentItem.player_id,
        name: currentItem.player_name,
        position: currentItem.position,
        tier: currentItem.tier,
        bio: currentItem.bio,
        imgUrl: currentItem.img_url,
        sequence: currentItem.sequence
      } : null,

      // 입찰 정보
      currentHighBid: state?.current_high_bid || 0,
      currentHighTeam: currentHighTeam ? {
        teamId: currentHighTeam.id,
        teamName: currentHighTeam.name,
        captainName: currentHighTeam.captain_name
      } : null,
      globalMinBid: state?.global_min_bid || config.min_bid_start,
      unsoldCount: state?.unsold_count || 0,

      // 설정
      config: {
        timerSeconds: config.timer_seconds,
        bidStepLow: config.bid_step_low,
        bidStepHigh: config.bid_step_high,
        bidStepThreshold: config.bid_step_threshold
      },

      // 팀 정보
      teams: teams.map(t => ({
        id: t.id,
        name: t.name,
        captainName: t.captain_name,
        pointNow: t.point_now
      })),

      // 진행 상황
      phaseProgress,
      phaseQueue: phaseQueue.map(q => ({
        queueId: q.id,
        playerId: q.player_id,
        playerName: q.player_name,
        position: q.position,
        sequence: q.sequence,
        status: q.status
      })),

      // 낙찰 결과 (기존 호환용)
      results: soldResults.map(r => ({
        teamId: r.team_id,
        teamName: r.team_name,
        playerId: r.player_id,
        playerName: r.player_name,
        position: r.position,
        slot: r.slot,
        price: r.price_paid,
        timestamp: r.acquired_at
      })),

      // 유찰 결과 (기존 호환용)
      unsold: unsoldResults.map(u => ({
        playerId: u.player_id,
        playerName: u.player_name,
        position: u.position,
        timestamp: u.acquired_at
      })),

      // 통합 결과 (낙찰+유찰, 시간순 정렬 - 이미 정렬됨)
      allResults: allResults.map(r => ({
        type: r.result_type,
        playerId: r.player_id,
        playerName: r.player_name,
        position: r.position,
        teamName: r.team_name || null,
        price: r.price_paid || 0,
        timestamp: r.acquired_at
      }))
    };
  }

  getCurrentPhase(state) {
    // 현재 queue_id로부터 phase를 추론하거나, 순서대로 찾기
    if (state?.current_queue_id) {
      const match = state.current_queue_id.match(/Q_(TOP|MID|BOT)/);
      if (match) {
        return match[1] === 'BOT' ? 'BOTTOM' : match[1];
      }
    }
    return 'TOP';  // 기본값
  }

  // ============================================================
  // 경매 진행 로직
  // ============================================================

  /**
   * 다음 경매 대상으로 이동
   * @returns {boolean} 다음 대상이 있으면 true
   */
  async moveToNext() {
    // 현재 phase 순서대로 PENDING인 선수 찾기
    for (const phase of PHASE_ORDER) {
      const next = await this.getNextPendingInPhase(phase);
      if (next) {
        // auction_state 업데이트
        await this.dbRun(`
          UPDATE auction_state SET
            current_queue_id = ?,
            current_player_id = ?,
            current_high_bid = 0,
            current_high_team_id = NULL,
            last_tick_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `, [next.id, next.player_id]);

        console.log(`📌 다음 경매 대상: ${next.player_name} (${phase})`);
        return true;
      }
    }

    // 모든 경매 완료
    await this.dbRun(`
      UPDATE auction_state SET
        current_queue_id = NULL,
        current_player_id = NULL,
        current_high_bid = 0,
        current_high_team_id = NULL
      WHERE id = 1
    `);
    console.log('🏁 모든 경매 완료!');
    return false;
  }

  /**
   * 경매 시작 (3초 카운트다운 후 타이머 시작)
   */
  async startAuction() {
    if (this.timerHandle || this.isCountingDown) {
      return { ok: false, error: '이미 경매가 진행 중입니다.' };
    }

    const currentItem = await this.getCurrentQueueItem();
    if (!currentItem) {
      // 다음 대상으로 이동 시도
      const hasNext = await this.moveToNext();
      if (!hasNext) {
        return { ok: false, error: '더 이상 경매할 선수가 없습니다.' };
      }
    }

    // 3초 카운트다운 시작
    this.isCountingDown = true;
    this.countdownSeconds = 3;
    console.log(`⏳ 3초 후 경매 시작!`);
    this.broadcastState();

    await this.runCountdown();
    return { ok: true };
  }

  /**
   * 카운트다운 실행
   */
  async runCountdown() {
    return new Promise((resolve) => {
      const tick = () => {
        if (this.countdownSeconds <= 0) {
          this.isCountingDown = false;
          this.countdownSeconds = 0;
          this.actualStartAuction();
          resolve();
          return;
        }
        
        this.broadcastState();
        this.countdownSeconds--;
        this.countdownHandle = setTimeout(tick, 1000);
      };
      tick();
    });
  }

  /**
   * 실제 경매 타이머 시작
   */
  async actualStartAuction() {
    const config = await this.getConfig();
    const durationMs = config.timer_seconds * 1000;
    this.endsAt = Date.now() + durationMs;
    this.pausedRemainingMs = null;

    // 타이머 시작
    this.timerHandle = setTimeout(() => this.onTimerEnd(), durationMs);

    console.log(`⏱️ 경매 시작! ${config.timer_seconds}초 후 종료`);
    this.broadcastState();
  }

  /**
   * 타이머 종료 시 호출
   */
  async onTimerEnd() {
    this.timerHandle = null;
    this.endsAt = null;
    await this.finalizeCurrentAuction();
  }

  /**
   * 경매 강제 종료 (관리자)
   */
  async forceEndAuction() {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
      this.endsAt = null;
    }
    await this.finalizeCurrentAuction();
    return { ok: true };
  }

  /**
   * 현재 경매 확정 (낙찰 or 유찰 처리)
   */
  async finalizeCurrentAuction() {
    const state = await this.getAuctionState();
    const currentItem = await this.getCurrentQueueItem();
    const config = await this.getConfig();

    if (!currentItem) {
      console.log('⚠️ 확정할 경매 대상이 없습니다.');
      this.broadcastState();
      return;
    }

    const highBid = state.current_high_bid;
    const highTeamId = state.current_high_team_id;

    if (highBid > 0 && highTeamId) {
      // === 낙찰 ===
      await this.processSold(currentItem, highTeamId, highBid);
    } else {
      // === 유찰 ===
      await this.processUnsold(currentItem, config);
    }

    // 다음 경매 대상으로 이동
    await this.moveToNext();
    this.broadcastState();
  }

  /**
   * 낙찰 처리
   */
  async processSold(queueItem, teamId, price) {
    const player = await this.dbGet('SELECT * FROM players WHERE id = ?', [queueItem.player_id]);
    const currentPhase = queueItem.phase;
    
    // 1. 팀 포인트 차감
    await this.dbRun(`
      UPDATE teams SET point_now = point_now - ? WHERE id = ?
    `, [price, teamId]);

    // 2. 팀 로스터에 추가
    await this.dbRun(`
      INSERT INTO team_roster (team_id, slot, player_id, price_paid, acquired_via)
      VALUES (?, ?, ?, ?, 'bid')
    `, [teamId, player.position, queueItem.player_id, price]);

    // 3. 큐 상태 변경
    await this.dbRun(`
      UPDATE auction_queue SET status = 'SOLD' WHERE id = ?
    `, [queueItem.id]);

    // 4. 다음 선수 확인 - 같은 phase인지 체크
    const nextInSamePhase = await this.getNextPendingInPhase(currentPhase);
    const config = await this.getConfig();
    
    if (nextInSamePhase) {
      // 같은 포지션 내에서는 최소 입찰가 유지 (유찰 카운트만 리셋)
      await this.dbRun(`
        UPDATE auction_state SET unsold_count = 0 WHERE id = 1
      `);
    } else {
      // 다른 포지션으로 전환 시 최소 입찰가 초기화
      await this.dbRun(`
        UPDATE auction_state SET 
          unsold_count = 0,
          global_min_bid = ?
        WHERE id = 1
      `, [config.min_bid_start]);
      console.log(`🔄 포지션 전환! 최소 입찰가 ${config.min_bid_start}pt로 초기화`);
    }

    // 5. 로그 기록
    await this.logEvent('BID', 'SOLD', queueItem.id, queueItem.player_id, teamId, price);

    const team = await this.getTeamById(teamId);
    console.log(`🎉 낙찰! ${player.name} → ${team.name} (${price}pt)`);
  }

  /**
   * 유찰 처리
   * - 최소 입찰가 10pt 증가
   * - 해당 포지션 큐 마지막으로 이동
   */
  async processUnsold(queueItem, config) {
    const phase = queueItem.phase;

    // 1. 최소 입찰가 증가
    const state = await this.getAuctionState();
    const newMinBid = state.global_min_bid + config.min_bid_increment_on_unsold;
    
    await this.dbRun(`
      UPDATE auction_state SET
        global_min_bid = ?,
        unsold_count = unsold_count + 1
      WHERE id = 1
    `, [newMinBid]);

    // 2. 해당 phase의 최대 sequence 조회
    const maxSeq = await this.dbGet(`
      SELECT MAX(sequence) as max_seq FROM auction_queue WHERE phase = ?
    `, [phase]);

    // 3. 현재 선수를 마지막 순서로 이동
    const newSequence = (maxSeq?.max_seq || 0) + 1;
    await this.dbRun(`
      UPDATE auction_queue SET sequence = ? WHERE id = ?
    `, [newSequence, queueItem.id]);

    // 4. 로그 기록 (선수 정보 포함)
    await this.logEvent('ADMIN', 'UNSOLD', queueItem.id, queueItem.player_id, null, 0, queueItem.player_name, queueItem.position);

    console.log(`❌ 유찰! ${queueItem.player_name} → ${phase} 마지막으로 이동 (최소입찰가: ${newMinBid}pt)`);
  }

  // ============================================================
  // 입찰 처리
  // ============================================================

  /**
   * 입찰 시도
   * @param {string} teamId - 입찰하는 팀 ID
   * @param {number} bidPrice - 입찰가
   */
  async placeBid(teamId, bidPrice) {
    // 경매 진행 중인지 확인
    if (!this.timerHandle) {
      return { ok: false, error: '경매가 진행 중이 아닙니다.' };
    }

    const state = await this.getAuctionState();
    const config = await this.getConfig();
    const team = await this.getTeamById(teamId);
    const currentItem = await this.getCurrentQueueItem();

    if (!team) {
      return { ok: false, error: '존재하지 않는 팀입니다.' };
    }

    if (!currentItem) {
      return { ok: false, error: '경매 대상이 없습니다.' };
    }

    // 해당 포지션에 이미 선수가 있는지 확인
    const player = await this.dbGet('SELECT * FROM players WHERE id = ?', [currentItem.player_id]);
    const existingRoster = await this.dbGet(`
      SELECT * FROM team_roster WHERE team_id = ? AND slot = ?
    `, [teamId, player.position]);

    if (existingRoster) {
      return { ok: false, error: `이미 ${player.position} 포지션에 선수가 있습니다.` };
    }

    // 최소 입찰가 확인
    const minBid = state.global_min_bid;
    if (bidPrice < minBid) {
      return { ok: false, error: `최소 입찰가(${minBid}pt) 이상이어야 합니다.` };
    }

    // 현재 최고가보다 높은지 확인
    const currentHighBid = state.current_high_bid || 0;
    if (bidPrice <= currentHighBid) {
      return { ok: false, error: `현재 최고가(${currentHighBid}pt)보다 높아야 합니다.` };
    }

    // 호가 단위 확인
    const bidStep = currentHighBid >= config.bid_step_threshold 
      ? config.bid_step_high 
      : config.bid_step_low;
    
    if (currentHighBid > 0 && (bidPrice - currentHighBid) < bidStep) {
      return { ok: false, error: `최소 ${bidStep}pt 이상 올려야 합니다.` };
    }

    // 보유 포인트 확인
    if (team.point_now < bidPrice) {
      return { ok: false, error: `포인트가 부족합니다. (보유: ${team.point_now}pt, 입찰가: ${bidPrice}pt)` };
    }

    // 입찰 성공!
    await this.dbRun(`
      UPDATE auction_state SET
        current_high_bid = ?,
        current_high_team_id = ?,
        last_tick_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [bidPrice, teamId]);

    // 로그 기록
    await this.logEvent('BID', 'PLACE', currentItem.id, currentItem.player_id, teamId, bidPrice);

    // 🔥 새 입찰 발생 시 타이머 리셋 (10초로)
    await this.resetTimer();

    console.log(`💰 입찰! ${team.name}: ${bidPrice}pt (타이머 리셋)`);
    this.broadcastState();
    return { ok: true, bidPrice };
  }

  // ============================================================
  // 로그 기록 (텍스트 파일 + DB)
  // ============================================================

  async logEvent(eventType, act, queueId, playerId, teamId, price, playerName = '', position = '') {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${eventType}:${act} | queue:${queueId} | player:${playerId} | name:${playerName} | pos:${position} | team:${teamId || 'N/A'} | price:${price}\n`;
    
    try {
      fs.appendFileSync(LOG_FILE_PATH, logLine);
    } catch (e) {
      console.error('로그 파일 쓰기 오류:', e);
    }

    // DB에도 저장 (낙찰/유찰 기록용)
    if (act === 'SOLD' || act === 'UNSOLD') {
      const logId = `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      try {
        await this.dbRun(`
          INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [logId, eventType, act, queueId, playerId, teamId, price, timestamp]);
      } catch (e) {
        console.error('DB 로그 저장 오류:', e);
      }
    }
  }

  // ============================================================
  // 브로드캐스트
  // ============================================================

  async broadcastState() {
    if (this.onStateChange) {
      const publicState = await this.getPublicState();
      this.onStateChange(publicState);
    }
  }

  // ============================================================
  // 관리자 기능
  // ============================================================

  /**
   * 특정 선수를 다음 경매 대상으로 설정
   */
  async setCurrentPlayer(queueId) {
    const queueItem = await this.dbGet('SELECT * FROM auction_queue WHERE id = ?', [queueId]);
    if (!queueItem) {
      return { ok: false, error: '존재하지 않는 큐 항목입니다.' };
    }
    if (queueItem.status !== 'PENDING') {
      return { ok: false, error: '이미 처리된 선수입니다.' };
    }

    await this.dbRun(`
      UPDATE auction_state SET
        current_queue_id = ?,
        current_player_id = ?,
        current_high_bid = 0,
        current_high_team_id = NULL
      WHERE id = 1
    `, [queueId, queueItem.player_id]);

    this.broadcastState();
    return { ok: true };
  }

  /**
   * 타이머 리셋 (새 입찰 시)
   */
  async resetTimer() {
    if (!this.timerHandle) return;
    
    // 기존 타이머 취소
    clearTimeout(this.timerHandle);
    
    // 10초로 리셋
    const config = await this.getConfig();
    const durationMs = config.timer_seconds * 1000;
    this.endsAt = Date.now() + durationMs;
    this.pausedRemainingMs = null;
    
    // 새 타이머 시작
    this.timerHandle = setTimeout(() => this.onTimerEnd(), durationMs);
  }

  /**
   * 타이머 일시정지 (관리자)
   */
  pauseTimer() {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
      
      // 남은 시간 저장
      this.pausedRemainingMs = Math.max(0, this.endsAt - Date.now());
      this.endsAt = null;  // 일시정지 상태 표시
      
      console.log(`⏸️ 타이머 일시정지 (${Math.ceil(this.pausedRemainingMs / 1000)}초 남음)`);
      this.broadcastState();
      return { ok: true, remainingMs: this.pausedRemainingMs };
    }
    return { ok: false, error: '진행 중인 타이머가 없습니다.' };
  }

  /**
   * 타이머 재개 (관리자) - 3초 카운트다운 후 재개
   */
  resumeTimer() {
    if (this.timerHandle || this.isCountingDown) {
      return { ok: false, error: '이미 타이머가 진행 중입니다.' };
    }
    if (this.pausedRemainingMs === null || this.pausedRemainingMs === undefined) {
      return { ok: false, error: '재개할 타이머가 없습니다.' };
    }

    // 3초 카운트다운 시작
    this.isCountingDown = true;
    this.countdownSeconds = 3;
    console.log(`⏳ 3초 후 재개!`);
    this.broadcastState();
    
    this.runResumeCountdown();
    return { ok: true };
  }

  /**
   * 재개용 카운트다운 실행
   */
  async runResumeCountdown() {
    return new Promise((resolve) => {
      const tick = () => {
        if (this.countdownSeconds <= 0) {
          this.isCountingDown = false;
          this.countdownSeconds = 0;
          this.actualResumeTimer();
          resolve();
          return;
        }
        
        this.broadcastState();
        this.countdownSeconds--;
        this.countdownHandle = setTimeout(tick, 1000);
      };
      tick();
    });
  }

  /**
   * 실제 타이머 재개
   */
  actualResumeTimer() {
    const remainingMs = this.pausedRemainingMs;
    
    if (remainingMs <= 0) {
      this.pausedRemainingMs = null;
      this.onTimerEnd();
      return;
    }

    this.endsAt = Date.now() + remainingMs;
    this.pausedRemainingMs = null;
    
    this.timerHandle = setTimeout(() => this.onTimerEnd(), remainingMs);
    console.log(`▶️ 타이머 재개 (${Math.ceil(remainingMs / 1000)}초 남음)`);
    this.broadcastState();
  }

  /**
   * 타이머 연장 (관리자)
   */
  async extendTimer(seconds) {
    if (!this.endsAt) {
      return { ok: false, error: '진행 중인 경매가 없습니다.' };
    }

    // 기존 타이머 취소
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
    }

    // 시간 연장
    this.endsAt += seconds * 1000;
    const remainingMs = Math.max(0, this.endsAt - Date.now());
    
    this.timerHandle = setTimeout(() => this.onTimerEnd(), remainingMs);
    console.log(`⏱️ 타이머 ${seconds}초 연장 (${Math.ceil(remainingMs / 1000)}초 남음)`);
    this.broadcastState();
    return { ok: true };
  }

  /**
   * 관리자: 선수 강제 배정
   * @param {string} playerId - 선수 ID
   * @param {string} teamId - 팀 ID
   * @param {number} price - 배정 가격
   */
  async forceAssignPlayer(playerId, teamId, price) {
    const player = await this.dbGet('SELECT * FROM players WHERE id = ?', [playerId]);
    if (!player) {
      return { ok: false, error: '존재하지 않는 선수입니다.' };
    }

    const team = await this.getTeamById(teamId);
    if (!team) {
      return { ok: false, error: '존재하지 않는 팀입니다.' };
    }

    // 해당 포지션에 이미 선수가 있는지 확인
    const existingRoster = await this.dbGet(`
      SELECT * FROM team_roster WHERE team_id = ? AND slot = ?
    `, [teamId, player.position]);

    if (existingRoster) {
      return { ok: false, error: `이미 ${player.position} 포지션에 선수가 있습니다.` };
    }

    // 팀 포인트 확인
    if (team.point_now < price) {
      return { ok: false, error: `팀 포인트가 부족합니다. (보유: ${team.point_now}pt)` };
    }

    // 1. 팀 포인트 차감
    await this.dbRun(`
      UPDATE teams SET point_now = point_now - ? WHERE id = ?
    `, [price, teamId]);

    // 2. 팀 로스터에 추가
    await this.dbRun(`
      INSERT INTO team_roster (team_id, slot, player_id, price_paid, acquired_via)
      VALUES (?, ?, ?, ?, 'admin')
    `, [teamId, player.position, playerId, price]);

    // 3. 큐에서 해당 선수 상태 변경 (있다면)
    await this.dbRun(`
      UPDATE auction_queue SET status = 'SOLD' WHERE player_id = ?
    `, [playerId]);

    // 4. 로그 기록
    await this.logEvent('ADMIN', 'FORCE_ASSIGN', null, playerId, teamId, price);

    console.log(`👑 강제 배정! ${player.name} → ${team.name} (${price}pt)`);
    this.broadcastState();
    return { ok: true, playerName: player.name, teamName: team.name, price };
  }

  /**
   * 모든 선수 목록 가져오기 (강제 배정용)
   */
  async getAllPlayers() {
    return await this.dbAll(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM team_roster tr WHERE tr.player_id = p.id) as is_assigned
      FROM players p
      ORDER BY 
        CASE p.position 
          WHEN 'TOP' THEN 1 
          WHEN 'JUG' THEN 2 
          WHEN 'MID' THEN 3 
          WHEN 'ADC' THEN 4 
          WHEN 'SUP' THEN 5 
        END,
        p.name
    `);
  }
}

module.exports = { Auction, PHASE_ORDER };

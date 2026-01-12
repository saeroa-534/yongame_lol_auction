/**
 * auction.js
 * 경매 핵심 로직 모듈
 * 
 * 경매 순서: TOP → MID → BOTTOM(ADC+SUP)
 * 유찰 시: 최소 입찰가 +10pt 증가 후 해당 포지션 마지막으로 이동
 */

const PHASE_ORDER = ['TOP', 'MID', 'BOTTOM'];  // 포지션 경매 순서

/**
 * Auction 클래스
 * - DB와 연동하여 경매 상태를 관리
 * - 실시간 경매 진행 로직 처리
 */
class Auction {
  constructor(db) {
    this.db = db;
    this.timerHandle = null;      // 경매 타이머
    this.endsAt = null;           // 경매 종료 예정 시각 (timestamp)
    this.onStateChange = null;    // 상태 변경 시 콜백 (브로드캐스트용)
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
      SELECT tr.*, p.name as player_name, p.position
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
  // 경매 낙찰 결과 조회
  // ============================================================

  async getAuctionResults() {
    return await this.dbAll(`
      SELECT 
        tr.team_id, t.name as team_name,
        tr.slot, tr.player_id, p.name as player_name, p.position,
        tr.price_paid, tr.acquired_via, tr.acquired_at
      FROM team_roster tr
      JOIN players p ON tr.player_id = p.id
      JOIN teams t ON tr.team_id = t.id
      WHERE tr.acquired_via = 'bid'
      ORDER BY tr.acquired_at ASC
    `);
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
    const results = await this.getAuctionResults();

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

      // 낙찰 결과
      results: results.map(r => ({
        teamId: r.team_id,
        teamName: r.team_name,
        playerId: r.player_id,
        playerName: r.player_name,
        position: r.position,
        slot: r.slot,
        price: r.price_paid
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
   * 경매 시작 (타이머 시작)
   */
  async startAuction() {
    if (this.timerHandle) {
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

    const config = await this.getConfig();
    const durationMs = config.timer_seconds * 1000;
    this.endsAt = Date.now() + durationMs;

    // 타이머 시작
    this.timerHandle = setTimeout(() => this.onTimerEnd(), durationMs);

    console.log(`⏱️ 경매 시작! ${config.timer_seconds}초 후 종료`);
    this.broadcastState();
    return { ok: true };
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

    // 4. 유찰 카운트 리셋 & 최소 입찰가 리셋
    const config = await this.getConfig();
    await this.dbRun(`
      UPDATE auction_state SET 
        unsold_count = 0,
        global_min_bid = ?
      WHERE id = 1
    `, [config.min_bid_start]);

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

    // 4. 로그 기록
    await this.logEvent('ADMIN', 'UNSOLD', queueItem.id, queueItem.player_id, null, 0);

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

    // 보유 포인트 확인 (남은 슬롯 수 고려)
    const roster = await this.getTeamRoster(teamId);
    const filledSlots = roster.length;
    const remainingSlots = 5 - filledSlots;  // TOP, JUG, MID, ADC, SUP
    const reserveNeeded = (remainingSlots - 1) * minBid;  // 나머지 슬롯 최소 입찰용

    if (team.point_now < bidPrice + reserveNeeded) {
      return { ok: false, error: `포인트가 부족합니다. (보유: ${team.point_now}pt, 필요: ${bidPrice + reserveNeeded}pt)` };
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

    console.log(`💰 입찰! ${team.name}: ${bidPrice}pt`);
    this.broadcastState();
    return { ok: true, bidPrice };
  }

  // ============================================================
  // 로그 기록
  // ============================================================

  async logEvent(eventType, act, queueId, playerId, teamId, price) {
    const logId = `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.dbRun(`
      INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [logId, eventType, act, queueId, playerId, teamId, price]);
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
   * 타이머 일시정지 (관리자)
   */
  pauseTimer() {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
      // endsAt은 유지하여 남은 시간 계산 가능
      console.log('⏸️ 타이머 일시정지');
      this.broadcastState();
      return { ok: true };
    }
    return { ok: false, error: '진행 중인 타이머가 없습니다.' };
  }

  /**
   * 타이머 재개 (관리자)
   */
  resumeTimer() {
    if (this.timerHandle) {
      return { ok: false, error: '이미 타이머가 진행 중입니다.' };
    }
    if (!this.endsAt) {
      return { ok: false, error: '재개할 타이머가 없습니다.' };
    }

    const remainingMs = Math.max(0, this.endsAt - Date.now());
    if (remainingMs <= 0) {
      // 이미 시간 초과됨
      this.onTimerEnd();
      return { ok: true };
    }

    this.timerHandle = setTimeout(() => this.onTimerEnd(), remainingMs);
    console.log(`▶️ 타이머 재개 (${Math.ceil(remainingMs / 1000)}초 남음)`);
    this.broadcastState();
    return { ok: true };
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
}

module.exports = { Auction, PHASE_ORDER };

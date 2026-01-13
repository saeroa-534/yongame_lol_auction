/**
 * sockets.js
 * Socket.IO 이벤트 핸들러
 */

function setupSockets(io, auction) {
  // 상태 변경 시 모든 클라이언트에게 브로드캐스트
  auction.onStateChange = (state) => {
    io.emit('state', state);
  };

  const captainSockets = new Map();
  auction.onDecisionRequest = (teamId, payload) => {
    const sockets = captainSockets.get(teamId);
    if (!sockets) return;
    for (const s of sockets) {
      s.emit('captain:decisionRequest', payload);
    }
  };

  io.on('connection', async (socket) => {
    // 역할 확인 (admin, captain, viewer)
    const role = socket.handshake.auth.role || 'viewer';
    const teamId = socket.handshake.auth.teamId || null;
    
    socket.data.role = role;
    socket.data.teamId = teamId;

    console.log(`🔌 연결: ${socket.id} (role: ${role}, teamId: ${teamId})`);

    if (role === 'captain' && teamId) {
      if (!captainSockets.has(teamId)) {
        captainSockets.set(teamId, new Set());
      }
      captainSockets.get(teamId).add(socket);
    }

    if (role === 'captain' && teamId && auction.decisionState) {
      const currentTeamId = auction.decisionState.teamOrder?.[auction.decisionState.index];
      if (currentTeamId === teamId && typeof auction.requestDecisionForCurrentTeam === 'function') {
        const currentItem = await auction.getCurrentQueueItem();
        if (currentItem) {
          await auction.requestDecisionForCurrentTeam(currentItem);
        }
      }
    }

    // 초기 상태 전송
    try {
      const state = await auction.getPublicState();
      socket.emit('state', state);
    } catch (e) {
      console.error('초기 상태 전송 실패:', e);
    }

    // ========================================
    // 팀장(Captain) 이벤트
    // ========================================

    /**
     * 입찰
     * data: { price: number }
     */
    socket.on('bid', async (data) => {
      if (role !== 'captain' || !teamId) {
        socket.emit('bidRejected', { reason: '팀장만 입찰할 수 있습니다.' });
        return;
      }

      const price = Number(data?.price);
      if (!Number.isFinite(price) || price <= 0) {
        socket.emit('bidRejected', { reason: '올바른 입찰가를 입력해주세요.' });
        return;
      }

      try {
        const result = await auction.placeBid(teamId, price);
        if (!result.ok) {
          socket.emit('bidRejected', { reason: result.error });
        } else {
          socket.emit('bidAccepted', { price: result.bidPrice });
        }
      } catch (e) {
        console.error('입찰 처리 오류:', e);
        socket.emit('bidRejected', { reason: '서버 오류가 발생했습니다.' });
      }
    });

    /**
     * 포인트 부족 우선권 응답
     * data: { queueId: string, accept: boolean }
     */
    socket.on('captain:decision', async (data) => {
      if (role !== 'captain' || !teamId) return;
      const accept = Boolean(data?.accept);
      const result = await auction.handleLowPointDecision(teamId, accept);
      socket.emit('captain:decision:done', result);
    });

    // ========================================
    // 관리자(Admin) 이벤트
    // ========================================

    /**
     * 경매 시작
     */
    socket.on('admin:start', async () => {
      if (role !== 'admin') {
        socket.emit('admin:error', { error: '권한이 없습니다.' });
        return;
      }

      try {
        const result = await auction.startAuction();
        socket.emit('admin:start:done', result);
        if (result?.pendingAdminAssign) {
          socket.emit('admin:error', { error: '입찰 가능한 팀이 없습니다. 관리자 배정이 필요합니다.' });
        }
      } catch (e) {
        console.error('경매 시작 오류:', e);
        socket.emit('admin:start:done', { ok: false, error: String(e.message) });
      }
    });

    /**
     * 경매 강제 종료 (낙찰/유찰 처리)
     */
    socket.on('admin:end', async () => {
      if (role !== 'admin') {
        socket.emit('admin:error', { error: '권한이 없습니다.' });
        return;
      }

      try {
        const result = await auction.forceEndAuction();
        socket.emit('admin:end:done', result);
      } catch (e) {
        console.error('경매 종료 오류:', e);
        socket.emit('admin:end:done', { ok: false, error: String(e.message) });
      }
    });

    /**
     * 타이머 일시정지
     */
    socket.on('admin:pause', () => {
      if (role !== 'admin') return;
      const result = auction.pauseTimer();
      socket.emit('admin:pause:done', result);
    });

    /**
     * 타이머 재개
     */
    socket.on('admin:resume', () => {
      if (role !== 'admin') return;
      const result = auction.resumeTimer();
      socket.emit('admin:resume:done', result);
    });

    /**
     * 특정 선수 선택 (다음 경매 대상 설정)
     * data: { queueId: string }
     */
    socket.on('admin:selectPlayer', async (data) => {
      if (role !== 'admin') return;
      const queueId = data?.queueId;
      if (!queueId) {
        socket.emit('admin:selectPlayer:done', { ok: false, error: 'queueId 필요' });
        return;
      }
      const result = await auction.setCurrentPlayer(queueId);
      socket.emit('admin:selectPlayer:done', result);
    });

    /**
     * 전체 큐 조회
     */
    socket.on('admin:getQueue', async () => {
      if (role !== 'admin') return;
      try {
        const queue = await auction.getFullQueue();
        socket.emit('admin:queue', queue);
      } catch (e) {
        socket.emit('admin:error', { error: String(e.message) });
      }
    });

    /**
     * 모든 선수 목록 요청 (관리자 배정용)
     */
    socket.on('admin:getAllPlayers', async () => {
      if (role !== 'admin') return;
      try {
        const players = await auction.getAllPlayers();
        socket.emit('admin:allPlayers', players);
      } catch (e) {
        console.error('선수 목록 요청 오류:', e);
      }
    });

    /**
     * 관리자: 선수 강제 배정 (무과금)
     * data: { playerId: string, teamId: string }
     */
    socket.on('admin:forceAssign', async (data) => {
      if (role !== 'admin') {
        socket.emit('admin:forceAssign:done', { ok: false, error: '권한이 없습니다.' });
        return;
      }

      const { playerId, teamId } = data || {};
      if (!playerId || !teamId) {
        socket.emit('admin:forceAssign:done', { ok: false, error: '모든 필드를 입력해주세요.' });
        return;
      }

      try {
        const result = await auction.forceAssignPlayerNoPay(playerId, teamId);
        socket.emit('admin:forceAssign:done', result);
      } catch (e) {
        console.error('강제 배정 오류:', e);
        socket.emit('admin:forceAssign:done', { ok: false, error: String(e.message) });
      }
    });

    // ========================================
    // 공통 이벤트
    // ========================================

    /**
     * 상태 요청 (동기화)
     */
    socket.on('requestState', async () => {
      try {
        const state = await auction.getPublicState();
        socket.emit('state', state);
      } catch (e) {
        console.error('상태 요청 오류:', e);
      }
    });

    /**
     * 팀 정보 요청
     */
    socket.on('getTeams', async () => {
      try {
        const teams = await auction.getTeams();
        socket.emit('teams', teams);
      } catch (e) {
        console.error('팀 정보 요청 오류:', e);
      }
    });

    /**
     * 팀 로스터 요청
     * data: { teamId: string }
     */
    socket.on('getRoster', async (data) => {
      try {
        const tId = data?.teamId || teamId;
        if (!tId) {
          socket.emit('roster', { error: 'teamId 필요' });
          return;
        }
        const roster = await auction.getTeamRoster(tId);
        socket.emit('roster', { teamId: tId, roster });
      } catch (e) {
        console.error('로스터 요청 오류:', e);
      }
    });

    /**
     * 모든 팀 로스터 요청 (팀장, 시청자용)
     */
    socket.on('getAllRosters', async () => {
      try {
        const allRosters = await auction.getAllTeamRosters();
        socket.emit('allRosters', allRosters);
      } catch (e) {
        console.error('전체 로스터 요청 오류:', e);
      }
    });

    /**
     * 최근 낙찰 결과 요청 (유찰 포함)
     */
    socket.on('getAuctionResults', async () => {
      try {
        const results = await auction.getAuctionResults(10);
        const unsold = await auction.getUnsoldHistory(10);
        socket.emit('auctionResults', { results, unsold });
      } catch (e) {
        console.error('경매 결과 요청 오류:', e);
      }
    });

    /**
     * 연결 해제
     */
    socket.on('disconnect', () => {
      console.log(`🔌 연결 해제: ${socket.id}`);
      if (role === 'captain' && teamId) {
        const set = captainSockets.get(teamId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) {
            captainSockets.delete(teamId);
          }
        }
      }
    });
  });
}

module.exports = { setupSockets };

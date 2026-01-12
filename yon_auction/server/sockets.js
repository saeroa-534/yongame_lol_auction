/**
 * sockets.js
 * Socket.IO 이벤트 핸들러
 */

function setupSockets(io, auction) {
  // 상태 변경 시 모든 클라이언트에게 브로드캐스트
  auction.onStateChange = (state) => {
    io.emit('state', state);
  };

  io.on('connection', async (socket) => {
    // 역할 확인 (admin, captain, viewer)
    const role = socket.handshake.auth.role || 'viewer';
    const teamId = socket.handshake.auth.teamId || null;
    
    socket.data.role = role;
    socket.data.teamId = teamId;

    console.log(`🔌 연결: ${socket.id} (role: ${role}, teamId: ${teamId})`);

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
     * 타이머 연장
     * data: { seconds: number }
     */
    socket.on('admin:extend', async (data) => {
      if (role !== 'admin') return;
      const seconds = Number(data?.seconds) || 10;
      const result = await auction.extendTimer(seconds);
      socket.emit('admin:extend:done', result);
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
     * 다음 선수로 이동 (스킵)
     */
    socket.on('admin:next', async () => {
      if (role !== 'admin') return;
      try {
        const hasNext = await auction.moveToNext();
        await auction.broadcastState();
        socket.emit('admin:next:done', { ok: true, hasNext });
      } catch (e) {
        socket.emit('admin:next:done', { ok: false, error: String(e.message) });
      }
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
     * 연결 해제
     */
    socket.on('disconnect', () => {
      console.log(`🔌 연결 해제: ${socket.id}`);
    });
  });
}

module.exports = { setupSockets };

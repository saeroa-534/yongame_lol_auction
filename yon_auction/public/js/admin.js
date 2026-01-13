/**
 * admin.js - 관리자 페이지 스크립트
 */

// Socket.IO 연결
const socket = io({
  auth: { role: 'admin' }
});

// DOM 요소
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태 저장
let currentState = null;
let currentPhase = 'TOP';

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  socket.emit('getAllRosters');
  socket.emit('admin:getAllPlayers');
  socket.emit('getTeams');
});

function setupEventListeners() {
  // 경매 컨트롤 버튼
  $('#btnStart').addEventListener('click', () => socket.emit('admin:start'));
  
  // 일시정지/재개 토글 버튼
  $('#btnPause').addEventListener('click', () => {
    if (currentState?.isPaused) {
      socket.emit('admin:resume');
    } else {
      socket.emit('admin:pause');
    }
  });
  
  $('#btnEnd').addEventListener('click', () => {
    if (confirm('정말 경매를 강제 종료하시겠습니까?')) {
      socket.emit('admin:end');
    }
  });
  
  // DB 리셋
  $('#btnReset').addEventListener('click', () => {
    if (confirm('⚠️ 정말 DB를 초기화하시겠습니까?\n모든 경매 데이터가 삭제됩니다!')) {
      socket.emit('admin:reset');
    }
  });

  $('#btnForceAssign').addEventListener('click', () => {
    const playerId = $('#forcePlayer').value;
    const teamId = $('#forceTeam').value;

    if (!playerId) {
      showMessage('선수를 선택해주세요.', 'error');
      return;
    }
    if (!teamId) {
      showMessage('팀을 선택해주세요.', 'error');
      return;
    }

    const playerName = $('#forcePlayer').selectedOptions[0].text;
    const teamName = $('#forceTeam').selectedOptions[0].text;

    if (confirm(`${playerName}을(를) ${teamName}에 포인트 전액으로 배정하시겠습니까?`)) {
      socket.emit('admin:forceAssign', { playerId, teamId });
    }
  });

  // Phase 탭
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPhase = tab.dataset.phase;
      renderQueue();
    });
  });
}

// ===== Socket 이벤트 =====
socket.on('connect', () => {
  console.log('✅ 서버 연결됨');
  showMessage('서버에 연결되었습니다.', 'success');
  socket.emit('getAllRosters');
});

socket.on('disconnect', () => {
  console.log('❌ 서버 연결 끊김');
  showMessage('서버 연결이 끊어졌습니다.', 'error');
});

socket.on('state', (state) => {
  console.log('📦 상태 수신:', state);
  currentState = state;
  renderAll();
  if (state?.allRosters) {
    renderAdminRosters(state.allRosters);
  } else {
    socket.emit('getAllRosters');
  }
});

socket.on('admin:start:done', (res) => {
  if (res.ok) {
    if (res.pendingAdminAssign) {
      showMessage('입찰 가능한 팀이 없습니다. 관리자 배정이 필요합니다.', 'info');
    } else if (res.pendingDecision) {
      showMessage('포인트 부족 우선권 요청 중입니다.', 'info');
    } else if (res.autoAssigned) {
      showMessage('자동 낙찰 처리되었습니다. 다음 경매를 시작하려면 다시 누르세요.', 'info');
    } else {
      showMessage('경매가 시작되었습니다!', 'success');
    }
  } else {
    showMessage(res.error, 'error');
  }
});

socket.on('admin:end:done', (res) => {
  if (res.ok) {
    showMessage('경매가 종료되었습니다.', 'info');
  } else {
    showMessage(res.error, 'error');
  }
});

socket.on('admin:pause:done', (res) => {
  showMessage(res.ok ? '타이머가 일시정지되었습니다.' : res.error, res.ok ? 'info' : 'error');
});

socket.on('admin:resume:done', (res) => {
  showMessage(res.ok ? '타이머가 재개되었습니다.' : res.error, res.ok ? 'success' : 'error');
});

socket.on('admin:reset:done', (res) => {
  showMessage(res.ok ? 'DB가 초기화되었습니다!' : res.error, res.ok ? 'success' : 'error');
});


socket.on('allRosters', (data) => {
  renderAdminRosters(data);
});

socket.on('admin:allPlayers', (players) => {
  const select = $('#forcePlayer');
  if (!select) return;
  select.innerHTML = '<option value="">선수 선택...</option>';

  players.forEach(p => {
    const assigned = p.is_assigned > 0;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `[${p.position}] ${p.name}${assigned ? ' (배정됨)' : ''}`;
    opt.disabled = assigned;
    select.appendChild(opt);
  });
});

socket.on('teams', (teams) => {
  const select = $('#forceTeam');
  if (!select) return;
  select.innerHTML = '<option value="">팀 선택...</option>';

  teams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.pointNow}pt)`;
    select.appendChild(opt);
  });
});

socket.on('admin:forceAssign:done', (res) => {
  if (res.ok) {
    showMessage(`${res.playerName}이(가) ${res.teamName}에 포인트 전액으로 배정되었습니다.`, 'success');
    socket.emit('admin:getAllPlayers');
    socket.emit('getTeams');
  } else {
    showMessage(res.error, 'error');
  }
});

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderQueue();
  renderResults();
  updateButtons();
}

function renderAdminRosters(allRosters) {
  const container = $('#adminAllRosters');
  if (!container || !allRosters) return;

  const slots = ['TOP', 'JUG', 'MID', 'ADC', 'SUP'];
  const teams = Object.values(allRosters);

  if (teams.length === 0) {
    container.innerHTML = '<p style="color: #72767D; text-align: center;">팀 정보 없음</p>';
    return;
  }

  container.innerHTML = teams.map(teamData => {
    const rosterBySlot = {};
    teamData.roster.forEach(r => { rosterBySlot[r.slot] = r; });

    return `
      <div class="queue-item" style="flex-direction: column; align-items: stretch; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--white); font-weight: 700;">${teamData.team.name}</span>
          <span style="color: var(--warning); font-size: 0.85rem;">${teamData.team.pointNow}pt</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;">
          ${slots.map(slot => {
            const player = rosterBySlot[slot];
            return `
              <div style="background: var(--darker); padding: 6px; border-radius: 6px; text-align: center;">
                <div class="position-${slot}" style="font-size: 0.65rem; font-weight: 700;">${slot}</div>
                <div style="font-size: 0.7rem; color: var(--white);">${player ? player.playerName : '-'}</div>
                ${player ? `<div style=\"font-size: 0.65rem; color: #72767D;\">${player.pricePaid}pt</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderCurrentPlayer() {
  const player = currentState.currentPlayer;
  
  if (!player) {
    $('#noPlayer').classList.remove('hidden');
    $('#playerInfo').classList.add('hidden');
    return;
  }
  
  $('#noPlayer').classList.add('hidden');
  $('#playerInfo').classList.remove('hidden');
  
  $('#playerName').textContent = player.name;
  $('#playerPosition').textContent = player.position;
  $('#playerPosition').className = `player-position position-${player.position}`;
  $('#playerTier').textContent = player.tier || '-';
  $('#playerBio').textContent = player.bio || '-';
  
  // 이미지 (placeholder 처리)
  const img = $('#playerImage');
  if (player.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
    img.src = player.imgUrl;
  } else {
    img.src = `https://via.placeholder.com/200x200/23272A/DCDDDE?text=${encodeURIComponent(player.name)}`;
  }
}

function renderBidInfo() {
  $('#currentBid').textContent = currentState.currentHighBid || 0;
  $('#currentBidder').textContent = currentState.currentHighTeam?.teamName || '-';
  $('#minBid').textContent = currentState.globalMinBid || 5;
}

function renderTimer() {
  const timerEl = $('#timer');
  const statusEl = $('#timerStatus');
  
  // 카운트다운 중인 경우
  if (currentState.isCountingDown) {
    timerEl.textContent = currentState.countdownSeconds;
    timerEl.className = 'timer warning';
    statusEl.textContent = '잠시 후 시작!';
    return;
  }
  
  // 일시정지 상태
  if (currentState.isPaused) {
    timerEl.textContent = '--';
    timerEl.className = 'timer';
    statusEl.textContent = '⏸️ 일시정지';
    return;
  }
  
  // 타이머가 실행 중이 아닌 경우
  if (!currentState.isRunning || !currentState.endsAt) {
    timerEl.textContent = '--';
    timerEl.className = 'timer';
    statusEl.textContent = currentState.currentPlayer ? '시작 대기' : '선수 선택 필요';
    return;
  }
  
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (!currentState?.isRunning || !currentState?.endsAt) return;
  if (currentState?.isCountingDown || currentState?.isPaused) return;
  
  const timerEl = $('#timer');
  const statusEl = $('#timerStatus');
  const remaining = Math.max(0, currentState.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  
  timerEl.textContent = seconds;
  statusEl.textContent = '진행 중';
  
  // 경고 색상
  timerEl.className = 'timer';
  if (seconds <= 3) {
    timerEl.classList.add('danger');
  } else if (seconds <= 5) {
    timerEl.classList.add('warning');
  }
}

// 타이머 업데이트 (200ms 간격)
setInterval(updateTimerDisplay, 200);

function renderQueue() {
  const container = $('#queueList');
  const progress = currentState.phaseProgress?.[currentPhase] || { sold: 0, total: 0 };
  
  $('#queueProgress').textContent = `${progress.sold}/${progress.total}`;
  
  // 서버에서 현재 phase 큐 가져오기 요청
  socket.emit('admin:getQueue');
}

// 큐 데이터 수신
socket.on('admin:queue', (queueData) => {
  const container = $('#queueList');
  const queue = queueData[currentPhase] || [];
  
  // 현재 선수의 queueId
  const currentQueueId = currentState?.currentPlayer?.queueId;
  
  container.innerHTML = queue.map(item => {
    const isCurrent = item.id === currentQueueId;
    const statusClass = item.status === 'SOLD' ? 'sold' : (isCurrent ? 'current' : '');
    
    return `
      <div class="queue-item ${statusClass}" data-queue-id="${item.id}">
        <span class="queue-seq">${item.sequence}</span>
        <span class="player-position position-${item.position}" style="padding: 2px 8px; font-size: 0.75rem;">${item.position}</span>
        <span style="flex: 1;">${item.player_name}</span>
        <span class="status-badge status-${item.status.toLowerCase()}">${item.status}</span>
      </div>
    `;
  }).join('') || '<p style="text-align: center; color: #72767D;">선수 없음</p>';
  
  // 클릭 이벤트 (선수 선택)
  container.querySelectorAll('.queue-item:not(.sold)').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const queueId = el.dataset.queueId;
      const playerName = el.querySelector('span:nth-child(3)').textContent;
      if (confirm(`"${playerName}"를 다음 경매 대상으로 설정하시겠습니까?`)) {
        socket.emit('admin:selectPlayer', { queueId });
      }
    });
  });
});

function renderResults() {
  const container = $('#recentResults');
  // 서버에서 이미 시간순 정렬된 allResults 사용
  const allResults = currentState.allResults || [];
  
  container.innerHTML = allResults.map(r => {
    if (r.type === 'unsold') {
      return `
        <div class="queue-item" style="background: rgba(237, 66, 69, 0.2); border-left: 3px solid var(--danger);">
          <span class="player-position position-${r.position}" style="padding: 2px 8px; font-size: 0.75rem;">${r.position}</span>
          <span style="flex: 1;">${r.playerName}</span>
          <span style="color: var(--danger);">유찰</span>
        </div>
      `;
    }
    return `
      <div class="queue-item">
        <span class="player-position position-${r.position}" style="padding: 2px 8px; font-size: 0.75rem;">${r.position}</span>
        <span style="flex: 1;">${r.playerName}</span>
        <span style="color: var(--warning);">${r.price} pt</span>
        <span style="color: var(--secondary);">→ ${r.teamName}</span>
      </div>
    `;
  }).join('') || '<p style="text-align: center; color: #72767D;">아직 낙찰 없음</p>';
}

function updateButtons() {
  const isRunning = currentState.isRunning;
  const isPaused = currentState.isPaused;
  const isCountingDown = currentState.isCountingDown;
  const hasPlayer = !!currentState.currentPlayer;
  
  $('#btnStart').disabled = isRunning || isCountingDown || !hasPlayer;
  $('#btnEnd').disabled = !isRunning && !isPaused;
  $('#btnNext').disabled = isRunning || isCountingDown;
  $('#btnExtend10').disabled = !isRunning;
  $('#btnExtend30').disabled = !isRunning;
  
  // 일시정지/재개 버튼 상태 관리
  const pauseBtn = $('#btnPause');
  
  if (isPaused) {
    // 일시정지 상태 → 재개 버튼으로
    pauseBtn.textContent = '▶️ 재개';
    pauseBtn.disabled = false;
  } else if (isRunning) {
    // 진행 중 → 일시정지 버튼으로
    pauseBtn.textContent = '⏸️ 일시정지';
    pauseBtn.disabled = false;
  } else {
    // 대기 상태
    pauseBtn.textContent = '⏸️ 일시정지';
    pauseBtn.disabled = true;
  }
}

// ===== 유틸리티 =====
function showMessage(text, type = 'info') {
  const msg = $('#message');
  msg.textContent = text;
  msg.className = `message message-${type}`;
  msg.classList.remove('hidden');
  
  setTimeout(() => {
    msg.classList.add('hidden');
  }, 3000);
}

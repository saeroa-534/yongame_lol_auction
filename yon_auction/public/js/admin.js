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
});

function setupEventListeners() {
  // 경매 컨트롤 버튼
  $('#btnStart').addEventListener('click', () => socket.emit('admin:start'));
  $('#btnPause').addEventListener('click', () => socket.emit('admin:pause'));
  $('#btnEnd').addEventListener('click', () => {
    if (confirm('정말 경매를 강제 종료하시겠습니까?')) {
      socket.emit('admin:end');
    }
  });
  $('#btnNext').addEventListener('click', () => socket.emit('admin:next'));
  
  // 타이머 연장
  $('#btnExtend10').addEventListener('click', () => socket.emit('admin:extend', { seconds: 10 }));
  $('#btnExtend30').addEventListener('click', () => socket.emit('admin:extend', { seconds: 30 }));
  
  // DB 리셋
  $('#btnReset').addEventListener('click', () => {
    if (confirm('⚠️ 정말 DB를 초기화하시겠습니까?\n모든 경매 데이터가 삭제됩니다!')) {
      socket.emit('admin:reset');
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
});

socket.on('disconnect', () => {
  console.log('❌ 서버 연결 끊김');
  showMessage('서버 연결이 끊어졌습니다.', 'error');
});

socket.on('state', (state) => {
  console.log('📦 상태 수신:', state);
  currentState = state;
  renderAll();
});

socket.on('admin:start:done', (res) => {
  if (res.ok) {
    showMessage('경매가 시작되었습니다!', 'success');
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

socket.on('admin:next:done', (res) => {
  if (!res.ok) {
    showMessage(res.error, 'error');
  } else if (!res.hasNext) {
    showMessage('모든 경매가 완료되었습니다!', 'info');
  }
});

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderTeams();
  renderQueue();
  renderResults();
  updateButtons();
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
  $('#playerTier').textContent = player.tier || '';
  
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

function renderTeams() {
  const container = $('#teamList');
  if (!currentState.teams) return;
  
  container.innerHTML = currentState.teams.map(team => {
    const isCurrent = currentState.currentHighTeam?.teamId === team.id;
    return `
      <div class="card team-item ${isCurrent ? 'current-bidder-team' : ''}" style="margin: 0;">
        <div>
          <div class="team-name">${team.name}</div>
          <div style="font-size: 0.85rem; color: #72767D;">팀장: ${team.captainName}</div>
        </div>
        <div class="team-points">${team.pointNow} pt</div>
      </div>
    `;
  }).join('');
}

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
  const results = currentState.results || [];
  
  // 최근 5개만 역순으로
  const recent = results.slice(-5).reverse();
  
  container.innerHTML = recent.map(r => `
    <div class="queue-item">
      <span class="player-position position-${r.position}" style="padding: 2px 8px; font-size: 0.75rem;">${r.position}</span>
      <span style="flex: 1;">${r.playerName}</span>
      <span style="color: var(--warning);">${r.price} pt</span>
      <span style="color: var(--secondary);">→ ${r.teamName}</span>
    </div>
  `).join('') || '<p style="text-align: center; color: #72767D;">아직 낙찰 없음</p>';
}

function updateButtons() {
  const isRunning = currentState.isRunning;
  const hasPlayer = !!currentState.currentPlayer;
  
  $('#btnStart').disabled = isRunning || !hasPlayer;
  $('#btnPause').disabled = !isRunning;
  $('#btnEnd').disabled = !isRunning;
  $('#btnNext').disabled = isRunning;
  $('#btnExtend10').disabled = !isRunning;
  $('#btnExtend30').disabled = !isRunning;
  
  // 일시정지 버튼 텍스트 변경
  if (isRunning) {
    $('#btnPause').textContent = '⏸️ 일시정지';
  } else if (currentState.endsAt && !isRunning) {
    $('#btnPause').textContent = '▶️ 재개';
    $('#btnPause').disabled = false;
    $('#btnPause').onclick = () => socket.emit('admin:resume');
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

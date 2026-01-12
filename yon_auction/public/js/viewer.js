/**
 * viewer.js - 시청자 페이지 스크립트
 */

// Socket.IO 연결
const socket = io({
  auth: { role: 'viewer' }
});

// DOM 요소
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태
let currentState = null;

// ===== Socket 이벤트 =====
socket.on('connect', () => {
  console.log('✅ 서버 연결됨');
});

socket.on('disconnect', () => {
  console.log('❌ 서버 연결 끊김');
});

socket.on('state', (state) => {
  console.log('📦 상태 수신:', state);
  currentState = state;
  renderAll();
});

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderPhaseIndicator();
  renderMainState();
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderTeams();
  renderResults();
  renderUpcomingQueue();
}

function renderPhaseIndicator() {
  const currentPhase = currentState.phase || 'TOP';
  const progress = currentState.phaseProgress || {};
  
  $$('.phase-dot').forEach(dot => {
    const phase = dot.dataset.phase;
    dot.classList.remove('active', 'completed');
    
    const phaseData = progress[phase] || { sold: 0, total: 0 };
    
    if (phase === currentPhase && currentState.currentPlayer) {
      dot.classList.add('active');
    } else if (phaseData.sold === phaseData.total && phaseData.total > 0) {
      dot.classList.add('completed');
    }
    
    dot.textContent = `${phase} (${phaseData.sold}/${phaseData.total})`;
  });
}

function renderMainState() {
  const hasPlayer = !!currentState.currentPlayer;
  const allDone = !hasPlayer && currentState.results?.length > 0;
  
  $('#waitingState').classList.toggle('hidden', hasPlayer || allDone);
  $('#endedState').classList.toggle('hidden', !allDone);
  $('#auctionState').classList.toggle('hidden', !hasPlayer);
}

function renderCurrentPlayer() {
  const player = currentState.currentPlayer;
  if (!player) return;
  
  $('#playerName').textContent = player.name;
  $('#playerPosition').textContent = player.position;
  $('#playerPosition').className = `player-position position-${player.position}`;
  
  const img = $('#playerImage');
  if (player.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
    img.src = player.imgUrl;
  } else {
    img.src = `https://via.placeholder.com/280x280/23272A/DCDDDE?text=${encodeURIComponent(player.name)}`;
  }
}

function renderBidInfo() {
  const bid = currentState.currentHighBid || 0;
  const bidder = currentState.currentHighTeam?.teamName || '-';
  
  $('#currentBid').textContent = bid;
  $('#currentBidder').textContent = bidder;
  
  // 입찰자가 있으면 강조
  if (currentState.currentHighTeam) {
    $('#bidderLabel').style.color = 'var(--secondary)';
  } else {
    $('#bidderLabel').style.color = '#72767D';
  }
}

function renderTimer() {
  const timerEl = $('#timer');
  
  if (!currentState.isRunning || !currentState.endsAt) {
    timerEl.textContent = '--';
    timerEl.className = 'big-timer timer';
    return;
  }
  
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (!currentState?.isRunning || !currentState?.endsAt) return;
  
  const timerEl = $('#timer');
  const remaining = Math.max(0, currentState.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  
  timerEl.textContent = seconds;
  
  timerEl.className = 'big-timer timer';
  if (seconds <= 3) {
    timerEl.classList.add('danger');
  } else if (seconds <= 5) {
    timerEl.classList.add('warning');
  }
}

setInterval(updateTimerDisplay, 200);

function renderTeams() {
  const container = $('#teamGrid');
  if (!currentState.teams) return;
  
  container.innerHTML = currentState.teams.map(team => {
    const isCurrent = currentState.currentHighTeam?.teamId === team.id;
    return `
      <div class="card" style="margin: 0; ${isCurrent ? 'border: 2px solid var(--warning); background: rgba(250, 166, 26, 0.1);' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: var(--white); font-size: 1.1rem;">${team.name}</div>
            <div style="font-size: 0.85rem; color: #72767D;">${team.captainName}</div>
          </div>
          <div style="font-size: 1.5rem; font-weight: 700; color: ${isCurrent ? 'var(--warning)' : 'var(--secondary)'};">
            ${team.pointNow}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderResults() {
  const results = currentState.results || [];
  $('#resultCount').textContent = `${results.length}명`;
  
  const container = $('#resultsList');
  
  // 역순으로 (최신이 위로)
  const reversed = [...results].reverse();
  
  container.innerHTML = reversed.map(r => `
    <div class="result-card">
      <div class="position-badge position-${r.position}">${r.position}</div>
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--white);">${r.playerName}</div>
        <div style="font-size: 0.85rem; color: var(--secondary);">→ ${r.teamName}</div>
      </div>
      <div style="font-weight: 700; color: var(--warning);">${r.price} pt</div>
    </div>
  `).join('') || '<p style="text-align: center; color: #72767D; padding: 20px;">아직 낙찰된 선수가 없습니다.</p>';
}

function renderUpcomingQueue() {
  const container = $('#upcomingQueue');
  const queue = currentState.phaseQueue || [];
  const currentQueueId = currentState.currentPlayer?.queueId;
  
  // PENDING 상태인 것만 (현재 선수 제외)
  const upcoming = queue.filter(q => q.status === 'PENDING' && q.queueId !== currentQueueId);
  
  // 최대 5개만
  const limited = upcoming.slice(0, 5);
  
  container.innerHTML = limited.map((item, idx) => `
    <div class="queue-item">
      <span class="queue-seq">${idx + 1}</span>
      <span class="player-position position-${item.position}" style="padding: 2px 8px; font-size: 0.75rem;">${item.position}</span>
      <span style="flex: 1;">${item.playerName}</span>
    </div>
  `).join('') || '<p style="text-align: center; color: #72767D;">대기 중인 선수 없음</p>';
}

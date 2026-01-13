/**
 * captain.js - 팀장 페이지 스크립트
 */

// URL에서 팀 ID 가져오기
const params = new URLSearchParams(location.search);
let teamId = params.get('team');

// DOM 요소
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태
let currentState = null;
let socket = null;
let currentQueuePhase = 'TOP';

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
  if (!teamId) {
    // 팀 선택 화면 표시
    showTeamSelect();
  } else {
    initSocket();
  }
});

function showTeamSelect() {
  $('#teamSelect').classList.remove('hidden');

  const selectSocket = io({ auth: { role: 'viewer' } });
  const listEl = $('#teamSelectList');

  selectSocket.on('connect', () => {
    selectSocket.emit('getTeams');
  });

  selectSocket.on('teams', (teams) => {
    if (!teams || teams.length === 0) {
      listEl.innerHTML = '<p style="color: #72767D; text-align: center;">팀 정보 없음</p>';
      return;
    }
    listEl.innerHTML = teams.map(t => `
      <button class="btn btn-primary btn-lg" onclick="selectTeam('${t.id}')">${t.name}</button>
    `).join('');
  });
}

window.selectTeam = function(id) {
  teamId = id;
  location.href = `?team=${id}`;
};

function initSocket() {
  socket = io({
    auth: { 
      role: 'captain',
      teamId: teamId
    }
  });

  setupSocketEvents();
  setupEventListeners();
}

function setupSocketEvents() {
  socket.on('connect', () => {
    console.log('✅ 서버 연결됨');
    showMessage('서버에 연결되었습니다.', 'success');
    // 내 팀 로스터 요청
    socket.emit('getRoster', { teamId });
    // 전체 팀 로스터 요청
    socket.emit('getAllRosters');
  });

  socket.on('disconnect', () => {
    console.log('❌ 서버 연결 끊김');
    showMessage('서버 연결이 끊어졌습니다!', 'error');
  });

  socket.on('state', (state) => {
    console.log('📦 상태 수신:', state);
    currentState = state;
    renderAll();
    // 상태 변경 시 전체 로스터 갱신
    socket.emit('getAllRosters');
  });

  socket.on('roster', (data) => {
    console.log('📋 로스터 수신:', data);
    if (data.teamId === teamId) {
      renderMyRoster(data.roster);
    }
  });

  socket.on('allRosters', (data) => {
    console.log('📊 전체 로스터 수신:', data);
    renderAllRosters(data);
  });

  socket.on('bidAccepted', (data) => {
    showMessage(`입찰 성공! ${data.price} pt`, 'success');
    $('#customBidInput').value = '';
  });

  socket.on('bidRejected', (data) => {
    showMessage(data.reason, 'error');
    showBidError(data.reason);
  });

  socket.on('captain:decisionRequest', (data) => {
    const playerLabel = `${data.playerName} (${data.position})`;
    const promptText = data.isLast
      ? `포인트 부족 우선권 마지막 팀입니다.\n${playerLabel}을(를) ${data.price}pt로 낙찰받습니다.`
      : `포인트 부족 우선권입니다.\n${playerLabel}을(를) ${data.price}pt로 낙찰받겠습니까?`;
    const accept = data.isLast ? true : window.confirm(promptText);
    socket.emit('captain:decision', { queueId: data.queueId, accept });
  });

  socket.on('captain:decision:done', (res) => {
    if (!res?.ok) return;
    if (res.assigned) {
      showMessage(res.forced ? '마지막 팀이라 자동 낙찰되었습니다.' : '낙찰 처리되었습니다.', 'info');
    } else {
      showMessage('우선권이 다음 팀으로 넘어갔습니다.', 'info');
    }
  });
}

function setupEventListeners() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentQueuePhase = tab.dataset.phase;
      renderQueueOrder();
    });
  });

  // 빠른 입찰 버튼
  $$('.bid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount;
      let bidPrice;
      
      const currentHigh = currentState?.currentHighBid || 0;
      const minBid = currentState?.globalMinBid || 5;
      const bidStep = currentHigh >= 300 ? 10 : 5;
      
      if (amount === 'min') {
        bidPrice = currentHigh > 0 ? currentHigh + bidStep : minBid;
      } else {
        const add = parseInt(amount.replace('+', ''));
        bidPrice = currentHigh + add;
      }
      
      $('#customBidInput').value = bidPrice;
      placeBid(bidPrice);
    });
  });

  // 직접 입찰 버튼
  $('#btnBid').addEventListener('click', () => {
    const price = parseInt($('#customBidInput').value);
    if (price > 0) {
      placeBid(price);
    }
  });

  // Enter 키로 입찰
  $('#customBidInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const price = parseInt($('#customBidInput').value);
      if (price > 0) {
        placeBid(price);
      }
    }
  });
}

function placeBid(price) {
  if (!currentState?.isRunning) {
    showBidError('경매가 진행 중이 아닙니다.');
    return;
  }
  if ((currentState.currentHighBid || 0) > 0 && currentState.currentHighTeam?.teamId === teamId) {
    showBidError('이미 최고 입찰자입니다.');
    return;
  }
  
  socket.emit('bid', { price });
  hideBidError();
}

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderMyTeam();
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderTeamsHorizontal();
  renderRecentResults();
  renderQueueOrder();
  updateBidPanel();
  updateBidIndicator();
  
  // 로스터 새로고침
  socket.emit('getRoster', { teamId });
}

function renderMyTeam() {
  const myTeam = currentState.teams?.find(t => t.id === teamId);
  if (!myTeam) return;
  
  $('#myTeamName').textContent = myTeam.name;
  $('#myCaptainName').textContent = myTeam.captainName;
  $('#myPoints').textContent = myTeam.pointNow;
  $('#teamBadge').textContent = `🏆 ${myTeam.name}`;
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
  
  // 티어 및 바이오 표시
  $('#playerTier').textContent = player.tier || '';
  $('#playerBio').textContent = player.bio || '';
  
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
  
  // 카운트다운 중
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
  
  if (!currentState.isRunning || !currentState.endsAt) {
    timerEl.textContent = '--';
    timerEl.className = 'timer';
    statusEl.textContent = '대기 중';
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
  
  timerEl.className = 'timer';
  if (seconds <= 3) {
    timerEl.classList.add('danger');
  } else if (seconds <= 5) {
    timerEl.classList.add('warning');
  }
}

setInterval(updateTimerDisplay, 200);

function renderTeamsHorizontal() {
  const container = $('#teamsHorizontal');
  if (!currentState.teams) return;
  
  container.innerHTML = currentState.teams.map(team => {
    const isMine = team.id === teamId;
    const isCurrent = currentState.currentHighTeam?.teamId === team.id;
    let classes = 'team-chip';
    if (isMine) classes += ' my-team';
    if (isCurrent) classes += ' current-bidder';
    
    return `
      <div class="${classes}">
        <div class="team-chip-name">${team.name}</div>
        <div class="team-chip-points">${team.pointNow} pt</div>
      </div>
    `;
  }).join('');
}

function renderRecentResults() {
  const container = $('#recentResults');
  // 서버에서 이미 시간순 정렬된 allResults 사용
  const allResults = currentState.allResults || [];
  
  container.innerHTML = allResults.map(r => {
    if (r.type === 'unsold') {
      return `
        <div class="result-item unsold">
          <span class="position-${r.position}" style="padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; font-weight: 600;">${r.position}</span>
          <span style="flex: 1; color: var(--white);">${r.playerName}</span>
          <span style="color: var(--danger);">유찰</span>
        </div>
      `;
    }
    return `
      <div class="result-item">
        <span class="position-${r.position}" style="padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; font-weight: 600;">${r.position}</span>
        <span style="flex: 1; color: var(--white);">${r.playerName}</span>
        <span style="color: var(--warning);">${r.price}pt</span>
        <span style="color: #72767D;">→ ${r.teamName}</span>
      </div>
    `;
  }).join('') || '<p style="text-align: center; color: #72767D; font-size: 0.8rem;">아직 낙찰 없음</p>';
}

/**
 * 전체 팀 로스터 렌더링 (프로필 사진 활용)
 */
function renderAllRosters(allRosters) {
  const container = $('#allRosters');
  if (!allRosters) return;
  
  const slots = ['TOP', 'JUG', 'MID', 'ADC', 'SUP'];
  const allTeams = Object.values(allRosters);
  
  if (allTeams.length === 0) {
    container.innerHTML = '<p style="color: #72767D; text-align: center;">팀 정보 없음</p>';
    return;
  }
  
  // 빈 슬롯용 기본 이미지 (SVG 데이터 URI)
  const emptySlotImg = 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="18" fill="#40444B"/>
      <circle cx="18" cy="14" r="6" fill="#72767D"/>
      <ellipse cx="18" cy="28" rx="10" ry="7" fill="#72767D"/>
    </svg>
  `);
  
  container.innerHTML = allTeams.map(teamData => {
    const rosterBySlot = {};
    teamData.roster.forEach(r => rosterBySlot[r.slot] = r);
    const isMine = teamData.team.id === teamId;
    
    return `
      <div class="team-roster-card" style="${isMine ? 'border: 2px solid var(--primary);' : ''}">
        <div class="team-roster-header">
          <span style="font-weight: 700; color: var(--white); font-size: 0.85rem;">${teamData.team.name}${isMine ? ' (나)' : ''}</span>
          <span style="color: var(--warning); font-size: 0.8rem;">${teamData.team.pointNow}pt</span>
        </div>
        <div class="roster-slots">
          ${slots.map(slot => {
            const player = rosterBySlot[slot];
            let imgUrl;
            if (player?.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
              imgUrl = player.imgUrl;
            } else if (player) {
              imgUrl = `https://via.placeholder.com/36x36/23272A/FFF?text=${encodeURIComponent(player.playerName[0])}`;
            } else {
              imgUrl = emptySlotImg;
            }
            
            return `
              <div class="roster-slot-mini ${player ? 'filled' : 'empty'}">
                <img src="${imgUrl}" alt="${slot}" onerror="this.src='${emptySlotImg}'">
                <span class="slot-label position-${slot}" style="padding: 1px 4px; border-radius: 2px;">${slot}</span>
                <span class="player-name-mini">${player ? player.playerName : '-'}</span>
                ${player ? `<span style="font-size: 0.65rem; color: #72767D;">${player.pricePaid}pt</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderQueueOrder() {
  const listEl = $('#queueList');
  const progressEl = $('#queueProgress');
  if (!listEl || !progressEl) return;

  const phase = currentQueuePhase || currentState.phase || 'TOP';
  const phaseQueue = currentState?.phaseQueueByPhase?.[phase] || currentState.phaseQueue || [];
  const progress = currentState.phaseProgress?.[phase] || { sold: 0, total: 0 };

  progressEl.textContent = `${progress.sold}/${progress.total}`;

  if (phaseQueue.length === 0) {
    listEl.innerHTML = '<p style="color: #72767D; text-align: center;">큐 정보 없음</p>';
    return;
  }

  listEl.innerHTML = phaseQueue.map(item => {
    const isCurrent = currentState.currentPlayer?.queueId === item.queueId;
    const itemClass = [
      'queue-item',
      isCurrent ? 'current' : '',
      item.status === 'SOLD' ? 'sold' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${itemClass}">
        <div class="queue-seq">${item.sequence}</div>
        <div style="flex: 1;">
          <div style="color: var(--white); font-weight: 600;">${item.playerName}</div>
          <div style="color: #72767D; font-size: 0.8rem;">${item.position}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateBidPanel() {
  const panel = $('#bidPanel');
  const isRunning = currentState.isRunning;
  const hasPlayer = !!currentState.currentPlayer;
  
  // 입찰 가능 여부
  const canBid = isRunning && hasPlayer && canBidOnCurrentPlayer();
  
  // 버튼 비활성화
  $$('.bid-btn').forEach(btn => btn.disabled = !canBid);
  $('#btnBid').disabled = !canBid;
  $('#customBidInput').disabled = !canBid;
  
  if (!canBid && hasPlayer) {
    panel.style.opacity = '0.5';
  } else {
    panel.style.opacity = '1';
  }
  
  // 최대 입찰 가능 금액 표시
  updateMaxBidInfo();
}

function updateMaxBidInfo() {
  const maxBidEl = $('#maxBidAmount');
  if (!maxBidEl) return;
  
  const myTeam = currentState.teams?.find(t => t.id === teamId);
  if (!myTeam) {
    maxBidEl.textContent = '-';
    return;
  }
  
  // 모든 포인트 사용 가능
  maxBidEl.textContent = myTeam.pointNow;
}

function canBidOnCurrentPlayer() {
  if (!currentState.currentPlayer) return false;
  
  const position = currentState.currentPlayer.position;
  const myTeam = currentState.teams?.find(t => t.id === teamId);
  
  // 해당 포지션에 이미 선수가 있는지 체크 (results에서)
  const alreadyHas = currentState.results?.some(
    r => r.teamId === teamId && r.slot === position
  );
  
  if (alreadyHas) return false;
  
  // 포인트 체크
  const minBid = currentState.globalMinBid || 5;
  if (myTeam && myTeam.pointNow < minBid) return false;

  // 이미 최고 입찰자면 추가 입찰 불가
  if ((currentState.currentHighBid || 0) > 0 && currentState.currentHighTeam?.teamId === teamId) return false;
  
  return true;
}

// 입찰 불가 사유 캐시 (중복 알림 방지)
let lastBidWarning = '';

function updateBidIndicator() {
  // 구 bidIndicator 제거됨 - 입찰 불가 시 토스트로 1회만 알림
  const isRunning = currentState.isRunning;
  const hasPlayer = !!currentState.currentPlayer;
  
  if (!isRunning || !hasPlayer) {
    lastBidWarning = '';
    return;
  }
  
  if (!canBidOnCurrentPlayer()) {
    // 사유
    const position = currentState.currentPlayer?.position;
    const alreadyHas = currentState.results?.some(
      r => r.teamId === teamId && r.slot === position
    );
    
    let warning = '';
    if (alreadyHas) {
      warning = `이미 ${position} 선수를 보유하고 있습니다.`;
    } else if ((currentState.currentHighBid || 0) > 0 && currentState.currentHighTeam?.teamId === teamId) {
      warning = '이미 최고 입찰자입니다.';
    } else {
      warning = '포인트가 부족합니다.';
    }
    
    // 동일 경고 중복 방지
    if (warning !== lastBidWarning) {
      showToast(warning, 'warning');
      lastBidWarning = warning;
    }
  } else {
    lastBidWarning = '';
  }
}

// ===== 유틸리티 =====
function showMessage(text, type = 'info') {
  // 토스트 알림으로 표시
  showToast(text, type);
}

function showToast(text, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = text;
  
  container.appendChild(toast);
  
  // 3초 후 제거
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function showBidError(text) {
  const el = $('#bidError');
  el.textContent = text;
  el.style.display = 'block';
  
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

function hideBidError() {
  $('#bidError').style.display = 'none';
}

/**
 * viewer.js - 시청자 페이지 스크립트 (전체 팀 로스터 메인)
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
  socket.emit('getAllRosters');
});

socket.on('disconnect', () => {
  console.log('❌ 서버 연결 끊김');
});

socket.on('state', (state) => {
  console.log('📦 상태 수신:', state);
  currentState = state;
  renderAll();
  socket.emit('getAllRosters');
});

socket.on('allRosters', (data) => {
  console.log('📊 전체 로스터 수신:', data);
  renderRostersGrid(data);
});

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderPhaseIndicator();
  renderMainState();
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderRecentResults();
}

function renderPhaseIndicator() {
  const currentPhase = currentState.phase || 'TOP';
  const progress = currentState.phaseProgress || {};
  
  $$('.phase-chip').forEach(chip => {
    const phase = chip.dataset.phase;
    chip.classList.remove('active', 'completed');
    
    const phaseData = progress[phase] || { sold: 0, total: 0 };
    
    if (phase === currentPhase && currentState.currentPlayer) {
      chip.classList.add('active');
    } else if (phaseData.sold === phaseData.total && phaseData.total > 0) {
      chip.classList.add('completed');
    }
    
    chip.textContent = `${phase} (${phaseData.sold}/${phaseData.total})`;
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
  
  // 티어 및 바이오 표시
  const tierEl = $('#playerTier');
  const bioEl = $('#playerBio');
  if (tierEl) tierEl.textContent = player.tier || '';
  if (bioEl) bioEl.textContent = player.bio || '';
  
  const img = $('#playerImage');
  if (player.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
    img.src = player.imgUrl;
  } else {
    img.src = `https://via.placeholder.com/100x100/23272A/DCDDDE?text=${encodeURIComponent(player.name)}`;
  }
}

function renderBidInfo() {
  const bid = currentState.currentHighBid || 0;
  const bidder = currentState.currentHighTeam?.teamName || '-';
  
  $('#currentBid').textContent = bid;
  $('#currentBidder').textContent = bidder;
}

function renderTimer() {
  const timerEl = $('#timer');
  
  // 카운트다운 중
  if (currentState.isCountingDown) {
    timerEl.textContent = currentState.countdownSeconds;
    timerEl.className = 'current-timer timer warning';
    return;
  }
  
  // 일시정지 상태
  if (currentState.isPaused) {
    timerEl.textContent = '⏸';
    timerEl.className = 'current-timer timer';
    return;
  }
  
  if (!currentState.isRunning || !currentState.endsAt) {
    timerEl.textContent = '--';
    timerEl.className = 'current-timer timer';
    return;
  }
  
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (!currentState?.isRunning || !currentState?.endsAt) return;
  if (currentState?.isCountingDown || currentState?.isPaused) return;
  
  const timerEl = $('#timer');
  const remaining = Math.max(0, currentState.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  
  timerEl.textContent = seconds;
  
  timerEl.className = 'current-timer timer';
  if (seconds <= 3) {
    timerEl.classList.add('danger');
  } else if (seconds <= 5) {
    timerEl.classList.add('warning');
  }
}

setInterval(updateTimerDisplay, 200);

function renderRecentResults() {
  const results = currentState.results || [];
  const unsold = currentState.unsold || [];
  
  $('#resultCount').textContent = `${results.length}명`;
  
  const container = $('#recentResults');
  
  // 서버에서 이미 시간순 정렬된 allResults 사용
  const allResults = currentState.allResults || [];
  
  container.innerHTML = allResults.map(r => {
    if (r.type === 'unsold') {
      return `
        <div class="result-mini" style="background: rgba(237, 66, 69, 0.2); border-left: 3px solid var(--danger);">
          <span class="position-${r.position}" style="padding: 2px 5px; border-radius: 3px; font-size: 0.65rem; font-weight: 600;">${r.position}</span>
          <span style="flex: 1; color: var(--white);">${r.playerName}</span>
          <span style="color: var(--danger);">유찰</span>
        </div>
      `;
    }
    return `
      <div class="result-mini">
        <span class="position-${r.position}" style="padding: 2px 5px; border-radius: 3px; font-size: 0.65rem; font-weight: 600;">${r.position}</span>
        <span style="flex: 1; color: var(--white);">${r.playerName}</span>
        <span style="color: var(--warning);">${r.price}pt</span>
        <span style="color: #72767D;">→${r.teamName}</span>
      </div>
    `;
  }).join('') || '<p style="text-align: center; color: #72767D; font-size: 0.8rem;">아직 낙찰 없음</p>';
}

/**
 * 전체 팀 로스터 그리드 렌더링 (메인 뷰)
 */
function renderRostersGrid(allRosters) {
  const container = $('#rostersGrid');
  if (!allRosters || !container) return;
  
  const slots = ['TOP', 'JUG', 'MID', 'ADC', 'SUP'];
  const teams = Object.values(allRosters);
  
  // 빈 슬롯용 기본 이미지 (SVG 데이터 URI)
  const emptySlotImg = 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
      <circle cx="25" cy="25" r="25" fill="#40444B"/>
      <circle cx="25" cy="19" r="8" fill="#72767D"/>
      <ellipse cx="25" cy="38" rx="14" ry="10" fill="#72767D"/>
    </svg>
  `);
  
  if (teams.length === 0) {
    container.innerHTML = '<p style="color: #72767D; text-align: center; grid-column: 1/-1;">팀 정보 없음</p>';
    return;
  }
  
  container.innerHTML = teams.map(teamData => {
    const rosterBySlot = {};
    teamData.roster.forEach(r => rosterBySlot[r.slot] = r);
    const filledCount = teamData.roster.length;
    
    // 현재 입찰 중인 팀인지 확인
    const isBidding = currentState?.currentHighTeam?.teamId === teamData.team.id;
    
    return `
      <div class="team-roster-big" style="${isBidding ? 'border: 2px solid var(--warning);' : ''}">
        <div class="team-roster-header">
          <span class="team-roster-name">${teamData.team.name}</span>
          <span class="team-roster-points">${teamData.team.pointNow} pt</span>
        </div>
        <div class="roster-players">
          ${slots.map(slot => {
            const player = rosterBySlot[slot];
            let imgUrl;
            if (player?.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
              imgUrl = player.imgUrl;
            } else if (player) {
              imgUrl = `https://via.placeholder.com/50x50/23272A/FFF?text=${encodeURIComponent(player.playerName[0])}`;
            } else {
              imgUrl = emptySlotImg;
            }
            
            return `
              <div class="roster-player ${player ? 'filled' : 'empty'}">
                <img src="${imgUrl}" alt="${slot}" onerror="this.src='${emptySlotImg}'">
                <span class="position-label position-${slot}">${slot}</span>
                <span class="player-name-label">${player ? player.playerName : '-'}</span>
                ${player ? `<span class="price-label">${player.pricePaid}pt</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

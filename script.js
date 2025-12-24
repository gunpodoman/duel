// --- [1] 기본 설정 ---
const GRAVITY = 0.25;
const HIT_RADIUS = 30; 
let canvas, ctx, w, h, myId, conn, isHost = false, myNum = 0;
let particles = [];

let state = {
    terrain: [],
    p1: { x: 0, y: 0, hp: 100, angle: -0.5 },
    p2: { x: 0, y: 0, hp: 100, angle: 3.6 },
    turn: 1, wind: 0, ball: null, gameOver: false, winner: 0
};

// --- [2] 초안정 네트워크 엔진 ---
const peer = new Peer(null, {
    config: { 'iceServers': [{ url: 'stun:stun.l.google.com:19302' }, { url: 'stun:stun1.l.google.com:19302' }] },
    debug: 1
});

peer.on('open', id => {
    myId = id;
    const btn = document.getElementById('invite-btn');
    btn.disabled = false;
    btn.innerText = "초대 링크 복사";
    document.getElementById('status').innerText = "서버 연결 완료. 링크를 공유하세요.";
    if(window.location.hash) connectToHost(window.location.hash.substring(1));
});

// 호스트: 연결 대기
peer.on('connection', c => {
    conn = c; isHost = true; myNum = 1;
    setupConnection();
});

// 게스트: 연결 시도
function connectToHost(hostId) {
    conn = peer.connect(hostId, { reliable: true });
    isHost = false; myNum = 2;
    setupConnection();
}

function setupConnection() {
    conn.on('open', () => {
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('game-ui').style.display = 'block';
        initCanvas();
        
        if(isHost) {
            createTerrain();
            // [중요] 접속 성공 즉시 0.5초 후 초기 데이터 강제 전송
            setTimeout(sync, 500); 
        }
        requestAnimationFrame(loop);
    });

    conn.on('data', data => {
        if(data.type === 'SYNC') {
            state = data.state;
            updateUI();
        }
        if(data.type === 'FIRE') {
            state.ball = data.ball;
        }
    });

    conn.on('close', () => { alert("연결 종료"); location.reload(); });
}

function sync() {
    if(isHost && conn && conn.open) {
        conn.send({ type: 'SYNC', state: state });
    }
    updateUI();
}

// --- [3] 물리 및 게임 로직 (턴 고착 현상 해결) ---

function updatePhysics() {
    if(!state.ball || state.gameOver) return;

    const b = state.ball;
    b.vx += b.wind; b.vy += GRAVITY; b.x += b.vx; b.y += b.vy;

    const target = state.turn === 1 ? state.p2 : state.p1;
    const dist = Math.sqrt((b.x - target.x)**2 + (b.y - (target.y - 15))**2);
    const groundY = getTerrainY(b.x);
    
    // 충돌 판정 (호스트가 결정)
    if(dist < HIT_RADIUS || b.y > groundY || b.x < 0 || b.x > w) {
        createBoom(b.x, b.y, state.turn === 1 ? '#3b82f6' : '#ef4444');
        
        if(isHost) {
            if(dist < HIT_RADIUS + 10) {
                target.hp = Math.max(0, target.hp - 34);
                if(target.hp <= 0) { state.gameOver = true; state.winner = state.turn; }
            }
            state.ball = null; // 포탄 제거
            if(!state.gameOver) {
                state.turn = state.turn === 1 ? 2 : 1; // 턴 전환
                state.wind = (Math.random() - 0.5) * 0.4; // 바람 변경
            }
            sync(); // [중요] 모든 변경사항을 즉시 게스트에게 강제 동기화
        } else {
            state.ball = null; // 게스트는 시각적으로만 포탄 지우고 SYNC 대기
        }
    }
}

// --- [4] 입력 및 UI 제어 ---

let input = { active:false, sx:0, sy:0, cx:0, cy:0 };
function setupInput() {
    canvas.addEventListener('pointerdown', e => {
        if(state.turn !== myNum || state.ball || state.gameOver) return;
        input.active = true; input.sx = input.cx = e.clientX; input.sy = input.cy = e.clientY;
    });
    window.addEventListener('pointermove', e => {
        if(!input.active) return;
        input.cx = e.clientX; input.cy = e.clientY;
        const p = myNum === 1 ? state.p1 : state.p2;
        p.angle = Math.atan2(input.sy - input.cy, input.sx - input.cx);
    });
    window.addEventListener('pointerup', () => {
        if(!input.active) return;
        input.active = false;
        const dx = input.sx - input.cx, dy = input.sy - input.cy;
        const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
        const ang = Math.atan2(dy, dx);
        
        if(pwr > 3) {
            const ballData = { x:(myNum===1?state.p1.x:state.p2.x), y:(myNum===1?state.p1.y:state.p2.y)-15, vx:Math.cos(ang)*pwr, vy:Math.sin(ang)*pwr, wind:state.wind };
            state.ball = ballData;
            conn.send({ type: 'FIRE', ball: ballData });
            updateUI();
        }
    });
}

function updateUI() {
    document.getElementById('hp1').style.width = state.p1.hp + '%';
    document.getElementById('hp2').style.width = state.p2.hp + '%';
    const wnd = state.wind * 100;
    document.getElementById('wind-ui').innerText = `WIND: ${Math.abs(wnd).toFixed(1)} ${wnd>=0?'→':'←'}`;
    const msg = document.getElementById('msg');
    
    if(state.gameOver) {
        msg.innerText = (state.winner === 1 ? "BLUE" : "RED") + " WINS!";
        msg.style.color = state.winner === 1 ? 'var(--p1)' : 'var(--p2)';
        msg.classList.add('show');
    } else {
        msg.innerText = state.turn === myNum ? "YOUR TURN" : "ENEMY TURN";
        msg.style.color = state.turn === myNum ? 'var(--accent)' : '#fff';
        msg.classList.add('show');
    }
}

// --- 나머지 렌더링/유틸 (기존과 동일) ---

function initCanvas() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    setupInput();
}

function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }

function createTerrain() {
    state.terrain = [];
    let curH = h * 0.7;
    for(let x = 0; x <= w + 100; x += 50) {
        curH += (Math.random() - 0.5) * 120;
        curH = Math.max(h * 0.4, Math.min(h * 0.85, curH));
        state.terrain.push({x, y: curH});
    }
    state.p1.x = w * 0.15; state.p1.y = getTerrainY(state.p1.x);
    state.p2.x = w * 0.85; state.p2.y = getTerrainY(state.p2.x);
    state.wind = (Math.random() - 0.5) * 0.4;
}

function getTerrainY(x) {
    for(let i=0; i<state.terrain.length-1; i++) {
        if(x >= state.terrain[i].x && x <= state.terrain[i+1].x) {
            let r = (x - state.terrain[i].x) / (state.terrain[i+1].x - state.terrain[i].x);
            return state.terrain[i].y * (1-r) + state.terrain[i+1].y * r;
        }
    }
    return h;
}

function loop() {
    updatePhysics();
    draw();
    requestAnimationFrame(loop);
}

function draw() {
    ctx.clearRect(0,0,w,h);
    let g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#020617'); g.addColorStop(1,'#1e293b');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    
    if(state.terrain.length) {
        ctx.beginPath(); ctx.moveTo(0,h);
        state.terrain.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(w,h); ctx.fillStyle = '#0f172a'; ctx.fill();
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.stroke();
    }
    drawTank(state.p1, 1); drawTank(state.p2, 2);
    if(state.ball) {
        ctx.fillStyle = '#fff'; ctx.shadowBlur = 15; ctx.shadowColor = '#fff';
        ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, 6, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
    }
    if(input.active && state.turn === myNum && !state.ball) drawGuide();
    particles.forEach((p,i) => {
        p.x += p.vx; p.y += p.vy; p.a -= 0.02;
        ctx.fillStyle = `rgba(${p.c}, ${p.a})`;
        ctx.fillRect(p.x, p.y, p.s, p.s);
        if(p.a <= 0) particles.splice(i,1);
    });
}

function drawTank(p, n) {
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = n === 1 ? '#3b82f6' : '#ef4444';
    ctx.beginPath(); ctx.roundRect(-22, -12, 44, 18, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -12, 12, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,-15);
    ctx.lineTo(Math.cos(p.angle)*30, Math.sin(p.angle)*30-15); ctx.stroke();
    ctx.restore();
}

function drawGuide() {
    const p = myNum === 1 ? state.p1 : state.p2;
    const dx = input.sx - input.cx, dy = input.sy - input.cy;
    const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
    const ang = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.setLineDash([6,6]); ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    let tx = p.x, ty = p.y-15, tvx = Math.cos(ang)*pwr, tvy = Math.sin(ang)*pwr;
    for(let i=0; i<40; i++) {
        ctx.lineTo(tx, ty); tvx += state.wind; tvy += GRAVITY; tx += tvx; ty += tvy;
    }
    ctx.stroke(); ctx.setLineDash([]);
}

function createBoom(x, y, color) {
    const rgb = color === '#3b82f6' ? '59, 130, 246' : '239, 68, 68';
    for(let i=0; i<30; i++) {
        particles.push({ x, y, vx:(Math.random()-0.5)*12, vy:(Math.random()-0.5)*12, s:Math.random()*6+2, a:1, c:rgb });
    }
}

function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#${myId}`;
    navigator.clipboard.writeText(url).then(() => {
        document.getElementById('status').innerText = "링크 복사 완료! 친구에게 보내세요.";
    });
}

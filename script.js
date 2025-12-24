// --- [1] 게임 설정 ---
const GRAVITY = 0.25;
const MAX_HP = 200;
const SPLASH_RADIUS = 80;
const MAX_DAMAGE = 70;

let canvas, ctx, w, h, myId, conn, isHost = false, myNum = 0;
let particles = [];
let state = {
    terrain: [],
    p1: { x: 0, y: 0, hp: MAX_HP, angle: -0.5 },
    p2: { x: 0, y: 0, hp: MAX_HP, angle: 3.6 },
    turn: 1, wind: 0, ball: null, gameOver: false, winner: 0
};

// --- [2] 초안정 네트워크 엔진 ---
const peer = new Peer(null, {
    config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
});

peer.on('open', id => {
    myId = id;
    const btn = document.getElementById('invite-btn');
    btn.disabled = false;
    btn.innerText = "초대 링크 복사";
    document.getElementById('status').innerText = "서버 연결 성공!";
    if(window.location.hash) connectToHost(window.location.hash.substring(1));
});

peer.on('connection', c => {
    conn = c; isHost = true; myNum = 1;
    setupConnection();
});

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
            setTimeout(sync, 500); // 채널 안정화 후 데이터 전송
        } else {
            conn.send({ type: 'REQ_INIT' });
        }
        requestAnimationFrame(loop);
    });

    conn.on('data', data => {
        if(data.type === 'REQ_INIT' && isHost) sync();
        if(data.type === 'SYNC') { state = data.state; updateUI(); }
        if(data.type === 'FIRE') state.ball = data.ball;
    });

    conn.on('error', err => {
        document.getElementById('status').innerText = "연결 오류 발생. 다시 시도하세요.";
    });
}

function sync() {
    if(isHost && conn && conn.open) {
        conn.send({ type: 'SYNC', state });
    }
    updateUI();
}

// --- [3] 물리 엔진 (자폭 방지 로직 적용) ---
function update() {
    if(!state.ball || state.gameOver) return;

    const b = state.ball;
    b.vx += b.wind; b.vy += GRAVITY; b.x += b.vx; b.y += b.vy;

    const groundY = getTerrainY(b.x);
    const distP1 = Math.sqrt((b.x - state.p1.x)**2 + (b.y - (state.p1.y - 15))**2);
    const distP2 = Math.sqrt((b.x - state.p2.x)**2 + (b.y - (state.p2.y - 15))**2);

    // 충돌 판정 (자폭 방지를 위해 최소 이동 거리나 외곽 발사 적용됨)
    if(b.y > groundY || distP1 < 20 || distP2 < 20 || b.x < 0 || b.x > w) {
        createBoom(b.x, b.y);
        
        if(isHost) {
            const calcDmg = (dist) => {
                if (dist > SPLASH_RADIUS) return 0;
                return Math.floor(MAX_DAMAGE * (1 - dist / SPLASH_RADIUS));
            };

            state.p1.hp = Math.max(0, state.p1.hp - calcDmg(distP1));
            state.p2.hp = Math.max(0, state.p2.hp - calcDmg(distP2));

            if(state.p1.hp <= 0) { state.gameOver = true; state.winner = 2; }
            else if(state.p2.hp <= 0) { state.gameOver = true; state.winner = 1; }

            state.ball = null;
            if(!state.gameOver) {
                state.turn = state.turn === 1 ? 2 : 1;
                state.wind = (Math.random() - 0.5) * 0.5;
            }
            sync();
        } else {
            state.ball = null;
        }
    }
}

// --- [4] 그래픽 (은은하고 선명한 지형) ---
function draw() {
    ctx.clearRect(0,0,w,h);
    
    // 배경: 깊은 우주 그라데이션
    let sky = ctx.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,'#020617'); sky.addColorStop(1,'#0f172a');
    ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);
    
    if(state.terrain.length) {
        // 지형 내부 채우기
        ctx.beginPath(); ctx.moveTo(0, h);
        state.terrain.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(w, h); ctx.closePath();
        let terr = ctx.createLinearGradient(0, h*0.4, 0, h);
        terr.addColorStop(0, '#1e293b'); terr.addColorStop(1, '#020617');
        ctx.fillStyle = terr; ctx.fill();

        // 지형 윤곽선 (은은한 네온 블루 글로우)
        ctx.beginPath();
        state.terrain.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10; ctx.shadowColor = '#38bdf8';
        ctx.stroke();
        ctx.shadowBlur = 0; // 그림자 초기화
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
        ctx.fillStyle = `rgba(${p.c}, ${p.a})`; ctx.fillRect(p.x, p.y, p.s, p.s);
        if(p.a <= 0) particles.splice(i,1);
    });
}

// --- [5] 핵심 수정: 발사 위치 보정 ---
function setupInput() {
    canvas.onpointerdown = e => {
        if(state.turn === myNum && !state.ball && !state.gameOver) {
            input.active = true; input.sx = input.cx = e.clientX; input.sy = input.cy = e.clientY;
        }
    };
    window.onpointermove = e => {
        if(input.active) {
            input.cx = e.clientX; input.cy = e.clientY;
            (myNum === 1 ? state.p1 : state.p2).angle = Math.atan2(input.sy - input.cy, input.sx - input.cx);
        }
    };
    window.onpointerup = () => {
        if(input.active) {
            input.active = false;
            const dx = input.sx - input.cx, dy = input.sy - input.cy;
            const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
            const ang = Math.atan2(dy, dx);
            
            if(pwr > 3) {
                const p = myNum === 1 ? state.p1 : state.p2;
                // [중요] 포탄 시작 지점을 포신 끝(30px 거리)으로 설정하여 본인 탱크 충돌 방지
                const startX = p.x + Math.cos(p.angle) * 32;
                const startY = (p.y - 15) + Math.sin(p.angle) * 32;
                
                const b = { x: startX, y: startY, vx: Math.cos(ang) * pwr, vy: Math.sin(ang) * pwr, wind: state.wind };
                state.ball = b;
                conn.send({ type: 'FIRE', ball: b });
            }
        }
    };
}

// --- 기타 유틸리티 (유지) ---
function initCanvas() { canvas = document.getElementById('gameCanvas'); ctx = canvas.getContext('2d'); resize(); window.onresize = resize; setupInput(); }
function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
function createTerrain() {
    state.terrain = []; let curH = h * 0.7;
    for(let x = 0; x <= w + 100; x += 50) {
        curH += (Math.random() - 0.5) * 120;
        state.terrain.push({x, y: Math.max(h*0.4, Math.min(h*0.85, curH))});
    }
    state.p1.x = w * 0.15; state.p1.y = getTerrainY(state.p1.x);
    state.p2.x = w * 0.85; state.p2.y = getTerrainY(state.p2.x);
    state.wind = (Math.random() - 0.5) * 0.4;
}
function getTerrainY(x) {
    for(let i=0; i<state.terrain.length-1; i++) {
        if(x >= state.terrain[i].x && x <= state.terrain[i+1].x) {
            let r = (x - state.terrain[i].x) / (state.terrain[i+1].x - state.terrain[i].x);
            return state.terrain[i].y*(1-r)+state.terrain[i+1].y*r;
        }
    }
    return h;
}
function loop() { update(); draw(); requestAnimationFrame(loop); }
function drawTank(p, n) {
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = n === 1 ? '#3b82f6' : '#ef4444';
    ctx.beginPath(); ctx.roundRect(-22, -12, 44, 18, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -12, 12, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(Math.cos(p.angle)*30, Math.sin(p.angle)*30-15); ctx.stroke();
    ctx.restore();
}
function drawGuide() {
    const p = myNum === 1 ? state.p1 : state.p2;
    const dx = input.sx - input.cx, dy = input.sy - input.cy;
    const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
    const ang = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.setLineDash([6,6]); ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    const startX = p.x + Math.cos(p.angle) * 32;
    const startY = (p.y - 15) + Math.sin(p.angle) * 32;
    let tx = startX, ty = startY, tvx = Math.cos(ang)*pwr, tvy = Math.sin(ang)*pwr;
    for(let i=0; i<40; i++) { ctx.lineTo(tx, ty); tvx += state.wind; tvy += GRAVITY; tx += tvx; ty += tvy; }
    ctx.stroke(); ctx.setLineDash([]);
}
function createBoom(x, y) {
    for(let i=0; i<40; i++) particles.push({ x, y, vx:(Math.random()-0.5)*15, vy:(Math.random()-0.5)*15, s:Math.random()*8+2, a:1, c:'251, 191, 36' });
}
let input = { active:false, sx:0, sy:0, cx:0, cy:0 };
function updateUI() {
    document.getElementById('hp1').style.width = (state.p1.hp / MAX_HP * 100) + '%';
    document.getElementById('hp2').style.width = (state.p2.hp / MAX_HP * 100) + '%';
    document.getElementById('wind-ui').innerText = `WIND: ${Math.abs(state.wind*100).toFixed(1)} ${state.wind>=0?'→':'←'}`;
    const msg = document.getElementById('msg');
    if(state.gameOver) {
        msg.innerText = (state.winner === 1 ? "BLUE" : "RED") + " WINS!";
        msg.style.color = state.winner === 1 ? 'var(--p1)' : 'var(--p2)';
    } else {
        msg.innerText = state.turn === myNum ? "YOUR TURN" : "ENEMY TURN";
        msg.style.color = state.turn === myNum ? 'var(--accent)' : '#fff';
    }
    msg.classList.add('show');
}
function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#${myId}`;
    navigator.clipboard.writeText(url).then(() => {
        document.getElementById('status').innerText = "링크 복사 완료! 친구를 초대하세요.";
    });
}

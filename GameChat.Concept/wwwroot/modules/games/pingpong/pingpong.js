import { getUserName } from '../../../js/user.js';

export const meta = {
    id:       'pingpong',
    label:    ' Ping Pong',
    cssPath:  '/modules/games/pingpong/pingpong.css',
    htmlPath: '/modules/games/pingpong/pingpong.html',
};

export async function init() {
    // -- Config from appsettings via /api/config ------------------------------
    const cfg = await fetch('/api/config').then(r => r.json()).then(d => d.pingPong);

    // -- SignalR connection ---------------------------------------------------
    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/pingponghub')
        .withAutomaticReconnect()
        .build();

    // -- DOM refs -------------------------------------------------------------
    const lobbyEl       = document.getElementById('pingpong-lobby');
    const gameEl        = document.getElementById('pingpong-game');
    const resultEl      = document.getElementById('pingpong-result');
    const canvas        = document.getElementById('pp-canvas');
    const ctx           = canvas.getContext('2d');

    const joinBtnEl     = document.getElementById('pp-join-btn');
    const joinFormEl    = document.getElementById('pp-join-form');
    const cancelBtnEl   = document.getElementById('pp-cancel-btn');
    const leaveBtnEl    = document.getElementById('pp-leave-btn');
    const newNamesBtnEl = document.getElementById('pp-new-names-btn');

    const lobbyStatusEl  = document.getElementById('pp-lobby-status');
    const gameStatusEl   = document.getElementById('pp-game-status');
    const waitingBadgeEl = document.getElementById('pp-waiting-badge');
    const winnerTextEl   = document.getElementById('pp-winner-text');
    const controlsHintEl = document.getElementById('pp-controls-hint');
    const score1El       = document.getElementById('pp-score1');
    const score2El       = document.getElementById('pp-score2');
    const name1El        = document.getElementById('pp-name-display1');
    const name2El        = document.getElementById('pp-name-display2');

    const lobbyActionsEl    = document.getElementById('pp-lobby-actions');
    const lobbyQueueBtnEl   = document.getElementById('pp-lobby-queue-btn');
    const lobbyCountsEl     = document.getElementById('pp-lobby-counts');
    const lobbyQueueCountEl = document.getElementById('pp-lobby-queue-count');

    // -- Game constants -------------------------------------------------------
    const W            = cfg.canvasWidth;
    const H            = cfg.canvasHeight;
    const PADDLE_W     = cfg.paddleWidth;
    const PADDLE_H     = cfg.paddleHeight;
    const PADDLE_OFF   = cfg.paddleOffset;
    const PADDLE_SPD   = cfg.paddleSpeed;
    const BALL_R       = cfg.ballRadius;
    const WIN_SCORE    = cfg.winScore;
    const BALL_SPD0    = cfg.ballInitialSpeed;
    const BALL_SPD_MAX = cfg.ballMaxSpeed;
    const BALL_ACCEL   = cfg.ballAcceleration;

    canvas.width  = W;
    canvas.height = H;

    // -- State ----------------------------------------------------------------
    let mySlot          = 0;   // 0=lobby 1=P1 2=P2 3=in-queue
    let myName          = '';
    let p1Name          = 'Jogador 1';
    let p2Name          = 'Jogador 2';
    let score1          = 0;
    let score2          = 0;
    let animId          = null;
    let countdownActive = false;
    let bx = W / 2, by = H / 2, vx = BALL_SPD0, vy = 2;
    let paddle1Y = H / 2 - PADDLE_H / 2;
    let paddle2Y = H / 2 - PADDLE_H / 2;
    let keys = {};
    let lastSendTime    = 0;    // throttle SendGameState (~30 Hz)
    let lastP2SendTime  = 0;    // throttle P2 SendPaddleMove (~30 Hz)
    let lastPaddle2Y    = -1;
    let lbvx            = 0;    // last known ball vx (for P2 extrapolation)
    let lbvy            = 0;    // last known ball vy (for P2 extrapolation)
    const SEND_RATE_MS  = 33;   // ~30 Hz

    // -- Helpers --------------------------------------------------------------
    function show(el) { el.classList.remove('hidden'); }
    function hide(el) { el.classList.add('hidden'); }

    function setTabNotify(active) {
        const btn = document.querySelector('.game-tabs .tab-btn[data-tab="pingpong"]');
        if (btn) btn.dataset.notify = active ? 'true' : 'false';
    }

    function resetBall(dir = 1) {
        bx = W / 2; by = H / 2;
        const angle = (Math.random() * 60 - 30) * Math.PI / 180;
        vx = dir * BALL_SPD0 * Math.cos(angle);
        vy = BALL_SPD0 * Math.sin(angle);
    }

    function showLobby() {
        stopGameLoop();
        hide(gameEl);
        hide(resultEl);
        show(lobbyEl);
        lobbyStatusEl.textContent = '';
        controlsHintEl.textContent = '';
        cancelBtnEl.textContent = 'Cancelar';
        cancelBtnEl.classList.add('hidden');
        joinBtnEl.disabled = false;
        hide(lobbyActionsEl);
        hide(lobbyCountsEl);
        show(joinFormEl);
        mySlot = 0;
    }

    function showLobbyInQueue(position) {
        stopGameLoop();
        hide(gameEl);
        hide(resultEl);
        show(lobbyEl);
        hide(joinFormEl);
        hide(lobbyActionsEl);
        cancelBtnEl.textContent = 'Sair da fila';
        show(cancelBtnEl);
        lobbyStatusEl.textContent = position === 1
            ? ' Você é o próximo a jogar!'
            : ` Posição ${position} na fila`;
    }

    // -- Lobby UI -------------------------------------------------------------
    function enableJoin(name) {
        if (name && name.trim().length > 0) joinBtnEl.disabled = false;
    }

    enableJoin(getUserName());
    window.addEventListener('gchat:namechanged', () => enableJoin(getUserName()));

    joinBtnEl.addEventListener('click', () => {
        myName = getUserName();
        connection.invoke('JoinGame', myName).catch(console.error);
        joinBtnEl.disabled = true;
        cancelBtnEl.textContent = 'Cancelar';
        show(cancelBtnEl);
        lobbyStatusEl.textContent = 'Entrando na sala...';
    });

    cancelBtnEl.addEventListener('click', () => {
        if (mySlot === 3) {
            connection.invoke('LeaveQueue').catch(console.error);
        } else {
            connection.invoke('CancelQueue').catch(console.error);
            hide(cancelBtnEl);
            joinBtnEl.disabled = false;
            lobbyStatusEl.textContent = '';
        }
    });

    lobbyQueueBtnEl.addEventListener('click', () => {
        myName = getUserName();
        connection.invoke('JoinGame', myName).catch(console.error);
    });

    // -- LobbyUpdate ----------------------------------------------------------
    connection.on('LobbyUpdate', (waitingName) => {
        if (waitingName) {
            waitingBadgeEl.textContent = ` ${waitingName} está aguardando...`;
            show(waitingBadgeEl);
            setTabNotify(true);
        } else {
            hide(waitingBadgeEl);
            if (gameStatusEl.classList.contains('hidden')) setTabNotify(false);
        }
    });

    connection.on('WaitingForOpponent', () => {
        lobbyStatusEl.textContent = 'Aguardando oponente...';
    });

    connection.on('QueueCancelled', () => {
        hide(cancelBtnEl);
        joinBtnEl.disabled = false;
        lobbyStatusEl.textContent = '';
        setTabNotify(false);
    });

    // -- GameStatusUpdate -----------------------------------------------------
    connection.on('GameStatusUpdate', (name1, name2) => {
        const gameActive = !!(name1 && name2);
        if (gameActive) {
            gameStatusEl.textContent = ` ${name1} vs ${name2} em jogo`;
            show(gameStatusEl);
            setTabNotify(true);
            if (mySlot === 0) {
                hide(joinFormEl);
                show(lobbyActionsEl);
                show(lobbyCountsEl);
            }
        } else {
            hide(gameStatusEl);
            hide(lobbyActionsEl);
            hide(lobbyCountsEl);
            setTabNotify(false);
            if (mySlot === 0) show(joinFormEl);
        }
    });

    // -- QueueCountUpdate -----------------------------------------------------
    connection.on('QueueCountUpdate', (count) => {
        lobbyQueueCountEl.textContent = count === 1 ? ' 1 na fila' : ` ${count} na fila`;
        if (count > 0) setTabNotify(true);
    });

    // -- JoinedQueue ----------------------------------------------------------
    connection.on('JoinedQueue', (position) => {
        mySlot = 3;
        showLobbyInQueue(position);
    });

    // -- QueuePositionUpdate --------------------------------------------------
    connection.on('QueuePositionUpdate', (position) => {
        if (mySlot === 3) {
            lobbyStatusEl.textContent = position === 1
                ? ' Você é o próximo a jogar!'
                : ` Posição ${position} na fila`;
        }
    });

    // -- LeftQueue ------------------------------------------------------------
    connection.on('LeftQueue', () => {
        showLobby();
    });

    // -- ReturnToLobby (loser displaced by queue promotion) -------------------
    connection.on('ReturnToLobby', () => {
        showLobby();
        lobbyStatusEl.textContent = 'Você perdeu! Volte para a fila.';
    });

    // -- RoomReset ------------------------------------------------------------
    connection.on('RoomReset', () => {
        const wasActive = mySlot !== 0;
        showLobby();
        setTabNotify(false);
        if (wasActive) lobbyStatusEl.textContent = 'A sala foi encerrada.';
    });

    // -- OpponentLeft ---------------------------------------------------------
    connection.on('OpponentLeft', (leaverName) => {
        stopGameLoop();
        const msg = leaverName ? `${leaverName} saiu da partida...` : 'Oponente saiu...';
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#6c7086';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '18px sans-serif';
        ctx.fillText(msg, W / 2, H / 2);
    });

    // -- StartCountdown -------------------------------------------------------
    connection.on('StartCountdown', (name1, name2, slot, seconds) => {
        mySlot = slot;
        p1Name = name1; p2Name = name2;
        score1 = 0; score2 = 0;
        enterGameScreen(name1, name2);
        runCountdown(seconds);
    });

    // -- Game Over ------------------------------------------------------------
    connection.on('ReceiveGameOver', (winnerName) => {
        stopGameLoop();
        const isWinner = winnerName === myName;
        winnerTextEl.textContent = isWinner ? ' Você venceu!' : ' Você perdeu...';
        show(resultEl);
        show(newNamesBtnEl);
    });

    // -- Receive state (P2) ---------------------------------------------------
    connection.on('ReceiveGameState', (rbx, rby, rvx, rvy, rp1y, rp2y, rs1, rs2) => {
        if (mySlot !== 2) return;
        bx = rbx; by = rby;
        lbvx = rvx; lbvy = rvy;
        paddle1Y = rp1y;
        score1 = rs1; score2 = rs2;
        score1El.textContent = String(score1);
        score2El.textContent = String(score2);
    });

    connection.on('ReceivePaddleMove', (y) => {
        if (mySlot === 1) paddle2Y = y;
    });

    // -- Leave button ---------------------------------------------------------
    leaveBtnEl.addEventListener('click', () => {
        if (confirm('Sair da partida?')) {
            connection.invoke('LeaveGame').catch(console.error);
            showLobby();
        }
    });

    // -- Result: back to lobby -------------------------------------------------
    newNamesBtnEl.addEventListener('click', () => {
        if (mySlot === 1 || mySlot === 2) {
            connection.invoke('LeaveGame').catch(console.error);
        }
        showLobby();
    });

    // -- enterGameScreen ------------------------------------------------------
    function enterGameScreen(name1, name2) {
        hide(lobbyEl);
        show(gameEl);
        hide(resultEl);
        name1El.textContent  = name1;
        name2El.textContent  = name2;
        score1El.textContent = '0';
        score2El.textContent = '0';
        hide(cancelBtnEl);
        controlsHintEl.textContent = 'Use setas ↑/↓ para mover';
    }

    // -- Countdown ------------------------------------------------------------
    function runCountdown(seconds) {
        countdownActive = true;
        stopGameLoop();
        resetBall(1);
        paddle1Y = H / 2 - PADDLE_H / 2;
        paddle2Y = H / 2 - PADDLE_H / 2;
        drawFrame();

        let count = seconds;
        function tick() {
            renderCountdown(count);
            if (count <= 0) { countdownActive = false; startGameLoop(); return; }
            count--;
            setTimeout(tick, 1000);
        }
        tick();
    }

    function renderCountdown(count) {
        drawFrame();
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (count <= 0) {
            ctx.font = 'bold 80px sans-serif';
            ctx.fillStyle = '#a6e3a1';
            ctx.fillText('GO!', W / 2, H / 2);
        } else {
            ctx.font = 'bold 120px sans-serif';
            ctx.fillStyle = '#cdd6f4';
            ctx.fillText(String(count), W / 2, H / 2);
        }
        ctx.restore();
    }

    // -- Input ----------------------------------------------------------------
    document.addEventListener('keydown', e => { keys[e.key] = true; });
    document.addEventListener('keyup',   e => { keys[e.key] = false; });

    function movePaddles(ts) {
        if (mySlot === 1) {
            if (keys['ArrowUp'])   paddle1Y = Math.max(0, paddle1Y - PADDLE_SPD);
            if (keys['ArrowDown']) paddle1Y = Math.min(H - PADDLE_H, paddle1Y + PADDLE_SPD);
        } else if (mySlot === 2) {
            if (keys['ArrowUp'])   paddle2Y = Math.max(0, paddle2Y - PADDLE_SPD);
            if (keys['ArrowDown']) paddle2Y = Math.min(H - PADDLE_H, paddle2Y + PADDLE_SPD);
            if (paddle2Y !== lastPaddle2Y && ts - lastP2SendTime >= SEND_RATE_MS) {
                lastPaddle2Y   = paddle2Y;
                lastP2SendTime = ts;
                connection.invoke('SendPaddleMove', paddle2Y).catch(() => {});
            }
        }
    }

    // -- Local ball extrapolation for P2 (wall bounces only, P1 is authoritative) --
    function extrapolateP2() {
        if (mySlot !== 2 || countdownActive) return;
        bx += lbvx;
        by += lbvy;
        if (by - BALL_R < 0) { by = BALL_R;       lbvy = -lbvy; }
        if (by + BALL_R > H) { by = H - BALL_R;   lbvy = -lbvy; }
        // clamp x — P1 is authoritative for out-of-bounds and scoring
        if (bx - BALL_R < 0)   bx = BALL_R;
        if (bx + BALL_R > W)   bx = W - BALL_R;
    }

    // -- Physics (P1 only) ----------------------------------------------------
    function updatePhysics(ts) {
        if (mySlot !== 1 || countdownActive) return;

        bx += vx; by += vy;

        if (by - BALL_R < 0) { by = BALL_R;     vy = -vy; }
        if (by + BALL_R > H) { by = H - BALL_R; vy = -vy; }

        if (vx < 0 && bx - BALL_R <= PADDLE_W + PADDLE_OFF && bx - BALL_R > 0 &&
            by >= paddle1Y && by <= paddle1Y + PADDLE_H) {
            bx = PADDLE_W + PADDLE_OFF + BALL_R;
            bouncePaddle(by, paddle1Y, 1);
        }

        if (vx > 0 && bx + BALL_R >= W - PADDLE_W - PADDLE_OFF && bx + BALL_R < W &&
            by >= paddle2Y && by <= paddle2Y + PADDLE_H) {
            bx = W - PADDLE_W - PADDLE_OFF - BALL_R;
            bouncePaddle(by, paddle2Y, -1);
        }

        if (bx - BALL_R < 0) {
            score2++;
            score2El.textContent = String(score2);
            if (score2 >= WIN_SCORE) { connection.invoke('GameOver', p2Name).catch(console.error); return; }
            resetBall(-1);
        }

        if (bx + BALL_R > W) {
            score1++;
            score1El.textContent = String(score1);
            if (score1 >= WIN_SCORE) { connection.invoke('GameOver', p1Name).catch(console.error); return; }
            resetBall(1);
        }

        if (ts - lastSendTime >= SEND_RATE_MS) {
            lastSendTime = ts;
            connection.invoke('SendGameState', bx, by, vx, vy, paddle1Y, paddle2Y, score1, score2).catch(() => {});
        }
    }

    function bouncePaddle(ballY, paddleY, dirMult) {
        const hitPos = (ballY - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2);
        const angle  = hitPos * (Math.PI / 4);
        const spd    = Math.min(Math.sqrt(vx * vx + vy * vy) * BALL_ACCEL, BALL_SPD_MAX);
        vx = dirMult * spd * Math.cos(angle);
        vy = spd * Math.sin(angle);
    }

    // -- Draw -----------------------------------------------------------------
    function drawFrame() {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, W, H);

        ctx.setLineDash([10, 10]);
        ctx.strokeStyle = '#313244';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = mySlot === 1 ? '#89b4fa' : '#cdd6f4';
        ctx.fillRect(PADDLE_OFF, paddle1Y, PADDLE_W, PADDLE_H);

        ctx.fillStyle = mySlot === 2 ? '#89b4fa' : '#cdd6f4';
        ctx.fillRect(W - PADDLE_W - PADDLE_OFF, paddle2Y, PADDLE_W, PADDLE_H);

        ctx.fillStyle = '#f38ba8';
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
        ctx.fill();
    }

    // -- Game loop ------------------------------------------------------------
    function startGameLoop() {
        stopGameLoop();
        function loop(ts) {
            if (mySlot === 0 || mySlot === 3) return;
            movePaddles(ts);
            updatePhysics(ts);
            extrapolateP2();
            drawFrame();
            animId = requestAnimationFrame(loop);
        }
        animId = requestAnimationFrame(loop);
    }

    function stopGameLoop() {
        if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
    }

    // -- Start connection -----------------------------------------------------
    connection.start().catch(err => console.error('PingPong SignalR:', err));
}

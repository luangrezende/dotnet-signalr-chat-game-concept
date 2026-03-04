// ─── PingPong Module ──────────────────────────────────────────────────────────

import { getUserName } from '../../../js/user.js';

export const meta = {
    id:       'pingpong',
    label:    '🏓 Ping Pong',
    cssPath:  '/modules/games/pingpong/pingpong.css',
    htmlPath: '/modules/games/pingpong/pingpong.html',
};

export async function init() {
    // ── Config from appsettings via /api/config ─────────────────────────────
    const cfg = await fetch('/api/config').then(r => r.json()).then(d => d.pingPong);

    // ── SignalR connection ───────────────────────────────────────────────────
    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/pingponghub')
        .withAutomaticReconnect()
        .build();

    // ── DOM refs ────────────────────────────────────────────────────────────
    const lobbyEl         = document.getElementById('pingpong-lobby');
    const gameEl          = document.getElementById('pingpong-game');
    const resultEl        = document.getElementById('pingpong-result');
    const canvas          = document.getElementById('pp-canvas');
    const ctx             = canvas.getContext('2d');

    const joinBtnEl       = document.getElementById('pp-join-btn');
    const cancelBtnEl     = document.getElementById('pp-cancel-btn');
    const leaveBtnEl      = document.getElementById('pp-leave-btn');
    const playAgainBtnEl  = document.getElementById('pp-play-again-btn');
    const newNamesBtnEl   = document.getElementById('pp-new-names-btn');

    const lobbyStatusEl   = document.getElementById('pp-lobby-status');
    const gameStatusEl    = document.getElementById('pp-game-status');
    const waitingBadgeEl  = document.getElementById('pp-waiting-badge');
    const spectatorCountEl= document.getElementById('pp-spectator-count');
    const spectatorBadgeEl= document.getElementById('pp-spectator-badge');
    const winnerTextEl    = document.getElementById('pp-winner-text');
    const resultSubEl     = document.getElementById('pp-result-sub');
    const controlsHintEl  = document.getElementById('pp-controls-hint');
    const score1El        = document.getElementById('pp-score1');
    const score2El        = document.getElementById('pp-score2');
    const name1El         = document.getElementById('pp-name-display1');
    const name2El         = document.getElementById('pp-name-display2');

    // ── Game constants (from appsettings via /api/config) ──────────────────
    const W           = cfg.canvasWidth;
    const H           = cfg.canvasHeight;
    const PADDLE_W    = cfg.paddleWidth;
    const PADDLE_H    = cfg.paddleHeight;
    const PADDLE_SPD  = cfg.paddleSpeed;
    const BALL_R      = cfg.ballRadius;
    const WIN_SCORE   = cfg.winScore;
    const BALL_SPD0   = cfg.ballInitialSpeed;
    const BALL_SPD_MAX= cfg.ballMaxSpeed;
    const BALL_ACCEL  = cfg.ballAcceleration;

    canvas.width  = W;
    canvas.height = H;

    // ── State ────────────────────────────────────────────────────────────────
    let mySlot       = 0;   // 0=none 1=P1(host) 2=P2(client) 3=spectator
    let myName       = '';
    let p1Name       = 'Jogador 1';
    let p2Name       = 'Jogador 2';
    let score1       = 0;
    let score2       = 0;
    let animId       = null;
    let countdownActive = false;

    // Ball + paddles (authoritative on P1, received by P2 & spectators)
    let bx = W / 2, by = H / 2, vx = BALL_SPD0, vy = 2;
    let paddle1Y = H / 2 - PADDLE_H / 2;
    let paddle2Y = H / 2 - PADDLE_H / 2;
    let keys = {};

    // ── Helpers ──────────────────────────────────────────────────────────────
    function show(el)  { el.classList.remove('hidden'); }
    function hide(el)  { el.classList.add('hidden'); }

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
        mySlot = 0;
    }

    function updateSpectatorBadge() {
        if (mySlot === 3) {
            spectatorBadgeEl.textContent = '👁 Espectador';
            show(spectatorBadgeEl);
        } else {
            hide(spectatorBadgeEl);
        }
    }

    // ── Lobby UI ─────────────────────────────────────────────────────────────
    function enableJoin(name) {
        if (name && name.trim().length > 0) {
            joinBtnEl.disabled = false;
        }
    }

    // Enable join button if user already has a name set
    enableJoin(getUserName());
    // Also re-enable if name is set later (e.g. after name modal)
    window.addEventListener('gchat:namechanged', () => enableJoin(getUserName()));

    joinBtnEl.addEventListener('click', () => {
        const name = getUserName();
        myName = name;
        connection.invoke('JoinGame', name).catch(console.error);
        joinBtnEl.disabled = true;
        cancelBtnEl.classList.remove('hidden');
        lobbyStatusEl.textContent = 'Entrando na sala...';
    });

    cancelBtnEl.addEventListener('click', () => {
        connection.invoke('CancelQueue').catch(console.error);
        cancelBtnEl.classList.add('hidden');
        joinBtnEl.disabled = false;
        lobbyStatusEl.textContent = '';
    });

    // ── LobbyUpdate ─────────────────────────────────────────────────────────
    connection.on('LobbyUpdate', (waitingName) => {
        if (waitingName) {
            waitingBadgeEl.textContent = `👤 ${waitingName} está aguardando...`;
            show(waitingBadgeEl);
        } else {
            hide(waitingBadgeEl);
        }
    });

    connection.on('WaitingForOpponent', () => {
        lobbyStatusEl.textContent = 'Aguardando oponente...';
    });

    connection.on('QueueCancelled', () => {
        lobbyStatusEl.textContent = '';
        cancelBtnEl.classList.add('hidden');
        joinBtnEl.disabled = false;
    });

    // ── GameStatusUpdate ─────────────────────────────────────────────────────
    connection.on('GameStatusUpdate', (name1, name2) => {
        if (name1 && name2) {
            gameStatusEl.textContent = `🎮 ${name1} vs ${name2} em jogo`;
            show(gameStatusEl);
        } else {
            hide(gameStatusEl);
        }
    });

    // ── SpectatorCountUpdate ─────────────────────────────────────────────────
    connection.on('SpectatorCountUpdate', (count) => {
        if (count > 0) {
            spectatorCountEl.textContent = `👁 ${count} espectador${count === 1 ? '' : 'es'} na fila`;
            show(spectatorCountEl);
        } else {
            hide(spectatorCountEl);
        }
    });

    // ── WaitingForRematch ────────────────────────────────────────────────────
    connection.on('WaitingForRematch', () => {
        resultSubEl.textContent = 'Aguardando oponente aceitar revanche...';
        show(resultSubEl);
    });

    // ── JoinedAsSpectator ────────────────────────────────────────────────────
    connection.on('JoinedAsSpectator', (position, name1, name2) => {
        mySlot = 3;
        p1Name = name1 || 'Jogador 1';
        p2Name = name2 || 'Jogador 2';
        hide(lobbyEl);
        show(gameEl);
        hide(resultEl);
        updateSpectatorBadge();
        controlsHintEl.textContent = '👁 Modo espectador — aguardando sua vez na fila';
        name1El.textContent = p1Name;
        name2El.textContent = p2Name;
        score1El.textContent = '0';
        score2El.textContent = '0';
        score1 = 0; score2 = 0;
        cancelBtnEl.classList.add('hidden');
        drawIdle();
    });

    // ── SpectatorPositionUpdate ──────────────────────────────────────────────
    connection.on('SpectatorPositionUpdate', (position) => {
        if (mySlot === 3) {
            controlsHintEl.textContent = `👁 Espectador — posição na fila: ${position}`;
        }
    });

    // ── SpectatorTookYourSpot ────────────────────────────────────────────────
    connection.on('SpectatorTookYourSpot', (specName) => {
        // This player lost and a spectator took their slot — they become spectator
        mySlot = 3;
        resultSubEl.textContent = `👤 ${specName} entrou no jogo no seu lugar`;
        show(resultSubEl);
        hide(playAgainBtnEl);
        updateSpectatorBadge();
    });

    // ── SpectatorLeft ────────────────────────────────────────────────────────
    connection.on('SpectatorLeft', () => {
        showLobby();
    });

    // ── RoomReset ────────────────────────────────────────────────────────────
    connection.on('RoomReset', () => {
        showLobby();
        lobbyStatusEl.textContent = 'A sala foi encerrada. Entre novamente.';
        joinBtnEl.disabled = false;
        cancelBtnEl.classList.add('hidden');
    });

    // ── OpponentLeft ─────────────────────────────────────────────────────────
    connection.on('OpponentLeft', () => {
        stopGameLoop();
        showLobby();
        lobbyStatusEl.textContent = 'O oponente saiu da partida.';
        joinBtnEl.disabled = false;
        cancelBtnEl.classList.add('hidden');
    });

    // ── StartCountdown ───────────────────────────────────────────────────────
    connection.on('StartCountdown', (name1, name2, slot, seconds) => {
        mySlot  = slot;
        p1Name  = name1;
        p2Name  = name2;
        score1  = 0; score2 = 0;
        enterGameScreen(name1, name2);
        runCountdown(seconds);
    });

    // ── SpectatorGameStart ───────────────────────────────────────────────────
    connection.on('SpectatorGameStart', (name1, name2) => {
        p1Name = name1; p2Name = name2;
        name1El.textContent = p1Name;
        name2El.textContent = p2Name;
        score1El.textContent = '0';
        score2El.textContent = '0';
        score1 = 0; score2 = 0;
        hide(resultEl);
    });

    // ── enterGameScreen ───────────────────────────────────────────────────────
    function enterGameScreen(name1, name2) {
        hide(lobbyEl);
        show(gameEl);
        hide(resultEl);
        name1El.textContent  = name1;
        name2El.textContent  = name2;
        score1El.textContent = '0';
        score2El.textContent = '0';
        cancelBtnEl.classList.add('hidden');
        updateSpectatorBadge();

        if (mySlot === 1) {
            controlsHintEl.textContent = 'W / S ou ↑ / ↓ para mover';
        } else if (mySlot === 2) {
            controlsHintEl.textContent = 'W / S ou ↑ / ↓ para mover';
        } else {
            controlsHintEl.textContent = '👁 Modo espectador — aguardando sua vez na fila';
        }
    }

    // ── Countdown ────────────────────────────────────────────────────────────
    function runCountdown(seconds) {
        countdownActive = true;
        stopGameLoop();
        resetBall(1);
        paddle1Y = H / 2 - PADDLE_H / 2;
        paddle2Y = H / 2 - PADDLE_H / 2;
        drawFrame(); // draw idle state

        let count = seconds;
        function tick() {
            renderCountdown(count);
            if (count <= 0) {
                countdownActive = false;
                startGameLoop();
                return;
            }
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

    // ── Leave button ──────────────────────────────────────────────────────────
    leaveBtnEl.addEventListener('click', () => {
        if (mySlot === 3) {
            connection.invoke('LeaveSpectator').catch(console.error);
        } else {
            if (confirm('Sair da partida?')) {
                stopGameLoop();
                showLobby();
                // Connection stays alive; server handles via OnDisconnectedAsync on true disconnect
                // or we can just navigate away — for now just reset local state
                mySlot = 0;
            }
        }
    });

    // ── Play again / back to lobby ────────────────────────────────────────────
    playAgainBtnEl.addEventListener('click', () => {
        if (mySlot === 3) return; // spectators can't request rematch
        connection.invoke('RequestRematch').catch(console.error);
        playAgainBtnEl.disabled = true;
        resultSubEl.textContent = 'Aguardando oponente aceitar revanche...';
        show(resultSubEl);
    });

    newNamesBtnEl.addEventListener('click', () => {
        showLobby();
        mySlot = 0;
    });

    // ── Game Over ─────────────────────────────────────────────────────────────
    connection.on('ReceiveGameOver', (winnerName) => {
        stopGameLoop();
        showResult(winnerName);
        if (mySlot === 1 || mySlot === 2) {
            const isWinner = winnerName === myName;
            winnerTextEl.textContent = isWinner ? '🏆 Você venceu!' : '💔 Você perdeu...';
            resultSubEl.textContent  = isWinner
                ? `${winnerName} venceu a partida!`
                : `${winnerName} venceu a partida.`;
            show(resultSubEl);
        }
    });

    function showResult(winnerName) {
        winnerTextEl.textContent = `🏆 ${winnerName} venceu!`;
        show(resultEl);
        if (mySlot === 3) {
            playAgainBtnEl.disabled = true;
        } else {
            playAgainBtnEl.disabled = false;
        }
        hide(resultSubEl);
        resultSubEl.textContent = '';
    }

    // ── Receive state (P2 + spectators) ──────────────────────────────────────
    connection.on('ReceiveGameState', (rbx, rby, rp1y, rp2y, rs1, rs2) => {
        if (mySlot === 2 || mySlot === 3) {
            bx = rbx; by = rby;
            paddle1Y = rp1y; paddle2Y = rp2y;
            score1 = rs1; score2 = rs2;
            score1El.textContent = String(score1);
            score2El.textContent = String(score2);
        }
    });

    // P1 receives P2 paddle
    connection.on('ReceivePaddleMove', (y) => {
        if (mySlot === 1) paddle2Y = y;
    });

    // ── Input ─────────────────────────────────────────────────────────────────
    document.addEventListener('keydown', e => { keys[e.key] = true; });
    document.addEventListener('keyup',   e => { keys[e.key] = false; });

    function movePaddles(dt) {
        const spd = PADDLE_SPD;
        if (mySlot === 1) {
            if (keys['w'] || keys['W'] || keys['ArrowUp'])   paddle1Y = Math.max(0, paddle1Y - spd);
            if (keys['s'] || keys['S'] || keys['ArrowDown']) paddle1Y = Math.min(H - PADDLE_H, paddle1Y + spd);
        } else if (mySlot === 2) {
            if (keys['w'] || keys['W'] || keys['ArrowUp'])   paddle2Y = Math.max(0, paddle2Y - spd);
            if (keys['s'] || keys['S'] || keys['ArrowDown']) paddle2Y = Math.min(H - PADDLE_H, paddle2Y + spd);
            connection.invoke('SendPaddleMove', paddle2Y).catch(() => {});
        }
    }

    // ── Physics (P1 only) ─────────────────────────────────────────────────────
    function updatePhysics() {
        if (mySlot !== 1 || countdownActive) return;

        bx += vx; by += vy;

        // Top / bottom walls
        if (by - BALL_R < 0)  { by = BALL_R;      vy = -vy; }
        if (by + BALL_R > H)  { by = H - BALL_R;  vy = -vy; }

        // Left paddle (P1)
        if (vx < 0 && bx - BALL_R <= PADDLE_W + 10 && bx - BALL_R > 0 &&
            by >= paddle1Y && by <= paddle1Y + PADDLE_H) {
            bx = PADDLE_W + 10 + BALL_R;
            bouncePaddle(by, paddle1Y, 1);
        }

        // Right paddle (P2)
        if (vx > 0 && bx + BALL_R >= W - PADDLE_W - 10 && bx + BALL_R < W &&
            by >= paddle2Y && by <= paddle2Y + PADDLE_H) {
            bx = W - PADDLE_W - 10 - BALL_R;
            bouncePaddle(by, paddle2Y, -1);
        }

        // Score: left wall
        if (bx - BALL_R < 0) {
            score2++;
            score2El.textContent = String(score2);
            if (score2 >= WIN_SCORE) {
                connection.invoke('GameOver', p2Name).catch(console.error);
                return;
            }
            resetBall(-1);
        }

        // Score: right wall
        if (bx + BALL_R > W) {
            score1++;
            score1El.textContent = String(score1);
            if (score1 >= WIN_SCORE) {
                connection.invoke('GameOver', p1Name).catch(console.error);
                return;
            }
            resetBall(1);
        }

        // Broadcast state
        connection.invoke('SendGameState', bx, by, paddle1Y, paddle2Y, score1, score2).catch(() => {});
    }

    function bouncePaddle(ballY, paddleY, dirMult) {
        const hitPos  = (ballY - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2); // [-1, 1]
        const angle   = hitPos * (Math.PI / 4); // ±45°
        const spd     = Math.min(Math.sqrt(vx * vx + vy * vy) * BALL_ACCEL, BALL_SPD_MAX);
        vx = dirMult * spd * Math.cos(angle);
        vy = spd * Math.sin(angle);
    }

    // ── Draw ──────────────────────────────────────────────────────────────────
    function drawFrame() {
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, W, H);

        // Center line
        ctx.setLineDash([10, 10]);
        ctx.strokeStyle = '#313244';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
        ctx.setLineDash([]);

        // Paddles
        ctx.fillStyle = mySlot === 1 ? '#89b4fa' : '#cdd6f4';
        ctx.fillRect(10, paddle1Y, PADDLE_W, PADDLE_H);

        ctx.fillStyle = mySlot === 2 ? '#89b4fa' : '#cdd6f4';
        ctx.fillRect(W - PADDLE_W - 10, paddle2Y, PADDLE_W, PADDLE_H);

        // Ball
        ctx.fillStyle = '#f38ba8';
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawIdle() {
        bx = W / 2; by = H / 2;
        paddle1Y = H / 2 - PADDLE_H / 2;
        paddle2Y = H / 2 - PADDLE_H / 2;
        drawFrame();
    }

    // ── Game loop ─────────────────────────────────────────────────────────────
    function startGameLoop() {
        stopGameLoop();
        function loop() {
            if (mySlot === 0) return;
            movePaddles();
            updatePhysics();
            drawFrame();
            animId = requestAnimationFrame(loop);
        }
        animId = requestAnimationFrame(loop);
    }

    function stopGameLoop() {
        if (animId !== null) {
            cancelAnimationFrame(animId);
            animId = null;
        }
    }

    // ── Initial draw ─────────────────────────────────────────────────────────
    // Canvas is hidden initially; drawn when entering game screen

    // ── Start connection ─────────────────────────────────────────────────────
    connection.start().catch(err => console.error('PingPong SignalR:', err));
}

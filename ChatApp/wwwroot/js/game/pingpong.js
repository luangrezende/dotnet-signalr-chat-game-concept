// ============================================
// pingpong.js — Ping Pong online multiplayer (SignalR)
//
// Architecture:
//   Player 1 (first to join) = left paddle, authoritative host.
//     Runs the game loop, does all physics, broadcasts state each frame.
//   Player 2 (second to join) = right paddle, thin client.
//     Sends only its own paddle Y; renders state received from P1.
// ============================================

const W = 800, H = 500;
const PADDLE_W = 14, PADDLE_H = 80, PADDLE_SPEED = 2;
const BALL_R = 8;
const BALL_SPEED     = 1;   // velocidade inicial da bola (px/frame)
const BALL_SPEED_MAX = 5;  // velocidade máxima da bola
const WIN_SCORE = 5;

export function initPingPong() {
    // ── DOM ──────────────────────────────────────────────────────────────────
    const lobbyEl       = document.getElementById('pingpong-lobby');
    const gameEl        = document.getElementById('pingpong-game');
    const joinNameEl    = document.getElementById('pp-join-name');
    const joinBtnEl     = document.getElementById('pp-join-btn');
    const statusEl      = document.getElementById('pp-lobby-status');

    const canvas        = document.getElementById('pp-canvas');
    const ctx           = canvas.getContext('2d');
    canvas.width  = W;
    canvas.height = H;

    const score1El      = document.getElementById('pp-score1');
    const score2El      = document.getElementById('pp-score2');
    const nameDisp1El   = document.getElementById('pp-name-display1');
    const nameDisp2El   = document.getElementById('pp-name-display2');
    const resultEl      = document.getElementById('pingpong-result');
    const winnerEl      = document.getElementById('pp-winner-text');
    const playAgainBtn  = document.getElementById('pp-play-again-btn');
    const backLobbyBtn  = document.getElementById('pp-new-names-btn');
    const controlsHint  = document.getElementById('pp-controls-hint');

    // ── SignalR connection ───────────────────────────────────────────────────
    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/pingponghub')
        .withAutomaticReconnect()
        .build();

    // ── Runtime state ────────────────────────────────────────────────────────
    let mySlot = 0;          // 1 = left / host, 2 = right / client
    let names  = { 1: 'Jogador 1', 2: 'Jogador 2' };

    const game = {
        ball:   { x: W / 2, y: H / 2, vx: 4, vy: 3 },
        p1y:    H / 2 - PADDLE_H / 2,
        p2y:    H / 2 - PADDLE_H / 2,
        score:  { 1: 0, 2: 0 },
    };

    const keys = {};
    let gameRunning = false;
    let animId      = null;

    // ── Enable join button while user types ──────────────────────────────────
    joinNameEl.addEventListener('input', () => {
        joinBtnEl.disabled = joinNameEl.value.trim().length === 0;
    });

    // ── SignalR: server → client ─────────────────────────────────────────────

    connection.on('WaitingForOpponent', () => {
        setStatus('⏳ Aguardando 2º jogador...');
    });

    connection.on('RoomFull', () => {
        setStatus('❌ Sala cheia. Aguarde e tente novamente.', true);
        joinBtnEl.disabled = false;
        joinNameEl.disabled = false;
    });

    connection.on('GameStart', (name1, name2, slot) => {
        startGame(name1, name2, slot);
    });

    // P2 receives full game state from P1 every frame
    connection.on('ReceiveGameState', (ballX, ballY, p1y, p2y, s1, s2) => {
        if (mySlot !== 2) return;
        game.ball.x   = ballX;
        game.ball.y   = ballY;
        game.p1y      = p1y;
        game.p2y      = p2y;
        game.score[1] = s1;
        game.score[2] = s2;
        updateScores();
    });

    // P1 receives P2's paddle Y
    connection.on('ReceivePaddleMove', (y) => {
        if (mySlot !== 1) return;
        game.p2y = y;
    });

    connection.on('ReceiveGameOver', (winnerName) => {
        stopLoop();
        gameRunning = false;
        showResult(winnerName);
    });

    connection.on('WaitingForRematch', () => {
        winnerEl.textContent  = '⏳ Aguardando adversário...';
        playAgainBtn.disabled = true;
    });

    connection.on('OpponentLeft', () => {
        stopLoop();
        gameRunning = false;
        resultEl.classList.add('hidden');
        goToLobby();
        setStatus('❌ O adversário desconectou.', true);
    });

    // ── Connect ──────────────────────────────────────────────────────────────
    connection.start()
        .then(() => {
            joinBtnEl.disabled = joinNameEl.value.trim().length === 0;
        })
        .catch(err => setStatus('Falha ao conectar: ' + err, true));

    // ── Join ─────────────────────────────────────────────────────────────────
    async function doJoin() {
        const name = joinNameEl.value.trim();
        if (!name || joinBtnEl.disabled) return;
        joinBtnEl.disabled  = true;
        joinNameEl.disabled = true;
        setStatus('Conectando...');
        try {
            await connection.invoke('JoinGame', name);
        } catch (err) {
            setStatus('Erro ao entrar: ' + err, true);
            joinBtnEl.disabled  = false;
            joinNameEl.disabled = false;
        }
    }

    joinBtnEl.addEventListener('click', doJoin);
    joinNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

    // ── Start / restart game ─────────────────────────────────────────────────
    function startGame(name1, name2, slot) {
        mySlot   = slot;
        names[1] = name1;
        names[2] = name2;

        resetBall();
        game.p1y      = H / 2 - PADDLE_H / 2;
        game.p2y      = H / 2 - PADDLE_H / 2;
        game.score[1] = 0;
        game.score[2] = 0;

        nameDisp1El.textContent = name1;
        nameDisp2El.textContent = name2;
        updateScores();

        resultEl.classList.add('hidden');
        lobbyEl.classList.add('hidden');
        gameEl.classList.remove('hidden');

        controlsHint.textContent = mySlot === 1
            ? 'Você (esquerda): ↑ / ↓   |   Adversário: direita'
            : 'Você (direita): ↑ / ↓   |   Adversário: esquerda';

        gameRunning = true;
        stopLoop();
        animId = requestAnimationFrame(mySlot === 1 ? loopP1 : loopP2);
    }

    // ── P1 authoritative game loop ───────────────────────────────────────────
    let lastSendTs = 0;

    function loopP1(ts) {
        if (!gameRunning) return;

        // Move own (left) paddle
        if (keys['ArrowUp'])   game.p1y = Math.max(0, game.p1y - PADDLE_SPEED);
        if (keys['ArrowDown']) game.p1y = Math.min(H - PADDLE_H, game.p1y + PADDLE_SPEED);

        // Ball movement
        game.ball.x += game.ball.vx;
        game.ball.y += game.ball.vy;

        // Wall bounce
        if (game.ball.y - BALL_R < 0) {
            game.ball.y  = BALL_R;
            game.ball.vy = Math.abs(game.ball.vy);
        }
        if (game.ball.y + BALL_R > H) {
            game.ball.y  = H - BALL_R;
            game.ball.vy = -Math.abs(game.ball.vy);
        }

        // Paddle 1 hit (left)
        if (game.ball.vx < 0 &&
            game.ball.x - BALL_R <= 20 + PADDLE_W &&
            game.ball.x - BALL_R >= 18 &&
            game.ball.y >= game.p1y &&
            game.ball.y <= game.p1y + PADDLE_H) {
            game.ball.x  = 20 + PADDLE_W + BALL_R;
            game.ball.vx = Math.abs(game.ball.vx) * 1.05;
            game.ball.vy += (game.ball.y - (game.p1y + PADDLE_H / 2)) * 0.1;
        }

        // Paddle 2 hit (right)
        if (game.ball.vx > 0 &&
            game.ball.x + BALL_R >= W - 20 - PADDLE_W &&
            game.ball.x + BALL_R <= W - 18 &&
            game.ball.y >= game.p2y &&
            game.ball.y <= game.p2y + PADDLE_H) {
            game.ball.x  = W - 20 - PADDLE_W - BALL_R;
            game.ball.vx = -Math.abs(game.ball.vx) * 1.05;
            game.ball.vy += (game.ball.y - (game.p2y + PADDLE_H / 2)) * 0.1;
        }

        // Cap speed
        const spd = Math.hypot(game.ball.vx, game.ball.vy);
        if (spd > BALL_SPEED_MAX) { game.ball.vx *= BALL_SPEED_MAX / spd; game.ball.vy *= BALL_SPEED_MAX / spd; }

        // Ball exits left → P2 scores
        if (game.ball.x + BALL_R < 0) {
            game.score[2]++;
            updateScores();
            if (game.score[2] >= WIN_SCORE) {
                gameRunning = false;
                connection.invoke('GameOver', names[2]).catch(() => {});
                showResult(names[2]);
                return;
            }
            resetBall(2);
        }

        // Ball exits right → P1 scores
        if (game.ball.x - BALL_R > W) {
            game.score[1]++;
            updateScores();
            if (game.score[1] >= WIN_SCORE) {
                gameRunning = false;
                connection.invoke('GameOver', names[1]).catch(() => {});
                showResult(names[1]);
                return;
            }
            resetBall(1);
        }

        // Broadcast state to P2 (≈60 fps)
        if (ts - lastSendTs >= 16) {
            lastSendTs = ts;
            connection.invoke(
                'SendGameState',
                game.ball.x, game.ball.y,
                game.p1y, game.p2y,
                game.score[1], game.score[2]
            ).catch(() => {});
        }

        render();
        animId = requestAnimationFrame(loopP1);
    }

    // ── P2 render-only loop (sends paddle) ───────────────────────────────────
    let lastPaddleTs = 0;
    let lastSentP2y  = -1;

    function loopP2(ts) {
        if (!gameRunning) return;

        // Move own (right) paddle
        if (keys['ArrowUp'])   game.p2y = Math.max(0, game.p2y - PADDLE_SPEED);
        if (keys['ArrowDown']) game.p2y = Math.min(H - PADDLE_H, game.p2y + PADDLE_SPEED);

        // Send if changed and throttled
        if (game.p2y !== lastSentP2y && ts - lastPaddleTs >= 16) {
            lastPaddleTs = ts;
            lastSentP2y  = game.p2y;
            connection.invoke('SendPaddleMove', game.p2y).catch(() => {});
        }

        render();
        animId = requestAnimationFrame(loopP2);
    }

    // ── Ball reset ───────────────────────────────────────────────────────────
    // lastScorer 1 → serve toward P2 (+vx), 2 → serve toward P1 (-vx)
    function resetBall(lastScorer = 1) {
        game.ball.x  = W / 2;
        game.ball.y  = H / 2;
        game.ball.vx = (lastScorer === 2) ? -BALL_SPEED : BALL_SPEED;
        game.ball.vy = (Math.random() * BALL_SPEED / 2) - (BALL_SPEED / 4);
    }

    // ── Rendering ────────────────────────────────────────────────────────────
    function render() {
        ctx.fillStyle = '#11111b';
        ctx.fillRect(0, 0, W, H);

        // Centre dashed line
        ctx.setLineDash([10, 10]);
        ctx.strokeStyle = '#313244';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
        ctx.setLineDash([]);

        // Paddle 1 (left, blue)
        ctx.fillStyle = '#89b4fa';
        drawRoundRect(20, game.p1y, PADDLE_W, PADDLE_H, 4);

        // Paddle 2 (right, green)
        ctx.fillStyle = '#a6e3a1';
        drawRoundRect(W - 20 - PADDLE_W, game.p2y, PADDLE_W, PADDLE_H, 4);

        // Ball
        ctx.fillStyle = '#cdd6f4';
        ctx.beginPath();
        ctx.arc(game.ball.x, game.ball.y, BALL_R, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawRoundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
    }

    // ── UI helpers ───────────────────────────────────────────────────────────
    function updateScores() {
        score1El.textContent = game.score[1];
        score2El.textContent = game.score[2];
    }

    function showResult(winnerName) {
        winnerEl.textContent  = `🏆 ${winnerName} venceu!`;
        playAgainBtn.disabled = false;
        resultEl.classList.remove('hidden');
    }

    function setStatus(msg, isError = false) {
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#f38ba8' : '#a6adc8';
    }

    function goToLobby() {
        stopLoop();
        gameEl.classList.add('hidden');
        lobbyEl.classList.remove('hidden');
        joinNameEl.disabled = false;
        joinBtnEl.disabled  = joinNameEl.value.trim().length === 0;
    }

    function stopLoop() {
        if (animId) { cancelAnimationFrame(animId); animId = null; }
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        keys[e.key] = true;
        if (gameRunning && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))
            e.preventDefault();
    });
    document.addEventListener('keyup', e => { keys[e.key] = false; });

    // ── Result buttons ───────────────────────────────────────────────────────
    playAgainBtn.addEventListener('click', async () => {
        playAgainBtn.disabled = true;
        winnerEl.textContent  = '⏳ Aguardando adversário...';
        await connection.invoke('RequestRematch').catch(() => {});
    });

    backLobbyBtn.addEventListener('click', async () => {
        stopLoop();
        gameRunning = false;
        resultEl.classList.add('hidden');
        goToLobby();
        setStatus('');
        mySlot = 0;
        // Disconnect so server clears the room (peer gets OpponentLeft)
        try { await connection.stop(); } catch {}
        await connection.start().catch(() => {});
        joinBtnEl.disabled = joinNameEl.value.trim().length === 0;
    });
}

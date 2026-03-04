import { getUserName } from '../../../js/user.js';

export const meta = {
    id:       'paint',
    label:    ' Paint',
    cssPath:  '/modules/games/paint/paint.css',
    htmlPath: '/modules/games/paint/paint.html',
};

let _destroy = null;

export function destroy() {
    _destroy?.();
    _destroy = null;
}

export function init() {
    const GAME_ID  = 'global';
    const myName   = getUserName() || 'Anônimo';

    // -- SignalR connection ---------------------------------------------------
    const connection = new signalR.HubConnectionBuilder()
        .withUrl(`/painthub?gameId=${GAME_ID}&userName=${encodeURIComponent(myName)}`)
        .withAutomaticReconnect()
        .build();

    // -- DOM refs -------------------------------------------------------------
    const canvas          = document.getElementById('draw-canvas');
    const ctx             = canvas.getContext('2d');
    const colorInput      = document.getElementById('draw-color');
    const sizeRange       = document.getElementById('draw-size');
    const eraserBtn       = document.getElementById('draw-tool-eraser');
    const clearBtn        = document.getElementById('draw-clear-btn');
    const onlineCountEl   = document.getElementById('draw-online-count');

    // -- Tab notification -----------------------------------------------------
    function setTabNotify(active) {
        const btn = document.querySelector('.game-tabs .tab-btn[data-tab="paint"]');
        if (btn) btn.dataset.notify = active ? 'true' : 'false';
    }

    // -- Canvas size ----------------------------------------------------------
    canvas.width  = 900;
    canvas.height = 500;

    // -- AbortController (cleanup on destroy) ---------------------------------
    const ac = new AbortController();

    // -- State ----------------------------------------------------------------
    let isDrawing = false;
    let isEraser  = false;
    let lastX = 0, lastY = 0;

    // -- Helpers --------------------------------------------------------------
    function getPos(e) {
        const rect   = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        const src    = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) * scaleX,
            y: (src.clientY - rect.top)  * scaleY,
        };
    }

    function drawSegment(x0, y0, x1, y1, color, size, eraser) {
        ctx.save();
        ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth   = size;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // -- Draw events ----------------------------------------------------------
    function onStart(e) {
        e.preventDefault();
        isDrawing = true;
        const { x, y } = getPos(e);
        lastX = x; lastY = y;
    }

    function onMove(e) {
        e.preventDefault();
        if (!isDrawing) return;
        const { x, y } = getPos(e);
        const color  = colorInput.value;
        const size   = parseInt(sizeRange.value, 10);

        drawSegment(lastX, lastY, x, y, color, size, isEraser);

        connection.invoke('SendDrawAction', GAME_ID, 'stroke', {
            x0: lastX, y0: lastY, x1: x, y1: y,
            color, size, eraser: isEraser,
        }).catch(() => {});

        lastX = x; lastY = y;
    }

    function onEnd(e) {
        e.preventDefault();
        isDrawing = false;
    }

    canvas.addEventListener('mousedown',  onStart, { signal: ac.signal });
    canvas.addEventListener('mousemove',  onMove,  { signal: ac.signal });
    canvas.addEventListener('mouseup',    onEnd,   { signal: ac.signal });
    canvas.addEventListener('mouseleave', onEnd,   { signal: ac.signal });
    canvas.addEventListener('touchstart', onStart, { passive: false, signal: ac.signal });
    canvas.addEventListener('touchmove',  onMove,  { passive: false, signal: ac.signal });
    canvas.addEventListener('touchend',   onEnd,   { signal: ac.signal });

    // -- Toolbar events -------------------------------------------------------
    eraserBtn.addEventListener('click', () => {
        isEraser = !isEraser;
        eraserBtn.classList.toggle('active', isEraser);
        canvas.style.cursor = isEraser ? 'cell' : 'crosshair';
    }, { signal: ac.signal });

    clearBtn.addEventListener('click', () => {
        clearCanvas();
        connection.invoke('SendDrawAction', GAME_ID, 'clear', {}).catch(() => {});
    }, { signal: ac.signal });

    // -- Destroy --------------------------------------------------------------
    _destroy = () => {
        ac.abort();
        connection.stop();
        onlineCountEl.classList.add('hidden');
        onlineCountEl.textContent = '';
        const btn = document.querySelector('.game-tabs .tab-btn[data-tab="paint"]');
        if (btn) btn.dataset.notify = 'false';
    };

    // -- Online names ---------------------------------------------------------
    connection.on('PaintOnlineUpdate', (names) => {
        const others = names.filter(n => n !== myName);
        let label;
        if (others.length === 0) {
            label = 'Você';
        } else if (others.length === 1) {
            label = `Você, ${others[0]}`;
        } else {
            label = `Você e ${others.length} outros`;
        }
        onlineCountEl.textContent = label;
        onlineCountEl.classList.remove('hidden');
        setTabNotify(true);
    });

    // -- Receive from others --------------------------------------------------
    connection.on('ReceiveDrawAction', (action, data) => {
        if (action === 'stroke') {
            drawSegment(data.x0, data.y0, data.x1, data.y1, data.color, data.size, data.eraser);
        } else if (action === 'clear') {
            clearCanvas();
        }
    });

    // -- Start connection -----------------------------------------------------
    connection.start().catch(err => console.error('Paint SignalR:', err));
}
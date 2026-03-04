// ============================================
// chat.js — chat module (SignalR)
// ============================================

import { getUserName } from '../user.js';

export function initChat() {
    const messagesEl = document.getElementById('messages');
    const statusEl   = document.getElementById('chat-status');
    const sendBtn    = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const changeNameBtn = document.getElementById('chat-change-name-btn');

    const myName = () => getUserName() || 'Anônimo';

    // Reflect current name in the header button
    function syncNameTag() {
        changeNameBtn.textContent = myName();
    }
    syncNameTag();

    // Update tag whenever name changes app-wide
    window.addEventListener('gchat:namechanged', () => syncNameTag());

    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/chathub')
        .withAutomaticReconnect()
        .build();

    // ── Incoming messages ───────────────────────────────────────────────────────────

    // History batch on first connect
    connection.on('ReceiveHistory', (messages) => {
        for (const { user, message } of messages)
            appendMessage(user, message, false);

        // Separator so the user knows where history ends
        const sep = document.createElement('div');
        sep.className = 'msg-separator';
        sep.textContent = '―― histórico ――';
        messagesEl.appendChild(sep);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    connection.on('ReceiveMessage', (user, message) => {
        appendMessage(user, message, true);
    });

    function appendMessage(user, message, scroll) {
        const div = document.createElement('div');
        div.classList.add('msg');
        if (user === myName()) div.classList.add('mine');
        div.innerHTML = `
            <div class="msg-user">${escapeHtml(user)}</div>
            <div class="msg-text">${escapeHtml(message)}</div>
        `;
        messagesEl.appendChild(div);
        if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Connection state ───────────────────────────────────────────────────────────

    connection.onreconnecting(() => {
        statusEl.textContent = 'Reconectando...';
        sendBtn.disabled = true;
    });

    connection.onreconnected(() => {
        statusEl.textContent = 'Conectado';
        sendBtn.disabled = false;
    });

    connection.onclose(() => {
        statusEl.textContent = 'Desconectado';
        sendBtn.disabled = true;
    });

    connection.start()
        .then(() => {
            statusEl.textContent = 'Conectado';
            sendBtn.disabled = false;
        })
        .catch(err => {
            statusEl.textContent = 'Falha ao conectar: ' + err;
        });

    // ── Send ───────────────────────────────────────────────────────────────

    async function send() {
        const message = messageInput.value.trim();
        if (!message || sendBtn.disabled) return;
        await connection.invoke('SendMessage', myName(), message);
        messageInput.value = '';
        messageInput.focus();
    }

    sendBtn.addEventListener('click', send);
    messageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') send();
    });
}

// ---------- Helpers ----------

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

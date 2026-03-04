// ============================================
// chat.js — chat module (SignalR)
// ============================================

import { getUserName } from '../../js/user.js';

export function initChat() {
    const messagesEl = document.getElementById('messages');
    const sendBtn    = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const changeNameBtn = document.getElementById('chat-change-name-btn');
    const onlineCountEl = document.getElementById('online-count');

    const myName = () => getUserName() || 'Anônimo';

    // Reflect current name in the header button
    function syncNameTag() {
        changeNameBtn.textContent = myName();
    }
    syncNameTag();

    // Update tag whenever name changes app-wide
    window.addEventListener('gchat:namechanged', (e) => {
        syncNameTag();
        const { name, oldName } = e.detail || {};
        if (oldName && name && oldName !== name)
            connection.invoke('NotifyNameChange', oldName, name).catch(() => {});
    });

    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/chathub')
        .withAutomaticReconnect()
        .build();

    // ── Incoming messages ──────────────────────────────────────────────────────

    connection.on('ReceiveHistory', (messages) => {
        for (const { user, message } of messages)
            appendMessage(user, message, false);

        const sep = document.createElement('div');
        sep.className = 'msg-separator';
        sep.textContent = '―― histórico ――';
        messagesEl.appendChild(sep);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    connection.on('ReceiveMessage', (user, message) => {
        appendMessage(user, message, true);
    });

    connection.on('ReceiveSystemMessage', (text) => {
        appendSystemMessage(text);
    });

    connection.on('UpdateOnlineCount', (count) => {
        if (onlineCountEl)
            onlineCountEl.innerHTML = `<span class="online-dot">●</span> ${count} ${count === 1 ? 'pessoa' : 'pessoas'} online`;
    });

    connection.on('PaintActivityUpdate', (names) => {
        window.dispatchEvent(new CustomEvent('paint:activityupdate', { detail: names }));
    });

    // ── Typing indicator ───────────────────────────────────────────────────────

    const typingEl = document.getElementById('typing-indicator');
    const typingTimers = new Map();

    connection.on('UserTyping', (user) => {
        typingTimers.get(user) && clearTimeout(typingTimers.get(user));
        typingTimers.set(user, setTimeout(() => {
            typingTimers.delete(user);
            renderTyping();
        }, 2500));
        renderTyping();
    });

    function renderTyping() {
        const names = [...typingTimers.keys()];
        if (!typingEl) return;
        if (names.length === 0) { typingEl.innerHTML = ''; return; }
        const parts = names.slice(0, 2).map(n => `<span style="color:${userColor(n)}">${escapeHtml(n)}</span>`);
        const label = names.length === 1
            ? `${parts[0]} está digitando...`
            : `${parts.join(', ')} estão digitando...`;
        typingEl.innerHTML = label;
    }

    let typingTimeout = null;
    messageInput.addEventListener('input', () => {
        if (!messageInput.value.trim()) return;
        if (typingTimeout) return;
        connection.invoke('NotifyTyping', myName()).catch(() => {});
        typingTimeout = setTimeout(() => { typingTimeout = null; }, 1500);
    });

    function appendMessage(user, message, scroll) {
        const div = document.createElement('div');
        div.classList.add('msg');
        if (user === myName()) div.classList.add('mine');
        div.innerHTML = `
            <div class="msg-user" style="color:${userColor(user)}">${escapeHtml(user)}</div>
            <div class="msg-text">${escapeHtml(message)}</div>
        `;
        messagesEl.appendChild(div);
        if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'msg-system';
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Connection state ───────────────────────────────────────────────────────
    connection.onreconnecting(() => { sendBtn.disabled = true; });
    connection.onreconnected(()  => { sendBtn.disabled = false; });
    connection.onclose(()        => { sendBtn.disabled = true; });

    connection.start()
        .then(() => { sendBtn.disabled = false; })
        .catch(err => console.error('Falha ao conectar: ' + err));

    // ── Send ───────────────────────────────────────────────────────────────────
    async function send() {
        const message = messageInput.value.trim();
        if (!message || sendBtn.disabled) return;
        await connection.invoke('SendMessage', myName(), message);
        messageInput.value = '';
        messageInput.focus();
    }

    sendBtn.addEventListener('click', send);
    messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const USER_COLORS = [
    '#cba6f7', // mauve
    '#89b4fa', // blue
    '#f38ba8', // red
    '#a6e3a1', // green
    '#fab387', // peach
    '#f9e2af', // yellow
    '#74c7ec', // sapphire
    '#b4befe', // lavender
    '#89dceb', // sky
    '#f2cdcd', // flamingo
];

function userColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return USER_COLORS[hash % USER_COLORS.length];
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

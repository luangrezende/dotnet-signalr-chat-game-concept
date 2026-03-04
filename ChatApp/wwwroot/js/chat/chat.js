// ============================================
// chat.js — chat module (SignalR)
// ============================================

export function initChat() {
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('chat-status');
    const sendBtn = document.getElementById('sendBtn');
    const userInput = document.getElementById('userInput');
    const messageInput = document.getElementById('messageInput');

    const myName = () => userInput.value.trim() || 'Anônimo';

    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/chathub')
        .withAutomaticReconnect()
        .build();

    // ---------- Incoming messages ----------

    connection.on('ReceiveMessage', (user, message) => {
        const div = document.createElement('div');
        div.classList.add('msg');
        if (user === myName()) div.classList.add('mine');
        div.innerHTML = `
            <div class="msg-user">${escapeHtml(user)}</div>
            <div class="msg-text">${escapeHtml(message)}</div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    // ---------- Connection state ----------

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

    // ---------- Send ----------

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

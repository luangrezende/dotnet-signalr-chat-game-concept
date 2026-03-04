// ============================================
// app.js — main app controller (game tab routing)
// ============================================

import { initChat }     from './chat/chat.js';
import { initPingPong } from './game/pingpong.js';
import { getUserName, setUserName, hasUserName } from './user.js';

const gameModules = {
    pingpong: initPingPong,
};

const initializedGames = new Set();

function activateGameTab(tabId) {
    document.querySelectorAll('.game-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.game-content .tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });

    // Lazy-init game module on first visit
    if (!initializedGames.has(tabId) && gameModules[tabId]) {
        gameModules[tabId]();
        initializedGames.add(tabId);
    }
}

document.querySelectorAll('.game-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateGameTab(btn.dataset.tab));
});

// ── Name modal ───────────────────────────────────────────────────────────────

const modal      = document.getElementById('name-modal');
const modalInput = document.getElementById('name-modal-input');
const modalBtn   = document.getElementById('name-modal-btn');

function openModal() {
    modalInput.value = getUserName();
    modal.classList.remove('hidden');
    modalInput.focus();
    modalInput.select();
    syncModalBtn();
}

function closeModal() {
    modal.classList.add('hidden');
}

function syncModalBtn() {
    modalBtn.disabled = modalInput.value.trim().length === 0;
}

function confirmName() {
    const oldName = getUserName();
    const name = modalInput.value.trim();
    if (!name) return;
    setUserName(name);
    closeModal();
    // notify any listener
    window.dispatchEvent(new CustomEvent('gchat:namechanged', { detail: { name, oldName } }));
}

modalInput.addEventListener('input', syncModalBtn);
modalInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
modalBtn.addEventListener('click', confirmName);

// "Change name" button in the chat header
document.getElementById('chat-change-name-btn')
    .addEventListener('click', openModal);

function bootApp() {
    // Chat is always visible — init immediately
    initChat();
    // Boot default game tab
    activateGameTab('pingpong');
}

// Show modal on first visit; otherwise boot directly
if (!hasUserName()) {
    openModal();
    // Wait for first name confirmation before booting
    window.addEventListener('gchat:namechanged', bootApp, { once: true });
} else {
    bootApp();
}

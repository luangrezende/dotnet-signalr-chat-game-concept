// ============================================
// app.js — main app controller (tab routing)
// ============================================

import { initChat } from './chat/chat.js';
import { initPingPong } from './game/pingpong.js';

const modules = {
    chat: initChat,
    pingpong: initPingPong,
};

const initialized = new Set();

function activateTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });

    // Lazy-init module on first visit
    if (!initialized.has(tabId) && modules[tabId]) {
        modules[tabId]();
        initialized.add(tabId);
    }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Boot default tab
activateTab('chat');

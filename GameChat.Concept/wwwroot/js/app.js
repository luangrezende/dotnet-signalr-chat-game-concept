import { initChat }  from '../modules/chat/chat.js';
import { getUserName, setUserName, hasUserName } from './user.js';
import * as PingPong from '../modules/games/pingpong/pingpong.js';
import * as Paint from '../modules/games/paint/paint.js';

// ── Chat module ────────────────────────────────────────────────────────────────
const CHAT = {
    cssPath:  '/modules/chat/chat.css',
    htmlPath: '/modules/chat/chat.html',
};

// ── Game registry ─────────────────────────────────────────────────────────────
// Add new game modules here:
const GAMES = [PingPong, Paint];

const initializedGames = new Set();
let activeGameId = null;

function injectCSS(href) {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

async function registerGames() {
    const tabsEl    = document.querySelector('.game-tabs');
    const contentEl = document.querySelector('.game-content');

    for (const [i, game] of GAMES.entries()) {
        const { id, label, cssPath, htmlPath } = game.meta;

        injectCSS(cssPath);

        const btn = document.createElement('button');
        btn.className   = i === 0 ? 'tab-btn active' : 'tab-btn';
        btn.dataset.tab = id;
        btn.textContent = label;
        btn.addEventListener('click', () => activateGame(id));
        tabsEl.appendChild(btn);

        const html = await fetch(htmlPath).then(r => r.text());
        const section = document.createElement('section');
        section.id        = `tab-${id}`;
        section.className = i === 0 ? 'tab-panel active' : 'tab-panel';
        section.innerHTML = html;
        contentEl.appendChild(section);
    }
}

async function activateGame(id) {
    if (activeGameId && activeGameId !== id) {
        const outgoing = GAMES.find(g => g.meta.id === activeGameId);
        if (outgoing?.destroy) {
            outgoing.destroy();
            initializedGames.delete(activeGameId);
        }
    }
    activeGameId = id;

    document.querySelectorAll('.game-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === id);
    });
    document.querySelectorAll('.game-content .tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${id}`);
    });

    if (!initializedGames.has(id)) {
        const game = GAMES.find(g => g.meta.id === id);
        if (game) {
            await game.init();
            initializedGames.add(id);
        }
    }
}

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
    window.dispatchEvent(new CustomEvent('gchat:namechanged', { detail: { name, oldName } }));
}

modalInput.addEventListener('input', syncModalBtn);
modalInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
modalBtn.addEventListener('click', confirmName);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function bootApp() {
    injectCSS(CHAT.cssPath);
    const chatHTML = await fetch(CHAT.htmlPath).then(r => r.text());
    document.querySelector('.chat-panel').innerHTML = chatHTML;

    document.getElementById('chat-change-name-btn')
        .addEventListener('click', openModal);

    initChat();

    await registerGames();
    await activateGame(GAMES[0].meta.id);
}

// ── Cross-module tab notifications ───────────────────────────────────────────
window.addEventListener('paint:activityupdate', (e) => {
    const names  = e.detail ?? [];
    const btn    = document.querySelector('.game-tabs .tab-btn[data-tab="paint"]');
    if (btn) btn.dataset.notify = names.length > 0 ? 'true' : 'false';
});

if (!hasUserName()) {
    openModal();
    window.addEventListener('gchat:namechanged', bootApp, { once: true });
} else {
    bootApp();
}

<DOCUMENT filename="script.js">
const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
const hpList = document.getElementById('hp-list');
const logContent = document.getElementById('log-content');
const statusBanner = document.getElementById('status-banner');
const pokemonGrid = document.getElementById('pokemon-grid');
const selectionOverlay = document.getElementById('selection-overlay');
const timerDisplay = document.getElementById('timer-display');
const socket = io();

const playerProfile = document.getElementById('player-profile');
const chosenPkmnSprite = document.getElementById('chosen-pkmn-sprite');
const targetPkmnSprite = document.getElementById('target-pkmn-sprite');
const faintedOverlay = document.getElementById('fainted-overlay');

// Post-game + spectator elements (unchanged)
const postgameOverlay  = document.getElementById('postgame-overlay');
const winnerBanner     = document.getElementById('winner-banner');
const voteListEl       = document.getElementById('vote-list');
const winsListEl       = document.getElementById('wins-list');
const playVoteCount    = document.getElementById('play-vote-count');
const totalPlayerCount = document.getElementById('total-player-count');
const pgTimerEl        = document.getElementById('pg-timer');
const btnPlayAgain     = document.getElementById('btn-play-again');
const btnQuit          = document.getElementById('btn-quit');

const spectatorBanner     = document.getElementById('spectator-banner');
const spectatorChip       = document.getElementById('spectator-chip');
const spectatorChipCount  = document.getElementById('spectator-chip-count');
const spectatorVoteNote   = document.getElementById('spectator-vote-note');
const ingameActivity      = document.getElementById('ingame-activity');

const readyFraction = document.getElementById('ready-fraction');
const readyLabel    = document.getElementById('ready-label');
const readyPips     = document.getElementById('ready-pips');

let gameState = "LOADING";
let selectionTimeLeft = 60;
let countdownTimer = 180;
let phaseTimer = 0;
let playerChoice = null;
let fighters = [];
let allPokemonPool = [];

let myVote = null;
let pgCountdown = 15;
let pgInterval = null;
let lobbyWins = {};
let playerVotes = {};
let totalPlayers = 1;
let myName = sessionStorage.getItem('playerName') || 'Player';
let amSpectator = false;

let currentReady = 0;
let currentTotal = 1;

let prng = Math.random;                    // ← will be replaced with seeded version
let simulationInterval = null;

const POKEBALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

const TYPE_COLORS = { /* unchanged */ };
const TYPE_CHART = { /* unchanged */ };
const TYPE_MOVES = { /* unchanged */ };

function formatName(n) { return n.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function normalizeType(t) { return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase(); }

// ── SEEDED PRNG (for perfect sync across clients) ──
function createPRNG(seedStr) {
    let seed = parseInt(seedStr, 36) || 12345;
    return function() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
}

// ── READY COUNTER (unchanged) ──
function updateReadyCounter(ready, total) { /* unchanged */ }

// ── SPECTATOR HELPERS (unchanged) ──
function setSpectatorMode(isSpec) { /* unchanged */ }
function updateSpectatorCount(count) { /* unchanged */ }
function showIngameToast(name, action) { /* unchanged */ }

// ── SOCKET EVENTS (updated) ──
socket.on('gameInfo', (data) => { /* unchanged */ });
socket.on('readyUpdate', ({ ready, total }) => { updateReadyCounter(ready, total); });
socket.on('joinedAsSpectator', () => { setSpectatorMode(true); });
socket.on('spectatorGameState', (data) => { /* unchanged */ });
socket.on('spectatorCount', (count) => { updateSpectatorCount(count); });
socket.on('playerActivity', ({ name, action }) => { showIngameToast(name, action); });
socket.on('playerVoteUpdate', (votes) => { playerVotes = votes; renderVotes(); });
socket.on('winsUpdate', (wins) => { lobbyWins = wins; renderWins(); });
socket.on('restartGame', () => { amSpectator = false; resetForNewGame(); });
socket.on('allQuit', () => { window.location.href = '/'; });

// ── NEW: SHARED POKEMON POOL + BATTLE START (authoritative sync) ──
socket.on('sharedPokemonPool', (pool) => {
    allPokemonPool = pool;
    if (!amSpectator) {
        gameState = "SELECT";
        initSelection();
        selectionTimeLeft = 60;
        if (timerDisplay) timerDisplay.innerText = 60;
    } else {
        gameState = "SPECTATE";
    }
    loop();
});

socket.on('battleStart', ({ seed }) => {
    prng = createPRNG(seed);

    selectionOverlay.style.display = 'none';

    // Reset EVERYTHING with the SAME seeded random (positions, velocities, etc.)
    fighters.forEach(f => {
        f.x = prng() * (canvas.width - 100) + 50;
        f.y = prng() * (canvas.height - 100) + 50;
        f.vx = (prng() - 0.5) * 4;
        f.vy = (prng() - 0.5) * 4;
        f.hp = 150;
        f.maxHp = 150;
        f.atk = 80;
        f.def = 80;
        f.target = null;
        f.currentMoveName = "";
        f.currentMoveCategory = "";
    });

    gameState = "COUNTDOWN";
    countdownTimer = 180;
    phaseTimer = 0;
    logContent.innerHTML = '';

    // Fixed-tick simulation (16ms ≈ 60 FPS) so everyone advances identically
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(simulationTick, 16);

    console.log("Battle simulation started with shared seed");
});

// ── POST-GAME (unchanged) ──
function showPostGame(winCreditName, displayName) { /* unchanged */ }
function votePlayAgain() { /* unchanged */ }
function voteQuit() { /* unchanged */ }
function renderVotes() { /* unchanged */ }
function renderWins() { /* unchanged */ }
function resetForNewGame() {
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
    if (pgInterval) { clearInterval(pgInterval); pgInterval = null; }
    myVote = null;
    postgameOverlay.classList.remove('show');
    fighters = [];
    playerChoice = null;
    gameState = "LOADING";
    selectionTimeLeft = 60;
    countdownTimer = 180;
    phaseTimer = 0;
    logContent.innerHTML = '';
    hpList.innerHTML = '';
    playerProfile.classList.add('hidden');
    updateReadyCounter(0, totalPlayers);
    if (!amSpectator) selectionOverlay.style.display = 'flex';
    statusBanner.className = '';
    statusBanner.innerText = amSpectator ? 'SPECTATING...' : 'LOADING POKÉDEX...';
    // No fetchAllPokemon — waiting for new shared pool from server
}

// ── POKEMON CLASS (positions now set in battleStart) ──
class Pokemon {
    constructor(name, id, type) {
        this.name = name; this.type = type; this.atk = 80; this.def = 80;
        this.moves = TYPE_MOVES[type] || TYPE_MOVES["Normal"];
        this.hp = 150; this.maxHp = 150;
        this.img = new Image();
        this.img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
        this.x = 400; this.y = 300; this.vx = 0; this.vy = 0;
        this.target = null; this.currentMoveName = ""; this.currentMoveCategory = "";
    }
    draw() { /* unchanged */ }
}

// ── UI HELPERS (unchanged) ──
function addToLog(msg) { /* unchanged */ }
function updateSidebarProfile() { /* unchanged */ }
function updateUI() { /* unchanged */ }

// ── FIXED-TICK SIMULATION (authoritative, seeded, identical on every client) ──
function simulationTick() {
    if (gameState === "COUNTDOWN") {
        countdownTimer--;
        statusBanner.innerText = "STARTING IN: " + Math.ceil(countdownTimer / 60);
        if (countdownTimer <= 0) {
            gameState = "MOVE";
            phaseTimer = 300;
        }
    } else if (gameState === "MOVE") {
        phaseTimer--;
        fighters.forEach(f => {
            if (f.hp <= 0) return;
            f.x += f.vx; f.y += f.vy;
            if (f.x < 30 || f.x > canvas.width - 30) f.vx *= -1;
            if (f.y < 30 || f.y > canvas.height - 30) f.vy *= -1;
        });
        if (phaseTimer <= 0) {
            gameState = "DECIDE";
            phaseTimer = 120;
            fighters.forEach(f => {
                if (f.hp <= 0) return;
                let minDist = Infinity;
                let target = null;
                fighters.forEach(o => {
                    if (o !== f && o.hp > 0) {
                        let d = Math.hypot(o.x - f.x, o.y - f.y);
                        if (d < minDist) { minDist = d; target = o; }
                    }
                });
                f.target = target;

                const r = prng();
                if (r < 0.2) {
                    f.currentMoveCategory = "debuff";
                    f.currentMoveName = f.moves.debuff;
                } else if (minDist < 110) {
                    f.currentMoveCategory = "short";
                    f.currentMoveName = f.moves.short;
                } else {
                    f.currentMoveCategory = "long";
                    f.currentMoveName = f.moves.long;
                }
            });
        }
    } else if (gameState === "DECIDE") {
        phaseTimer--;
        if (phaseTimer <= 0) {
            fighters.forEach(f => {
                if (f.hp <= 0 || !f.target || f.target.hp <= 0) return;
                if (f.currentMoveCategory === "debuff") {
                    addToLog(`<span style="color:#aaa">${f.name} used <b style="color:#a29bfe">${f.currentMoveName}</b> on ${f.target.name}! <i style="color:#888">(-DEF)</i></span>`);
                    f.target.def = Math.max(1, Math.floor(f.target.def * 0.85));
                    return;
                }
                let typeMult = TYPE_CHART[f.type]?.[f.target.type] ?? 1.0;
                let isCrit = prng() < 0.1;
                let dmg = Math.floor((30 * f.atk / f.target.def) * typeMult * (isCrit ? 1.5 : 1.0));
                let effectLabel = typeMult >= 2 ? `<span style="color:#f39c12"> ⚡ Super effective!</span>` :
                                  typeMult === 0 ? `<span style="color:#888"> It had no effect...</span>` :
                                  typeMult < 1 ? `<span style="color:#7f8c8d"> Not very effective...</span>` : "";
                let critLabel = isCrit ? `<span style="color:#e74c3c"> ★ CRITICAL HIT!</span>` : "";
                let moveColor = f.currentMoveCategory === "long" ? "#fd79a8" : "#74b9ff";
                f.target.hp = Math.max(0, f.target.hp - dmg);
                addToLog(`<span style="color:#dfe6e9">${f.name} used <b style="color:${moveColor}">${f.currentMoveName}</b> → <b>${dmg} dmg</b> to ${f.target.name}!${effectLabel}${critLabel}</span>`);
                if (f.target.hp <= 0) addToLog(`<span style="color:#e74c3c;font-size:1rem">💀 <b>${f.target.name} fainted!</b></span>`);
            });
            gameState = "MOVE";
            phaseTimer = 300;
        }
    }

    // WIN DETECTION (same on every client because simulation is identical)
    const alive = fighters.filter(f => f.hp > 0);
    if (alive.length === 1 && !["SELECT","COUNTDOWN","LOADING","SPECTATE"].includes(gameState)) {
        const wp = alive[0];
        const iMyWin = playerChoice && playerChoice === wp;
        const displayName = wp.name;
        const creditName = iMyWin ? myName : wp.name;

        statusBanner.innerText = wp.name.toUpperCase() + " WINS!";
        statusBanner.className = '';
        gameState = "WIN";

        clearInterval(simulationInterval);
        setTimeout(() => showPostGame(creditName, displayName), 1500);
    }
}

// ── RENDER LOOP (only drawing + UI) ──
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === "SPECTATE") {
        statusBanner.innerText = "SPECTATING...";
        fighters.forEach(f => f.draw());
        requestAnimationFrame(loop);
        return;
    }
    if (gameState === "LOADING") {
        statusBanner.innerText = "LOADING POKÉDEX...";
    } else if (gameState === "SELECT") {
        statusBanner.innerText = `CHOOSE YOUR POKEMON: ${selectionTimeLeft}s`;
        statusBanner.className = "selecting";
    }

    fighters.forEach(f => f.draw());
    updateUI();

    requestAnimationFrame(loop);
}

// ── SELECTION (now uses server pool + deterministic order) ──
function initSelection() {
    const sortedPool = [...allPokemonPool].sort((a, b) => a.id - b.id);
    fighters = sortedPool.map(p => new Pokemon(p.name, p.id, p.type));

    pokemonGrid.innerHTML = '';
    fighters.forEach(f => {
        const card = document.createElement('div');
        card.className = 'select-card';
        card.innerHTML = `
            <img src="${f.img.src}">
            <div style="color:${TYPE_COLORS[f.type]||'#aaa'}">${f.name}</div>
            <div style="font-size:0.65rem;color:${TYPE_COLORS[f.type]||'#aaa'};margin-top:2px;">[${f.type}]</div>`;
        card.onclick = () => selectPokemon(f, card);
        pokemonGrid.appendChild(card);
    });
}

function selectPokemon(pokemon, element) {
    if (amSpectator) return;
    const isFirstChoice = !playerChoice;
    playerChoice = pokemon;

    document.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');

    playerProfile.classList.remove('hidden');
    chosenPkmnSprite.src = pokemon.img.src;
    addToLog(`<b style="color:#ffcb05">Locked in ${pokemon.name}!</b>`);

    if (isFirstChoice) {
        socket.emit('playerReady');
    }
}

// ── SELECTION TIMEOUT (auto-lock) ──
setInterval(() => {
    if (gameState === "SELECT" && !amSpectator) {
        selectionTimeLeft--;
        if (timerDisplay) timerDisplay.innerText = selectionTimeLeft;
        if (selectionTimeLeft <= 0) {
            if (!playerChoice) {
                playerChoice = fighters[0];
                playerProfile.classList.remove('hidden');
                chosenPkmnSprite.src = playerChoice.img.src;
                socket.emit('playerReady');
            }
            // NO local startBattle — server controls it
        }
    }
}, 1000);

// ── START (removed local startBattle — everything is now server-driven) ──
function startBattle() {
    // This function is no longer used (auto-start via server)
    console.warn("startBattle() is deprecated — battle is now fully synced by server");
}

// ── INITIAL LOAD (no more local fetch) ──
fetchAllPokemon = () => {}; // dummy (pool comes from server)

// Post-game + spectator functions (unchanged)
function showPostGame(...) { /* full unchanged code from original */ }
function votePlayAgain() { /* unchanged */ }
function voteQuit() { /* unchanged */ }
function renderVotes() { /* unchanged */ }
function renderWins() { /* unchanged */ }

// ── RUN ──
loop();
</DOCUMENT>

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

let prng = Math.random;
let simulationInterval = null;

const POKEBALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

const TYPE_COLORS = {
    "Fire":"#ff4422","Water":"#3399ff","Grass":"#77cc55","Electric":"#ffcc33",
    "Rock":"#bbaa66","Ghost":"#6666bb","Fighting":"#bb5544","Flying":"#8899ff",
    "Psychic":"#ff5599","Ground":"#ddbb55","Bug":"#aabb22","Fairy":"#ee99ee",
    "Dragon":"#7766ee","Dark":"#775544","Steel":"#aaaabb","Ice":"#66ccff",
    "Poison":"#aa5599","Normal":"#aaaa99"
};

const TYPE_CHART = { /* (your full TYPE_CHART from original — paste it here) */ };
const TYPE_MOVES = { /* (your full TYPE_MOVES from original — paste it here) */ };

function formatName(n) { return n.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function normalizeType(t) { return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase(); }

// ── SEEDED PRNG ──
function createPRNG(seedStr) {
    let seed = parseInt(seedStr, 36) || 12345;
    return function() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
}

// ── READY COUNTER ──
function updateReadyCounter(ready, total) {
    currentReady = ready;
    currentTotal = total;
    readyFraction.textContent = `${ready}/${total}`;
    readyLabel.textContent = ready === total ? '✔ ALL READY!' : 'READY';
    const allReady = ready === total && total > 0;
    readyFraction.classList.toggle('all-ready', allReady);
    readyLabel.classList.toggle('all-ready', allReady);
    readyPips.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip' + (i < ready ? ' ready' : '');
        readyPips.appendChild(pip);
    }
}

// ── SPECTATOR HELPERS ──
function setSpectatorMode(isSpec) {
    amSpectator = isSpec;
    if (isSpec) {
        spectatorBanner.style.display = 'block';
        spectatorVoteNote.style.display = 'block';
        document.body.classList.add('is-spectator');
        selectionOverlay.style.display = 'none';
        statusBanner.innerText = 'SPECTATING...';
    } else {
        spectatorBanner.style.display = 'none';
        spectatorVoteNote.style.display = 'none';
        document.body.classList.remove('is-spectator');
    }
}

function updateSpectatorCount(count) {
    spectatorChipCount.textContent = count;
    spectatorChip.style.display = count > 0 ? 'block' : 'none';
    spectatorBanner.innerHTML = `👁 YOU ARE SPECTATING &nbsp;|&nbsp; <span>${count}</span> SPECTATOR(S) WATCHING`;
}

function showIngameToast(name, action) {
    const icons = {joined:'➕', left:'➖', spectating:'👁'};
    const labels = {joined:'joined', left:'left', spectating:'is now spectating'};
    const toast = document.createElement('div');
    toast.className = `ig-toast ${action}`;
    toast.textContent = `${icons[action]||''} ${name} ${labels[action]||action}`;
    ingameActivity.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; }, 2500);
    setTimeout(() => { if (toast.parentNode) ingameActivity.removeChild(toast); }, 3000);
}

// ── SOCKET EVENTS ──
socket.on('gameInfo', (data) => {
    if (data.name) myName = data.name;
    if (data.totalPlayers) totalPlayers = data.totalPlayers;
    if (data.wins) lobbyWins = data.wins;
    if (data.isSpectator) setSpectatorMode(true);
    updateReadyCounter(0, totalPlayers);
});

socket.on('readyUpdate', ({ ready, total }) => updateReadyCounter(ready, total));
socket.on('joinedAsSpectator', () => setSpectatorMode(true));
socket.on('spectatorGameState', (data) => {
    if (data.wins) lobbyWins = data.wins;
    if (data.totalPlayers) totalPlayers = data.totalPlayers;
    updateSpectatorCount(data.spectatorCount || 0);
});
socket.on('spectatorCount', updateSpectatorCount);
socket.on('playerActivity', showIngameToast);
socket.on('playerVoteUpdate', (votes) => { playerVotes = votes; renderVotes(); });
socket.on('winsUpdate', (wins) => { lobbyWins = wins; renderWins(); });
socket.on('restartGame', () => { amSpectator = false; resetForNewGame(); });
socket.on('allQuit', () => { window.location.href = '/'; });

// ── SHARED POOL + BATTLE START (fully synced) ──
function createFighters() {
    fighters = allPokemonPool.map(p => new Pokemon(p.name, p.id, p.type));
}

socket.on('sharedPokemonPool', (pool) => {
    allPokemonPool = pool;
    createFighters();
    if (!amSpectator) {
        gameState = "SELECT";
        selectionTimeLeft = 60;
        if (timerDisplay) timerDisplay.innerText = 60;
        initSelection();
    } else {
        gameState = "SPECTATE";
    }
    loop();
});

socket.on('battleStart', ({ seed }) => {
    prng = createPRNG(seed);
    selectionOverlay.style.display = 'none';

    fighters.forEach(f => {
        f.x = prng() * (canvas.width - 100) + 50;
        f.y = prng() * (canvas.height - 100) + 50;
        f.vx = (prng() - 0.5) * 4;
        f.vy = (prng() - 0.5) * 4;
        f.hp = 150; f.maxHp = 150;
        f.atk = 80; f.def = 80;
        f.target = null;
        f.currentMoveName = "";
        f.currentMoveCategory = "";
    });

    gameState = "COUNTDOWN";
    countdownTimer = 180;
    phaseTimer = 0;
    logContent.innerHTML = '';

    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(simulationTick, 16);
});

// ── POST GAME ──
function showPostGame(displayName) {
    if (pgInterval) { clearInterval(pgInterval); pgInterval = null; }
    winnerBanner.textContent = `🏆 ${displayName.toUpperCase()} WINS!`;

    playerVotes = {};
    myVote = null;
    pgCountdown = 15;
    pgTimerEl.textContent = '15';
    btnPlayAgain.disabled = false;
    btnQuit.disabled = false;
    playVoteCount.textContent = '0';
    totalPlayerCount.textContent = totalPlayers;

    renderVotes();
    renderWins();
    postgameOverlay.classList.add('show');

    pgInterval = setInterval(() => {
        pgCountdown--;
        pgTimerEl.textContent = pgCountdown;
        if (pgCountdown <= 0) {
            clearInterval(pgInterval); pgInterval = null;
            if (!myVote) {
                myVote = 'play';
                btnPlayAgain.disabled = true;
                btnQuit.disabled = true;
                socket.emit('playerVote', { name: myName, vote: 'play' });
                if (totalPlayers <= 1) setTimeout(resetForNewGame, 500);
            }
        }
    }, 1000);
}

function votePlayAgain() {
    if (myVote) return;
    myVote = 'play';
    btnPlayAgain.disabled = true;
    btnQuit.disabled = true;
    socket.emit('playerVote', { name: myName, vote: 'play' });
    if (totalPlayers <= 1) setTimeout(resetForNewGame, 500);
}

function voteQuit() {
    if (myVote) return;
    myVote = 'quit';
    btnPlayAgain.disabled = true;
    btnQuit.disabled = true;
    socket.emit('playerVote', { name: myName, vote: 'quit' });
    if (totalPlayers <= 1) setTimeout(() => window.location.href = '/', 500);
}

function renderVotes() {
    const entries = Object.entries(playerVotes);
    const playCount = entries.filter(([,v]) => v === 'play').length;
    playVoteCount.textContent = playCount;
    voteListEl.innerHTML = entries.length === 0
        ? '<div style="color:#555;font-size:0.42rem;padding:8px;">Waiting for votes...</div>'
        : entries.map(([name,vote]) => `
            <div class="vote-row">
                <span class="vote-name">${name}</span>
                <span class="badge ${vote==='play'?'badge-play':'badge-quit'}">${vote==='play'?'▶ PLAY':'✖ QUIT'}</span>
            </div>`).join('');
}

function renderWins() {
    const sorted = Object.entries(lobbyWins).sort((a,b)=>b[1]-a[1]);
    winsListEl.innerHTML = sorted.length === 0
        ? '<div style="color:#555;font-size:0.42rem;padding:8px;">No wins yet</div>'
        : sorted.map(([name,wins],i) => `
            <div class="wins-row ${i===0?'top':''}">
                <span class="wins-rank">${i===0?'👑':`#${i+1}`}</span>
                <span class="wins-name">${name}</span>
                <span class="wins-count">${wins}W</span>
            </div>`).join('');
}

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
}

// ── POKEMON CLASS ──
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
    draw() {
        if (this.hp <= 0) return;
        if (gameState === "DECIDE" && this.target) {
            ctx.beginPath(); ctx.setLineDash([5,5]);
            ctx.moveTo(this.x, this.y); ctx.lineTo(this.target.x, this.target.y);
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.drawImage(this.img, this.x-30, this.y-30, 60, 60);
        if (gameState === "DECIDE") {
            ctx.fillStyle = "#ffcb05"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
            ctx.fillText(this.currentMoveName.toUpperCase(), this.x, this.y-45);
        }
    }
}

// ── UI HELPERS ──
function addToLog(msg) {
    const e = document.createElement('div');
    e.className = "log-entry"; e.innerHTML = msg;
    logContent.appendChild(e);
    logContent.scrollTop = logContent.scrollHeight;
}

function updateSidebarProfile() {
    if (!playerChoice) return;
    playerChoice.hp <= 0 ? faintedOverlay.classList.remove('hidden') : faintedOverlay.classList.add('hidden');
    if (playerChoice.target && playerChoice.target.hp > 0) {
        targetPkmnSprite.src = playerChoice.target.img.src; targetPkmnSprite.style.opacity = '1';
    } else {
        const e = fighters.find(f => f !== playerChoice && f.hp > 0);
        if (e) { targetPkmnSprite.src = e.img.src; targetPkmnSprite.style.opacity = '1'; }
        else targetPkmnSprite.style.opacity = '0.3';
    }
}

function updateUI() {
    if (!amSpectator) updateSidebarProfile();
    hpList.innerHTML = fighters.map(f => `
        <div class="hp-card" style="border-color:${playerChoice===f?'#ffcb05':(f.hp<=0?'#555':TYPE_COLORS[f.type]||'#aaa')};opacity:${f.hp<=0?0.4:1}">
            <div class="hp-card-name">
                ${f.name}${playerChoice===f?`<img src="${POKEBALL_URL}" class="owner-icon">`:''}
                <span style="float:right;color:${TYPE_COLORS[f.type]||'#aaa'}">[${f.type}]</span>
            </div>
            <div class="hp-bar-bg"><div class="hp-bar-fill" style="width:${(f.hp/f.maxHp)*100}%;background:${f.hp>50?'#2ecc71':'#e74c3c'}"></div></div>
        </div>`).join('');
}

// ── FIXED-TICK SIMULATION (identical on every client) ──
function simulationTick() {
    if (gameState === "COUNTDOWN") {
        countdownTimer--;
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
                let minDist = Infinity, target = null;
                fighters.forEach(o => {
                    if (o !== f && o.hp > 0) {
                        const d = Math.hypot(o.x - f.x, o.y - f.y);
                        if (d < minDist) { minDist = d; target = o; }
                    }
                });
                f.target = target;
                const r = prng();
                if (r < 0.2) { f.currentMoveCategory = "debuff"; f.currentMoveName = f.moves.debuff; }
                else if (minDist < 110) { f.currentMoveCategory = "short"; f.currentMoveName = f.moves.short; }
                else { f.currentMoveCategory = "long"; f.currentMoveName = f.moves.long; }
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

    // WIN CHECK (same on every client)
    const alive = fighters.filter(f => f.hp > 0);
    if (alive.length === 1 && !["SELECT","COUNTDOWN","LOADING","SPECTATE"].includes(gameState)) {
        const wp = alive[0];
        const displayName = wp.name;
        const isMyWin = playerChoice && playerChoice === wp;
        if (isMyWin) socket.emit('reportWin', { winner: myName });

        statusBanner.innerText = wp.name.toUpperCase() + " WINS!";
        statusBanner.className = '';
        gameState = "WIN";
        if (simulationInterval) clearInterval(simulationInterval);
        setTimeout(() => showPostGame(displayName), 1500);
    }
}

// ── RENDER LOOP (drawing only) ──
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
    } else if (gameState === "COUNTDOWN") {
        statusBanner.innerText = "STARTING IN: " + Math.ceil(countdownTimer / 60);
    } else if (gameState === "MOVE") {
        statusBanner.innerText = "BATTLE PHASE";
    } else if (gameState === "DECIDE") {
        statusBanner.innerText = "EXECUTION";
    }

    fighters.forEach(f => f.draw());
    updateUI();
    requestAnimationFrame(loop);
}

// ── SELECTION UI ──
function initSelection() {
    updateReadyCounter(0, totalPlayers);
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
    if (isFirstChoice) socket.emit('playerReady');
}

// ── SELECTION AUTO-READY ──
setInterval(() => {
    if (gameState === "SELECT" && !amSpectator) {
        selectionTimeLeft--;
        if (timerDisplay) timerDisplay.innerText = selectionTimeLeft;
        if (selectionTimeLeft <= 0 && !playerChoice) {
            playerChoice = fighters[0];
            playerProfile.classList.remove('hidden');
            chosenPkmnSprite.src = playerChoice.img.src;
            socket.emit('playerReady');
        }
    }
}, 1000);

function startBattle() {
    console.warn("startBattle() is no longer used — battle starts automatically when everyone is ready");
}

// ── START ──
loop();

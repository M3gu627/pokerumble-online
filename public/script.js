const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
const hpList = document.getElementById('hp-list');
const logContent = document.getElementById('log-content');
const statusBanner = document.getElementById('status-banner');
const pokemonGrid = document.getElementById('pokemon-grid');
const selectionOverlay = document.getElementById('selection-overlay');
const startBtn = document.getElementById('start-battle-btn');
const timerDisplay = document.getElementById('timer-display');
const socket = io();

const playerProfile = document.getElementById('player-profile');
const chosenPkmnSprite = document.getElementById('chosen-pkmn-sprite');
const targetPkmnSprite = document.getElementById('target-pkmn-sprite');
const faintedOverlay = document.getElementById('fainted-overlay');

// Post-game elements
const postgameOverlay  = document.getElementById('postgame-overlay');
const winnerBanner     = document.getElementById('winner-banner');
const voteListEl       = document.getElementById('vote-list');
const winsListEl       = document.getElementById('wins-list');
const playVoteCount    = document.getElementById('play-vote-count');
const totalPlayerCount = document.getElementById('total-player-count');
const pgTimerEl        = document.getElementById('pg-timer');
const btnPlayAgain     = document.getElementById('btn-play-again');
const btnQuit          = document.getElementById('btn-quit');

// Spectator elements
const spectatorBanner     = document.getElementById('spectator-banner');
const spectatorChip       = document.getElementById('spectator-chip');
const spectatorChipCount  = document.getElementById('spectator-chip-count');
const spectatorVoteNote   = document.getElementById('spectator-vote-note');
const ingameActivity      = document.getElementById('ingame-activity');

// Ready counter elements
const readyFraction = document.getElementById('ready-fraction');
const readyLabel    = document.getElementById('ready-label');
const readyPips     = document.getElementById('ready-pips');

let gameState = "LOADING";
let selectionTimeLeft = 60;
let playerChoice = null;
let fighters = [];
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

const POKEBALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

const TYPE_COLORS = {
    "Fire":"#ff4422","Water":"#3399ff","Grass":"#77cc55","Electric":"#ffcc33",
    "Rock":"#bbaa66","Ghost":"#6666bb","Fighting":"#bb5544","Flying":"#8899ff",
    "Psychic":"#ff5599","Ground":"#ddbb55","Bug":"#aabb22","Fairy":"#ee99ee",
    "Dragon":"#7766ee","Dark":"#775544","Steel":"#aaaabb","Ice":"#66ccff",
    "Poison":"#aa5599","Normal":"#aaaa99"
};

// ── UI HELPERS ──
function formatName(n) { return n.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }

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

function setSpectatorMode(isSpec) {
    amSpectator = isSpec;
    if (isSpec) {
        spectatorBanner.style.display = 'block';
        document.body.classList.add('is-spectator');
        selectionOverlay.style.display = 'none';
        statusBanner.innerText = 'SPECTATING...';
    }
}

function updateSpectatorCount(count) {
    spectatorChipCount.textContent = count;
    spectatorChip.style.display = count > 0 ? 'block' : 'none';
}

function addToLog(msg) {
    const e=document.createElement('div');
    e.className="log-entry"; e.innerHTML=msg;
    logContent.appendChild(e);
    logContent.scrollTop=logContent.scrollHeight;
}

function showIngameToast(name, action) {
    const toast = document.createElement('div');
    toast.className = `ig-toast ${action}`;
    toast.textContent = `${name} ${action}`;
    ingameActivity.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) ingameActivity.removeChild(toast); }, 3000);
}

// ── POKEMON CLASS (RENDERER ONLY) ──
class Pokemon {
    constructor(data) {
        this.name = data.name;
        this.id = data.id;
        this.type = data.type;
        this.hp = data.hp;
        this.maxHp = data.maxHp;
        this.x = data.x;
        this.y = data.y;
        this.img = new Image();
        this.img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`;
        this.currentMoveName = "";
        this.target = null;
    }
    draw() {
        if (this.hp <= 0) return;
        if (gameState === "DECIDE" && this.target) {
            ctx.beginPath(); ctx.setLineDash([5,5]);
            ctx.moveTo(this.x, this.y); ctx.lineTo(this.target.x, this.target.y);
            ctx.strokeStyle="rgba(255,255,255,0.3)"; ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.drawImage(this.img, this.x - 30, this.y - 30, 60, 60);
        if (gameState === "DECIDE" && this.currentMoveName) {
            ctx.fillStyle = "#ffcb05"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
            ctx.fillText(this.currentMoveName.toUpperCase(), this.x, this.y - 45);
        }
    }
}

// ── SOCKET EVENTS (THE NEW SOURCE OF TRUTH) ──

socket.on('initSelection', (pool) => {
    gameState = "SELECT";
    selectionOverlay.style.display = 'flex';
    statusBanner.innerText = "CHOOSE YOUR POKEMON";
    
    // Convert server data to local Pokemon objects
    fighters = pool.map(p => new Pokemon(p));

    pokemonGrid.innerHTML = '';
    fighters.forEach((f, index) => {
        const card = document.createElement('div');
        card.className = 'select-card';
        card.innerHTML = `
            <img src="${f.img.src}">
            <div style="color:${TYPE_COLORS[f.type]||'#aaa'}">${f.name}</div>
            <div style="font-size:0.65rem;color:${TYPE_COLORS[f.type]||'#aaa'};margin-top:2px;">[${f.type}]</div>`;
        card.onclick = () => selectPokemon(index, card);
        pokemonGrid.appendChild(card);
    });
});

socket.on('battleUpdate', (data) => {
    gameState = data.mode;
    // Sync all fighters with server positions/HP
    data.fighters.forEach((srvFighter, i) => {
        if (fighters[i]) {
            fighters[i].x = srvFighter.x;
            fighters[i].y = srvFighter.y;
            fighters[i].hp = srvFighter.hp;
            fighters[i].currentMoveName = srvFighter.currentMoveName;
            if (srvFighter.targetIdx !== null) fighters[i].target = fighters[srvFighter.targetIdx];
        }
    });

    if (gameState === "MOVE") statusBanner.innerText = "BATTLE PHASE";
    if (gameState === "DECIDE") statusBanner.innerText = "EXECUTION";
    
    renderFrame();
});

socket.on('battleLog', (msg) => addToLog(msg));

socket.on('gameOver', (winnerData) => {
    gameState = "WIN";
    showPostGame(winnerData ? winnerData.owner : null, winnerData ? winnerData.name : null);
});

// ── REMAINING UI LOGIC (UNCHANGED) ──

function selectPokemon(index, element) {
    if (amSpectator) return;
    playerChoice = fighters[index];
    document.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    startBtn.classList.remove('hidden');
    playerProfile.classList.remove('hidden');
    chosenPkmnSprite.src = playerChoice.img.src;
    addToLog(`<b style="color:#ffcb05">Locked in ${playerChoice.name}!</b>`);
    socket.emit('playerReady', index);
}

function renderFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fighters.forEach(f => f.draw());
    updateUI();
}

function updateUI() {
    if (playerChoice) {
        playerChoice.hp <= 0 ? faintedOverlay.classList.remove('hidden') : faintedOverlay.classList.add('hidden');
        if (playerChoice.target && playerChoice.target.hp > 0) {
            targetPkmnSprite.src = playerChoice.target.img.src;
            targetPkmnSprite.style.opacity = '1';
        }
    }
    hpList.innerHTML = fighters.map(f => `
        <div class="hp-card" style="border-color:${playerChoice === f ? '#ffcb05' : (f.hp <= 0 ? '#555' : TYPE_COLORS[f.type] || '#aaa')};opacity:${f.hp <= 0 ? 0.4 : 1}">
            <div class="hp-card-name">
                ${f.name}${playerChoice === f ? `<img src="${POKEBALL_URL}" class="owner-icon">` : ''}
                <span style="float:right;color:${TYPE_COLORS[f.type] || '#aaa'}">[${f.type}]</span>
            </div>
            <div class="hp-bar-bg"><div class="hp-bar-fill" style="width:${(f.hp / f.maxHp) * 100}%;background:${f.hp > 50 ? '#2ecc71' : '#e74c3c'}"></div></div>
        </div>`).join('');
}

// ── Post Game Logic (Keep as is) ──
function showPostGame(winCreditName, displayName) {
    if (pgInterval) clearInterval(pgInterval);
    winnerBanner.textContent = displayName ? `🏆 ${displayName.toUpperCase()} WINS!` : '🤝 DRAW!';
    postgameOverlay.classList.add('show');
    pgInterval = setInterval(() => {
        pgCountdown--;
        pgTimerEl.textContent = pgCountdown;
        if (pgCountdown <= 0) clearInterval(pgInterval);
    }, 1000);
}

function votePlayAgain() {
    myVote = 'play';
    btnPlayAgain.disabled = true;
    socket.emit('playerVote', { name: myName, vote: 'play' });
}

socket.on('restartGame', () => {
    postgameOverlay.classList.remove('show');
    logContent.innerHTML = '';
    playerProfile.classList.add('hidden');
    selectionOverlay.style.display = 'flex';
    playerChoice = null;
});

// Initialization
socket.on('connect', () => { console.log("Connected to Server Engine"); });

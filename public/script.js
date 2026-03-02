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

let gameState = "LOADING";
let selectionTimeLeft = 60;
let countdownTimer = 180;
let phaseTimer = 0;
let playerChoice = null;
let fighters = [];
let allPokemonPool = [];

// Post-game state
let myVote = null;
let pgCountdown = 15;
let pgInterval = null;
let lobbyWins = {};
let playerVotes = {};
let totalPlayers = 1;
let myName = 'Player'; // default so it always has a value

const POKEBALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

const TYPE_COLORS = {
    "Fire": "#ff4422", "Water": "#3399ff", "Grass": "#77cc55", "Electric": "#ffcc33",
    "Rock": "#bbaa66", "Ghost": "#6666bb", "Fighting": "#bb5544", "Flying": "#8899ff",
    "Psychic": "#ff5599", "Ground": "#ddbb55", "Bug": "#aabb22", "Fairy": "#ee99ee",
    "Dragon": "#7766ee", "Dark": "#775544", "Steel": "#aaaabb", "Ice": "#66ccff",
    "Poison": "#aa5599", "Normal": "#aaaa99"
};

const TYPE_CHART = {
    "Normal":   { "Rock": 0.5, "Ghost": 0, "Steel": 0.5 },
    "Fire":     { "Fire": 0.5, "Water": 0.5, "Grass": 2, "Ice": 2, "Bug": 2, "Rock": 0.5, "Dragon": 0.5, "Steel": 2 },
    "Water":    { "Fire": 2, "Water": 0.5, "Grass": 0.5, "Ground": 2, "Rock": 2, "Dragon": 0.5 },
    "Electric": { "Water": 2, "Electric": 0.5, "Grass": 0.5, "Ground": 0, "Flying": 2, "Dragon": 0.5 },
    "Grass":    { "Fire": 0.5, "Water": 2, "Grass": 0.5, "Poison": 0.5, "Ground": 2, "Flying": 0.5, "Bug": 0.5, "Rock": 2, "Dragon": 0.5, "Steel": 0.5 },
    "Ice":      { "Fire": 0.5, "Water": 0.5, "Grass": 2, "Ice": 0.5, "Ground": 2, "Flying": 2, "Dragon": 2, "Steel": 0.5 },
    "Fighting": { "Normal": 2, "Ice": 2, "Poison": 0.5, "Flying": 0.5, "Psychic": 0.5, "Bug": 0.5, "Rock": 2, "Ghost": 0, "Dark": 2, "Steel": 2, "Fairy": 0.5 },
    "Poison":   { "Grass": 2, "Poison": 0.5, "Ground": 0.5, "Rock": 0.5, "Ghost": 0.5, "Steel": 0, "Fairy": 2 },
    "Ground":   { "Fire": 2, "Electric": 2, "Grass": 0.5, "Poison": 2, "Flying": 0, "Bug": 0.5, "Rock": 2, "Steel": 2 },
    "Flying":   { "Electric": 0.5, "Grass": 2, "Fighting": 2, "Bug": 2, "Rock": 0.5, "Steel": 0.5 },
    "Psychic":  { "Fighting": 2, "Poison": 2, "Psychic": 0.5, "Dark": 0, "Steel": 0.5 },
    "Bug":      { "Fire": 0.5, "Grass": 2, "Fighting": 0.5, "Poison": 0.5, "Flying": 0.5, "Psychic": 2, "Ghost": 0.5, "Dark": 2, "Steel": 0.5, "Fairy": 0.5 },
    "Rock":     { "Fire": 2, "Ice": 2, "Fighting": 0.5, "Ground": 0.5, "Flying": 2, "Bug": 2, "Steel": 0.5 },
    "Ghost":    { "Normal": 0, "Psychic": 2, "Ghost": 2, "Dark": 0.5 },
    "Dragon":   { "Dragon": 2, "Steel": 0.5, "Fairy": 0 },
    "Dark":     { "Fighting": 0.5, "Psychic": 2, "Ghost": 2, "Dark": 0.5, "Fairy": 0.5 },
    "Steel":    { "Fire": 0.5, "Water": 0.5, "Electric": 0.5, "Ice": 2, "Rock": 2, "Steel": 0.5, "Fairy": 2 },
    "Fairy":    { "Fire": 0.5, "Fighting": 2, "Poison": 0.5, "Dragon": 2, "Dark": 2, "Steel": 0.5 }
};

const TYPE_MOVES = {
    "Fire":     { debuff: "Smokescreen",  short: "Ember",         long: "Flamethrower" },
    "Water":    { debuff: "Tail Whip",    short: "Water Gun",     long: "Hydro Pump" },
    "Grass":    { debuff: "Stun Spore",   short: "Vine Whip",     long: "Solar Beam" },
    "Electric": { debuff: "Thunder Wave", short: "Quick Attack",  long: "Thunderbolt" },
    "Rock":     { debuff: "Defense Curl", short: "Rock Throw",    long: "Rock Slide" },
    "Ghost":    { debuff: "Confuse Ray",  short: "Lick",          long: "Shadow Ball" },
    "Fighting": { debuff: "Focus Energy", short: "Karate Chop",   long: "Low Kick" },
    "Flying":   { debuff: "Sand Attack",  short: "Wing Attack",   long: "Hurricane" },
    "Psychic":  { debuff: "Teleport",     short: "Psybeam",       long: "Psychic" },
    "Ground":   { debuff: "Sand Attack",  short: "Slash",         long: "Earthquake" },
    "Bug":      { debuff: "String Shot",  short: "Tackle",        long: "Bug Buzz" },
    "Fairy":    { debuff: "Charm",        short: "Pound",         long: "Moonblast" },
    "Dragon":   { debuff: "Leer",         short: "Dragon Breath", long: "Dragon Pulse" },
    "Dark":     { debuff: "Howl",         short: "Bite",          long: "Crunch" },
    "Steel":    { debuff: "Metal Sound",  short: "Metal Claw",    long: "Flash Cannon" },
    "Ice":      { debuff: "Haze",         short: "Powder Snow",   long: "Blizzard" },
    "Poison":   { debuff: "Glare",        short: "Poison Sting",  long: "Sludge Bomb" },
    "Normal":   { debuff: "Screech",      short: "Tackle",        long: "Hyper Beam" }
};

function formatName(name) {
    return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function normalizeType(apiType) {
    return apiType.charAt(0).toUpperCase() + apiType.slice(1).toLowerCase();
}

// ── Socket events ──
socket.on('gameInfo', (data) => {
    if (data.name) myName = data.name;
    if (data.totalPlayers) totalPlayers = data.totalPlayers;
    if (data.wins) lobbyWins = data.wins;
});

socket.on('playerVoteUpdate', (votes) => {
    playerVotes = votes;
    renderVotes();
});

socket.on('winsUpdate', (wins) => {
    lobbyWins = wins;
    renderWins();
});

socket.on('restartGame', () => {
    resetForNewGame();
});

socket.on('allQuit', () => {
    window.location.href = '/';
});

// ── Post-game ──
function showPostGame(winnerName) {
    // Stop any existing interval first
    if (pgInterval) {
        clearInterval(pgInterval);
        pgInterval = null;
    }

    winnerBanner.textContent = winnerName
        ? `🏆 ${winnerName.toUpperCase()} WINS!`
        : '🤝 DRAW!';

    // Notify server about the win
    socket.emit('reportWin', { winner: winnerName });

    // Reset all vote UI state cleanly
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

    // Show the overlay
    postgameOverlay.classList.add('show');

    // Start fresh countdown
    pgInterval = setInterval(() => {
        pgCountdown--;
        pgTimerEl.textContent = pgCountdown;

        if (pgCountdown <= 0) {
            clearInterval(pgInterval);
            pgInterval = null;
            // Auto vote play if not voted yet
            if (!myVote) {
                myVote = 'play';
                btnPlayAgain.disabled = true;
                btnQuit.disabled = true;
                socket.emit('playerVote', { name: myName, vote: 'play' });
                // If solo (no server handling), just restart locally
                if (totalPlayers <= 1) {
                    setTimeout(() => resetForNewGame(), 500);
                }
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

    // Solo fallback: if no multiplayer room, restart immediately
    if (totalPlayers <= 1) {
        if (pgInterval) { clearInterval(pgInterval); pgInterval = null; }
        setTimeout(() => resetForNewGame(), 500);
    }
}

function voteQuit() {
    if (myVote) return;
    myVote = 'quit';
    btnPlayAgain.disabled = true;
    btnQuit.disabled = true;
    socket.emit('playerVote', { name: myName, vote: 'quit' });

    // Solo fallback
    if (totalPlayers <= 1) {
        if (pgInterval) { clearInterval(pgInterval); pgInterval = null; }
        setTimeout(() => { window.location.href = '/'; }, 500);
    }
}

function renderVotes() {
    const entries = Object.entries(playerVotes);
    const playCount = entries.filter(([, v]) => v === 'play').length;
    playVoteCount.textContent = playCount;

    voteListEl.innerHTML = entries.length === 0
        ? '<div style="color:#555; font-size:0.42rem; padding:8px;">Waiting for votes...</div>'
        : entries.map(([name, vote]) => `
            <div class="vote-row">
                <span class="vote-name">${name}</span>
                <span class="badge ${vote === 'play' ? 'badge-play' : 'badge-quit'}">
                    ${vote === 'play' ? '▶ PLAY' : '✖ QUIT'}
                </span>
            </div>
        `).join('');
}

function renderWins() {
    const sorted = Object.entries(lobbyWins).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        winsListEl.innerHTML = '<div style="color:#555; font-size:0.42rem; padding:8px;">No wins yet</div>';
        return;
    }
    winsListEl.innerHTML = sorted.map(([name, wins], i) => `
        <div class="wins-row ${i === 0 ? 'top' : ''}">
            <span class="wins-rank">${i === 0 ? '👑' : `#${i + 1}`}</span>
            <span class="wins-name">${name}</span>
            <span class="wins-count">${wins}W</span>
        </div>
    `).join('');
}

function resetForNewGame() {
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
    startBtn.classList.add('hidden');
    selectionOverlay.style.display = 'flex';
    statusBanner.className = '';
    statusBanner.innerText = 'LOADING POKÉDEX...';
    fetchAllPokemon();
}

// ── Core game ──
async function fetchAllPokemon() {
    statusBanner.innerText = "LOADING POKÉDEX...";
    try {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0");
        const data = await res.json();
        allPokemonPool = data.results.map((p, i) => ({ name: formatName(p.name), id: i + 1 }));
        gameState = "SELECT";
        initSelection();
        loop();
    } catch (err) {
        statusBanner.innerText = "FAILED TO LOAD — CHECK CONNECTION";
        console.error(err);
    }
}

async function fetchPokemonType(id) {
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        const data = await res.json();
        return normalizeType(data.types[0].type.name);
    } catch { return "Normal"; }
}

class Pokemon {
    constructor(name, id, type) {
        this.name = name; this.type = type;
        this.atk = 80; this.def = 80;
        this.moves = TYPE_MOVES[type] || TYPE_MOVES["Normal"];
        this.hp = 150; this.maxHp = 150;
        this.img = new Image();
        this.img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
        this.x = Math.random() * (canvas.width - 100) + 50;
        this.y = Math.random() * (canvas.height - 100) + 50;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.target = null;
        this.currentMoveName = ""; this.currentMoveCategory = "";
    }
    draw() {
        if (this.hp <= 0) return;
        if (gameState === "DECIDE" && this.target) {
            ctx.beginPath(); ctx.setLineDash([5, 5]);
            ctx.moveTo(this.x, this.y); ctx.lineTo(this.target.x, this.target.y);
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.drawImage(this.img, this.x - 30, this.y - 30, 60, 60);
        if (gameState === "DECIDE") {
            ctx.fillStyle = "#ffcb05"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
            ctx.fillText(this.currentMoveName.toUpperCase(), this.x, this.y - 45);
        }
    }
}

function addToLog(msg) {
    const entry = document.createElement('div');
    entry.className = "log-entry"; entry.innerHTML = msg;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
}

function updateSidebarProfile() {
    if (!playerChoice) return;
    playerChoice.hp <= 0
        ? faintedOverlay.classList.remove('hidden')
        : faintedOverlay.classList.add('hidden');
    if (playerChoice.target && playerChoice.target.hp > 0) {
        targetPkmnSprite.src = playerChoice.target.img.src;
        targetPkmnSprite.style.opacity = '1';
    } else {
        const aliveEnemy = fighters.find(f => f !== playerChoice && f.hp > 0);
        if (aliveEnemy) { targetPkmnSprite.src = aliveEnemy.img.src; targetPkmnSprite.style.opacity = '1'; }
        else targetPkmnSprite.style.opacity = '0.3';
    }
}

function updateUI() {
    updateSidebarProfile();
    hpList.innerHTML = fighters.map(f => `
        <div class="hp-card" style="border-color:${playerChoice===f?'#ffcb05':(f.hp<=0?'#555':TYPE_COLORS[f.type]||'#aaa')};opacity:${f.hp<=0?0.4:1}">
            <div class="hp-card-name">
                ${f.name}${playerChoice===f?`<img src="${POKEBALL_URL}" class="owner-icon">`:''}
                <span style="float:right;color:${TYPE_COLORS[f.type]||'#aaa'}">[${f.type}]</span>
            </div>
            <div class="hp-bar-bg"><div class="hp-bar-fill" style="width:${(f.hp/f.maxHp)*100}%;background:${f.hp>50?'#2ecc71':'#e74c3c'}"></div></div>
        </div>
    `).join('');
}

function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === "LOADING") {
        statusBanner.innerText = "LOADING POKÉDEX...";
    } else if (gameState === "SELECT") {
        statusBanner.innerText = `CHOOSE YOUR POKEMON: ${selectionTimeLeft}s`;
        statusBanner.className = "selecting";
    } else if (gameState === "COUNTDOWN") {
        countdownTimer--;
        statusBanner.innerText = "STARTING IN: " + Math.ceil(countdownTimer / 60);
        if (countdownTimer <= 0) { gameState = "MOVE"; phaseTimer = 300; }
    } else if (gameState === "MOVE") {
        statusBanner.innerText = "BATTLE PHASE"; phaseTimer--;
        fighters.forEach(f => {
            if (f.hp <= 0) return;
            f.x += f.vx; f.y += f.vy;
            if (f.x < 30 || f.x > canvas.width - 30) f.vx *= -1;
            if (f.y < 30 || f.y > canvas.height - 30) f.vy *= -1;
        });
        if (phaseTimer <= 0) {
            gameState = "DECIDE"; phaseTimer = 120;
            fighters.forEach(f => {
                if (f.hp <= 0) return;
                let minDist = Infinity;
                fighters.forEach(o => {
                    if (o !== f && o.hp > 0) {
                        let d = Math.hypot(o.x - f.x, o.y - f.y);
                        if (d < minDist) { minDist = d; f.target = o; }
                    }
                });
                const r = Math.random();
                if (r < 0.2) { f.currentMoveCategory = "debuff"; f.currentMoveName = f.moves.debuff; }
                else if (minDist < 110) { f.currentMoveCategory = "short"; f.currentMoveName = f.moves.short; }
                else { f.currentMoveCategory = "long"; f.currentMoveName = f.moves.long; }
            });
        }
    } else if (gameState === "DECIDE") {
        statusBanner.innerText = "EXECUTION"; phaseTimer--;
        if (phaseTimer <= 0) {
            fighters.forEach(f => {
                if (f.hp <= 0 || !f.target || f.target.hp <= 0) return;
                if (f.currentMoveCategory === "debuff") {
                    addToLog(`<span style="color:#aaa">${f.name} used <b style="color:#a29bfe">${f.currentMoveName}</b> on ${f.target.name}! <i style="color:#888">(-DEF)</i></span>`);
                    f.target.def = Math.max(1, Math.floor(f.target.def * 0.85));
                    return;
                }
                let typeMult = TYPE_CHART[f.type]?.[f.target.type] ?? 1.0;
                let isCrit = Math.random() < 0.1;
                let dmg = Math.floor((30 * f.atk / f.target.def) * typeMult * (isCrit ? 1.5 : 1.0));
                let effectLabel = typeMult >= 2
                    ? `<span style="color:#f39c12"> ⚡ Super effective!</span>`
                    : typeMult === 0 ? `<span style="color:#888"> It had no effect...</span>`
                    : typeMult < 1 ? `<span style="color:#7f8c8d"> Not very effective...</span>` : "";
                let critLabel = isCrit ? `<span style="color:#e74c3c"> ★ CRITICAL HIT!</span>` : "";
                let moveColor = f.currentMoveCategory === "long" ? "#fd79a8" : "#74b9ff";
                f.target.hp = Math.max(0, f.target.hp - dmg);
                addToLog(`<span style="color:#dfe6e9">${f.name} used <b style="color:${moveColor}">${f.currentMoveName}</b> → <b>${dmg} dmg</b> to ${f.target.name}!${effectLabel}${critLabel}</span>`);
                if (f.target.hp <= 0) addToLog(`<span style="color:#e74c3c;font-size:1rem">💀 <b>${f.target.name} fainted!</b></span>`);
            });
            gameState = "MOVE"; phaseTimer = 300;
        }
    }

    fighters.forEach(f => f.draw());
    updateUI();

    const alive = fighters.filter(f => f.hp > 0);
    if (alive.length === 1 && !["SELECT", "COUNTDOWN", "LOADING"].includes(gameState)) {
        const winnerPokemon = alive[0];
        // If this client's chosen pokemon won, credit the win to their name
        const winnerName = (playerChoice && playerChoice === winnerPokemon)
            ? myName
            : winnerPokemon.name;
        statusBanner.innerText = winnerPokemon.name.toUpperCase() + " WINS!";
        statusBanner.className = '';
        gameState = "WIN";
        setTimeout(() => showPostGame(winnerName), 1500);
        return;
    }

    requestAnimationFrame(loop);
}

async function initSelection() {
    const shuffled = [...allPokemonPool].sort(() => Math.random() - 0.5).slice(0, 10);
    pokemonGrid.innerHTML = shuffled.map(p => `
        <div class="select-card" id="card-${p.id}" style="opacity:0.5;pointer-events:none;">
            <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png">
            <div style="color:#aaa">${p.name}</div>
            <div style="font-size:0.65rem;color:#555;margin-top:2px;">Loading...</div>
        </div>
    `).join('');
    const types = await Promise.all(shuffled.map(p => fetchPokemonType(p.id)));
    fighters = shuffled.map((p, i) => new Pokemon(p.name, p.id, types[i]));
    pokemonGrid.innerHTML = '';
    fighters.forEach(f => {
        const card = document.createElement('div');
        card.className = 'select-card';
        card.innerHTML = `
            <img src="${f.img.src}">
            <div style="color:${TYPE_COLORS[f.type] || '#aaa'}">${f.name}</div>
            <div style="font-size:0.65rem;color:${TYPE_COLORS[f.type] || '#aaa'};margin-top:2px;">[${f.type}]</div>
        `;
        card.onclick = () => selectPokemon(f, card);
        pokemonGrid.appendChild(card);
    });
}

function selectPokemon(pokemon, element) {
    playerChoice = pokemon;
    document.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    startBtn.classList.remove('hidden');
    playerProfile.classList.remove('hidden');
    chosenPkmnSprite.src = pokemon.img.src;
    addToLog(`<b style="color:#ffcb05">Locked in ${pokemon.name}!</b>`);
}

function startBattle() {
    if (!playerChoice) return;
    selectionTimeLeft = 0;
    selectionOverlay.style.display = 'none';
    countdownTimer = 180;
    gameState = "COUNTDOWN";
}

setInterval(() => {
    if (gameState === "SELECT") {
        selectionTimeLeft--;
        if (timerDisplay) timerDisplay.innerText = selectionTimeLeft;
        if (selectionTimeLeft <= 0) {
            if (!playerChoice) {
                playerChoice = fighters[0];
                playerProfile.classList.remove('hidden');
                chosenPkmnSprite.src = playerChoice.img.src;
            }
            startBattle();
        }
    }
}, 1000);

fetchAllPokemon();

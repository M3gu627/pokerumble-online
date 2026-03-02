const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Index.html'));
});

const rooms = {};

// Game Constants
const TICK_RATE = 1000 / 60; 
const PHASE_MOVE_DURATION = 300;
const PHASE_DECIDE_DURATION = 120;

const TYPE_CHART = {
    "Normal": {"Rock":0.5,"Ghost":0,"Steel":0.5},
    "Fire": {"Fire":0.5,"Water":0.5,"Grass":2,"Ice":2,"Bug":2,"Rock":0.5,"Dragon":0.5,"Steel":2},
    "Water": {"Fire":2,"Water":0.5,"Grass":0.5,"Ground":2,"Rock":2,"Dragon":0.5},
    "Electric":{"Water":2,"Electric":0.5,"Grass":0.5,"Ground":0,"Flying":2,"Dragon":0.5},
    "Grass": {"Fire":0.5,"Water":2,"Grass":0.5,"Poison":0.5,"Ground":2,"Flying":0.5,"Bug":0.5,"Rock":2,"Dragon":0.5,"Steel":0.5},
    "Ice": {"Fire":0.5,"Water":0.5,"Grass":2,"Ice":0.5,"Ground":2,"Flying":2,"Dragon":2,"Steel":0.5},
    "Fighting":{"Normal":2,"Ice":2,"Poison":0.5,"Flying":0.5,"Psychic":0.5,"Bug":0.5,"Rock":2,"Ghost":0,"Dark":2,"Steel":2,"Fairy":0.5},
    "Poison": {"Grass":2,"Poison":0.5,"Ground":0.5,"Rock":0.5,"Ghost":0.5,"Steel":0,"Fairy":2},
    "Ground": {"Fire":2,"Electric":2,"Grass":0.5,"Poison":2,"Flying":0,"Bug":0.5,"Rock":2,"Steel":2},
    "Flying": {"Electric":0.5,"Grass":2,"Fighting":2,"Bug":2,"Rock":0.5,"Steel":0.5},
    "Psychic": {"Fighting":2,"Poison":2,"Psychic":0.5,"Dark":0,"Steel":0.5},
    "Bug": {"Fire":0.5,"Grass":2,"Fighting":0.5,"Poison":0.5,"Flying":0.5,"Psychic":2,"Ghost":0.5,"Dark":2,"Steel":0.5,"Fairy":0.5},
    "Rock": {"Fire":2,"Ice":2,"Fighting":0.5,"Ground":0.5,"Flying":2,"Bug":2,"Steel":0.5},
    "Ghost": {"Normal":0,"Psychic":2,"Ghost":2,"Dark":0.5},
    "Dragon": {"Dragon":2,"Steel":0.5,"Fairy":0},
    "Dark": {"Fighting":0.5,"Psychic":2,"Ghost":2,"Dark":0.5,"Fairy":0.5},
    "Steel": {"Fire":0.5,"Water":0.5,"Electric":0.5,"Ice":2,"Rock":2,"Steel":0.5,"Fairy":2},
    "Fairy": {"Fire":0.5,"Fighting":2,"Poison":0.5,"Dragon":2,"Dark":2,"Steel":0.5}
};

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getPlayerList(room) {
    return room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.host,
        isSpectator: p.isSpectator || false
    }));
}

async function getPokemonType(id) {
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        const data = await res.json();
        const type = data.types[0].type.name;
        return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    } catch { return "Normal"; }
}

io.on('connection', (socket) => {
    socket.on('createRoom', (name) => {
        let code = generateCode();
        while (rooms[code]) code = generateCode();

        rooms[code] = {
            host: socket.id,
            players: [{ id: socket.id, name: name || 'Player', isSpectator: false }],
            fighters: [],
            votes: {},
            wins: {},
            gameInProgress: false,
            readyPlayers: new Set(),
            battleInterval: null
        };

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name || 'Player';
        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', getPlayerList(rooms[code]));
    });

    socket.on('joinRoom', ({ code, name }) => {
        const room = rooms[code];
        if (!room) { socket.emit('errorMessage', 'Room not found.'); return; }

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name || 'Player';

        if (room.gameInProgress) {
            socket.isSpectator = true;
            room.players.push({ id: socket.id, name: socket.playerName, isSpectator: true });
            socket.emit('roomJoined', code);
            socket.emit('joinedAsSpectator');
            io.to(code).emit('updatePlayers', getPlayerList(room));
        } else {
            socket.isSpectator = false;
            room.players.push({ id: socket.id, name: socket.playerName, isSpectator: false });
            socket.emit('roomJoined', code);
            io.to(code).emit('updatePlayers', getPlayerList(room));
        }
    });

    socket.on('hostStart', async (code) => {
        const room = rooms[code];
        if (!room || room.host !== socket.id) return;

        room.gameInProgress = true;
        room.readyPlayers = new Set();
        
        // Generate global pool
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1025");
        const data = await res.json();
        const shuffled = data.results.sort(() => 0.5 - Math.random()).slice(0, 10);
        
        const pool = await Promise.all(shuffled.map(async (p) => {
            const id = p.url.split('/').filter(Boolean).pop();
            const type = await getPokemonType(id);
            return {
                id,
                name: p.name.charAt(0).toUpperCase() + p.name.slice(1),
                type,
                hp: 150, maxHp: 150, atk: 80, def: 80,
                x: Math.random() * 700 + 50,
                y: Math.random() * 300 + 50,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                ownerId: null
            };
        }));

        room.fighters = pool;
        io.to(code).emit('initSelection', pool);
    });

    socket.on('playerReady', (pokemonIndex) => {
        const room = rooms[socket.roomCode];
        if (!room || socket.isSpectator) return;

        room.readyPlayers.add(socket.id);
        if (room.fighters[pokemonIndex]) {
            room.fighters[pokemonIndex].ownerId = socket.id;
            room.fighters[pokemonIndex].ownerName = socket.playerName;
        }

        const activeCount = room.players.filter(p => !p.isSpectator).length;
        io.to(socket.roomCode).emit('readyUpdate', { ready: room.readyPlayers.size, total: activeCount });

        if (room.readyPlayers.size >= activeCount) {
            runBattleLoop(socket.roomCode);
        }
    });

    socket.on('playerVote', ({ name, vote }) => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        room.votes[name] = vote;
        io.to(socket.roomCode).emit('playerVoteUpdate', room.votes);
        
        const activeCount = room.players.filter(p => !p.isSpectator).length;
        if (Object.keys(room.votes).length >= activeCount) {
            const playVotes = Object.values(room.votes).filter(v => v === 'play').length;
            if (playVotes >= activeCount / 2) {
                room.gameInProgress = false;
                room.votes = {};
                io.to(socket.roomCode).emit('restartGame');
            } else {
                io.to(socket.roomCode).emit('allQuit');
                delete rooms[socket.roomCode];
            }
        }
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomCode];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                clearInterval(room.battleInterval);
                delete rooms[socket.roomCode];
            } else {
                if (room.host === socket.id) room.host = room.players[0].id;
                io.to(socket.roomCode).emit('updatePlayers', getPlayerList(room));
            }
        }
    });
});

function runBattleLoop(code) {
    const room = rooms[code];
    let timer = PHASE_MOVE_DURATION;
    let mode = "MOVE";
    io.to(code).emit('startGame');

    room.battleInterval = setInterval(() => {
        if (!rooms[code]) return clearInterval(room.battleInterval);

        if (mode === "MOVE") {
            room.fighters.forEach(f => {
                if (f.hp <= 0) return;
                f.x += f.vx; f.y += f.vy;
                if (f.x < 30 || f.x > 770) f.vx *= -1;
                if (f.y < 30 || f.y > 370) f.vy *= -1;
            });
            timer--;
            if (timer <= 0) { mode = "DECIDE"; timer = PHASE_DECIDE_DURATION; }
        } else {
            if (timer === PHASE_DECIDE_DURATION) {
                // Battle Logic
                room.fighters.forEach(f => {
                    if (f.hp <= 0) return;
                    let target = null;
                    let minDist = Infinity;
                    room.fighters.forEach(o => {
                        if (o !== f && o.hp > 0) {
                            let d = Math.hypot(o.x - f.x, o.y - f.y);
                            if (d < minDist) { minDist = d; target = o; }
                        }
                    });
                    if (target) {
                        let typeMult = TYPE_CHART[f.type]?.[target.type] ?? 1.0;
                        let dmg = Math.floor((30 * f.atk / target.def) * typeMult);
                        target.hp = Math.max(0, target.hp - dmg);
                        io.to(code).emit('battleLog', `${f.name} dealt ${dmg} to ${target.name}`);
                    }
                });
            }
            timer--;
            if (timer <= 0) { mode = "MOVE"; timer = PHASE_MOVE_DURATION; }
        }

        io.to(code).emit('battleUpdate', { fighters: room.fighters, mode });

        const alive = room.fighters.filter(f => f.hp > 0);
        if (alive.length <= 1) {
            clearInterval(room.battleInterval);
            const winner = alive[0];
            if (winner && winner.ownerName) room.wins[winner.ownerName] = (room.wins[winner.ownerName] || 0) + 1;
            io.to(code).emit('winsUpdate', room.wins);
            io.to(code).emit('gameOver', winner ? { name: winner.name, owner: winner.ownerName } : null);
        }
    }, TICK_RATE);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`PokeRumble Sync running on ${PORT}`));

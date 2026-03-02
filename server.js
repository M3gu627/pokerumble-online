<DOCUMENT filename="server.js">
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Index.html'));
});

const rooms = {};

// ── SHARED POOL GENERATION (moved here for sync) ──
const formatName = (n) => n.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const normalizeType = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

async function fetchPokemonType(id) {
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        const data = await res.json();
        return normalizeType(data.types[0].type.name);
    } catch {
        return "Normal";
    }
}

async function generateSharedPool() {
    try {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0");
        const data = await res.json();
        let pool = data.results.map((p, i) => ({ name: formatName(p.name), id: i + 1 }));
        pool = pool.sort(() => Math.random() - 0.5).slice(0, 10);
        const types = await Promise.all(pool.map(p => fetchPokemonType(p.id)));
        return pool.map((p, i) => ({ ...p, type: types[i] }));
    } catch (err) {
        console.error("Pool generation failed:", err);
        return [];
    }
}

// ── GAME LOGIC (unchanged except pool + battleStart) ──
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createRoom', async (name) => {
        let code = Math.random().toString(36).substring(2, 6).toUpperCase();
        while (rooms[code]) code = Math.random().toString(36).substring(2, 6).toUpperCase();

        const pool = await generateSharedPool();

        rooms[code] = {
            host: socket.id,
            players: [{ id: socket.id, name: name || 'Player', isSpectator: false }],
            votes: {},
            wins: {},
            gameInProgress: false,
            readyPlayers: new Set(),
            pokemonPool: pool
        };

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;
        socket.isSpectator = false;

        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', getPlayerList(rooms[code]));
        io.to(code).emit('sharedPokemonPool', pool);   // ← SYNCED POOL
        console.log(`Room ${code} created by ${name}`);
    });

    socket.on('joinRoom', async ({ code, name }) => {
        const room = rooms[code];
        if (!room) { socket.emit('errorMessage', 'Room not found.'); return; }

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;

        if (room.gameInProgress) {
            socket.isSpectator = true;
            room.players.push({ id: socket.id, name: name || 'Player', isSpectator: true });
            socket.emit('roomJoined', code);
            socket.emit('joinedAsSpectator');
            socket.emit('spectatorGameState', {
                wins: room.wins,
                totalPlayers: room.players.filter(p => !p.isSpectator).length,
                spectatorCount: room.players.filter(p => p.isSpectator).length
            });
            io.to(code).emit('updatePlayers', getPlayerList(room));
            io.to(code).emit('spectatorCount', room.players.filter(p => p.isSpectator).length);
            io.to(code).emit('playerActivity', { name, action: 'spectating' });
            console.log(`${name} joined ${code} as SPECTATOR`);
        } else {
            if (room.players.length >= 10) { socket.emit('errorMessage', 'Room is full (10/10).'); return; }
            socket.isSpectator = false;
            room.players.push({ id: socket.id, name: name || 'Player', isSpectator: false });

            // Give pool to new player (if not already generated)
            if (!room.pokemonPool) {
                room.pokemonPool = await generateSharedPool();
            }
            socket.emit('sharedPokemonPool', room.pokemonPool);

            socket.emit('roomJoined', code);
            io.to(code).emit('updatePlayers', getPlayerList(room));
            io.to(code).emit('playerActivity', { name, action: 'joined' });
            console.log(`${name} joined ${code}`);
        }
    });

    // ── AUTO-START WHEN EVERYONE IS READY (authoritative) ──
    socket.on('playerReady', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code] || socket.isSpectator) return;
        const room = rooms[code];

        room.readyPlayers.add(socket.id);
        const activeCount = room.players.filter(p => !p.isSpectator).length;
        const readyCount = room.readyPlayers.size;

        io.to(code).emit('readyUpdate', { ready: readyCount, total: activeCount });

        // ALL READY → start battle with shared seed
        if (readyCount === activeCount && !room.gameInProgress) {
            const seed = Math.random().toString(36).substring(2, 10);
            room.seed = seed;
            room.gameInProgress = true;

            io.to(code).emit('battleStart', { seed });
            console.log(`Battle started in ${code} (seed: ${seed})`);
        }
    });

    socket.on('reportWin', ({ winner }) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        if (winner) room.wins[winner] = (room.wins[winner] || 0) + 1;
        room.votes = {};
        room.readyPlayers = new Set();
        io.to(code).emit('winsUpdate', room.wins);
        console.log(`Win: ${winner} in room ${code}`);
    });

    socket.on('playerVote', ({ name, vote }) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];

        if (!socket.isSpectator) room.votes[name] = vote;
        io.to(code).emit('playerVoteUpdate', room.votes);

        const activeCount = room.players.filter(p => !p.isSpectator).length;
        const vals = Object.values(room.votes);
        const playVotes = vals.filter(v => v === 'play').length;
        const quitVotes = vals.filter(v => v === 'quit').length;

        if (vals.length >= activeCount) {
            if (playVotes >= quitVotes) {
                room.votes = {};
                room.readyPlayers = new Set();
                room.gameInProgress = false;

                setTimeout(async () => {
                    room.players.forEach(p => { p.isSpectator = false; });

                    // NEW POOL FOR NEXT ROUND
                    const newPool = await generateSharedPool();
                    room.pokemonPool = newPool;

                    io.to(code).emit('sharedPokemonPool', newPool);
                    io.to(code).emit('restartGame');
                }, 1000);
            } else {
                io.to(code).emit('allQuit');
                delete rooms[code];
            }
        }
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;
        const name = socket.playerName;
        if (code && rooms[code]) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);
            room.readyPlayers.delete(socket.id);

            if (room.players.length === 0) {
                delete rooms[code];
                console.log(`Room ${code} deleted`);
            } else {
                if (room.host === socket.id) {
                    const newHost = room.players.find(p => !p.isSpectator) || room.players[0];
                    room.host = newHost.id;
                    io.to(room.host).emit('youAreHost');
                }
                const activeCount = room.players.filter(p => !p.isSpectator).length;
                io.to(code).emit('updatePlayers', getPlayerList(room));
                io.to(code).emit('spectatorCount', room.players.filter(p => p.isSpectator).length);
                io.to(code).emit('readyUpdate', { ready: room.readyPlayers.size, total: activeCount });
                if (name) io.to(code).emit('playerActivity', { name, action: 'left' });
            }
        }
        console.log('Disconnected:', socket.id);
    });
});

function getPlayerList(room) {
    return room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.host,
        isSpectator: p.isSpectator || false
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`PokeRumble running on port ${PORT}`));
</DOCUMENT>

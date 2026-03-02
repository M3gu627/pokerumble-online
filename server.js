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

// ── SHARED POOL GENERATION (unchanged) ──
const formatName = (n) => n.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const normalizeType = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

async function fetchPokemonType(id) {
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        const data = await res.json();
        return normalizeType(data.types[0].type.name);
    } catch { return "Normal"; }
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

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createRoom', async (name) => { /* unchanged - same as last version */ 
        let code = Math.random().toString(36).substring(2, 6).toUpperCase();
        while (rooms[code]) code = Math.random().toString(36).substring(2, 6).toUpperCase();

        const pool = await generateSharedPool();
        rooms[code] = { host: socket.id, players: [{ id: socket.id, name: name || 'Player', isSpectator: false }], votes: {}, wins: {}, gameInProgress: false, readyPlayers: new Set(), pokemonPool: pool };

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;
        socket.isSpectator = false;

        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', getPlayerList(rooms[code]));
        io.to(code).emit('sharedPokemonPool', pool);
        console.log(`Room ${code} created by ${name}`);
    });

    socket.on('joinRoom', async ({ code, name }) => { /* unchanged - same as last */ 
        // ... (exact same as previous version)
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
            socket.emit('spectatorGameState', { wins: room.wins, totalPlayers: room.players.filter(p => !p.isSpectator).length, spectatorCount: room.players.filter(p => p.isSpectator).length });
            io.to(code).emit('updatePlayers', getPlayerList(room));
            io.to(code).emit('spectatorCount', room.players.filter(p => p.isSpectator).length);
            io.to(code).emit('playerActivity', { name, action: 'spectating' });
        } else {
            if (room.players.length >= 10) { socket.emit('errorMessage', 'Room is full (10/10).'); return; }
            socket.isSpectator = false;
            room.players.push({ id: socket.id, name: name || 'Player', isSpectator: false });
            if (!room.pokemonPool) room.pokemonPool = await generateSharedPool();
            socket.emit('sharedPokemonPool', room.pokemonPool);
            socket.emit('roomJoined', code);
            io.to(code).emit('updatePlayers', getPlayerList(room));
            io.to(code).emit('playerActivity', { name, action: 'joined' });
        }
    });

    // ── READY (just visual now) ──
    socket.on('playerReady', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code] || socket.isSpectator) return;
        const room = rooms[code];
        room.readyPlayers.add(socket.id);
        const activeCount = room.players.filter(p => !p.isSpectator).length;
        const readyCount = room.readyPlayers.size;
        io.to(code).emit('readyUpdate', { ready: readyCount, total: activeCount });
    });

    // ── HOST STARTS THE BATTLE (new) ──
    socket.on('hostStartBattle', () => {
        const code = socket.roomCode;
        const room = rooms[code];
        if (!room || room.host !== socket.id || room.gameInProgress) {
            socket.emit('errorMessage', 'Only the host can start the battle.');
            return;
        }

        const seed = Math.random().toString(36).substring(2, 10);
        room.seed = seed;
        room.gameInProgress = true;

        io.to(code).emit('battleStart', { seed });
        console.log(`Host started battle in ${code} (seed: ${seed})`);
    });

    // rest of your events (reportWin, playerVote, disconnect) — unchanged from last version
    socket.on('reportWin', ({ winner }) => { /* same as before */ });
    socket.on('playerVote', ({ name, vote }) => { /* same as before */ });
    socket.on('disconnect', () => { /* same as before */ });
});

function getPlayerList(room) { /* same as before */ }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`PokeRumble running on port ${PORT}`));

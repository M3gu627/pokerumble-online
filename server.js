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

// ── Room Management ──
const rooms = {};

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getPlayerList(room) {
    return room.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === room.host
    }));
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createRoom', (name) => {
        let code = generateCode();
        while (rooms[code]) code = generateCode();

        rooms[code] = {
            host: socket.id,
            players: [{ id: socket.id, name: name || 'Player' }]
        };

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;

        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', getPlayerList(rooms[code]));
        console.log(`Room ${code} created by ${name} (${socket.id})`);
    });

    socket.on('joinRoom', ({ code, name }) => {
        const room = rooms[code];
        if (!room) {
            socket.emit('errorMessage', 'Room not found.');
            return;
        }
        if (room.players.length >= 10) {
            socket.emit('errorMessage', 'Room is full (10/10).');
            return;
        }

        room.players.push({ id: socket.id, name: name || 'Player' });
        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;

        socket.emit('roomJoined', code);
        io.to(code).emit('updatePlayers', getPlayerList(room));
        console.log(`${name} joined room ${code}`);
    });

    socket.on('hostStart', (code) => {
        const room = rooms[code];
        if (!room) return;
        if (room.host !== socket.id) {
            socket.emit('errorMessage', 'Only the host can start the game.');
            return;
        }
        console.log(`Host started room ${code} with ${room.players.length} players`);
        io.to(code).emit('startGame');
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (code && rooms[code]) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                delete rooms[code];
                console.log(`Room ${code} deleted (empty)`);
            } else {
                if (room.host === socket.id) {
                    room.host = room.players[0].id;
                    io.to(room.host).emit('youAreHost');
                    console.log(`New host for room ${code}: ${room.players[0].name}`);
                }
                io.to(code).emit('updatePlayers', getPlayerList(room));
            }
        }
        console.log('Player disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`PokeRumble server running on port ${PORT}`);
});

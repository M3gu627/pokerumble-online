const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve all static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve Index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Index.html'));
});

// ── Room Management ──
const rooms = {};

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createRoom', () => {
        let code = generateCode();
        while (rooms[code]) code = generateCode();

        rooms[code] = { players: [socket.id], host: socket.id };
        socket.join(code);
        socket.roomCode = code;

        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', rooms[code].players.length);
        console.log(`Room ${code} created by ${socket.id}`);
    });

    socket.on('joinRoom', (code) => {
        const room = rooms[code];
        if (!room) {
            socket.emit('errorMessage', 'Room not found.');
            return;
        }
        if (room.players.length >= 10) {
            socket.emit('errorMessage', 'Room is full (10/10).');
            return;
        }

        room.players.push(socket.id);
        socket.join(code);
        socket.roomCode = code;

        io.to(code).emit('updatePlayers', room.players.length);

        if (room.players.length >= 2) {
            io.to(code).emit('startGame');
        }
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (code && rooms[code]) {
            rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
            if (rooms[code].players.length === 0) {
                delete rooms[code];
                console.log(`Room ${code} deleted (empty)`);
            } else {
                io.to(code).emit('updatePlayers', rooms[code].players.length);
            }
        }
        console.log('Player disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`PokeRumble server running on port ${PORT}`);
});

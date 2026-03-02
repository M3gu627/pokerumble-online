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
            players: [{ id: socket.id, name: name || 'Player' }],
            votes: {},      // { playerName: "play"|"quit" }
            wins: {}        // { playerName: count }
        };

        socket.join(code);
        socket.roomCode = code;
        socket.playerName = name;

        socket.emit('roomCreated', code);
        io.to(code).emit('updatePlayers', getPlayerList(rooms[code]));
        console.log(`Room ${code} created by ${name}`);
    });

    socket.on('joinRoom', ({ code, name }) => {
        const room = rooms[code];
        if (!room) { socket.emit('errorMessage', 'Room not found.'); return; }
        if (room.players.length >= 10) { socket.emit('errorMessage', 'Room is full (10/10).'); return; }

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
        if (room.host !== socket.id) { socket.emit('errorMessage', 'Only the host can start.'); return; }
        console.log(`Host started room ${code} with ${room.players.length} players`);
        // Send each player their name + lobby wins
        room.players.forEach(p => {
            io.to(p.id).emit('gameInfo', {
                name: p.name,
                totalPlayers: room.players.length,
                wins: room.wins
            });
        });
        io.to(code).emit('startGame');
    });

    // Called when a game ends and a winner is determined
    socket.on('reportWin', ({ winner }) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        if (winner) {
            room.wins[winner] = (room.wins[winner] || 0) + 1;
        }
        // Reset votes for new round
        room.votes = {};
        io.to(code).emit('winsUpdate', room.wins);
        console.log(`Win recorded: ${winner} in room ${code}`);
    });

    // Called when a player votes play/quit after a game
    socket.on('playerVote', ({ name, vote }) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];

        room.votes[name] = vote;
        io.to(code).emit('playerVoteUpdate', room.votes);

        const totalInRoom = room.players.length;
        const voteValues = Object.values(room.votes);
        const playVotes = voteValues.filter(v => v === 'play').length;
        const quitVotes = voteValues.filter(v => v === 'quit').length;

        console.log(`Vote in ${code}: ${name} → ${vote} | Play:${playVotes} Quit:${quitVotes} Total:${totalInRoom}`);

        // Everyone voted
        if (voteValues.length >= totalInRoom) {
            if (playVotes >= quitVotes) {
                // Majority or tie → restart
                room.votes = {};
                setTimeout(() => {
                    room.players.forEach(p => {
                        io.to(p.id).emit('gameInfo', {
                            name: p.name,
                            totalPlayers: room.players.length,
                            wins: room.wins
                        });
                    });
                    io.to(code).emit('restartGame');
                }, 1000);
            } else {
                // Majority quit
                io.to(code).emit('allQuit');
                delete rooms[code];
            }
        }
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

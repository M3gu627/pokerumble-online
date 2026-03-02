const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const MAX_PLAYERS = 10;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    socket.on("createRoom", () => {
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            players: []
        };

        rooms[roomCode].players.push(socket.id);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("roomCreated", roomCode);
    });

    socket.on("joinRoom", (roomCode) => {
        if (!rooms[roomCode]) {
            socket.emit("errorMessage", "Room does not exist.");
            return;
        }

        if (rooms[roomCode].players.length >= MAX_PLAYERS) {
            socket.emit("errorMessage", "Room is full (10 players max).");
            return;
        }

        rooms[roomCode].players.push(socket.id);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        io.to(roomCode).emit("updatePlayers", rooms[roomCode].players.length);

        if (rooms[roomCode].players.length === MAX_PLAYERS) {
            io.to(roomCode).emit("startGame");
        }
    });

    socket.on("disconnect", () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        rooms[roomCode].players =
            rooms[roomCode].players.filter(id => id !== socket.id);

        io.to(roomCode).emit("updatePlayers", rooms[roomCode].players.length);

        if (rooms[roomCode].players.length === 0) {
            delete rooms[roomCode];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));
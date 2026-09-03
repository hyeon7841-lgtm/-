const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname + '/public'));

let waitingSocket = null;
const rooms = {};

io.on('connection', (socket) => {
  socket.on('joinGame', (username) => {
    socket.username = username;

    if (!waitingSocket) {
      waitingSocket = socket;
      socket.emit('playerAssigned', { playerNumber: 1, username });
    } else {
      const p1 = waitingSocket;
      const p2 = socket;
      waitingSocket = null;

      const roomId = `room_${p1.id}_${p2.id}`;
      p1.join(roomId);
      p2.join(roomId);

      p2.emit('playerAssigned', { playerNumber: 2, username });

      rooms[roomId] = {
        p1: { id: p1.id, name: p1.username, x: 100, y: 300 },
        p2: { id: p2.id, name: p2.username, x: 700, y: 300 }
      };

      io.to(roomId).emit('matchFound', {
        roomId,
        p1: p1.username,
        p2: p2.username
      });
    }
  });

  socket.on('requestStart', (roomId) => {
    let count = 3;
    const timer = setInterval(() => {
      io.to(roomId).emit('countdown', count);
      count--;
      if (count < 0) {
        clearInterval(timer);
        io.to(roomId).emit('gameStart', rooms[roomId]);
      }
    }, 1000);
  });

  socket.on('playerMove', (data) => {
    if (rooms[data.roomId]) {
      const target = data.playerNumber === 1 ? rooms[data.roomId].p1 : rooms[data.roomId].p2;
      target.x = data.x;
      target.y = data.y;
      socket.to(data.roomId).emit('opponentMoved', data);
    }
  });

  socket.on('disconnect', () => {
    if (waitingSocket && waitingSocket.id === socket.id) {
      waitingSocket = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

// Socket.io 옵션 최소화 및 호환성 확보
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true
});

const rooms = {};

const RECIPES = ['불고기버거', '빅맥버거', '슈비버거'];
const EMOJIS = ['👨‍💼', '👩‍🦰', '🧔', '👩‍🎨', '👨‍🍳', '🧑‍💻', '👵'];

function createInitialCustomers(isP2 = false) {
  const custs = [];
  const baseLeft = isP2 ? 550 : 70;
  const gap = 100;
  for (let i = 0; i < 3; i++) {
    custs.push({
      id: i,
      x: baseLeft + (i * gap),
      y: 180,
      serveArea: { x: baseLeft + (i * gap) - 30, y: 190, w: 80, h: 70 },
      order: RECIPES[Math.floor(Math.random() * RECIPES.length)],
      timeLeft: 40,
      maxTime: 40,
      active: true,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)]
    });
  }
  return custs;
}

function getCleanRoomData(room) {
  return {
    gameTime: room.gameTime,
    isStarted: room.isStarted,
    spectators: room.spectators || [],
    p1: room.p1 ? {
      name: room.p1.name,
      x: room.p1.x,
      y: room.p1.y,
      score: room.p1.score,
      holding: room.p1.holding,
      assemblyTable: room.p1.assemblyTable,
      customers: room.p1.customers
    } : null,
    p2: room.p2 ? {
      name: room.p2.name,
      x: room.p2.x,
      y: room.p2.y,
      score: room.p2.score,
      holding: room.p2.holding,
      assemblyTable: room.p2.assemblyTable,
      customers: room.p2.customers
    } : null
  };
}

app.get("/", (req, res) => res.send("Burger Tycoon Server Running"));

io.on("connection", (socket) => {
  console.log("새 사용자 연결됨:", socket.id);

  socket.on("joinBurgerRoom", ({ roomCode, username }) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        p1: null,
        p2: null,
        spectators: [],
        gameTime: 90,
        isStarted: false,
        timerInterval: null
      };
    }

    const room = rooms[roomCode];

    if (!room.p1) {
      room.p1 = { id: socket.id, name: username, x: 200, y: 430, score: 0, holding: null, assemblyTable: [], customers: createInitialCustomers(false) };
      socket.role = "P1";
    } else if (!room.p2) {
      room.p2 = { id: socket.id, name: username, x: 680, y: 430, score: 0, holding: null, assemblyTable: [], customers: createInitialCustomers(true) };
      socket.role = "P2";
    } else {
      socket.role = "SPECTATOR";
      room.spectators.push({ id: socket.id, name: username });
    }

    socket.emit("roleAssigned", { role: socket.role, roomCode });
    io.to(roomCode).emit("roomStateUpdate", getCleanRoomData(room));
  });

  const startNewGameLogic = (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.isStarted = true;
    room.gameTime = 90;

    if (room.p1) {
      room.p1.score = 0;
      room.p1.x = 200;
      room.p1.y = 430;
      room.p1.holding = null;
      room.p1.assemblyTable = [];
      room.p1.customers = createInitialCustomers(false);
    }
    if (room.p2) {
      room.p2.score = 0;
      room.p2.x = 680;
      room.p2.y = 430;
      room.p2.holding = null;
      room.p2.assemblyTable = [];
      room.p2.customers = createInitialCustomers(true);
    }

    if (room.timerInterval) clearInterval(room.timerInterval);

    room.timerInterval = setInterval(() => {
      room.gameTime--;

      ["p1", "p2"].forEach(pKey => {
        if (room[pKey] && room[pKey].customers) {
          room[pKey].customers.forEach((c) => {
            if (c.active) {
              c.timeLeft--;
              if (c.timeLeft <= 0) {
                room[pKey].score = Math.max(0, room[pKey].score - 15);
                c.order = RECIPES[Math.floor(Math.random() * RECIPES.length)];
                c.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
                c.timeLeft = 40;
                io.to(roomCode).emit("tickerUpdate", `⏳ [시간초과] ${room[pKey].name} 손님이 떠났습니다! (-15점)`);
              }
            }
          });
        }
      });

      const cleanData = getCleanRoomData(room);
      io.to(roomCode).emit("syncGame", cleanData);

      if (room.gameTime <= 0) {
        clearInterval(room.timerInterval);
        room.isStarted = false;
        io.to(roomCode).emit("gameOver", cleanData);
      }
    }, 1000);

    io.to(roomCode).emit("gameStart", getCleanRoomData(room));
  };

  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && socket.role === "P1" && !room.isStarted) {
      startNewGameLogic(roomCode);
    }
  });

  socket.on("requestRestartGame", ({ roomCode }) => {
    startNewGameLogic(roomCode);
  });

  socket.on("playerAction", ({ roomCode, role, data }) => {
    const room = rooms[roomCode];
    if (room && room.isStarted) {
      if (role === "P1" && room.p1) Object.assign(room.p1, data);
      else if (role === "P2" && room.p2) Object.assign(room.p2, data);
      socket.to(roomCode).emit("syncGame", getCleanRoomData(room));
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (room.p1 && room.p1.id === socket.id) room.p1 = null;
      if (room.p2 && room.p2.id === socket.id) room.p2 = null;
      room.spectators = room.spectators.filter(s => s.id !== socket.id);

      if (!room.p1 && !room.p2 && room.timerInterval) clearInterval(room.timerInterval);
      io.to(roomCode).emit("roomStateUpdate", getCleanRoomData(room));
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const RECIPES = ['불고기버거', '빅맥버거', '슈비버거'];
const EMOJIS = ['👨‍💼', '👩‍🦰', '🧔', '👩‍🎨', '👨‍🍳', '🧑‍💻', '👵'];

// 기본 손님 4명 생성 함수
function createInitialCustomers() {
  const custs = [];
  const startX = 100;
  const gap = 220;
  for (let i = 0; i < 4; i++) {
    custs.push({
      id: i,
      x: startX + (i * gap),
      y: 170,
      serveArea: { x: startX + (i * gap) - 40, y: 180, w: 100, h: 80 },
      order: RECIPES[Math.floor(Math.random() * RECIPES.length)],
      timeLeft: 40,
      maxTime: 40,
      active: true,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)]
    });
  }
  return custs;
}

app.get("/", (req, res) => res.send("Burger Tycoon Server Running"));

io.on("connection", (socket) => {
  socket.on("joinBurgerRoom", ({ roomCode, username }) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        p1: null,
        p2: null,
        spectators: [],
        gameTime: 90, // 제한시간 1분 30초 (90초)
        isStarted: false,
        timerInterval: null
      };
    }

    const room = rooms[roomCode];

    if (!room.p1) {
      room.p1 = { id: socket.id, name: username, x: 220, y: 420, score: 0, holding: null, assemblyTable: [], customers: createInitialCustomers() };
      socket.role = "P1";
    } else if (!room.p2) {
      room.p2 = { id: socket.id, name: username, x: 780, y: 420, score: 0, holding: null, assemblyTable: [], customers: createInitialCustomers() };
      socket.role = "P2";
    } else {
      socket.role = "SPECTATOR";
      room.spectators.push(socket.id);
    }

    socket.emit("roleAssigned", { role: socket.role, roomCode });
    io.to(roomCode).emit("roomStateUpdate", room);
  });

  // 1P의 게임 시작 요청
  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && socket.role === "P1" && !room.isStarted) {
      room.isStarted = true;
      room.gameTime = 90;

      // 1초 마다 타이머 & 손님 대기시간 차감
      room.timerInterval = setInterval(() => {
        room.gameTime--;

        // P1, P2 개별 손님 시간 차감 및 초과시 감점
        ["p1", "p2"].forEach(pKey => {
          if (room[pKey]) {
            room[pKey].customers.forEach((c) => {
              if (c.active) {
                c.timeLeft--;
                if (c.timeLeft <= 0) {
                  // 손님 대기시간 초과 (40초 경과) -> -15점 감점 후 리셋
                  room[pKey].score = Math.max(0, room[pKey].score - 15);
                  c.order = RECIPES[Math.floor(Math.random() * RECIPES.length)];
                  c.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
                  c.timeLeft = 40;
                  io.to(roomCode).emit("tickerUpdate", `⏳ [시간초과] ${room[pKey].name} 손님이 지쳐서 떠났습니다! (-15점)`);
                }
              }
            });
          }
        });

        io.to(roomCode).emit("syncGame", room);

        // 제한시간 종료 처리
        if (room.gameTime <= 0) {
          clearInterval(room.timerInterval);
          room.isStarted = false;
          io.to(roomCode).emit("gameOver", room);
        }
      }, 1000);

      io.to(roomCode).emit("gameStart", room);
    }
  });

  socket.on("playerAction", ({ roomCode, role, data }) => {
    const room = rooms[roomCode];
    if (room && room.isStarted) {
      if (role === "P1" && room.p1) Object.assign(room.p1, data);
      else if (role === "P2" && room.p2) Object.assign(room.p2, data);
      socket.to(roomCode).emit("syncGame", room);
    }
  });

  // 서빙 처리 (성공 +50 / 오배송 -20)
  socket.on("serveOrder", ({ roomCode, role, customerIndex, isSuccess }) => {
    const room = rooms[roomCode];
    if (room && room.isStarted) {
      const player = role === "P1" ? room.p1 : room.p2;
      if (player) {
        if (isSuccess) {
          player.score += 50;
          io.to(roomCode).emit("tickerUpdate", `🍔 [서빙 성공] ${player.name} 선수가 버거 전송 완료! (+50점)`);
        } else {
          player.score = Math.max(0, player.score - 20);
          io.to(roomCode).emit("tickerUpdate", `❌ [오배송] ${player.name} 선수가 레시피를 틀렸습니다! (-20점)`);
        }

        // 해당 손님 즉시 새 주문으로 교체 및 시간 40초 리셋
        const c = player.customers[customerIndex];
        c.order = RECIPES[Math.floor(Math.random() * RECIPES.length)];
        c.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        c.timeLeft = 40;

        io.to(roomCode).emit("syncGame", room);
      }
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (room.p1 && room.p1.id === socket.id) room.p1 = null;
      if (room.p2 && room.p2.id === socket.id) room.p2 = null;
      if (!room.p1 && !room.p2 && room.timerInterval) clearInterval(room.timerInterval);
      io.to(roomCode).emit("roomStateUpdate", room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

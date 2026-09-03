const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 방 상태 저장 객체
const rooms = {};

app.get("/", (req, res) => {
  res.send("Burger Tycoon Socket Server is running!");
});

io.on("connection", (socket) => {
  console.log("새 사용자 접속:", socket.id);

  // 방 참가 요청
  socket.on("joinBurgerRoom", ({ roomCode, username }) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.username = username;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        p1: null,
        p2: null,
        spectators: [],
        gameTime: 120,
        isStarted: false,
        customers: [
          { x: 220, y: 170, serveArea: { x: 160, y: 180, w: 120, h: 80 }, order: '불고기버거', timeLeft: 35, maxTime: 35, active: true, emoji: '👨‍💼' },
          { x: 500, y: 170, serveArea: { x: 440, y: 180, w: 120, h: 80 }, order: '빅맥버거', timeLeft: 35, maxTime: 35, active: true, emoji: '👩‍🦰' },
          { x: 780, y: 170, serveArea: { x: 720, y: 180, w: 120, h: 80 }, order: '슈비버거', timeLeft: 35, maxTime: 35, active: true, emoji: '🧔' }
        ]
      };
    }

    const room = rooms[roomCode];

    // 역할 할당
    if (!room.p1) {
      room.p1 = { id: socket.id, name: username, x: 220, y: 420, score: 0, holding: null, assemblyTable: [], joined: true };
      socket.role = "P1";
    } else if (!room.p2) {
      room.p2 = { id: socket.id, name: username, x: 780, y: 420, score: 0, holding: null, assemblyTable: [], joined: true };
      socket.role = "P2";
    } else {
      socket.role = "SPECTATOR";
      room.spectators.push(socket.id);
    }

    // 본인에게 역할 통보
    socket.emit("roleAssigned", { role: socket.role, roomCode });

    // 전체 방 인원에게 현재 방 상태 전송
    io.to(roomCode).emit("roomStateUpdate", room);
  });

  // 1P의 게임 시작 요청
  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room && socket.role === "P1") {
      room.isStarted = true;
      io.to(roomCode).emit("gameStart", room);
    }
  });

  // 플레이어 이동 및 상호작용 위치 전송
  socket.on("playerAction", ({ roomCode, role, data }) => {
    const room = rooms[roomCode];
    if (room) {
      if (role === "P1" && room.p1) {
        Object.assign(room.p1, data);
      } else if (role === "P2" && room.p2) {
        Object.assign(room.p2, data);
      }
      socket.to(roomCode).emit("syncGame", room);
    }
  });

  // 서빙 성공/실패 수신
  socket.on("serveOrder", ({ roomCode, role, customerIndex, isSuccess, score }) => {
    const room = rooms[roomCode];
    if (room) {
      if (role === "P1" && room.p1) room.p1.score = score;
      if (role === "P2" && room.p2) room.p2.score = score;

      const RECIPES = ['불고기버거', '빅맥버거', '슈비버거'];
      const EMOJIS = ['👨‍💼', '👩‍🦰', '🧔', '👩‍🎨', '👨‍🍳'];
      room.customers[customerIndex].order = RECIPES[Math.floor(Math.random() * RECIPES.length)];
      room.customers[customerIndex].emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      room.customers[customerIndex].timeLeft = 35;

      const playerName = role === "P1" ? room.p1.name : room.p2.name;
      const resultMsg = isSuccess ? "서빙 성공! (+50점)" : "서빙 실패! (-20점)";
      io.to(roomCode).emit("tickerUpdate", `🍔 [서빙 소식] ${playerName} 선수 ${resultMsg}`);
      io.to(roomCode).emit("syncGame", room);
    }
  });

  // 접속 종료 처리
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (room.p1 && room.p1.id === socket.id) room.p1 = null;
      if (room.p2 && room.p2.id === socket.id) room.p2 = null;
      
      io.to(roomCode).emit("roomStateUpdate", room);
      io.to(roomCode).emit("tickerUpdate", `⚠️ 한 선수의 접속이 끊겼습니다.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

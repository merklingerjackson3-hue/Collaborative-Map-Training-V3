const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3002;

app.use(express.static("public"));

const rooms = new Map();

function createRoomCode() {
    let code;

    do {
        code = crypto
            .randomBytes(4)
            .toString("base64")
            .replace(/[^A-Z0-9]/gi, "")
            .toUpperCase()
            .slice(0, 5);
    } while (!code || rooms.has(code));

    return code;
}

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("room:create", ({ name }, callback) => {
        const code = createRoomCode();

        rooms.set(code, {
            hostId: socket.id,
            users: new Map(),
            messages: []
        });

        const room = rooms.get(code);

        room.users.set(socket.id, {
            id: socket.id,
            name: name || "Host"
        });

        socket.join(code);

        callback({
            success: true,
            code
        });

        io.to(code).emit(
            "room:users",
            [...room.users.values()]
        );
    });

    socket.on("room:join", ({ code, name }, callback) => {
        const cleanCode = String(code || "")
            .trim()
            .toUpperCase();

        const room = rooms.get(cleanCode);

        if (!room) {
            callback({
                success: false,
                error: "Room not found."
            });

            return;
        }

        room.users.set(socket.id, {
            id: socket.id,
            name: name || "Operator"
        });

        socket.join(cleanCode);

        callback({
            success: true,
            code: cleanCode,
            hostId: room.hostId
        });

        io.to(cleanCode).emit(
            "room:users",
            [...room.users.values()]
        );
    });

    socket.on("chat:send", ({ code, message }, callback) => {
        const cleanCode = String(code || "")
            .trim()
            .toUpperCase();

        const room = rooms.get(cleanCode);

        if (!room) {
            callback?.({
                success: false,
                error: "Room not found."
            });

            return;
        }

        const user = room.users.get(socket.id);

        if (!user) {
            callback?.({
                success: false,
                error: "You are not in this room."
            });

            return;
        }

        const cleanMessage = String(message || "").trim();

        if (!cleanMessage) {
            callback?.({
                success: false,
                error: "Message cannot be empty."
            });

            return;
        }

        const chatMessage = {
            id: crypto.randomUUID(),
            userId: socket.id,
            userName: user.name,
            message: cleanMessage,
            timestamp: Date.now()
        };

        room.messages.push(chatMessage);

        // Keep only the most recent 100 messages for now.
        if (room.messages.length > 100) {
            room.messages.shift();
        }

        io.to(cleanCode).emit(
            "chat:message",
            chatMessage
        );

        callback?.({
            success: true
        });
    });

    socket.on("chat:history", ({ code }, callback) => {
        const cleanCode = String(code || "")
            .trim()
            .toUpperCase();

        const room = rooms.get(cleanCode);

        if (!room) {
            callback({
                success: false,
                error: "Room not found."
            });

            return;
        }

        callback({
            success: true,
            messages: room.messages.slice(-100)
        });
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);

        for (const [code, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);

                if (room.hostId === socket.id) {
                    const nextUser =
                        room.users.values().next().value;

                    if (nextUser) {
                        room.hostId = nextUser.id;

                        io.to(code).emit(
                            "room:hostChanged",
                            {
                                hostId: room.hostId
                            }
                        );
                    } else {
                        rooms.delete(code);
                        continue;
                    }
                }

                io.to(code).emit(
                    "room:users",
                    [...room.users.values()]
                );
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`V3 server running on port ${PORT}`);
});
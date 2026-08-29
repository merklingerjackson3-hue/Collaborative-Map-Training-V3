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
            users: new Map()
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

        io.to(code).emit("room:users", [...room.users.values()]);
    });

    socket.on("room:join", ({ code, name }, callback) => {
        const cleanCode = String(code || "").trim().toUpperCase();
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

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);

        for (const [code, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);

                if (room.hostId === socket.id) {
                    const nextUser = room.users.values().next().value;

                    if (nextUser) {
                        room.hostId = nextUser.id;

                        io.to(code).emit("room:hostChanged", {
                            hostId: room.hostId
                        });
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
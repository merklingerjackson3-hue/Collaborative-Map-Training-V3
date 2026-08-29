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

function createChatId() {
    return crypto.randomUUID();
}


// =========================
// SEND CHAT LIST
// =========================

function sendChatList(code) {

    const room = rooms.get(code);

    if (!room) {
        return;
    }

    const chats = [...room.chats.values()].map(chat => ({

        id: chat.id,

        name: chat.name,

        category: chat.category,

        messageCount: chat.messages.length

    }));

    io.to(code).emit(
        "chat:list",
        chats
    );

}


// =========================
// SEND USER LIST
// =========================

function sendUsers(code) {

    const room = rooms.get(code);

    if (!room) {
        return;
    }

    io.to(code).emit(
        "room:users",
        [...room.users.values()]
    );

}


io.on("connection", (socket) => {

    console.log("User connected:", socket.id);


    // =========================
    // CREATE ROOM
    // =========================

    socket.on("room:create", ({ name }, callback) => {

        const code = createRoomCode();

        rooms.set(code, {

            hostId: socket.id,

            users: new Map(),

            chats: new Map([

                [
                    "general",
                    {
                        id: "general",
                        name: "General",
                        category: "General",
                        messages: []
                    }
                ]

            ])

        });

        const room = rooms.get(code);

        room.users.set(socket.id, {

            id: socket.id,

            name: name || "Host",

            openChats: new Set(["general"])

        });

        socket.join(code);

        callback({

            success: true,

            code

        });

        sendChatList(code);

        sendUsers(code);

        sendOpenChats(socket);

    });


    // =========================
    // JOIN ROOM
    // =========================

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

            name: name || "Operator",

            openChats: new Set(["general"])

        });

        socket.join(cleanCode);

        callback({

            success: true,

            code: cleanCode,

            hostId: room.hostId

        });

        sendChatList(cleanCode);

        sendUsers(cleanCode);

        sendOpenChats(socket);

    });


    // =========================
    // CREATE CHAT
    // =========================

    socket.on("chat:create", ({ code, name, category }, callback) => {

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

        if (socket.id !== room.hostId) {

            callback({

                success: false,

                error: "Only the host can create chats."

            });

            return;

        }

        const cleanName =
            String(name || "").trim();

        if (!cleanName) {

            callback({

                success: false,

                error: "Chat name cannot be empty."

            });

            return;

        }

        const chatId = createChatId();

        room.chats.set(chatId, {

            id: chatId,

            name: cleanName,

            category:
                String(category || "General").trim()
                || "General",

            messages: []

        });

        // Automatically open the new chat
        // for everyone currently in the room.

        for (const user of room.users.values()) {

            user.openChats.add(chatId);

        }

        sendChatList(cleanCode);

        sendAllOpenChats(cleanCode);

        callback({

            success: true,

            chatId

        });

    });


    // =========================
    // OPEN CHAT
    // =========================

    socket.on("chat:open", ({ code, chatId }, callback) => {

        const cleanCode =
            String(code || "")
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

        const user =
            room.users.get(socket.id);

        if (!user) {

            callback?.({

                success: false,

                error: "You are not in this room."

            });

            return;

        }

        const chat =
            room.chats.get(chatId);

        if (!chat) {

            callback?.({

                success: false,

                error: "Chat not found."

            });

            return;

        }

        user.openChats.add(chatId);

        sendOpenChats(socket);

        callback?.({

            success: true

        });

    });


    // =========================
    // CLOSE CHAT
    // =========================

    socket.on("chat:close", ({ code, chatId }, callback) => {

        const cleanCode =
            String(code || "")
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

        const user =
            room.users.get(socket.id);

        if (!user) {

            callback?.({

                success: false,

                error: "You are not in this room."

            });

            return;

        }

        // General cannot be closed.
        if (chatId === "general") {

            callback?.({

                success: false,

                error: "General chat cannot be closed."

            });

            return;

        }

        user.openChats.delete(chatId);

        sendOpenChats(socket);

        callback?.({

            success: true

        });

    });


    // =========================
    // GET CHAT HISTORY
    // =========================

    socket.on("chat:history", ({ code, chatId }, callback) => {

        const cleanCode =
            String(code || "")
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

        const selectedChatId =
            chatId || "general";

        const chat =
            room.chats.get(selectedChatId);

        if (!chat) {

            callback({

                success: false,

                error: "Chat not found."

            });

            return;

        }

        callback({

            success: true,

            messages:
                chat.messages.slice(-100)

        });

    });


    // =========================
    // SEND MESSAGE
    // =========================

    socket.on("chat:send", ({ code, chatId, message }, callback) => {

        const cleanCode =
            String(code || "")
                .trim()
                .toUpperCase();

        const room =
            rooms.get(cleanCode);

        if (!room) {

            callback?.({

                success: false,

                error: "Room not found."

            });

            return;

        }

        const user =
            room.users.get(socket.id);

        if (!user) {

            callback?.({

                success: false,

                error: "You are not in this room."

            });

            return;

        }

        const selectedChatId =
            chatId || "general";

        const chat =
            room.chats.get(selectedChatId);

        if (!chat) {

            callback?.({

                success: false,

                error: "Chat not found."

            });

            return;

        }

        const cleanMessage =
            String(message || "").trim();

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

        chat.messages.push(chatMessage);


        // Keep only the most recent 100 messages.

        if (chat.messages.length > 100) {

            chat.messages.shift();

        }


        io.to(cleanCode).emit(

            "chat:message",

            {

                chatId: selectedChatId,

                message: chatMessage

            }

        );


        callback?.({

            success: true

        });

    });


    // =========================
    // SEND OPEN CHATS
    // =========================

    function sendOpenChats(socket) {

        const roomCode =
            [...socket.rooms]
                .find(roomName =>
                    rooms.has(roomName)
                );

        if (!roomCode) {
            return;
        }

        const room =
            rooms.get(roomCode);

        if (!room) {
            return;
        }

        const user =
            room.users.get(socket.id);

        if (!user) {
            return;
        }

        socket.emit(

            "chat:openList",

            [...user.openChats]

        );

    }


    // =========================
    // SEND OPEN CHATS TO ROOM
    // =========================

    function sendAllOpenChats(code) {

        const room =
            rooms.get(code);

        if (!room) {
            return;
        }

        for (const user of room.users.values()) {

            const userSocket =
                io.sockets.sockets.get(user.id);

            if (!userSocket) {
                continue;
            }

            sendOpenChats(userSocket);

        }

    }


    // =========================
    // DISCONNECT
    // =========================

    socket.on("disconnect", () => {

        console.log(
            "User disconnected:",
            socket.id
        );

        for (const [code, room] of rooms) {

            if (!room.users.has(socket.id)) {
                continue;
            }

            room.users.delete(socket.id);


            if (room.hostId === socket.id) {

                const nextUser =
                    room.users.values().next().value;

                if (nextUser) {

                    room.hostId =
                        nextUser.id;

                    io.to(code).emit(

                        "room:hostChanged",

                        {

                            hostId:
                                room.hostId

                        }

                    );

                } else {

                    rooms.delete(code);

                    continue;

                }

            }

            sendUsers(code);

        }

    });

});


// =========================
// START SERVER
// =========================

server.listen(PORT, () => {

    console.log(
        `V3 server running on port ${PORT}`
    );

});
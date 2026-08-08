const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = "./data.json";

function load() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = {
            users: {
                "isaac": { password: "123", admin: true }
            },
            pendingUsers: {},
            servers: {
                "srv_default": {
                    id: "srv_default",
                    name: "Isaac's Realm",
                    icon: "⚡",
                    channels: {
                        "general": { private: false, members: [] },
                        "gaming": { private: false, members: [] }
                    }
                }
            },
            messages: {
                "srv_default:general": [
                    { user: "isaac", text: "Welcome to Babcord!", time: Date.now() }
                ]
            }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!parsed.pendingUsers) parsed.pendingUsers = {};
    return parsed;
}

function save(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = load();
const sessions = {};

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "client.html"));
});

function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token || !sessions[token]) return res.status(401).json({ error: "Unauthorized" });
    req.user = sessions[token];
    next();
}

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    
    if (data.pendingUsers && data.pendingUsers[username]) {
        return res.status(403).json({ error: "Your account registration is awaiting approval by Admin (Isaac)." });
    }

    const user = data.users[username];
    if (!user || user.password !== password) {
        return res.status(403).json({ error: "Invalid username or password" });
    }
    const token = uuid();
    sessions[token] = username;
    res.json({ token, username, admin: !!user.admin });
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    if (data.users[username]) {
        return res.status(400).json({ error: "Username already exists" });
    }

    if (data.pendingUsers[username]) {
        return res.status(400).json({ error: "Registration already submitted! Awaiting admin approval." });
    }

    data.pendingUsers[username] = {
        password,
        requestedAt: Date.now()
    };
    save(data);

    res.json({ message: "Registration submitted successfully! Please wait for Isaac to approve your account." });
});

app.post("/change-password", auth, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 1) {
        return res.status(400).json({ error: "New password required" });
    }
    if (data.users[req.user]) {
        data.users[req.user].password = newPassword;
        save(data);
        return res.json({ success: true, message: "Password updated successfully!" });
    }
    res.status(404).json({ error: "User not found" });
});

app.get("/admin/pending", auth, (req, res) => {
    if (!data.users[req.user] || !data.users[req.user].admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    res.json(data.pendingUsers || {});
});

app.get("/admin/users", auth, (req, res) => {
    if (!data.users[req.user] || !data.users[req.user].admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const userList = {};
    for (const u in data.users) {
        userList[u] = { admin: !!data.users[u].admin };
    }
    res.json(userList);
});

app.post("/admin/approve", auth, (req, res) => {
    if (!data.users[req.user] || !data.users[req.user].admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { username, makeAdmin } = req.body;
    if (!data.pendingUsers[username]) {
        return res.status(404).json({ error: "Pending user not found" });
    }

    const pending = data.pendingUsers[username];
    data.users[username] = {
        password: pending.password,
        admin: !!makeAdmin
    };
    delete data.pendingUsers[username];
    save(data);

    res.json({ success: true, message: `Approved user ${username}` });
});

app.post("/admin/toggle-admin", auth, (req, res) => {
    if (!data.users[req.user] || !data.users[req.user].admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { username } = req.body;
    if (!data.users[username]) {
        return res.status(404).json({ error: "User not found" });
    }

    data.users[username].admin = !data.users[username].admin;
    save(data);

    res.json({ success: true, admin: data.users[username].admin });
});

app.post("/admin/reject", auth, (req, res) => {
    if (!data.users[req.user] || !data.users[req.user].admin) {
        return res.status(403).json({ error: "Admin access required" });
    }
    const { username } = req.body;
    if (data.pendingUsers[username]) {
        delete data.pendingUsers[username];
        save(data);
    }
    res.json({ success: true, message: `Rejected user ${username}` });
});

app.get("/servers", auth, (req, res) => {
    res.json(data.servers || {});
});

app.post("/servers", auth, (req, res) => {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ error: "Server name required" });
    const serverId = "srv_" + Date.now();
    if (!data.servers) data.servers = {};
    data.servers[serverId] = {
        id: serverId,
        name,
        icon: icon || name.charAt(0).toUpperCase(),
        channels: {
            "general": { private: false, members: [] }
        }
    };
    save(data);
    res.json(data.servers[serverId]);
});

app.get("/servers/:serverId/channels", auth, (req, res) => {
    const server = data.servers[req.params.serverId];
    if (!server) return res.status(404).json({ error: "Server not found" });
    res.json(server.channels || {});
});

app.post("/servers/:serverId/channels", auth, (req, res) => {
    const server = data.servers[req.params.serverId];
    if (!server) return res.status(404).json({ error: "Server not found" });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Channel name required" });
    const cleanName = name.toLowerCase().replace(/\s+/g, "-");
    server.channels[cleanName] = { private: false, members: [] };
    save(data);
    res.json(server.channels[cleanName]);
});

app.get("/messages/:serverId/:channel", auth, (req, res) => {
    const key = `${req.params.serverId}:${req.params.channel}`;
    res.json(data.messages[key] || []);
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
    ws.on("message", msg => {
        try {
            const payload = JSON.parse(msg);
            const user = sessions[payload.token];
            if (!user) return;

            if (payload.type === "typing") {
                wss.clients.forEach(c => {
                    if (c !== ws && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({
                            type: "typing",
                            user,
                            serverId: payload.serverId,
                            channel: payload.channel,
                            isTyping: payload.isTyping
                        }));
                    }
                });
                return;
            }

            if (payload.type === "chat" || !payload.type) {
                const { serverId, channel, text } = payload;
                if (!serverId || !channel || !text) return;
                
                const key = `${serverId}:${channel}`;
                if (!data.messages[key]) data.messages[key] = [];

                const message = { user, text, time: Date.now() };
                data.messages[key].push(message);
                save(data);

                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({
                            type: "chat",
                            serverId,
                            channel,
                            ...message
                        }));
                    }
                });
            }
        } catch (e) {
            console.error(e);
        }
    });
});

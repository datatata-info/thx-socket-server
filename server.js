require('dotenv').config();
const { createServer } = require('http');
const createSecureServer = require('https').createServer;
const { Server } = require('socket.io');
const fs = require('fs');
// implement webpush (see: https://dev.to/ajayupreti/how-to-use-push-notifications-in-angular-2cll)
const webpush = require('web-push');
// Push API - this is an API that allows messages to be pushed from a server to a browser (even when the site isn't focused or the browser is closed)

class Subscribtion {
    endpoint = '';
    expirationTime = '';
    keys = {
        auth: '',
        p256dh: ''
    };
    constructor(obj){
        this.endpoint = obj.endpoint;
        this.expirationTime = obj.expirationTime;
        this.keys.auth = obj.keys.auth;
        this.keys.p256dh = obj.keys.p256dh;
    }
}

let httpServer;
const PORT = process.env.PORT;

const ROOMS = {}
const USERS = {}

if (process.env.SSL === 'true') {
    const config = {
        key: fs.readFileSync(process.env.SSL_KEY),
        cert: fs.readFileSync(process.env.SSL_CERT)
    }
    httpServer = createSecureServer(config);
} else {
    httpServer = createServer();
}

const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS 
    }
});

httpServer.listen(PORT, () => {
    console.log(`${process.env.SSL === 'true' ? 'SSL ' : '' }Socket server is lisening on port ${PORT}...`);
});

function addRoom(appName, room) {
    if (!ROOMS[appName]) ROOMS[appName] = {};
    ROOMS[appName][room.id] = room;
}

function getRoom(appName, id) {
    if (roomExist(appName, id)) {
        return ROOMS[appName][id];
    }
    return null;
}

function getUser(appName, id) {
    if (USERS[appName] && USERS[appName][id]) return USERS[appName][id];
    return null;
}

function roomExist(appName, id) {
    if (ROOMS[appName] && ROOMS[appName][id]) return true;
    return false;
}

function deleteRoom(appName, roomId) {
    delete ROOMS[appName][roomId];
}

function closeRoom(appName, roomId, publicRoom = false) {
    io.in(roomId).emit('room_closed', roomId);
    io.in(roomId).socketsLeave(roomId);
    if (publicRoom) io.in(appName).emit('public_room_closed', roomId); // send to app 
    deleteRoom(appName, roomId);
}

function sendNotificationToSubscriber(subscription, notificationPayload) {
    webpush.sendNotification(subscription, JSON.stringify(notificationPayload))
      .then(() => {
        console.log('Push notification sent successfully');
      })
      .catch((error) => {
        console.error('Error sending push notification:', error);
      });
}

function findUserBySocketId(socketId) {
    for (const appName in USERS) {
        for (const userId in USERS[appName]) {
            const user = USERS[appName][userId];
            if (user.socket.id === socketId) return user;
        }
    }
    return null;
}

function findUserOfAppBySocketId(appName, socketId) {
    for (const userId in USERS[appName]) {
        const user = USERS[appName][userId];
        if (user.socket.id === socketId) return user;
    }
    return null;
}

io.of('/').adapter.on('create-room', (room) => {
    console.log(`🦧 room ${room} was created`);
});

io.of('/').adapter.on('delete-room', (room) => {
    console.log(`🦧 room ${room} was deleted`);
});

io.of('/').adapter.on('join-room', (room, id) => {
    console.log(`🦧 socket ${id} has joined room ${room}`);
});

io.of('/').adapter.on('leave-room', (room, id) => {
    console.log(`🦧 socket ${id} has leaved room ${room}`);
    // FIND user by socket id
    // io.to(room).emit('user_leaved_room', id)
});

io.on('connection', (socket) => {
    // console.log('socket.handshake.query', socket.handshake.query);
    const appName = socket.handshake.query.appName;
    if (appName) socket.join(appName); // join room for app
    // console.log('rooms', socket.rooms);

    socket.on('login', (user) => {
        if (!USERS[appName]) USERS[appName] = {};
        if (user.id) USERS[appName][user.id] = {
            user: user,
            socket: socket
        };
        console.log(`user logged in app ${appName}`, user);
    })

    socket.on('disconnect', (reason) => {
        console.log(socket.id, 'disconnect');
        // const userObject = findUserOfAppBySocketId(appName, socket.id);
        // if (userObject) {
        //     for (const roomId in ROOMS[appName]) {
        //         const room = ROOMS[appName][roomId];
        //         if (room.admin === userObject.user.id) {
        //             // admin of this room have been disconnected
        //             // close room
        //             closeRoom(appName, room.id, room.config.public);
        //         }
        //     }
        // }        
    });

    socket.on('disconnecting', () => {
        /// 
        console.log(socket.id, 'disconnecting');
    })

    socket.on('reconnect', () => { 
        console.log('reconnecting...');
    })
    /// TODO: check adapter rooms events https://socket.io/docs/v3/rooms/#room-events
    // create room (public/private)
    // interface RoomConfig { roomName: string, password: string, timer: number, public: boolean}
    // interface Room { id: string, name: string, config: RoomConfig, admin: User.nickname, public: boolean }
    // interface User { id: string, nickname: string }
    socket.on('create_room', (room, swPushSubscription, callback) => {
        // console.log('create_room', room);
        // console.log('create_room user', room.admin);
        console.log('🛎️ webpush subscription ---->', swPushSubscription);
        socket.join(room.id);
        addRoom(appName, room);
        console.log('create_room', room);
        if (room.config.public) socket.to(appName).emit('room_created', room);
        // socket.emit('room_created', room);
        callback({
            success: true,
            message: 'Room created.',
            data: room
        });
    });
    // delete room
    socket.on('close_room', (roomId, userId, callback) => {
        console.log('close_room', roomId)
        const room = getRoom(appName, roomId);
        // only admin can delete room
        // if room.admin === user.id -> deleteRoom(roomId)
        if (room && room.admin === userId) { 
            // if (room.config.public) socket.to(appName).emit('room_closed', roomId);
            closeRoom(appName, roomId, room.config.public);
            // deleteRoom(appName, roomId);
            // // socket.leave(roomId);
            // io.in(roomId).emit('room_closed', roomId);
            // io.in(roomId).socketsLeave(roomId); // all the users in room leave
            callback({
                success: true,
                message: 'Room closed.',
                data: room
            });
        } else {
            callback({
                success: false,
                message: 'You cannot close this room.'
            })
        }
    });
    socket.on('room_exist', (roomId, callback) => {
        if (roomExist(appName, roomId)) {
            callback({
                success: true,
                message: 'You can join this room.'
            });
        } else {
            callback({
                success: false,
                message: 'Room does not exist.'
            });
        }
    });
    // join room
    socket.on('join_room', (roomId, user, swPushSubscription, callback) => {
        // create webpush subscribption
        console.log('🛎️ webpush subscription ---->', swPushSubscription);
        // if room exist, join
        if (roomExist(appName, roomId)) {
            const room = getRoom(appName, roomId);
            socket.join(room.id);
            room.size = io.sockets.adapter.rooms.get(roomId) ? io.sockets.adapter.rooms.get(roomId).size : 0; // update room size
            callback({
                success: true,
                message: 'Room joined.',
                data: room
            });
            socket.to(room.id).emit('user_joined_room', user, room.id);
            if (room.config.public) io.in(appName).emit('public_room_updated', room);
        } else {
            callback({
                success: false,
                message: 'Room does not exist.'
            })
        }     
    });
    socket.on('leave_room', (roomId, userId) => {
        if (roomExist(appName, roomId)) {
            const room = getRoom(appName, roomId);
            socket.leave(roomId);
            room.size = io.sockets.adapter.rooms.get(roomId) ? io.sockets.adapter.rooms.get(roomId).size : 0; // update room size
            // if user is admin -> close
            // if (room.admin === userId) {
            //     // socket.leave(roomId);
            //     closeRoom(appName, roomId);
            // }
            // else emit user_leaved_room
            socket.to(roomId).emit('user_leaved_room', userId);
            if (room.config.public) {
                console.log('... leaving public room', room);
                io.in(appName).emit('public_room_updated', room)
            };
        }
    });
    // get public rooms for app
    socket.on('get_available_rooms', () => {
        // console.log('...get_available_rooms...');
        const appRooms = [];
        for (const roomId in ROOMS[appName]) {
            if (ROOMS[appName][roomId].config.public) {
                appRooms.push(ROOMS[appName][roomId]);
            }
        }
        // console.log('....', appRooms);
        socket.emit('available_rooms', appRooms);
    })
    // exit room
    // thx handshake
    // request handshake -> user want to join room and send publicKey
    socket.on('request_handshake', (roomId, userId, publicKey) => {
        console.log('request_handshake roomId', roomId);
        // sending publicKey to other users
        socket.to(roomId).emit('handshake', roomId, userId, publicKey);
    });
    // answer to request_handshake, every user in room send accept
    socket.on('response_handshake', (roomId, toUserId, fromUserId, publicKey) => {
        const userObject = getUser(appName, toUserId);
        if (userObject) {
            console.log('response_handshake to', userObject.user.nickname);
            socket.to(userObject.socket.id).emit('accept_handshake', roomId, fromUserId, publicKey);
        }
        
    });
    // ban/reject user (admin)
    // send message
    socket.on('send_message', (roomId, message) => {
        // console.log('send_message to app', appName);
        // console.log('send_message to roomId', roomId);
        // console.log('on send_message', message);
        socket.to(roomId).emit('message', message, roomId);
    })
    // socket.on('')
});
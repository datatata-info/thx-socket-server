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

function addRoomToUser(appName, roomId, userId) {
    const userObject = getUser(appName, userId);
    if (userObject) {
        if (!userObject.rooms) userObject.rooms = [];
        userObject.rooms.push(roomId);
    }
}

function removeRoomFromUser(appName, roomId, userId) {
    const userObject = getUser(appName, userId);
    if (userObject) {
        if (userObject.rooms) {
            for (let i = 0; i < userObject.rooms.length; i++) {
                const id = userObject.rooms[i];
                if (id === roomId) userObject.rooms.splice(i, 1);
            }
        }
    }
}

function getUsersInRoom(appName, roomId) {
    const result = [];
    const users = USERS[appName];
    for (const userId in users) {
        const user = users[userId];
        if (user.rooms && user.rooms.length && user.rooms.includes(roomId)) {
            result.push(user);
        }
    }
    return result;
}

function deleteUser(appName, id) {
    if (USERS[appName][id]) delete USERS[appName][id];
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

function sendNotificationToSubscriber(subscription, notification) {
    const parsedUrl = new URL(subscription.endpoint);
    const audience = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    // technically, the audience doesn't change between calls, so this can be cached in a non-minimal example
    const vapidHeaders = webpush.getVapidHeaders(
        audience,
        `mailto:${process.env.MAILTO}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
        'aes128gcm'
    );
    webpush.sendNotification(subscription, JSON.stringify({
            notification: notification // payload
        }), {
        headers: vapidHeaders,
        TTL: 60 // default for 60s
    })
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
            if (user.socket && user.socket.id === socketId) return user;
        }
    }
    return null;
}

function findUserOfAppBySocketId(appName, socketId) {
    for (const userId in USERS[appName]) {
        const user = USERS[appName][userId];
        if (user.socket && user.socket.id === socketId) return user;
    }
    return null;
}

function broadcastNewMessageNotifications(appOptions, roomId, excludeSocket) {
    const senderUserObject = findUserBySocketId(excludeSocket.id);
    const usersInRoom = getUsersInRoom(appOptions.appName, roomId);
        // send notification to every user in room, who has a push enabled, except the sender
        for (const userObject of usersInRoom) {
            if (userObject.push) {
                if (senderUserObject && senderUserObject.user.id === userObject.user.id) {
                    // do not send notification to sender
                    console.log('DO NOT SEND NOTIFICATION TO SENDER');
                } else {
                    console.log(`🍆🍆🍆🍆🍆 SEND NOTIFICATION TO USER ${userObject.user.id}`);
                    sendNotificationToSubscriber(userObject.push, {
                        icon: appOptions.appIcon ? appOptions.appIcon : '', // more general for app
                        title: appOptions.appTitle ? appOptions.appTitle : 'THX', // more general for app
                        // TODO: TAG, LANG, SILENT, VIBRATE, ...
                        silent: false,
                        tag: roomId,
                        body: `New message ${senderUserObject ? 'from ' + senderUserObject.user.nickname : ''}`,
                        actions: [
                            { action: 'goto', title: 'View Chat' }
                        ],
                        data: {
                            onActionClick: {
                                default: { 
                                    operation: 'navigateLastFocusedOrOpen',
                                    url: `/en-US/chat/${roomId}`
                                },
                                goto: {
                                    operation: 'navigateLastFocusedOrOpen',
                                    url: `/en-US/chat/${roomId}` // TODO: solve more general for specific app
                                }
                            }
                        }
                    });
                }
                
            }
        }
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
    console.log(`🦧 socket ${id} has left room ${room}`);
    // FIND user by socket id
    // io.to(room).emit('user_left_room', id)
});

io.on('connection', (socket) => {
    // console.log('socket.handshake.query', socket.handshake.query);
    const appOptions = socket.handshake.query.options;
    try {
        JSON.parse(appOptions);
    } catch(e) {
        console.log('cannot parse, typeof appOptions', typeof appOptions);
    }
    const appName = appOptions ? appOptions.appName : socket.handshake.query.appName;
    console.log('appOptions', appOptions);
    console.log('appName', appOptions['appName']);
    console.log('socket.handshake.query', socket.handshake.query);
    // const appName = socket.handshake.query.appName;
    // TODO: appTitle (eg. @thx/chat), appDomain(?), appIconLink, ...
    if (appName) socket.join(appName); // join room for app

    // login to app
    socket.on('login', (user) => {
        // console.log('🌸 notification subscribtion', pushSubscribtion);
        if (!USERS[appName]) USERS[appName] = {}; // no users in app
        // find if user exist
        const userObject = getUser(appName, user.id);
        if (userObject) { // user exist, reconnect with new socket
            userObject.socket = socket;
            console.log('...existing user, just refresh socket', user);
        } else { // new user
            if (user.id) {
                USERS[appName][user.id] = {
                    user: user,
                    socket: socket,
                    push: null
                };
            }
        }
        console.log(`user logged in app ${appName}`, user);
    });

    socket.on('logout', (userId) => {
        const userObject = getUser(appName, userId);
        if (userObject) deleteUser(appName, userId);
    })

    socket.on('has_push', (userId, callback = () => {}) => {
        const userObject = getUser(appName, userId);
        if (userObject) {
            if (userObject.push) {
                callback({
                    success: true,
                    message: 'User has push subscribed.',
                    push: true
                })
            } else { // maybe push can be true/false(denied) and null(not set)
                callback({
                    success: true,
                    message: 'User has not push subscribed.',
                    push: false
                })
            }
        } else {
            callback({
                success: false,
                message: `No user with id ${userId} logged in.`
            });
        }
    });
    // register push to user by id
    socket.on('subscribe_push', (user, push, callback = () => {}) => {
        const userObject = getUser(appName, user.id);
        if (userObject) {
            userObject.push = push;
            callback({
                success: true,
                message: 'PushSubscribtion successfully set.'
            })
        } else {
            callback({
                success: false,
                message: `No user with id ${user.id} logged in.`
            })
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(socket.id, `👋 disconnect for reason ${reason}`);
        const userObject = findUserOfAppBySocketId(appName, socket.id);
        if (userObject) {
            console.log('👋 disconnect user', userObject.user);
            userObject.socket = null;
        } else {
            console.log('👋 no user with socket', socket.id)
        }
        
        // remove disconnected user
        // if (userObject) {
        //     deleteUser(appName, userObject.user.id);
        // }

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
        console.log(socket.id, '👋 disconnecting');
        const userObject = findUserOfAppBySocketId(appName, socket.id);
        if (userObject) {
            console.log('👋 disconnecting user', userObject.user);
        } else {
            console.log('👋 no user with socket', socket.id)
        }
    })

    socket.on('reconnect', () => { 
        console.log('reconnecting...');
    })
    /// TODO: check adapter rooms events https://socket.io/docs/v3/rooms/#room-events
    // create room (public/private)
    // interface RoomConfig { roomName: string, password: string, timer: number, public: boolean}
    // interface Room { id: string, name: string, config: RoomConfig, admin: User.nickname, public: boolean }
    // interface User { id: string, nickname: string }
    socket.on('create_room', (room, callback = () => {}) => {
        // console.log('create_room', room);
        socket.join(room.id);
        const userObject = findUserBySocketId(socket.id);
        if (userObject) {
            addRoomToUser(appName, room.id, userObject.user.id);
        }
        
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
    socket.on('close_room', (roomId, userId, callback = () => {}) => {
        console.log('close_room', roomId)
        const room = getRoom(appName, roomId);
        // remove closed room from every user in app
        for (const userId in USERS[appName]) {
            const userObject = USERS[appName][userId];
            removeRoomFromUser(appName, roomId, userObject.user.id);
        }
        // only admin can delete room
        // if room.admin === user.id -> deleteRoom(roomId)
        if (room && room.admin === userId) { 
            // if (room.config.public) socket.to(appName).emit('room_closed', roomId);
            closeRoom(appName, roomId, room.config.public);
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
    // check if room exist
    socket.on('room_exist', (roomId, callback = () => {}) => {
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
    socket.on('join_room', (roomId, user, callback = () => {}) => {
        // if room exist, join
        if (roomExist(appName, roomId)) {
            const room = getRoom(appName, roomId);
            socket.join(room.id);
            if (!user) user = findUserBySocketId(socket.id);
            addRoomToUser(appName, room.id, user.id);
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
    // leave room
    socket.on('leave_room', (roomId, userId) => {
        if (roomExist(appName, roomId)) {
            const room = getRoom(appName, roomId);
            socket.leave(roomId);
            removeRoomFromUser(appName, roomId, userId);
            room.size = io.sockets.adapter.rooms.get(roomId) ? io.sockets.adapter.rooms.get(roomId).size : 0; // update room size
            // if user is admin -> close
            // if (room.admin === userId) {
            //     // socket.leave(roomId);
            //     closeRoom(appName, roomId);
            // }
            // else emit user_left_room
            socket.to(roomId).emit('user_left_room', userId);
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
    socket.on('handshake', (roomId, userId, publicKeyPem) => {
        console.log('handshake roomId', roomId);
        // sending publicKey to other users
        socket.broadcast.to(roomId).emit('handshake', roomId, userId, publicKeyPem);
    });

    socket.on('accept_handshake', (roomId, toUserId, fromUserId, publicKeyPem) => {
        const userObject = getUser(appName, toUserId);
        if (userObject) {
            socket.to(userObject.socket.id).emit('accept_handshake', roomId, fromUserId, publicKeyPem);
        }
    });

    // ban/reject user (admin)
    // send message
    // TODO: sending push notifications on message
    socket.on('send_message', async (roomId, message) => {
        // TODO: avoid to broadcast stats (!)
        broadcastNewMessageNotifications(appOptions, roomId, socket);
        socket.broadcast.to(roomId).emit('message', message, roomId);
    });
    // 
    socket.on('send_private_message', (roomId, userId, message) => {
        const userObject = getUser(appName, userId);
        if (userObject) {
            socket.to(userObject.socket.id).emit('message', message, roomId);
        }
    });
    // socket.on('')
});
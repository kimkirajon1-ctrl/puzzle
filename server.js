const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Statik dosyaları serve et
app.use(express.static(path.join(__dirname, 'public')));

// Oyun odalarını tut
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Oda oluştur
    socket.on('createRoom', (data) => {
        const roomId = generateRoomId();
        rooms.set(roomId, {
            id: roomId,
            players: [{
                id: socket.id,
                role: 'p1',
                name: data.playerName || 'Oyuncu 1',
                connected: true
            }],
            gameState: null,
            difficulty: null,
            createdAt: Date.now()
        });
        
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerRole = 'p1';
        
        socket.emit('roomCreated', { 
            roomId: roomId,
            role: 'p1'
        });
        
        console.log(`Oda oluşturuldu: ${roomId} - Oyuncu 1 katıldı`);
    });

    // Odaya katıl
    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Oda bulunamadı!' });
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Oda dolu!' });
            return;
        }
        
        room.players.push({
            id: socket.id,
            role: 'p2',
            name: data.playerName || 'Oyuncu 2',
            connected: true
        });
        
        socket.join(data.roomId);
        socket.roomId = data.roomId;
        socket.playerRole = 'p2';
        
        socket.emit('roomJoined', { 
            roomId: data.roomId,
            role: 'p2'
        });
        
        // Oyuncu 1'e bildir
        socket.to(data.roomId).emit('playerJoined', {
            playerName: data.playerName || 'Oyuncu 2'
        });
        
        console.log(`Oyuncu 2 odaya katıldı: ${data.roomId}`);
    });

    // Zorluk seçimi
    socket.on('selectDifficulty', (data) => {
        const room = rooms.get(socket.roomId);
        if (room) {
            room.difficulty = data.level;
            io.to(socket.roomId).emit('difficultySelected', { level: data.level });
        }
    });

    // Oyunu başlat
    socket.on('startGame', (data) => {
        const room = rooms.get(socket.roomId);
        if (room) {
            room.gameState = {
                image: data.image,
                grid: data.grid,
                size: data.size
            };
            
            // Her iki oyuncuya da oyun durumunu gönder
            io.to(socket.roomId).emit('gameStarted', {
                image: data.image,
                grid: data.grid,
                size: data.size,
                playerGrids: {
                    p1: [...data.grid],
                    p2: [...data.grid]
                }
            });
        }
    });

    // Taş hareketi
    socket.on('move', (data) => {
        socket.to(socket.roomId).emit('opponentMove', data);
        
        // Puzzle tamamlandı mı kontrol et
        checkPuzzleCompletion(socket.roomId, data.player, data.tiles);
    });

    // Emoji gönder
    socket.on('sendEmoji', (data) => {
        socket.to(socket.roomId).emit('receiveEmoji', data);
    });

    // Mesaj gönder
    socket.on('sendMessage', (data) => {
        io.to(socket.roomId).emit('newMessage', {
            sender: socket.playerRole,
            message: data.message,
            timestamp: Date.now()
        });
    });

    // Bağlantı koptu
    socket.on('disconnect', () => {
        console.log('Bağlantı koptu:', socket.id);
        
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.connected = false;
                }
                
                socket.to(socket.roomId).emit('playerDisconnected', {
                    role: socket.playerRole
                });
                
                // Odayı temizle (opsiyonel)
                setTimeout(() => {
                    const currentRoom = rooms.get(socket.roomId);
                    if (currentRoom && currentRoom.players.every(p => !p.connected)) {
                        rooms.delete(socket.roomId);
                        console.log(`Oda silindi: ${socket.roomId}`);
                    }
                }, 300000); // 5 dakika sonra temizle
            }
        }
    });

    // Yeniden bağlanma
    socket.on('reconnect', (data) => {
        if (data.roomId && rooms.has(data.roomId)) {
            socket.join(data.roomId);
            socket.roomId = data.roomId;
            
            const room = rooms.get(data.roomId);
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = true;
            }
            
            // Oyun durumunu geri gönder
            if (room.gameState) {
                socket.emit('gameState', room.gameState);
            }
        }
    });
});

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkPuzzleCompletion(roomId, player, tiles) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const size = room.gameState.size;
    const isComplete = tiles.every((value, index) => value === index);
    
    if (isComplete) {
        io.to(roomId).emit('puzzleCompleted', {
            player: player,
            message: player === 'p1' ? 'Oyuncu 1 puzzle\'ı tamamladı! 🎉' : 'Oyuncu 2 puzzle\'ı tamamladı! 🎉'
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor`);
    console.log(`http://localhost:${PORT}`);
});

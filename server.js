// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Servir archivos estáticos
app.use(express.static('public'));

// Almacén de partidas activas
const activeGames = new Map();

// Clase para manejar el estado de una partida
class ChessGame {
    constructor(gameId) {
        this.gameId = gameId;
        this.players = new Map(); // socketId -> {color, ready}
        this.currentTurn = 'w';
        this.gameStarted = false;
    }

    addPlayer(socketId) {
        if (this.players.size >= 2) return false;
        
        // Asignar color al azar para el primer jugador
        if (this.players.size === 0) {
            const color = Math.random() < 0.5 ? 'white' : 'black';
            this.players.set(socketId, {
                color: color,
                ready: true
            });
            return color;
        }
        
        // Asignar color opuesto al segundo jugador
        const firstPlayerColor = Array.from(this.players.values())[0].color;
        const secondPlayerColor = firstPlayerColor === 'white' ? 'black' : 'white';
        this.players.set(socketId, {
            color: secondPlayerColor,
            ready: true
        });
        this.gameStarted = true;
        return secondPlayerColor;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        if (this.players.size === 0) {
            return true; // retorna true si el juego debe ser eliminado
        }
        return false;
    }

    getOpponentSocket(socketId) {
        for (const [key] of this.players) {
            if (key !== socketId) return key;
        }
        return null;
    }
}

// Generar ID único para la partida
function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Crear nueva partida
    socket.on('createGame', () => {
        const gameId = generateGameId();
        const game = new ChessGame(gameId);
        const playerColor = game.addPlayer(socket.id);
        
        activeGames.set(gameId, game);
        socket.join(gameId);
        
        socket.emit('gameCreated', {
            gameId: gameId,
            color: playerColor
        });
    });

    // Unirse a una partida
    socket.on('joinGame', (gameId) => {
        const game = activeGames.get(gameId);
        
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        if (game.players.size >= 2) {
            socket.emit('error', 'Partida llena');
            return;
        }

        const playerColor = game.addPlayer(socket.id);
        socket.join(gameId);
        
        // Notificar a ambos jugadores que la partida puede comenzar
        io.to(gameId).emit('gameStart', {
            white: Array.from(game.players.values())[0].color === 'white' 
                ? Array.from(game.players.keys())[0] 
                : Array.from(game.players.keys())[1],
            black: Array.from(game.players.values())[0].color === 'black' 
                ? Array.from(game.players.keys())[0] 
                : Array.from(game.players.keys())[1]
        });

        socket.emit('playerColor', playerColor);
    });

    // Manejar movimiento
    socket.on('move', ({gameId, move}) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const opponentSocket = game.getOpponentSocket(socket.id);
        if (opponentSocket) {
            io.to(opponentSocket).emit('opponentMove', move);
        }
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        for (const [gameId, game] of activeGames) {
            if (game.players.has(socket.id)) {
                if (game.removePlayer(socket.id)) {
                    activeGames.delete(gameId);
                } else {
                    // Notificar al otro jugador que su oponente se desconectó
                    const opponentSocket = game.getOpponentSocket(socket.id);
                    if (opponentSocket) {
                        io.to(opponentSocket).emit('opponentDisconnected');
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor ejecutándose en puerto ${PORT}`);
});

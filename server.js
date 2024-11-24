// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const activeGames = new Map();

class ChessGame {
    constructor(gameId) {
        this.gameId = gameId;
        this.players = new Map(); // socketId -> {color, ready}
        this.currentTurn = 'w'; // 'w' para blancas, 'b' para negras
        this.gameStarted = false;
        this.moveHistory = []; // Historial de movimientos
        this.position = this.getInitialPosition(); // Estado actual del tablero
    }

    // Configuración inicial del tablero
    getInitialPosition() {
        return {
            pieces: {
                // Piezas blancas
                'a1': { type: 'r', color: 'w' }, 'b1': { type: 'n', color: 'w' },
                'c1': { type: 'b', color: 'w' }, 'd1': { type: 'q', color: 'w' },
                'e1': { type: 'k', color: 'w' }, 'f1': { type: 'b', color: 'w' },
                'g1': { type: 'n', color: 'w' }, 'h1': { type: 'r', color: 'w' },
                'a2': { type: 'p', color: 'w' }, 'b2': { type: 'p', color: 'w' },
                'c2': { type: 'p', color: 'w' }, 'd2': { type: 'p', color: 'w' },
                'e2': { type: 'p', color: 'w' }, 'f2': { type: 'p', color: 'w' },
                'g2': { type: 'p', color: 'w' }, 'h2': { type: 'p', color: 'w' },
                
                // Piezas negras
                'a8': { type: 'r', color: 'b' }, 'b8': { type: 'n', color: 'b' },
                'c8': { type: 'b', color: 'b' }, 'd8': { type: 'q', color: 'b' },
                'e8': { type: 'k', color: 'b' }, 'f8': { type: 'b', color: 'b' },
                'g8': { type: 'n', color: 'b' }, 'h8': { type: 'r', color: 'b' },
                'a7': { type: 'p', color: 'b' }, 'b7': { type: 'p', color: 'b' },
                'c7': { type: 'p', color: 'b' }, 'd7': { type: 'p', color: 'b' },
                'e7': { type: 'p', color: 'b' }, 'f7': { type: 'p', color: 'b' },
                'g7': { type: 'p', color: 'b' }, 'h7': { type: 'p', color: 'b' }
            },
            castling: { w: { kingside: true, queenside: true }, b: { kingside: true, queenside: true } },
            enPassant: null,
            halfMoves: 0,
            fullMoves: 1
        };
    }

    addPlayer(socketId) {
        if (this.players.size >= 2) return false;
        
        if (this.players.size === 0) {
            const color = Math.random() < 0.5 ? 'w' : 'b';
            this.players.set(socketId, {
                color: color,
                ready: true
            });
            return color;
        }
        
        const firstPlayerColor = Array.from(this.players.values())[0].color;
        const secondPlayerColor = firstPlayerColor === 'w' ? 'b' : 'w';
        this.players.set(socketId, {
            color: secondPlayerColor,
            ready: true
        });
        this.gameStarted = true;
        return secondPlayerColor;
    }

    // Validar y realizar movimiento
    makeMove(from, to, playerColor) {
        // Verificar turno
        if (playerColor !== this.currentTurn) {
            return { valid: false, message: 'No es tu turno' };
        }

        const piece = this.position.pieces[from];
        
        // Verificar que hay una pieza en la posición inicial
        if (!piece) {
            return { valid: false, message: 'No hay pieza en esa posición' };
        }

        // Verificar que la pieza pertenece al jugador
        if (piece.color !== playerColor) {
            return { valid: false, message: 'No es tu pieza' };
        }

        // Realizar el movimiento
        const newPosition = { ...this.position };
        delete newPosition.pieces[from];
        newPosition.pieces[to] = piece;

        // Actualizar estado
        this.position = newPosition;
        this.moveHistory.push({ from, to, piece });
        this.currentTurn = this.currentTurn === 'w' ? 'b' : 'w';

        return { 
            valid: true, 
            position: this.position,
            move: { from, to, piece }
        };
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        return this.players.size === 0;
    }

    getOpponentSocket(socketId) {
        for (const [key] of this.players) {
            if (key !== socketId) return key;
        }
        return null;
    }

    getGameState() {
        return {
            position: this.position,
            currentTurn: this.currentTurn,
            moveHistory: this.moveHistory
        };
    }
}

function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('createGame', () => {
        const gameId = generateGameId();
        const game = new ChessGame(gameId);
        const playerColor = game.addPlayer(socket.id);
        
        activeGames.set(gameId, game);
        socket.join(gameId);
        
        socket.emit('gameCreated', {
            gameId: gameId,
            color: playerColor,
            gameState: game.getGameState()
        });
    });

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
        
        io.to(gameId).emit('gameStart', {
            gameState: game.getGameState(),
            white: Array.from(game.players.entries())
                .find(([_, data]) => data.color === 'w')[0],
            black: Array.from(game.players.entries())
                .find(([_, data]) => data.color === 'b')[0]
        });

        socket.emit('playerColor', playerColor);
    });

    socket.on('move', ({gameId, from, to}) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const playerData = game.players.get(socket.id);
        if (!playerData) return;

        const result = game.makeMove(from, to, playerData.color);
        
        if (result.valid) {
            // Enviar el movimiento y el nuevo estado a ambos jugadores
            io.to(gameId).emit('gameUpdate', {
                move: result.move,
                gameState: game.getGameState()
            });
        } else {
            // Enviar error solo al jugador que intentó el movimiento
            socket.emit('moveError', result.message);
        }
    });

    socket.on('disconnect', () => {
        for (const [gameId, game] of activeGames) {
            if (game.players.has(socket.id)) {
                if (game.removePlayer(socket.id)) {
                    activeGames.delete(gameId);
                } else {
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

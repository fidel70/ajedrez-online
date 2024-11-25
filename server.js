const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// Almacén de partidas activas
const activeGames = new Map();

// Utilidades de ajedrez
const PIECES = {
    PAWN: 'p',
    ROOK: 'r',
    KNIGHT: 'n',
    BISHOP: 'b',
    QUEEN: 'q',
    KING: 'k'
};

const INITIAL_BOARD = [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

class ChessGame {
    constructor(gameId) {
        this.gameId = gameId;
        this.players = new Map(); // socketId -> {color, timeLeft, ready}
        this.board = this.copyBoard(INITIAL_BOARD);
        this.currentTurn = 'white';
        this.gameStatus = 'waiting'; // waiting, active, checkmate, stalemate, draw, resigned
        this.moves = [];
        this.lastMove = null;
        this.capturedPieces = { white: [], black: [] };
        this.kings = { white: { x: 4, y: 7 }, black: { x: 4, y: 0 } };
    }

    copyBoard(board) {
        return board.map(row => [...row]);
    }

    addPlayer(socketId) {
        if (this.players.size >= 2) return false;
        
        const color = this.players.size === 0 ? 
            (Math.random() < 0.5 ? 'white' : 'black') :
            (Array.from(this.players.values())[0].color === 'white' ? 'black' : 'white');
        
        this.players.set(socketId, {
            color,
            timeLeft: 600000, // 10 minutos
            ready: true
        });

        if (this.players.size === 2) {
            this.gameStatus = 'active';
        }

        return color;
    }

    makeMove(from, to, socketId) {
        const player = this.players.get(socketId);
        if (!player || player.color !== this.currentTurn) return false;
        
        const move = { from, to };
        if (!this.isValidMove(move, player.color)) return false;

        // Guardar estado anterior para validación de jaque
        const prevBoard = this.copyBoard(this.board);
        const capturedPiece = this.board[to.y][to.x];

        // Ejecutar movimiento
        this.board[to.y][to.x] = this.board[from.y][from.x];
        this.board[from.y][from.x] = null;

        // Actualizar posición del rey si se movió
        if (this.board[to.y][to.x]?.toLowerCase() === PIECES.KING) {
            this.kings[player.color] = { x: to.x, y: to.y };
        }

        // Verificar si el movimiento deja al rey en jaque
        if (this.isKingInCheck(player.color)) {
            // Revertir movimiento
            this.board = prevBoard;
            return false;
        }

        // Registrar captura
        if (capturedPiece) {
            const captureColor = this.getPieceColor(capturedPiece);
            this.capturedPieces[captureColor].push(capturedPiece);
        }

        // Registrar movimiento
        this.lastMove = {
            piece: this.board[to.y][to.x],
            from,
            to,
            capturedPiece,
            timestamp: Date.now()
        };
        this.moves.push(this.lastMove);

        // Cambiar turno
        this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';

        // Verificar estado del juego
        this.updateGameStatus();

        return true;
    }

    isValidMove(move, color) {
        const { from, to } = move;
        const piece = this.board[from.y][from.x];

        // Validaciones básicas
        if (!piece) return false;
        if (this.getPieceColor(piece) !== color) return false;
        if (from.x === to.x && from.y === to.y) return false;
        if (!this.isInsideBoard(to)) return false;

        // No se puede capturar pieza propia
        const targetPiece = this.board[to.y][to.x];
        if (targetPiece && this.getPieceColor(targetPiece) === color) return false;

        const pieceType = piece.toLowerCase();
        
        // Validar movimiento según tipo de pieza
        switch (pieceType) {
            case PIECES.PAWN:
                return this.isValidPawnMove(from, to, color);
            case PIECES.ROOK:
                return this.isValidRookMove(from, to);
            case PIECES.KNIGHT:
                return this.isValidKnightMove(from, to);
            case PIECES.BISHOP:
                return this.isValidBishopMove(from, to);
            case PIECES.QUEEN:
                return this.isValidQueenMove(from, to);
            case PIECES.KING:
                return this.isValidKingMove(from, to);
            default:
                return false;
        }
    }

    isValidPawnMove(from, to, color) {
        const direction = color === 'white' ? -1 : 1;
        const startRow = color === 'white' ? 6 : 1;
        const dx = Math.abs(to.x - from.x);
        const dy = to.y - from.y;

        // Movimiento normal
        if (dx === 0 && dy === direction && !this.board[to.y][to.x]) {
            return true;
        }

        // Movimiento inicial doble
        if (from.y === startRow && dx === 0 && dy === 2 * direction) {
            const middleY = from.y + direction;
            return !this.board[middleY][from.x] && !this.board[to.y][to.x];
        }

        // Captura
        if (dx === 1 && dy === direction) {
            return this.board[to.y][to.x] && 
                   this.getPieceColor(this.board[to.y][to.x]) !== color;
        }

        return false;
    }

    isValidRookMove(from, to) {
        return (from.x === to.x || from.y === to.y) && 
               this.isPathClear(from, to);
    }

    isValidKnightMove(from, to) {
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
    }

    isValidBishopMove(from, to) {
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        return dx === dy && this.isPathClear(from, to);
    }

    isValidQueenMove(from, to) {
        return (this.isValidRookMove(from, to) || 
                this.isValidBishopMove(from, to));
    }

    isValidKingMove(from, to) {
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        return dx <= 1 && dy <= 1;
    }

    isPathClear(from, to) {
        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);
        let x = from.x + dx;
        let y = from.y + dy;

        while (x !== to.x || y !== to.y) {
            if (this.board[y][x]) return false;
            x += dx;
            y += dy;
        }

        return true;
    }

    isInsideBoard(pos) {
        return pos.x >= 0 && pos.x < 8 && pos.y >= 0 && pos.y < 8;
    }

    getPieceColor(piece) {
        return piece === piece.toUpperCase() ? 'white' : 'black';
    }

    isKingInCheck(color) {
        const kingPos = this.kings[color];
        const oppositeColor = color === 'white' ? 'black' : 'white';

        // Verificar cada pieza enemiga
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.board[y][x];
                if (piece && this.getPieceColor(piece) === oppositeColor) {
                    if (this.isValidMove({ from: { x, y }, to: kingPos }, oppositeColor)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    hasLegalMoves(color) {
        for (let fromY = 0; fromY < 8; fromY++) {
            for (let fromX = 0; fromX < 8; fromX++) {
                const piece = this.board[fromY][fromX];
                if (!piece || this.getPieceColor(piece) !== color) continue;

                for (let toY = 0; toY < 8; toY++) {
                    for (let toX = 0; toX < 8; toX++) {
                        const move = {
                            from: { x: fromX, y: fromY },
                            to: { x: toX, y: toY }
                        };

                        // Probar movimiento
                        const prevBoard = this.copyBoard(this.board);
                        if (this.isValidMove(move, color)) {
                            this.board[toY][toX] = this.board[fromY][fromX];
                            this.board[fromY][fromX] = null;

                            const inCheck = this.isKingInCheck(color);
                            this.board = prevBoard;

                            if (!inCheck) return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    updateGameStatus() {
        const oppositeColor = this.currentTurn === 'white' ? 'black' : 'white';
        
        if (this.isKingInCheck(oppositeColor)) {
            if (!this.hasLegalMoves(oppositeColor)) {
                this.gameStatus = 'checkmate';
            }
        } else if (!this.hasLegalMoves(oppositeColor)) {
            this.gameStatus = 'stalemate';
        } else if (this.isInsufficientMaterial()) {
            this.gameStatus = 'draw';
        }
    }

    isInsufficientMaterial() {
        const pieces = {
            white: { count: 0, bishops: [], knights: 0 },
            black: { count: 0, bishops: [], knights: 0 }
        };

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.board[y][x];
                if (!piece) continue;

                const color = this.getPieceColor(piece);
                pieces[color].count++;

                switch (piece.toLowerCase()) {
                    case PIECES.BISHOP:
                        pieces[color].bishops.push((x + y) % 2);
                        break;
                    case PIECES.KNIGHT:
                        pieces[color].knights++;
                        break;
                }
            }
        }

        // Rey contra rey
        if (pieces.white.count === 1 && pieces.black.count === 1) {
            return true;
        }

        // Rey y alfil/caballo contra rey
        if ((pieces.white.count === 1 && pieces.black.count === 2 &&
             (pieces.black.bishops.length === 1 || pieces.black.knights === 1)) ||
            (pieces.black.count === 1 && pieces.white.count === 2 &&
             (pieces.white.bishops.length === 1 || pieces.white.knights === 1))) {
            return true;
        }

        // Rey y alfil contra rey y alfil (mismo color)
        if (pieces.white.bishops.length === 1 && pieces.black.bishops.length === 1 &&
            pieces.white.count === 2 && pieces.black.count === 2) {
            return pieces.white.bishops[0] === pieces.black.bishops[0];
        }

        return false;
    }

    resign(socketId) {
        const player = this.players.get(socketId);
        if (!player) return false;
        
        this.gameStatus = 'resigned';
        return true;
    }

    getOpponentSocket(socketId) {
        for (const [key] of this.players) {
            if (key !== socketId) return key;
        }
        return null;
    }

    getGameState() {
        return {
            board: this.board,
            currentTurn: this.currentTurn,
            gameStatus: this.gameStatus,
            lastMove: this.lastMove,
            moves: this.moves,
            capturedPieces: this.capturedPieces,
            players: Array.from(this.players.entries()).map(([socketId, player]) => ({
                socketId,
                color: player.color,
                timeLeft: player.timeLeft
            }))
        };
    }
}

// Generar ID único para partida
function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Configuración de Socket.IO
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('createGame', () => {
        const gameId = generateGameId();
        const game = new ChessGame(gameId);
        const playerColor = game.addPlayer(socket.id);
        
        activeGames.set(gameId, game);
        socket.join(gameId);
        
        socket.emit('gameCreated', {
            gameId,
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
        
        // Notificar a ambos jugadores
        io.to(gameId).emit('gameStart', {
            gameState: game.getGameState(),
            white: Array.from(game.players.entries())
                .find(([_, p]) => p.color === 'white')[0],
            black: Array.from(game.players.entries())
                .find(([_, p]) => p.color === 'black')[0]
        });

        socket.emit('playerColor', playerColor);
    });

    socket.on('move', ({ gameId, from, to }) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        if (game.makeMove(from, to, socket.id)) {
            const gameState = game.getGameState();
            
            // Emitir actualización a ambos jugadores
            io.to(gameId).emit('gameUpdate', gameState);
            
            // Si el juego terminó, notificar a ambos jugadores
            if (gameState.gameStatus !== 'active') {
                io.to(gameId).emit('gameOver', {
                    status: gameState.gameStatus,
                    winner: gameState.gameStatus === 'checkmate' ? 
                        (gameState.currentTurn === 'white' ? 'black' : 'white') : 
                        (gameState.gameStatus === 'resigned' ? 
                            game.players.get(socket.id).color === 'white' ? 'black' : 'white' 
                            : null)
                });
            }
        } else {
            socket.emit('error', 'Movimiento inválido');
        }
    });

    socket.on('resign', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        if (game.resign(socket.id)) {
            const gameState = game.getGameState();
            const winner = game.players.get(socket.id).color === 'white' ? 'black' : 'white';
            
            io.to(gameId).emit('gameUpdate', gameState);
            io.to(gameId).emit('gameOver', {
                status: 'resigned',
                winner: winner
            });
        }
    });

    socket.on('offerDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        const opponentSocket = game.getOpponentSocket(socket.id);
        if (opponentSocket) {
            io.to(opponentSocket).emit('drawOffered', {
                from: socket.id
            });
        }
    });

    socket.on('acceptDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        game.gameStatus = 'draw';
        const gameState = game.getGameState();
        
        io.to(gameId).emit('gameUpdate', gameState);
        io.to(gameId).emit('gameOver', {
            status: 'draw',
            winner: null
        });
    });

    socket.on('declineDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        const opponentSocket = game.getOpponentSocket(socket.id);
        if (opponentSocket) {
            io.to(opponentSocket).emit('drawDeclined');
        }
    });

    socket.on('promotePawn', ({ gameId, from, to, newPiece }) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        const validPieces = ['q', 'r', 'b', 'n'];
        if (!validPieces.includes(newPiece.toLowerCase())) {
            socket.emit('error', 'Pieza de promoción inválida');
            return;
        }

        // Verificar si es un peón en la última fila
        const piece = game.board[from.y][from.x];
        if (!piece || piece.toLowerCase() !== 'p' || 
            (game.getPieceColor(piece) === 'white' && to.y !== 0) ||
            (game.getPieceColor(piece) === 'black' && to.y !== 7)) {
            socket.emit('error', 'Promoción inválida');
            return;
        }

        // Realizar el movimiento con promoción
        if (game.makeMove(from, to, socket.id)) {
            // Promover el peón
            game.board[to.y][to.x] = game.getPieceColor(piece) === 'white' ? 
                newPiece.toUpperCase() : newPiece.toLowerCase();
            
            const gameState = game.getGameState();
            io.to(gameId).emit('gameUpdate', gameState);
        } else {
            socket.emit('error', 'Movimiento inválido');
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        
        for (const [gameId, game] of activeGames) {
            if (game.players.has(socket.id)) {
                if (game.players.size === 1) {
                    // Si solo quedaba un jugador, eliminar la partida
                    activeGames.delete(gameId);
                } else {
                    // Notificar al otro jugador
                    const opponentSocket = game.getOpponentSocket(socket.id);
                    if (opponentSocket) {
                        io.to(opponentSocket).emit('opponentDisconnected');
                        game.gameStatus = 'abandoned';
                        io.to(gameId).emit('gameOver', {
                            status: 'abandoned',
                            winner: game.players.get(opponentSocket).color
                        });
                    }
                }
            }
        }
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor ejecutándose en puerto ${PORT}`);
});

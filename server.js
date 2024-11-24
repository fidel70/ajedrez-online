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
        this.currentTurn = 'white';
        this.gameStarted = false;
        this.moves = [];
        this.board = this.getInitialBoard();
        this.gameStatus = 'waiting'; // waiting, active, checkmate, draw, stalemate
        this.lastMove = null;
        this.capturedPieces = {
            white: [],
            black: []
        };
    }

    getInitialBoard() {
        return [
            ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
            ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
            ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ];
    }

    addPlayer(socketId) {
        if (this.players.size >= 2) return false;
        
        if (this.players.size === 0) {
            const color = Math.random() < 0.5 ? 'white' : 'black';
            this.players.set(socketId, {
                color: color,
                ready: true,
                timeLeft: 600000 // 10 minutos en milisegundos
            });
            return color;
        }
        
        const firstPlayerColor = Array.from(this.players.values())[0].color;
        const secondPlayerColor = firstPlayerColor === 'white' ? 'black' : 'white';
        this.players.set(socketId, {
            color: secondPlayerColor,
            ready: true,
            timeLeft: 600000
        });
        this.gameStarted = true;
        this.gameStatus = 'active';
        return secondPlayerColor;
    }

    isValidMove(move, playerColor) {
        if (playerColor !== this.currentTurn) return false;
        if (!this.gameStarted || this.gameStatus !== 'active') return false;

        const { from, to } = move;
        
        // Validar que las coordenadas estén dentro del tablero
        if (!this.isValidPosition(from) || !this.isValidPosition(to)) return false;

        const piece = this.board[from.y][from.x];
        if (!piece) return false;

        // Verificar que el jugador mueve sus propias piezas
        if (playerColor === 'white' && !this.isWhitePiece(piece)) return false;
        if (playerColor === 'black' && !this.isBlackPiece(piece)) return false;

        // Validar el movimiento específico según el tipo de pieza
        return this.isValidPieceMove(from, to, piece);
    }

    isValidPosition(pos) {
        return pos.x >= 0 && pos.x < 8 && pos.y >= 0 && pos.y < 8;
    }

    isWhitePiece(piece) {
        return piece && piece === piece.toUpperCase();
    }

    isBlackPiece(piece) {
        return piece && piece === piece.toLowerCase();
    }

    isValidPieceMove(from, to, piece) {
        const pieceType = piece.toLowerCase();
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);

        switch (pieceType) {
            case 'p': // Peón
                return this.isValidPawnMove(from, to, piece);
            case 'r': // Torre
                return (dx === 0 || dy === 0) && this.isPathClear(from, to);
            case 'n': // Caballo
                return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
            case 'b': // Alfil
                return dx === dy && this.isPathClear(from, to);
            case 'q': // Reina
                return (dx === dy || dx === 0 || dy === 0) && this.isPathClear(from, to);
            case 'k': // Rey
                return dx <= 1 && dy <= 1;
            default:
                return false;
        }
    }

    isValidPawnMove(from, to, piece) {
        const direction = this.isWhitePiece(piece) ? -1 : 1;
        const startRow = this.isWhitePiece(piece) ? 6 : 1;
        const dx = Math.abs(to.x - from.x);
        const dy = to.y - from.y;

        // Movimiento normal hacia adelante
        if (dx === 0 && dy === direction && !this.board[to.y][to.x]) {
            return true;
        }

        // Movimiento inicial de dos casillas
        if (from.y === startRow && dx === 0 && dy === 2 * direction) {
            const middleY = from.y + direction;
            return !this.board[middleY][from.x] && !this.board[to.y][to.x];
        }

        // Captura diagonal
        if (dx === 1 && dy === direction) {
            const targetPiece = this.board[to.y][to.x];
            return targetPiece && this.isWhitePiece(piece) !== this.isWhitePiece(targetPiece);
        }

        return false;
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

    makeMove(move, socketId) {
        const player = this.players.get(socketId);
        if (!player || !this.isValidMove(move, player.color)) {
            return false;
        }

        const { from, to } = move;
        const piece = this.board[from.y][from.x];
        const capturedPiece = this.board[to.y][to.x];

        // Registrar pieza capturada
        if (capturedPiece) {
            const captureColor = this.isWhitePiece(capturedPiece) ? 'white' : 'black';
            this.capturedPieces[captureColor].push(capturedPiece);
        }

        // Realizar el movimiento
        this.board[to.y][to.x] = piece;
        this.board[from.y][from.x] = null;
        
        // Registrar el movimiento
        this.lastMove = {
            piece,
            from,
            to,
            capturedPiece,
            timestamp: Date.now()
        };
        this.moves.push(this.lastMove);

        // Verificar estado del juego
        if (this.isCheckmate()) {
            this.gameStatus = 'checkmate';
        } else if (this.isStalemate()) {
            this.gameStatus = 'stalemate';
        } else if (this.isInsufficientMaterial()) {
            this.gameStatus = 'draw';
        }

        // Cambiar turno
        this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';

        return true;
    }

    isCheckmate() {
        // Implementar lógica de jaque mate
        return false;
    }

    isStalemate() {
        // Implementar lógica de ahogado
        return false;
    }

    isInsufficientMaterial() {
        // Implementar lógica de material insuficiente
        return false;
    }

    removePlayer(socketId) {
        const wasRemoved = this.players.delete(socketId);
        if (wasRemoved && this.gameStarted) {
            this.gameStatus = 'abandoned';
        }
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
            board: this.board,
            currentTurn: this.currentTurn,
            moves: this.moves,
            gameStarted: this.gameStarted,
            gameStatus: this.gameStatus,
            lastMove: this.lastMove,
            capturedPieces: this.capturedPieces,
            players: Array.from(this.players.entries()).map(([socketId, player]) => ({
                socketId,
                color: player.color,
                timeLeft: player.timeLeft
            }))
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
                .find(([_, p]) => p.color === 'white')[0],
            black: Array.from(game.players.entries())
                .find(([_, p]) => p.color === 'black')[0]
        });

        socket.emit('playerColor', playerColor);
    });

    socket.on('move', ({gameId, move}) => {
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partida no encontrada');
            return;
        }

        if (game.makeMove(move, socket.id)) {
            const gameState = game.getGameState();
            io.to(gameId).emit('gameUpdate', gameState);
            
            if (gameState.gameStatus !== 'active') {
                io.to(gameId).emit('gameOver', {
                    status: gameState.gameStatus,
                    winner: gameState.gameStatus === 'checkmate' ? 
                        (gameState.currentTurn === 'white' ? 'black' : 'white') : 
                        null
                });
            }
        } else {
            socket.emit('error', 'Movimiento inválido');
        }
    });

    socket.on('resign', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const player = game.players.get(socket.id);
        if (!player) return;

        game.gameStatus = 'resigned';
        io.to(gameId).emit('gameOver', {
            status: 'resigned',
            winner: player.color === 'white' ? 'black' : 'white'
        });
    });

    socket.on('offerDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const opponentSocket = game.getOpponentSocket(socket.id);
        if (opponentSocket) {
            io.to(opponentSocket).emit('drawOffered');
        }
    });

    socket.on('acceptDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        game.gameStatus = 'draw';
        io.to(gameId).emit('gameOver', {
            status: 'draw',
            winner: null
        });
    });

    socket.on('declineDraw', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const opponentSocket = game.getOpponentSocket(socket.id);
        if (opponentSocket) {
            io.to(opponentSocket).emit('drawDeclined');
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
class ChessGame {
    // ... (código anterior se mantiene igual)

    isCheckmate() {
        const kingColor = this.currentTurn;
        const kingPos = this.findKing(kingColor);
        
        // Si no hay rey, hay un error en el estado del juego
        if (!kingPos) return false;
        
        // Si el rey no está en jaque, no puede ser jaque mate
        if (!this.isKingInCheck(kingColor, kingPos)) return false;
        
        // Verificar si hay algún movimiento legal que saque al rey del jaque
        return !this.hasLegalMoves(kingColor);
    }

    findKing(color) {
        const kingSymbol = color === 'white' ? 'K' : 'k';
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (this.board[y][x] === kingSymbol) {
                    return { x, y };
                }
            }
        }
        return null;
    }

    isKingInCheck(color, kingPos = null) {
        if (!kingPos) {
            kingPos = this.findKing(color);
        }
        
        const oppositeColor = color === 'white' ? 'black' : 'white';
        
        // Verificar si alguna pieza enemiga puede atacar al rey
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.board[y][x];
                if (piece && 
                    (color === 'white' ? this.isBlackPiece(piece) : this.isWhitePiece(piece))) {
                    if (this.isValidPieceMove({ x, y }, kingPos, piece)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    hasLegalMoves(color) {
        // Verificar todos los movimientos posibles para todas las piezas del color
        for (let fromY = 0; fromY < 8; fromY++) {
            for (let fromX = 0; fromX < 8; fromX++) {
                const piece = this.board[fromY][fromX];
                if (!piece || (color === 'white' ? !this.isWhitePiece(piece) : !this.isBlackPiece(piece))) {
                    continue;
                }

                // Verificar todos los destinos posibles
                for (let toY = 0; toY < 8; toY++) {
                    for (let toX = 0; toX < 8; toX++) {
                        const move = {
                            from: { x: fromX, y: fromY },
                            to: { x: toX, y: toY }
                        };
                        
                        // Si encontramos un movimiento legal, retornamos true
                        if (this.isLegalMove(move, color)) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    isLegalMove(move, color) {
        // Verificar si el movimiento es válido según las reglas de la pieza
        if (!this.isValidMove(move, color)) {
            return false;
        }

        // Hacer una copia temporal del tablero
        const tempBoard = this.board.map(row => [...row]);
        
        // Realizar el movimiento en la copia
        const piece = tempBoard[move.from.y][move.from.x];
        tempBoard[move.to.y][move.to.x] = piece;
        tempBoard[move.from.y][move.from.x] = null;
        
        // Verificar si el rey queda en jaque después del movimiento
        const kingPos = this.findKing(color);
        if (!kingPos) return false;
        
        // Verificar si el rey está en jaque después del movimiento
        return !this.isKingInCheckAfterMove(color, kingPos, tempBoard);
    }

    isKingInCheckAfterMove(color, kingPos, tempBoard) {
        const oppositeColor = color === 'white' ? 'black' : 'white';
        
        // Verificar si alguna pieza enemiga puede atacar al rey en la nueva posición
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = tempBoard[y][x];
                if (piece && 
                    (color === 'white' ? this.isBlackPiece(piece) : this.isWhitePiece(piece))) {
                    if (this.isValidPieceMove({ x, y }, kingPos, piece, tempBoard)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    isStalemate() {
        // Si el rey está en jaque, no es ahogado
        if (this.isKingInCheck(this.currentTurn)) {
            return false;
        }
        
        // Si el jugador tiene movimientos legales, no es ahogado
        return !this.hasLegalMoves(this.currentTurn);
    }

    isInsufficientMaterial() {
        const pieces = {
            white: { count: 0, bishops: [], knights: 0 },
            black: { count: 0, bishops: [], knights: 0 }
        };
        
        // Contar todas las piezas
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.board[y][x];
                if (!piece) continue;
                
                const color = this.isWhitePiece(piece) ? 'white' : 'black';
                pieces[color].count++;
                
                if (piece.toLowerCase() === 'b') {
                    pieces[color].bishops.push((x + y) % 2); // 0 para casillas blancas, 1 para negras
                } else if (piece.toLowerCase() === 'n') {
                    pieces[color].knights++;
                }
            }
        }
        
        // Rey contra rey
        if (pieces.white.count === 1 && pieces.black.count === 1) {
            return true;
        }
        
        // Rey y alfil contra rey
        if ((pieces.white.count === 1 && pieces.black.count === 2 && pieces.black.bishops.length === 1) ||
            (pieces.black.count === 1 && pieces.white.count === 2 && pieces.white.bishops.length === 1)) {
            return true;
        }
        
        // Rey y caballo contra rey
        if ((pieces.white.count === 1 && pieces.black.count === 2 && pieces.black.knights === 1) ||
            (pieces.black.count === 1 && pieces.white.count === 2 && pieces.white.knights === 1)) {
            return true;
        }
        
        // Rey y alfil contra rey y alfil del mismo color
        if (pieces.white.bishops.length === 1 && pieces.black.bishops.length === 1 &&
            pieces.white.count === 2 && pieces.black.count === 2) {
            // Verificar si los alfiles están en casillas del mismo color
            return pieces.white.bishops[0] === pieces.black.bishops[0];
        }
        
        return false;
    }

    // Método auxiliar para verificar si una posición está siendo atacada
    isSquareAttacked(pos, byColor) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.board[y][x];
                if (piece && 
                    (byColor === 'white' ? this.isWhitePiece(piece) : this.isBlackPiece(piece))) {
                    if (this.isValidPieceMove({ x, y }, pos, piece)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Método para promoción de peones
    promotePawn(pos, newPiece) {
        const piece = this.board[pos.y][pos.x];
        if (!piece || piece.toLowerCase() !== 'p') return false;
        
        // Verificar si el peón está en la última fila
        if ((this.isWhitePiece(piece) && pos.y === 0) ||
            (this.isBlackPiece(piece) && pos.y === 7)) {
            
            // Validar la pieza de promoción
            const validPieces = ['q', 'r', 'b', 'n'];
            if (!validPieces.includes(newPiece.toLowerCase())) return false;
            
            // Promover el peón
            this.board[pos.y][pos.x] = this.isWhitePiece(piece) ? 
                newPiece.toUpperCase() : newPiece.toLowerCase();
            
            return true;
        }
        return false;
    }
}

// Agregar nuevo evento para la promoción de peones
io.on('connection', (socket) => {
    // ... (eventos anteriores se mantienen igual)

    socket.on('promote', ({gameId, pos, newPiece}) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        if (game.promotePawn(pos, newPiece)) {
            io.to(gameId).emit('gameUpdate', game.getGameState());
        } else {
            socket.emit('error', 'Promoción inválida');
        }
    });
});

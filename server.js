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

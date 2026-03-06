/**
 * ROYAL FLUSH - Texas Hold'em Poker
 * Multiplayer Texas Hold'em
 */

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const HAND_RANKINGS = {
    HIGH_CARD: 1,
    ONE_PAIR: 2,
    TWO_PAIR: 3,
    THREE_OF_A_KIND: 4,
    STRAIGHT: 5,
    FLUSH: 6,
    FULL_HOUSE: 7,
    FOUR_OF_A_KIND: 8,
    STRAIGHT_FLUSH: 9,
    ROYAL_FLUSH: 10
};

const HAND_NAMES = {
    1: 'High Card',
    2: 'One Pair',
    3: 'Two Pair',
    4: 'Three of a Kind',
    5: 'Straight',
    6: 'Flush',
    7: 'Full House',
    8: 'Four of a Kind',
    9: 'Straight Flush',
    10: 'Royal Flush'
};

const STAGES = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const STAGE_NAMES = {
    preflop: 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown'
};

const STARTING_CHIPS = 1000;
const MIN_BET = 20;

// ============================================
// MULTIPLAYER NETWORK STATE
// ============================================

let socket = null;
let localPlayerId = null;
let roomCode = null;
let isHost = false;
let hasCreatedRoom = false;
let shuffleInProgress = false;
let pendingRoundState = null;

// ============================================
// GAME STATE
// ============================================

let gameState = {
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    blinds: { enabled: false, small: 0, big: 0 },
    minBet: MIN_BET,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    stage: 'preflop',
    roundBets: {},
    isUserTurn: false,
    gameActive: false,
    roundActive: false,
    roomCode: null,
    localPlayerId: null,
    raiseLocked: false,
    allInRunout: false,
    allInRunoutRevealedCount: 0
};

// ============================================
// DOM ELEMENTS
// ============================================

const elements = {
    startScreen: document.getElementById('start-screen'),
    gameScreen: document.getElementById('game-screen'),
    gameoverScreen: document.getElementById('gameover-screen'),
    hostGameBtn: document.getElementById('host-game-btn'),
    joinGameBtn: document.getElementById('join-game-btn'),
    playerNameInput: document.getElementById('player-name-input'),
    joinCodeInput: document.getElementById('join-code-input'),
    hostGameCode: document.getElementById('host-game-code'),
    gameCodeText: document.getElementById('game-code-text'),
    playersContainer: document.getElementById('players-container'),
    communityCards: document.getElementById('community-cards'),
    userHand: document.getElementById('user-hand'),
    potAmount: document.getElementById('pot-amount'),
    userChips: document.getElementById('user-chips'),
    roundStage: document.getElementById('round-stage'),
    actionPanel: document.getElementById('action-panel'),
    foldBtn: document.getElementById('fold-btn'),
    checkBtn: document.getElementById('check-btn'),
    callBtn: document.getElementById('call-btn'),
    raiseBtn: document.getElementById('raise-btn'),
    raiseContainer: document.getElementById('raise-container'),
    raiseSlider: document.getElementById('raise-slider'),
    raiseInput: document.getElementById('raise-input'),
    confirmRaise: document.getElementById('confirm-raise'),
    callAmount: document.getElementById('call-amount'),
    messageOverlay: document.getElementById('message-overlay'),
    messageTitle: document.getElementById('message-title'),
    messageText: document.getElementById('message-text'),
    continueBtn: document.getElementById('continue-btn'),
    shuffleOverlay: document.getElementById('shuffle-overlay'),
    allinRunoutOverlay: document.getElementById('allin-runout-overlay'),
    waitingOverlay: document.getElementById('waiting-overlay'),
    waitingNames: document.getElementById('waiting-names'),
    sittingOutMessage: document.getElementById('sitting-out-message'),
    gameoverTitle: document.getElementById('gameover-title'),
    gameoverMessage: document.getElementById('gameover-message'),
    playAgainBtn: document.getElementById('play-again-btn'),

    blindsOverlay: document.getElementById('blinds-overlay'),
    blindsModeOn: document.getElementById('blinds-mode-on'),
    blindsModeOff: document.getElementById('blinds-mode-off'),
    blindsFields: document.getElementById('blinds-fields'),
    smallBlindInput: document.getElementById('small-blind-input'),
    bigBlindInput: document.getElementById('big-blind-input'),
    blindsCancelBtn: document.getElementById('blinds-cancel-btn'),
    blindsConfirmBtn: document.getElementById('blinds-confirm-btn')
};

// ============================================
// MULTIPLAYER HELPERS
// ============================================

function getLocalPlayer() {
    if (localPlayerId == null) return null;
    return gameState.players.find(p => p.id === localPlayerId) || null;
}

function markLocalPlayerFlag() {
    gameState.players.forEach(p => {
        p.isUser = (p.id === localPlayerId);
    });
}

function applyServerState(state) {
    if (!state) return;
    roomCode = state.code || roomCode;
    gameState.roomCode = roomCode;
    gameState.gameActive = state.gameActive;
    gameState.roundActive = state.roundActive;
    gameState.communityCards = state.communityCards || [];
    gameState.pot = state.pot || 0;
    gameState.currentBet = state.currentBet || 0;
    gameState.blinds = state.blinds || gameState.blinds || { enabled: false, small: 0, big: 0 };
    gameState.minBet = state.minBet || (gameState.blinds && gameState.blinds.enabled ? gameState.blinds.big : MIN_BET);
    gameState.dealerIndex = state.dealerIndex ?? gameState.dealerIndex;
    gameState.currentPlayerIndex = state.currentPlayerIndex ?? gameState.currentPlayerIndex;
    gameState.stage = state.stage || gameState.stage || 'preflop';
    gameState.raiseLocked = !!state.raiseLocked;

    const previousPlayers = gameState.players || [];
    gameState.players = (state.players || []).map(sp => {
        const existing = previousPlayers.find(p => p.id === sp.id) || {};
        return {
            ...sp,
            cards: existing.cards || []
        };
    });

    markLocalPlayerFlag();

    // isUserTurn is set only by the 'turn' event (after all players have loaded the round)

    // Don't render cards while shuffle is showing so they only appear after it finishes
    if (shuffleInProgress) return;

    renderTable();
    gameState.players.forEach(p => {
        if (!p.isUser) renderPlayerCards(p, state.stage === 'showdown');
    });
    renderCommunityCards();
    renderUserHand();
    updateUI();
    updateCurrentPlayerHighlight();
    updateSittingOutOverlay();
}

function updateSittingOutOverlay() {
    if (!elements.sittingOutMessage) return;
    const player = getLocalPlayer();
    const isLateJoinerSittingOut = player && player.folded && gameState.roundActive &&
        (!player.cards || player.cards.length === 0);
    if (isLateJoinerSittingOut) {
        elements.sittingOutMessage.classList.add('active');
        elements.userHand.style.display = 'none';
    } else {
        elements.sittingOutMessage.classList.remove('active');
        elements.userHand.style.display = '';
    }
}

function showStartScreen() {
    elements.gameScreen.classList.remove('active');
    elements.gameoverScreen.classList.remove('active');
    elements.startScreen.classList.add('active');
}

function showGameScreen() {
    elements.startScreen.classList.remove('active');
    elements.gameoverScreen.classList.remove('active');
    elements.gameScreen.classList.add('active');
}

function setupSocket() {
    if (socket) return;
    // eslint-disable-next-line no-undef
    socket = io();

    socket.on('roomState', (state) => {
        applyServerState(state);
    });

    socket.on('gameStarted', (state) => {
        applyServerState(state);
        showGameScreen();
    });

    socket.on('roundStarted', async (state) => {
        const popupVisible = elements.messageOverlay && elements.messageOverlay.classList.contains('active');
        if (popupVisible) {
            pendingRoundState = state;
            return;
        }
        await runRoundStartSequence(state);
    });

    socket.on('holeCards', ({ cards }) => {
        const player = getLocalPlayer();
        if (player) {
            player.cards = cards;
            if (!shuffleInProgress) renderUserHand();
            updateSittingOutOverlay();
        }
    });

    socket.on('stageAdvanced', ({ state }) => {
        applyServerState(state);
    });

    socket.on('allInRunout', ({ state, players }) => {
        applyServerState(state);
        if (players && Array.isArray(players)) {
            players.forEach(p => {
                const local = gameState.players.find(lp => lp.id === p.id);
                if (local && p.cards) local.cards = p.cards;
            });
        }
        runAllInRunoutSequence();
    });

    socket.on('waitingForPlayers', ({ names }) => {
        if (!elements.waitingOverlay || !elements.waitingNames) return;
        const text = names.length === 1 ? names[0] : names.join(', ');
        elements.waitingNames.textContent = text;
        elements.waitingOverlay.classList.add('active');
    });

    socket.on('turn', ({ currentPlayerId }) => {
        if (elements.waitingOverlay) elements.waitingOverlay.classList.remove('active');
        const idx = gameState.players.findIndex(p => p.id === currentPlayerId);
        if (idx !== -1) {
            gameState.currentPlayerIndex = idx;
        }
        gameState.isUserTurn = (currentPlayerId === localPlayerId);
        updateCurrentPlayerHighlight();
        if (gameState.isUserTurn) {
            updateActionButtons();
        }
    });

    socket.on('actionApplied', ({ playerId, action, amount }) => {
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            executeAction(player, action, amount);
        }
    });

    socket.on('showdown', ({ state, winners, players }) => {
        applyServerState(state);

        players.forEach(p => {
            const local = gameState.players.find(lp => lp.id === p.id);
            if (local) {
                local.cards = p.cards;
            }
        });

        gameState.players.forEach(p => {
            if (!p.isUser) {
                renderPlayerCards(p, true);
            }
        });

        if (winners && winners.length > 0) {
            const winnerNames = winners.map(w => {
                const pl = gameState.players.find(p => p.id === w.playerId);
                return pl ? pl.name : 'Player';
            }).join(' & ');
            const handName = winners[0].hand.name;
            showMessage(
                winners.length > 1 ? 'Split Pot!' : `${winnerNames} Wins!`,
                `${winnerNames} win${winners.length === 1 ? 's' : ''} the pot with ${handName}!`
            );
        }
    });

    socket.on('roundEnded', ({ state, winnerId }) => {
        applyServerState(state);
        const winner = gameState.players.find(p => p.id === winnerId);
        if (winner) {
            showMessage(
                `${winner.name} Wins!`,
                `${winner.name} wins the pot! All other players folded.`
            );
        }
    });

    socket.on('gameEnded', (payload) => {
        const state = payload && payload.state != null ? payload.state : payload;
        const winnerNames = payload && payload.winnerNames;
        const handName = payload && payload.handName;
        applyServerState(state);
        endGame(winnerNames, handName);
    });

    socket.on('playerEliminated', ({ winnerNames, handName } = {}) => {
        let detail = "You went all-in and finished with $0.";
        if (winnerNames) {
            detail += "\n\n" + (winnerNames + " won" + (handName ? " with a " + handName + "." : " (all others folded)."));
        }
        showMessage(
            "You're Out!",
            detail
        ).then(() => {
            roomCode = null;
            localPlayerId = null;
            hasCreatedRoom = false;
            isHost = false;
            gameState.players = [];
            gameState.gameActive = false;
            showStartScreen();
        });
    });
}

function handleHostGameClick() {
    if (!socket) return;

    const nameInput = elements.playerNameInput ? elements.playerNameInput.value.trim() : '';
    const playerName = nameInput || 'Host';

    if (!hasCreatedRoom) {
        socket.emit('createRoom', { playerName }, (response) => {
            if (!response || !response.ok) {
                alert(response && response.error ? response.error : 'Unable to create game.');
                return;
            }
            isHost = true;
            hasCreatedRoom = true;
            roomCode = response.code;
            localPlayerId = response.playerId;
            gameState.localPlayerId = localPlayerId;
            applyServerState(response.state);

            if (elements.hostGameCode && elements.gameCodeText) {
                elements.hostGameCode.style.display = 'flex';
                elements.gameCodeText.textContent = roomCode;
            }

            const labelSpan = elements.hostGameBtn && elements.hostGameBtn.querySelector('span');
            if (labelSpan) {
                labelSpan.textContent = 'Start Game';
            }
        });
    } else if (roomCode && !gameState.gameActive) {
        showBlindsConfigModal().then((blindsConfig) => {
            if (!blindsConfig) return;
            socket.emit('startGame', { code: roomCode, blinds: blindsConfig });
        });
    }
}

function setBlindsFieldsEnabled(enabled) {
    if (!elements.smallBlindInput || !elements.bigBlindInput) return;
    elements.smallBlindInput.disabled = !enabled;
    elements.bigBlindInput.disabled = !enabled;
    if (elements.blindsFields) {
        elements.blindsFields.style.opacity = enabled ? '1' : '0.6';
        elements.blindsFields.style.pointerEvents = enabled ? 'auto' : 'none';
    }
}

function normalizeBlindAmount(value) {
    const n = parseInt(String(value || ''), 10);
    if (Number.isNaN(n) || !Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

function showBlindsConfigModal() {
    return new Promise((resolve) => {
        if (!elements.blindsOverlay) {
            resolve({ enabled: false, small: 0, big: 0 });
            return;
        }

        const cleanup = () => {
            elements.blindsOverlay.classList.remove('active');
            document.removeEventListener('keydown', onKeyDown);
            if (elements.blindsCancelBtn) elements.blindsCancelBtn.onclick = null;
            if (elements.blindsConfirmBtn) elements.blindsConfirmBtn.onclick = null;
            if (elements.blindsModeOn) elements.blindsModeOn.onchange = null;
            if (elements.blindsModeOff) elements.blindsModeOff.onchange = null;
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        };

        const updateMode = () => {
            const enabled = !!(elements.blindsModeOn && elements.blindsModeOn.checked);
            setBlindsFieldsEnabled(enabled);
        };

        if (elements.blindsModeOn) elements.blindsModeOn.checked = true;
        if (elements.blindsModeOff) elements.blindsModeOff.checked = false;
        updateMode();

        if (elements.blindsModeOn) elements.blindsModeOn.onchange = updateMode;
        if (elements.blindsModeOff) elements.blindsModeOff.onchange = updateMode;

        if (elements.blindsCancelBtn) {
            elements.blindsCancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };
        }

        if (elements.blindsConfirmBtn) {
            elements.blindsConfirmBtn.onclick = () => {
                const enabled = !!(elements.blindsModeOn && elements.blindsModeOn.checked);
                if (!enabled) {
                    cleanup();
                    resolve({ enabled: false, small: 0, big: 0 });
                    return;
                }

                const small = normalizeBlindAmount(elements.smallBlindInput ? elements.smallBlindInput.value : '');
                const big = normalizeBlindAmount(elements.bigBlindInput ? elements.bigBlindInput.value : '');

                if (!small || !big || small <= 0 || big <= 0) {
                    alert('Please enter positive whole numbers for both blinds.');
                    return;
                }
                if (big < small) {
                    alert('Big blind must be greater than or equal to small blind.');
                    return;
                }

                cleanup();
                resolve({ enabled: true, small, big });
            };
        }

        elements.blindsOverlay.classList.add('active');
        document.addEventListener('keydown', onKeyDown);

        // Focus first input for quick entry
        if (elements.smallBlindInput) {
            elements.smallBlindInput.focus();
            elements.smallBlindInput.select();
        }
    });
}

function handleJoinGameClick() {
    if (!socket) return;

    const nameInput = elements.playerNameInput ? elements.playerNameInput.value.trim() : '';
    const playerName = nameInput || 'Player';
    const codeRaw = elements.joinCodeInput ? elements.joinCodeInput.value.trim() : '';
    const code = codeRaw.toUpperCase();
    if (!code) {
        alert('Please enter a game code to join.');
        return;
    }

    socket.emit('joinRoom', { code, playerName }, (response) => {
        if (!response || !response.ok) {
            alert(response && response.error ? response.error : 'Unable to join game.');
            return;
        }

        isHost = false;
        roomCode = response.code;
        localPlayerId = response.playerId;
        gameState.localPlayerId = localPlayerId;
        applyServerState(response.state);

        showGameScreen();
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffleArray(array) {
    // Fisher-Yates shuffle for true randomness
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank, value: RANK_VALUES[rank] });
        }
    }
    return shuffleArray(deck);
}

function isRedSuit(suit) {
    return suit === '♥' || suit === '♦';
}

// ============================================
// CARD RENDERING
// ============================================

function createCardElement(card, faceDown = false, animationDelay = 0) {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${faceDown ? 'face-down' : (isRedSuit(card.suit) ? 'red' : 'black')}`;
    
    if (!faceDown) {
        cardEl.innerHTML = `
            <div class="card-corner top">
                <span class="card-rank">${card.rank}</span>
                <span class="card-suit">${card.suit}</span>
            </div>
            <span class="card-center">${card.suit}</span>
            <div class="card-corner bottom">
                <span class="card-rank">${card.rank}</span>
                <span class="card-suit">${card.suit}</span>
            </div>
        `;
    }
    
    if (animationDelay > 0) {
        cardEl.classList.add('dealing');
        cardEl.style.animationDelay = `${animationDelay}ms`;
    }
    
    return cardEl;
}

// ============================================
// HAND EVALUATION
// ============================================

function evaluateHand(holeCards, communityCards) {
    const allCards = [...holeCards, ...communityCards];
    
    if (allCards.length < 5) {
        return { rank: HAND_RANKINGS.HIGH_CARD, value: 0, name: 'High Card', cards: [] };
    }
    
    // Generate all 5-card combinations
    const combinations = getCombinations(allCards, 5);
    let bestHand = { rank: 0, value: 0, name: '', cards: [] };
    
    for (const combo of combinations) {
        const handResult = evaluateFiveCards(combo);
        if (compareHands(handResult, bestHand) > 0) {
            bestHand = handResult;
        }
    }
    
    return bestHand;
}

function getCombinations(array, size) {
    const result = [];
    
    function combine(start, combo) {
        if (combo.length === size) {
            result.push([...combo]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            combo.push(array[i]);
            combine(i + 1, combo);
            combo.pop();
        }
    }
    
    combine(0, []);
    return result;
}

function evaluateFiveCards(cards) {
    const sortedCards = [...cards].sort((a, b) => b.value - a.value);
    const ranks = sortedCards.map(c => c.value);
    const suits = sortedCards.map(c => c.suit);
    
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = checkStraight(ranks);
    const isLowStraight = checkLowStraight(ranks);
    
    const rankCounts = {};
    for (const rank of ranks) {
        rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    }
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    // Royal Flush
    if (isFlush && isStraight && ranks[0] === 14) {
        return { rank: HAND_RANKINGS.ROYAL_FLUSH, value: calculateValue(ranks), name: 'Royal Flush', cards: sortedCards };
    }
    
    // Straight Flush
    if (isFlush && (isStraight || isLowStraight)) {
        return { rank: HAND_RANKINGS.STRAIGHT_FLUSH, value: calculateValue(isLowStraight ? [5,4,3,2,1] : ranks), name: 'Straight Flush', cards: sortedCards };
    }
    
    // Four of a Kind
    if (counts[0] === 4) {
        return { rank: HAND_RANKINGS.FOUR_OF_A_KIND, value: calculateValue(sortByCount(ranks, rankCounts)), name: 'Four of a Kind', cards: sortedCards };
    }
    
    // Full House
    if (counts[0] === 3 && counts[1] === 2) {
        return { rank: HAND_RANKINGS.FULL_HOUSE, value: calculateValue(sortByCount(ranks, rankCounts)), name: 'Full House', cards: sortedCards };
    }
    
    // Flush
    if (isFlush) {
        return { rank: HAND_RANKINGS.FLUSH, value: calculateValue(ranks), name: 'Flush', cards: sortedCards };
    }
    
    // Straight
    if (isStraight || isLowStraight) {
        return { rank: HAND_RANKINGS.STRAIGHT, value: calculateValue(isLowStraight ? [5,4,3,2,1] : ranks), name: 'Straight', cards: sortedCards };
    }
    
    // Three of a Kind
    if (counts[0] === 3) {
        return { rank: HAND_RANKINGS.THREE_OF_A_KIND, value: calculateValue(sortByCount(ranks, rankCounts)), name: 'Three of a Kind', cards: sortedCards };
    }
    
    // Two Pair
    if (counts[0] === 2 && counts[1] === 2) {
        return { rank: HAND_RANKINGS.TWO_PAIR, value: calculateValue(sortByCount(ranks, rankCounts)), name: 'Two Pair', cards: sortedCards };
    }
    
    // One Pair
    if (counts[0] === 2) {
        return { rank: HAND_RANKINGS.ONE_PAIR, value: calculateValue(sortByCount(ranks, rankCounts)), name: 'One Pair', cards: sortedCards };
    }
    
    // High Card
    return { rank: HAND_RANKINGS.HIGH_CARD, value: calculateValue(ranks), name: 'High Card', cards: sortedCards };
}

function checkStraight(ranks) {
    for (let i = 0; i < ranks.length - 1; i++) {
        if (ranks[i] - ranks[i + 1] !== 1) return false;
    }
    return true;
}

function checkLowStraight(ranks) {
    const lowStraight = [14, 5, 4, 3, 2];
    const sortedRanks = [...ranks].sort((a, b) => b - a);
    return JSON.stringify(sortedRanks) === JSON.stringify(lowStraight);
}

function sortByCount(ranks, counts) {
    return [...ranks].sort((a, b) => {
        if (counts[b] !== counts[a]) return counts[b] - counts[a];
        return b - a;
    });
}

function calculateValue(ranks) {
    let value = 0;
    for (let i = 0; i < ranks.length; i++) {
        value += ranks[i] * Math.pow(15, ranks.length - 1 - i);
    }
    return value;
}

function compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
        return hand1.rank - hand2.rank;
    }
    return hand1.value - hand2.value;
}

// ============================================
// GAME INITIALIZATION
// ============================================

function initializeGame() {
    if (elements.hostGameBtn) {
        elements.hostGameBtn.addEventListener('click', handleHostGameClick);
    }
    if (elements.joinGameBtn) {
        elements.joinGameBtn.addEventListener('click', handleJoinGameClick);
    }

    elements.playAgainBtn.addEventListener('click', resetGame);
    
    // Action button listeners
    elements.foldBtn.addEventListener('click', () => handlePlayerAction('fold'));
    elements.checkBtn.addEventListener('click', () => handlePlayerAction('check'));
    elements.callBtn.addEventListener('click', () => handlePlayerAction('call'));
    elements.raiseBtn.addEventListener('click', showRaiseControls);
    elements.confirmRaise.addEventListener('click', confirmRaise);
    elements.continueBtn.addEventListener('click', handleContinue);
    
    // Raise slider
    elements.raiseSlider.addEventListener('input', updateRaiseAmount);
    elements.raiseInput.addEventListener('input', updateRaiseSlider);

    setupSocket();
}

async function startGame() {
    // In multiplayer mode the server controls game flow.
    // This function is kept for compatibility but no longer used.
}

function resetGame() {
    // For multiplayer, the simplest reset is a full reload,
    // which clears socket connections and local state.
    window.location.reload();
}

// ============================================
// ROUND MANAGEMENT
// ============================================

async function startNewRound() {
    // In multiplayer mode, the server controls round flow.
}

async function showShuffleAnimation() {
    elements.shuffleOverlay.classList.add('active');
    await sleep(2000);
    elements.shuffleOverlay.classList.remove('active');
}

async function dealCards() {
    const activePlayerCount = gameState.players.filter(p => !p.folded).length;
    
    // Deal two cards to each active player
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < gameState.players.length; i++) {
            const playerIndex = (gameState.dealerIndex + 1 + i) % gameState.players.length;
            const player = gameState.players[playerIndex];
            
            if (!player.folded) {
                player.cards.push(gameState.deck.pop());
                await sleep(100);
                renderPlayerCards(player);
            }
        }
    }
    
    // Show user's cards
    renderUserHand();
}

async function runBettingRound() {
    // Multiplayer: server controls betting; this is never called.
}

function getNextActivePlayer(currentIndex) {
    let nextIndex = (currentIndex + 1) % gameState.players.length;
    let attempts = 0;
    
    while ((gameState.players[nextIndex].folded || gameState.players[nextIndex].chips <= 0) && attempts < gameState.players.length) {
        nextIndex = (nextIndex + 1) % gameState.players.length;
        attempts++;
    }
    
    return nextIndex;
}

async function advanceStage() {
    const stageIndex = STAGES.indexOf(gameState.stage);
    
    if (stageIndex >= STAGES.length - 2) {
        // Showdown
        await showdown();
        return;
    }
    
    // Reset bets for new stage
    for (const player of gameState.players) {
        player.currentBet = 0;
    }
    gameState.currentBet = 0;
    
    // Advance stage
    gameState.stage = STAGES[stageIndex + 1];
    elements.roundStage.textContent = STAGE_NAMES[gameState.stage];
    
    // Deal community cards
    await dealCommunityCards();
    
    // Start new betting round from first active player after dealer
    gameState.currentPlayerIndex = getNextActivePlayer(gameState.dealerIndex);
    
    await runBettingRound();
}

async function dealCommunityCards() {
    let cardsToReveal = 0;
    
    if (gameState.stage === 'flop') {
        // Burn one card
        gameState.deck.pop();
        cardsToReveal = 3;
    } else if (gameState.stage === 'turn' || gameState.stage === 'river') {
        // Burn one card
        gameState.deck.pop();
        cardsToReveal = 1;
    }
    
    for (let i = 0; i < cardsToReveal; i++) {
        gameState.communityCards.push(gameState.deck.pop());
        await sleep(300);
        renderCommunityCards();
    }
}

async function showdown() {
    gameState.stage = 'showdown';
    elements.roundStage.textContent = 'Showdown';
    
    // Reveal all cards
    const activePlayers = gameState.players.filter(p => !p.folded);
    
    for (const player of activePlayers) {
        if (!player.isUser) {
            renderPlayerCards(player, true); // Show cards
        }
    }
    
    await sleep(1000);
    
    // Evaluate hands
    const results = activePlayers.map(player => ({
        player,
        hand: evaluateHand(player.cards, gameState.communityCards)
    }));
    
    // Sort by hand strength
    results.sort((a, b) => compareHands(b.hand, a.hand));
    
    // Determine winner(s) - handle ties
    const winners = [results[0]];
    for (let i = 1; i < results.length; i++) {
        if (compareHands(results[i].hand, results[0].hand) === 0) {
            winners.push(results[i]);
        }
    }
    
    // Award pot
    const splitPot = Math.floor(gameState.pot / winners.length);
    for (const winner of winners) {
        winner.player.chips += splitPot;
    }
    
    // Show winner
    const winnerNames = winners.map(w => w.player.name).join(' & ');
    const handName = winners[0].hand.name;
    
    await showMessage(
        winners.length > 1 ? 'Split Pot!' : `${winnerNames} Wins!`,
        `${winnerNames} win${winners.length === 1 ? 's' : ''} $${gameState.pot} with ${handName}!`
    );
    
    // Highlight winner
    for (const winner of winners) {
        const seatEl = document.querySelector(`[data-player-id="${winner.player.id}"]`);
        if (seatEl) {
            seatEl.classList.add('winner');
        }
    }
    
    await sleep(2000);
    
    // Clear winner highlight
    document.querySelectorAll('.player-seat').forEach(el => el.classList.remove('winner'));
}

async function endRound(winner) {
    // Award pot to winner
    winner.chips += gameState.pot;
    
    await showMessage(
        `${winner.name} Wins!`,
        `${winner.name} wins $${gameState.pot}! All other players folded.`
    );
    
    updateUI();
}

function endGame(winnerNames, handName) {
    gameState.gameActive = false;
    
    // Find winner
    const sortedPlayers = [...gameState.players].sort((a, b) => b.chips - a.chips);
    const winner = sortedPlayers[0];
    
    const local = getLocalPlayer();
    const isUserWinner = winner && local && winner.id === local.id;
    
    const title = isUserWinner ? 'Congratulations!' : 'Game Over';
    let msg = isUserWinner
        ? `You won with $${winner ? winner.chips : 0}!`
        : `${winner ? winner.name : 'Player'} won with $${winner ? winner.chips : 0}. You finished with $${local ? local.chips : 0}.`;
    if (winnerNames && handName) {
        msg += "\n\n" + (isUserWinner ? "You won with a " + handName + "." : winnerNames + " won with " + handName + ".");
    }
    showMessage(title, msg).then(() => {
        roomCode = null;
        localPlayerId = null;
        hasCreatedRoom = false;
        isHost = false;
        gameState.players = [];
        gameState.gameActive = false;
        showStartScreen();
    });
}

// ============================================
// USER ACTIONS
// ============================================

function waitForUserAction() {
    return new Promise(resolve => {
        window.userActionResolver = resolve;
    });
}

async function handlePlayerAction(action) {
    if (!gameState.isUserTurn || !socket || !roomCode || localPlayerId == null) return;
    
    const player = getLocalPlayer();
    if (!player) return;
    
    const callAmount = Math.max(0, gameState.currentBet - (player.currentBet || 0));
    
    if (action === 'check') {
        if (callAmount !== 0) return;
        socket.emit('playerAction', { code: roomCode, playerId: localPlayerId, action: 'check' });
    } else if (action === 'fold') {
        socket.emit('playerAction', { code: roomCode, playerId: localPlayerId, action: 'fold' });
    } else if (action === 'call') {
        const amount = Math.min(callAmount, player.chips || 0);
        if (amount <= 0) return;
        socket.emit('playerAction', { code: roomCode, playerId: localPlayerId, action: 'call', amount });
    }
}

function showRaiseControls() {
    if (!gameState.isUserTurn) return;
    if (gameState.raiseLocked) return;
    
    const player = getLocalPlayer();
    if (!player) return;
    // Max total bet = min effective stack (chips + currentBet) among non-folded; re-raise is added on top of current bet up to this
    const nonFolded = gameState.players.filter(p => !p.folded);
    const effectiveMaxBet = nonFolded.length === 0 ? player.chips : Math.min(...nonFolded.map(p => (p.chips || 0) + (p.currentBet || 0)));
    const myMaxTotalBet = (player.chips || 0) + (player.currentBet || 0);
    const maxRaise = Math.min(effectiveMaxBet, myMaxTotalBet);
    const minIncrement = gameState.minBet || (gameState.blinds && gameState.blinds.enabled ? gameState.blinds.big : MIN_BET);
    const minRaise = gameState.currentBet + minIncrement;
    const minRaiseClamped = Math.min(minRaise, maxRaise);
    
    elements.raiseSlider.min = minRaiseClamped;
    elements.raiseSlider.max = maxRaise;
    elements.raiseSlider.value = Math.min(Math.max(minRaiseClamped, minRaise * 2), maxRaise);
    elements.raiseInput.value = elements.raiseSlider.value;
    
    elements.raiseContainer.style.display = 'flex';
}

function updateRaiseAmount() {
    elements.raiseInput.value = elements.raiseSlider.value;
}

function updateRaiseSlider() {
    const value = parseInt(elements.raiseInput.value, 10) || 0;
    const min = parseInt(elements.raiseSlider.min, 10);
    const max = parseInt(elements.raiseSlider.max, 10);
    elements.raiseSlider.value = Math.max(min, Math.min(max, value));
}

async function confirmRaise() {
    if (!gameState.isUserTurn) return;
    
    const player = getLocalPlayer();
    if (!player || !socket || !roomCode || localPlayerId == null) return;
    const raiseAmount = parseInt(elements.raiseInput.value, 10);
    
    elements.raiseContainer.style.display = 'none';
    
    if (!Number.isNaN(raiseAmount) && raiseAmount > 0) {
        socket.emit('playerAction', {
            code: roomCode,
            playerId: localPlayerId,
            action: 'raise',
            amount: raiseAmount
        });
    }
}

async function executeAction(player, action, amount = 0) {
    const playerSeat = document.querySelector(`[data-player-id="${player.id}"]`);
    
    if (action === 'fold') {
        player.folded = true;
        
        // Animate cards folding
        if (playerSeat) {
            const cards = playerSeat.querySelectorAll('.card');
            cards.forEach(card => card.classList.add('folding'));
        }
        
        if (player.isUser) {
            const userCards = elements.userHand.querySelectorAll('.card');
            userCards.forEach(card => card.classList.add('folding'));
        }
        
        showPlayerAction(player, 'Fold');
    } else if (action === 'check') {
        showPlayerAction(player, 'Check');
    } else if (action === 'call') {
        showPlayerAction(player, `Call $${amount}`);
    } else if (action === 'raise') {
        showPlayerAction(player, `Raise to $${amount}`);
    } else if (action === 'all-in') {
        showPlayerAction(player, 'All-In!');
    }
    
    updateUI();
}

function showPlayerAction(player, actionText) {
    const playerSeat = document.querySelector(`[data-player-id="${player.id}"]`);
    if (playerSeat) {
        const actionEl = playerSeat.querySelector('.player-action');
        if (actionEl) {
            actionEl.textContent = actionText;
            actionEl.style.opacity = '1';
            setTimeout(() => {
                actionEl.style.opacity = '0.7';
            }, 1500);
        }
    }
}

// ============================================
// UI RENDERING
// ============================================

function renderTable() {
    elements.playersContainer.innerHTML = '';
    
    const numPlayers = gameState.players.length;
    const positions = getPlayerPositions(numPlayers);
    let opponentIndex = 0;

    gameState.players.forEach((player) => {
        if (player.isUser) return; // User is rendered separately

        const seat = document.createElement('div');
        seat.className = 'player-seat';
        seat.dataset.playerId = player.id;

        const pos = positions[opponentIndex + 1] || positions[1];
        opponentIndex++;
        seat.style.left = `${pos.x}%`;
        seat.style.top = `${pos.y}%`;
        seat.style.transform = 'translate(-50%, -50%)';
        
        seat.innerHTML = `
            <div class="player-cards"></div>
            <div class="player-info-box">
                ${(gameState.players[gameState.dealerIndex]?.id === player.id) ? '<div class="dealer-chip">D</div>' : ''}
                <div class="player-name">${player.name}</div>
                <div class="player-chips">$${player.chips}</div>
                <div class="player-bet"></div>
                <div class="player-action"></div>
            </div>
        `;
        
        elements.playersContainer.appendChild(seat);
    });
    
    // Add dealer chip to user if needed
    if (gameState.dealerIndex === 0) {
        // User is dealer - show somewhere
    }
    
    updateUI();
}

function getPlayerPositions(numPlayers) {
    const positions = [];
    
    // User is always at bottom center (position 0)
    positions.push({ x: 50, y: 88 });
    
    const numOpponents = numPlayers - 1;
    
    // Ellipse parameters
    const centerX = 50;
    const centerY = 42;
    const radiusX = 47;
    const radiusY = 40;
    
    const startAngle = 220;  
    const endAngle = -40;    
    const totalRange = startAngle - endAngle;
    
    for (let i = 0; i < numOpponents; i++) {
        let angle;

        if (numOpponents === 1) {
            angle = 90; 
        } else {
            const step = totalRange / (numOpponents - 1);
            angle = startAngle - (step * i);
        }
        
        const radians = (angle * Math.PI) / 180;
        
        const x = centerX + radiusX * Math.cos(radians);
        const y = centerY - radiusY * Math.sin(radians);
        
        positions.push({ x, y });
    }
    
    return positions;
}

function renderPlayerCards(player, showCards = false) {
    const seat = document.querySelector(`[data-player-id="${player.id}"]`);
    if (!seat) return;

    const cardsContainer = seat.querySelector('.player-cards');
    cardsContainer.innerHTML = '';

    const cardsToShow = player.cards && player.cards.length > 0
        ? player.cards
        : (gameState.roundActive && !player.folded ? [{}, {}] : []);

    cardsToShow.forEach((card, index) => {
        const isFaceDown = !showCards && !player.isUser;
        const cardEl = createCardElement(card.suit ? card : { suit: '', rank: '', value: 0 }, isFaceDown, 0);
        cardsContainer.appendChild(cardEl);
    });
}

function renderUserHand() {
    elements.userHand.innerHTML = '';
    const user = getLocalPlayer();
    if (!user || !user.cards) return;
    
    user.cards.forEach((card) => {
        const cardEl = createCardElement(card, false, 0);
        elements.userHand.appendChild(cardEl);
    });
}

function clearCommunityCards() {
    const slots = elements.communityCards.querySelectorAll('.card-slot');
    slots.forEach(slot => {
        const existingCard = slot.querySelector('.card');
        if (existingCard) {
            slot.removeChild(existingCard);
        }
    });
}

function renderCommunityCards() {
    const slots = elements.communityCards.querySelectorAll('.card-slot');
    
    // Clear previous cards from slots
    slots.forEach(slot => {
        const existingCard = slot.querySelector('.card');
        if (existingCard) {
            slot.removeChild(existingCard);
        }
    });

    const cardsToShow = gameState.allInRunout
        ? gameState.communityCards.slice(0, gameState.allInRunoutRevealedCount)
        : gameState.communityCards;
    
    cardsToShow.forEach((card, index) => {
        const slot = slots[index];
        if (slot) {
            const cardEl = createCardElement(card, false, 0);
            
            // Position card absolutely within slot
            cardEl.style.position = 'absolute';
            cardEl.style.top = '0';
            cardEl.style.left = '0';
            
            slot.style.position = 'relative';
            slot.appendChild(cardEl);
        }
    });
}

function updateUI() {
    // Update pot
    elements.potAmount.textContent = gameState.pot;
    
    // Update user chips
    const user = getLocalPlayer();
    elements.userChips.textContent = user ? user.chips : 0;
    
    // Update stage
    elements.roundStage.textContent = STAGE_NAMES[gameState.stage];
    
    // Update all player displays
    gameState.players.forEach(player => {
        if (player.isUser) return;
        
        const seat = document.querySelector(`[data-player-id="${player.id}"]`);
        if (!seat) return;
        
        const chipsEl = seat.querySelector('.player-chips');
        const betEl = seat.querySelector('.player-bet');
        
        if (chipsEl) chipsEl.textContent = `$${player.chips}`;
        if (betEl) betEl.textContent = player.currentBet > 0 ? `Bet: $${player.currentBet}` : '';
        
        if (player.folded) {
            seat.classList.add('folded');
        } else {
            seat.classList.remove('folded');
        }
    });
}

function updateCurrentPlayerHighlight() {
    // Remove all highlights
    document.querySelectorAll('.player-seat').forEach(el => {
        el.classList.remove('current-turn');
    });
    
    // Add highlight to current player
    const currentPlayer = gameState.players[gameState.currentPlayerIndex] || null;
    if (currentPlayer && !currentPlayer.isUser) {
        const seat = document.querySelector(`[data-player-id="${currentPlayer.id}"]`);
        if (seat) {
            seat.classList.add('current-turn');
        }
    }
    
    // Highlight action panel for user (disabled during all-in runout)
    if (gameState.allInRunout) {
        elements.actionPanel.classList.add('disabled');
    } else if (currentPlayer && currentPlayer.isUser) {
        elements.actionPanel.classList.remove('disabled');
    } else {
        elements.actionPanel.classList.add('disabled');
    }
}

function updateActionButtons() {
    const player = getLocalPlayer();
    if (!player) return;
    const callAmount = Math.max(0, gameState.currentBet - (player.currentBet || 0));
    
    // Update call amount display
    elements.callAmount.textContent = callAmount;
    
    // Check button - only available if no one has bet
    elements.checkBtn.disabled = callAmount > 0;
    
    // Call button - only available if there's a bet to call
    elements.callBtn.disabled = callAmount === 0;
    elements.callBtn.querySelector('.btn-text').textContent = callAmount >= player.chips 
        ? `All-In $${player.chips}` 
        : `Call $${callAmount}`;
    
    // Raise button - always available if player has chips
    elements.raiseBtn.disabled = player.chips <= 0 || gameState.raiseLocked;
    if (gameState.raiseLocked) {
        elements.raiseContainer.style.display = 'none';
    }
}

async function showMessage(title, text) {
    elements.messageTitle.textContent = title;
    elements.messageText.textContent = text;
    elements.messageOverlay.classList.add('active');
    
    return new Promise(resolve => {
        window.messageResolver = resolve;
    });
}

const ALLIN_RUNOUT_DELAY_MS = 2000;

async function runAllInRunoutSequence() {
    gameState.allInRunout = true;
    gameState.allInRunoutRevealedCount = 0;
    const overlay = elements.allinRunoutOverlay;
    const overlayContent = overlay ? overlay.querySelector('.allin-runout-content') : null;
    if (overlay) {
        overlay.classList.add('active');
        overlay.classList.remove('undimmed');
        if (overlayContent) overlayContent.classList.remove('faded');
    }
    if (elements.gameScreen) elements.gameScreen.classList.add('allin-runout-active');
    updateCurrentPlayerHighlight();
    renderCommunityCards();

    // Show only opponents still in the hand (all-in) with miniature cards; keep folded face-down
    gameState.players.forEach(p => {
        renderPlayerCards(p, !p.folded);
    });

    // Fade out the message and undim the screen after ~2 seconds
    await sleep(2000);
    if (overlayContent) overlayContent.classList.add('faded');
    if (overlay) overlay.classList.add('undimmed');

    const totalToReveal = gameState.communityCards.length;
    for (let count = 1; count <= totalToReveal; count++) {
        await sleep(ALLIN_RUNOUT_DELAY_MS);
        gameState.allInRunoutRevealedCount = count;
        renderCommunityCards();
    }

    // Pause 2 seconds after final card before proceeding to showdown
    await sleep(ALLIN_RUNOUT_DELAY_MS);

    gameState.allInRunout = false;
    gameState.allInRunoutRevealedCount = 0;
    if (elements.gameScreen) elements.gameScreen.classList.remove('allin-runout-active');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.classList.remove('undimmed');
    }
    if (overlayContent) overlayContent.classList.remove('faded');
    updateCurrentPlayerHighlight();

    if (socket && roomCode) {
        socket.emit('allInRunoutComplete', { code: roomCode });
    }
}

async function runRoundStartSequence(state) {
    if (!state) return;
    gameState.isUserTurn = false;
    shuffleInProgress = true;
    applyServerState(state);
    await showShuffleAnimation();
    shuffleInProgress = false;
    clearCommunityCards();
    elements.userHand.innerHTML = '';
    gameState.players.forEach(p => { if (p.id !== localPlayerId) p.cards = []; });
    applyServerState(state);
    if (socket && roomCode != null && localPlayerId != null) {
        socket.emit('playerReady', { code: roomCode, playerId: localPlayerId });
    }
}

function handleContinue() {
    elements.messageOverlay.classList.remove('active');

    if (window.messageResolver) {
        window.messageResolver();
        window.messageResolver = null;
    }

    if (pendingRoundState) {
        const state = pendingRoundState;
        pendingRoundState = null;
        runRoundStartSequence(state);
    }
}

// ============================================
// INITIALIZE
// ============================================

document.addEventListener('DOMContentLoaded', initializeGame);


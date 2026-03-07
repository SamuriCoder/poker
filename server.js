const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// ============================================
// CONSTANTS & CONFIGURATION (mirrors game.js)
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

const STAGES = ['preflop', 'flop', 'turn', 'river', 'showdown'];

const STARTING_CHIPS = 1000;
const MIN_BET = 20;
const MAX_PLAYERS_PER_ROOM = 8;

// ============================================
// SERVER SETUP
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

// ============================================
// ROOM MANAGEMENT
// ============================================

/**
 * rooms[code] = {
 *   code,
 *   players: [{ id, name, chips, folded, isAllIn, currentBet, socketId, connected }],
 *   deck,
 *   communityCards,
 *   pot,
 *   currentBet,
 *   dealerIndex,
 *   currentPlayerIndex,
 *   stage,
 *   roundActive,
 *   gameActive
 * }
 */
const rooms = {};

function generateGameCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[code]);
  return code;
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

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getPublicState(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      folded: p.folded,
      isAllIn: p.isAllIn,
      currentBet: p.currentBet,
      connected: p.connected
    })),
    communityCards: room.communityCards,
    pot: room.pot,
    currentBet: room.currentBet,
    blinds: room.blinds || { enabled: false, small: 0, big: 0 },
    minBet: room.minBet || MIN_BET,
    dealerIndex: room.dealerIndex,
    currentPlayerIndex: room.currentPlayerIndex,
    stage: room.stage,
    raiseLocked: !!room.raiseLocked,
    roundActive: room.roundActive,
    gameActive: room.gameActive
  };
}

function findRoomBySocket(socketId) {
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const idx = room.players.findIndex(p => p.socketId === socketId);
    if (idx !== -1) {
      return { room, playerIndex: idx };
    }
  }
  return null;
}

// ============================================
// HAND EVALUATION (copied from game.js)
// ============================================

function evaluateHand(holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];

  if (allCards.length < 5) {
    return { rank: HAND_RANKINGS.HIGH_CARD, value: 0, name: 'High Card', cards: [] };
  }

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

  if (isFlush && isStraight && ranks[0] === 14) {
    return { rank: HAND_RANKINGS.ROYAL_FLUSH, value: calculateValue(ranks), name: 'Royal Flush', cards: sortedCards };
  }

  if (isFlush && (isStraight || isLowStraight)) {
    return {
      rank: HAND_RANKINGS.STRAIGHT_FLUSH,
      value: calculateValue(isLowStraight ? [5, 4, 3, 2, 1] : ranks),
      name: 'Straight Flush',
      cards: sortedCards
    };
  }

  if (counts[0] === 4) {
    return {
      rank: HAND_RANKINGS.FOUR_OF_A_KIND,
      value: calculateValue(sortByCount(ranks, rankCounts)),
      name: 'Four of a Kind',
      cards: sortedCards
    };
  }

  if (counts[0] === 3 && counts[1] === 2) {
    return {
      rank: HAND_RANKINGS.FULL_HOUSE,
      value: calculateValue(sortByCount(ranks, rankCounts)),
      name: 'Full House',
      cards: sortedCards
    };
  }

  if (isFlush) {
    return { rank: HAND_RANKINGS.FLUSH, value: calculateValue(ranks), name: 'Flush', cards: sortedCards };
  }

  if (isStraight || isLowStraight) {
    return {
      rank: HAND_RANKINGS.STRAIGHT,
      value: calculateValue(isLowStraight ? [5, 4, 3, 2, 1] : ranks),
      name: 'Straight',
      cards: sortedCards
    };
  }

  if (counts[0] === 3) {
    return {
      rank: HAND_RANKINGS.THREE_OF_A_KIND,
      value: calculateValue(sortByCount(ranks, rankCounts)),
      name: 'Three of a Kind',
      cards: sortedCards
    };
  }

  if (counts[0] === 2 && counts[1] === 2) {
    return {
      rank: HAND_RANKINGS.TWO_PAIR,
      value: calculateValue(sortByCount(ranks, rankCounts)),
      name: 'Two Pair',
      cards: sortedCards
    };
  }

  if (counts[0] === 2) {
    return {
      rank: HAND_RANKINGS.ONE_PAIR,
      value: calculateValue(sortByCount(ranks, rankCounts)),
      name: 'One Pair',
      cards: sortedCards
    };
  }

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
// GAME FLOW HELPERS
// ============================================

function getNextActivePlayer(room, currentIndex) {
  let nextIndex = (currentIndex + 1) % room.players.length;
  let attempts = 0;

  while (
    attempts < room.players.length &&
    (room.players[nextIndex].folded || room.players[nextIndex].chips <= 0)
  ) {
    nextIndex = (nextIndex + 1) % room.players.length;
    attempts++;
  }

  return nextIndex;
}

function resetBets(room) {
  room.currentBet = 0;
  room.raiseLocked = false;
  room.players.forEach(p => {
    p.currentBet = 0;
  });
}

function normalizeBlindAmount(value) {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  return Math.max(0, Math.floor(n));
}

function postForcedBet(room, playerIndex, amount) {
  const player = room.players[playerIndex];
  if (!player || player.folded || player.chips <= 0) return 0;
  const actual = Math.min(amount, player.chips);
  if (actual <= 0) return 0;
  player.chips -= actual;
  player.currentBet = (player.currentBet || 0) + actual;
  room.pot += actual;
  if (player.chips === 0) player.isAllIn = true;
  return actual;
}

/** Max total bet = min effective stack (chips + currentBet) among non-folded. Poorest can call up to that total. */
function getEffectiveMaxBet(room) {
  const nonFolded = room.players.filter(p => !p.folded);
  if (nonFolded.length === 0) return 0;
  return Math.min(...nonFolded.map(p => p.chips + (p.currentBet || 0)));
}

// ============================================
// SOCKET.IO HANDLERS
// ============================================

io.on('connection', socket => {
  socket.on('createRoom', ({ playerName }, callback) => {
    const code = generateGameCode();
    const room = {
      code,
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
      roundActive: false,
      gameActive: false
    };

    const player = {
      id: 0,
      name: playerName || 'Host',
      chips: STARTING_CHIPS,
      cards: [],
      folded: false,
      isAllIn: false,
      currentBet: 0,
      socketId: socket.id,
      connected: true
    };

    room.players.push(player);
    rooms[code] = room;
    socket.join(code);

    if (callback) {
      callback({ ok: true, code, playerId: player.id, state: getPublicState(room) });
    }

    io.to(code).emit('roomState', getPublicState(room));
  });

  socket.on('joinRoom', ({ code, playerName }, callback) => {
    const room = rooms[code];
    if (!room) {
      if (callback) callback({ ok: false, error: 'Game not found.' });
      return;
    }
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      if (callback) callback({ ok: false, error: 'Game is full.' });
      return;
    }

    const playerId = room.players.length;
    // If joining mid-round, sit out this round (no cards dealt) so they get dealt in next round
    const joiningMidRound = room.gameActive && room.roundActive;
    const player = {
      id: playerId,
      name: playerName || `Player ${playerId + 1}`,
      chips: STARTING_CHIPS,
      cards: [],
      folded: joiningMidRound,
      isAllIn: false,
      currentBet: 0,
      socketId: socket.id,
      connected: true
    };

    room.players.push(player);
    socket.join(code);

    if (callback) {
      callback({ ok: true, code, playerId: player.id, state: getPublicState(room) });
    }

    io.to(code).emit('roomState', getPublicState(room));
  });

  socket.on('startGame', ({ code, blinds }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.gameActive) return;
    if (room.players.length < 2) return;

    if (blinds && blinds.enabled) {
      const small = normalizeBlindAmount(blinds.small);
      const big = normalizeBlindAmount(blinds.big);
      if (small && big && small > 0 && big > 0 && big >= small) {
        room.blinds = { enabled: true, small, big };
        room.minBet = big;
      } else {
        room.blinds = { enabled: false, small: 0, big: 0 };
        room.minBet = MIN_BET;
      }
    } else {
      room.blinds = { enabled: false, small: 0, big: 0 };
      room.minBet = MIN_BET;
    }

    room.gameActive = true;
    io.to(code).emit('gameStarted', getPublicState(room));
    startNewRound(room);
  });

  socket.on('playerAction', ({ code, playerId, action, amount }) => {
    const room = rooms[code];
    if (!room || !room.gameActive || !room.roundActive) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    if (room.players[room.currentPlayerIndex].id !== playerId) {
      return;
    }

    executeAction(room, player, action, amount || 0);
  });

  socket.on('playerReady', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || !room.roundActive) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    if (!room.playersReady) room.playersReady = new Set();
    room.playersReady.add(playerId);
    // Only require ready from connected players who are in the hand (not folded) so late joiners don't block
    const playersInHand = room.players.filter(p => p.connected !== false && !p.folded);
    const allReady = playersInHand.length > 0 && playersInHand.every(p => room.playersReady.has(p.id));
    if (allReady) {
      checkAllReadyAndStartTurn(room);
    } else {
      const waitingNames = room.players.filter(p => !p.folded && !room.playersReady.has(p.id)).map(p => p.name);
      io.to(room.code).emit('waitingForPlayers', { names: waitingNames });
    }
  });

  socket.on('allInRunoutComplete', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.allInRunoutPending) return;
    room.allInRunoutPending = false;
    showdown(room);
  });

  socket.on('disconnect', () => {
    const info = findRoomBySocket(socket.id);
    if (!info) return;
    const { room, playerIndex } = info;
    const player = room.players[playerIndex];
    player.connected = false;
    player.folded = true;

    io.to(room.code).emit('roomState', getPublicState(room));

    const activePlayers = room.players.filter(p => p.chips > 0 && !p.folded);
    if (activePlayers.length <= 1 && room.gameActive) {
      endGame(room);
    }
  });
});

// ============================================
// SERVER-SIDE GAME FLOW
// ============================================

function startNewRound(room) {
  const activePlayers = room.players.filter(p => p.chips > 0);
  if (activePlayers.length <= 1) {
    endGame(room);
    return;
  }

  room.pot = 0;
  room.currentBet = 0;
  room.raiseLocked = false;
  room.communityCards = [];
  room.stage = 'preflop';
  room.roundActive = true;
  room.playersReady = new Set();

  room.players.forEach(p => {
    p.cards = [];
    p.folded = p.chips <= 0;
    p.currentBet = 0;
    p.isAllIn = false;
  });

  do {
    room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  } while (room.players[room.dealerIndex].chips <= 0);

  room.deck = createDeck();

  // Post blinds (if enabled) and set correct preflop first-to-act.
  // 3+ players: SB left of button, BB left of SB, UTG left of BB.
  // Heads-up: button is SB; SB acts first preflop.
  room.allInFromBlinds = false;
  const blindsEnabled = !!(room.blinds && room.blinds.enabled);
  const inHand = room.players.filter(p => !p.folded && p.chips > 0);
  const inHandCount = inHand.length;

  if (blindsEnabled && inHandCount >= 2) {
    const sbIndex = (inHandCount === 2)
      ? room.dealerIndex
      : getNextActivePlayer(room, room.dealerIndex);
    const bbIndex = getNextActivePlayer(room, sbIndex);

    postForcedBet(room, sbIndex, room.blinds.small);
    const bbPosted = postForcedBet(room, bbIndex, room.blinds.big);
    room.currentBet = bbPosted;

    room.currentPlayerIndex = (inHandCount === 2)
      ? sbIndex
      : getNextActivePlayer(room, bbIndex);

    // Treat the BB as the "last raiser" so they always get last action preflop.
    room.lastRaiserIndex = bbIndex;

    const activeNonAllIn = room.players.filter(p => !p.folded && !p.isAllIn);
    if (activeNonAllIn.length === 0) {
      room.allInFromBlinds = true;
    }
  } else {
    room.currentBet = 0;
    room.currentPlayerIndex = getNextActivePlayer(room, room.dealerIndex);
    room.lastRaiserIndex = room.currentPlayerIndex;
  }

  const numPlayers = room.players.length;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < numPlayers; i++) {
      const playerIndex = (room.dealerIndex + 1 + i) % numPlayers;
      const player = room.players[playerIndex];
      if (!player.folded) {
        player.cards.push(room.deck.pop());
      }
    }
  }

  io.to(room.code).emit('roundStarted', getPublicState(room));

  room.players.forEach(player => {
    const socketId = player.socketId;
    const socket = io.sockets.sockets.get(socketId);
    if (socket && player.cards.length === 2) {
      socket.emit('holeCards', { cards: player.cards });
    }
  });

  io.to(room.code).emit('roomState', getPublicState(room));
}

function checkAllReadyAndStartTurn(room) {
  const playersInHand = room.players.filter(p => p.connected !== false && !p.folded);
  const allReady = playersInHand.length > 0 && playersInHand.every(p => room.playersReady.has(p.id));
  if (!allReady) return;
  if (room.allInFromBlinds) {
    room.allInFromBlinds = false;
    startAllInRunout(room);
    return;
  }
  io.to(room.code).emit('turn', { currentPlayerId: room.players[room.currentPlayerIndex].id });
  io.to(room.code).emit('roomState', getPublicState(room));
}

function dealRemainingCommunityCards(room) {
  while (room.communityCards.length < 5) {
    room.deck.pop(); // burn
    room.communityCards.push(room.deck.pop());
  }
}

/** @param room - room state (communityCards already has current stage's cards in advanceStage path)
 *  @param cardsAlreadyRevealed - number of community cards the client had already seen (0 preflop, 3 after flop, 4 after turn) */
function startAllInRunout(room, cardsAlreadyRevealed = 0) {
  dealRemainingCommunityCards(room);
  room.stage = 'showdown';
  room.allInRunoutPending = true;
  io.to(room.code).emit('allInRunout', {
    state: getPublicState(room),
    players: room.players.map(p => ({ id: p.id, cards: p.cards || [] })),
    cardsAlreadyRevealed
  });
}

function advanceStage(room) {
  const stageIndex = STAGES.indexOf(room.stage);
  if (stageIndex >= STAGES.length - 2) {
    showdown(room);
    return;
  }

  resetBets(room);

  room.stage = STAGES[stageIndex + 1];

  let cardsToReveal = 0;
  if (room.stage === 'flop') {
    room.deck.pop();
    cardsToReveal = 3;
  } else if (room.stage === 'turn' || room.stage === 'river') {
    room.deck.pop();
    cardsToReveal = 1;
  }

  for (let i = 0; i < cardsToReveal; i++) {
    room.communityCards.push(room.deck.pop());
  }

  // If all non-folded players are all-in, deal remaining cards and start all-in runout (client animates with delay, then we run showdown)
  const activeNonAllIn = room.players.filter(p => !p.folded && !p.isAllIn);
  if (activeNonAllIn.length === 0) {
    const cardsAlreadyRevealed = room.stage === 'flop' ? 0 : room.stage === 'turn' ? 3 : 4;
    startAllInRunout(room, cardsAlreadyRevealed);
    return;
  }

  room.currentPlayerIndex = getNextActivePlayer(room, room.dealerIndex);
  room.lastRaiserIndex = room.currentPlayerIndex;

  io.to(room.code).emit('stageAdvanced', {
    state: getPublicState(room)
  });
  io.to(room.code).emit('turn', { currentPlayerId: room.players[room.currentPlayerIndex].id });
  io.to(room.code).emit('roomState', getPublicState(room));
}

function showdown(room) {
  room.stage = 'showdown';

  const activePlayers = room.players.filter(p => !p.folded);
  const results = activePlayers.map(player => ({
    playerId: player.id,
    hand: evaluateHand(player.cards, room.communityCards)
  }));

  results.sort((a, b) => compareHands(b.hand, a.hand));

  const winners = [results[0]];
  for (let i = 1; i < results.length; i++) {
    if (compareHands(results[i].hand, results[0].hand) === 0) {
      winners.push(results[i]);
    }
  }

  const splitPot = Math.floor(room.pot / winners.length);
  winners.forEach(w => {
    const player = room.players.find(p => p.id === w.playerId);
    if (player) player.chips += splitPot;
  });

  room.pot = 0;
  room.roundActive = false;

  // Build winner info for eliminated players (before we remove anyone)
  const winnerNames = winners.map(w => {
    const pl = room.players.find(p => p.id === w.playerId);
    return pl ? pl.name : 'Player';
  }).join(' & ');
  const handName = winners[0] && winners[0].hand ? winners[0].hand.name : '';

  // Eliminate players with 0 chips: notify them, remove from room, update table for others
  const eliminated = room.players.filter(p => p.chips <= 0);
  eliminated.forEach(p => {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) {
      sock.leave(room.code);
      sock.emit('playerEliminated', { winnerNames, handName });
    }
  });
  room.players = room.players.filter(p => p.chips > 0);

  io.to(room.code).emit('showdown', {
    state: getPublicState(room),
    winners,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      cards: p.cards
    }))
  });

  io.to(room.code).emit('roomState', getPublicState(room));

  // Store for game-over screen (who won and with what hand)
  room.lastShowdownWinnerNames = winnerNames;
  room.lastShowdownHandName = handName;

  setTimeout(() => {
    if (room.gameActive) {
      startNewRound(room);
    }
  }, 2500);
}

function endGame(room) {
  room.gameActive = false;
  room.roundActive = false;
  io.to(room.code).emit('gameEnded', {
    state: getPublicState(room),
    winnerNames: room.lastShowdownWinnerNames || null,
    handName: room.lastShowdownHandName || null
  });
}

function executeAction(room, player, action, amount) {
  if (player.folded || player.isAllIn) {
    return;
  }

  if (action === 'fold') {
    player.folded = true;
    io.to(room.code).emit('actionApplied', { code: room.code, playerId: player.id, action });
  } else if (action === 'check') {
    if (room.currentBet === player.currentBet) {
      io.to(room.code).emit('actionApplied', { code: room.code, playerId: player.id, action });
    } else {
      return;
    }
  } else if (action === 'call') {
    const callAmount = room.currentBet - player.currentBet;
    const actualAmount = Math.min(callAmount, player.chips);
    if (actualAmount <= 0) return;
    player.chips -= actualAmount;
    player.currentBet += actualAmount;
    room.pot += actualAmount;
    if (player.chips === 0) {
      player.isAllIn = true;
      io.to(room.code).emit('actionApplied', {
        code: room.code,
        playerId: player.id,
        action: 'all-in',
        amount: player.currentBet
      });
    } else {
      io.to(room.code).emit('actionApplied', {
        code: room.code,
        playerId: player.id,
        action: 'call',
        amount: actualAmount
      });
    }
  } else if (action === 'raise') {
    // House rule / simplification:
    // If a player has already raised all-in (short stack), remaining players may only call/fold.
    if (room.raiseLocked) return;

    const effectiveMaxBet = getEffectiveMaxBet(room);
    const minIncrement = room.minBet || MIN_BET;
    let totalBet = Math.max(room.currentBet + minIncrement, amount);
    totalBet = Math.min(totalBet, effectiveMaxBet);
    const additionalAmount = totalBet - player.currentBet;
    if (additionalAmount <= 0) return;
    if (additionalAmount > player.chips) return;

    room.lastRaiserIndex = room.currentPlayerIndex;
    player.chips -= additionalAmount;
    player.currentBet = totalBet;
    room.currentBet = totalBet;
    room.pot += additionalAmount;

    if (player.chips === 0) {
      player.isAllIn = true;
      room.raiseLocked = true;
      io.to(room.code).emit('actionApplied', {
        code: room.code,
        playerId: player.id,
        action: 'all-in',
        amount: totalBet
      });
    } else {
      io.to(room.code).emit('actionApplied', {
        code: room.code,
        playerId: player.id,
        action: 'raise',
        amount: totalBet
      });
    }
  }

  io.to(room.code).emit('roomState', getPublicState(room));

  const remainingPlayers = room.players.filter(p => !p.folded);
  if (remainingPlayers.length === 1) {
    const winner = remainingPlayers[0];
    winner.chips += room.pot;
    room.pot = 0;
    room.roundActive = false;

    // Eliminate any players with 0 chips (e.g. folded after going all-in in a side pot scenario)
    const winnerNames = winner.name;
    const eliminated = room.players.filter(p => p.chips <= 0);
    eliminated.forEach(p => {
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.leave(room.code);
        sock.emit('playerEliminated', { winnerNames, handName: null });
      }
    });
    room.players = room.players.filter(p => p.chips > 0);

    io.to(room.code).emit('roundEnded', {
      state: getPublicState(room),
      winnerId: winner.id
    });
    io.to(room.code).emit('roomState', getPublicState(room));

    setTimeout(() => {
      if (room.gameActive) {
        startNewRound(room);
      }
    }, 2500);
    return;
  }

  const activeNonAllIn = room.players.filter(p => !p.folded && !p.isAllIn);
  if (activeNonAllIn.length === 0) {
    advanceStage(room);
    return;
  }

  const allMatched = activeNonAllIn.every(p => p.currentBet === room.currentBet);
  const nextPlayerIndex = getNextActivePlayer(room, room.currentPlayerIndex);
  const lastRaiser = room.players[room.lastRaiserIndex];
  const lastRaiserCantAct = !lastRaiser || lastRaiser.folded || lastRaiser.isAllIn || lastRaiser.chips <= 0;
  const bettingRoundComplete = allMatched && (room.raiseLocked || lastRaiserCantAct || nextPlayerIndex === room.lastRaiserIndex);

  if (bettingRoundComplete) {
    // If at least one player is all-in and there's <= 1 player who can still act,
    // there are no more betting decisions to be made; just run out the board.
    const activePlayers = room.players.filter(p => !p.folded);
    const anyAllIn = activePlayers.some(p => p.isAllIn);
    if (anyAllIn && activeNonAllIn.length <= 1) {
      startAllInRunout(room);
      return;
    }

    advanceStage(room);
    return;
  }

  room.currentPlayerIndex = nextPlayerIndex;
  io.to(room.code).emit('turn', { currentPlayerId: room.players[room.currentPlayerIndex].id });
}

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


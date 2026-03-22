import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createRoom as fbCreateRoom,
  joinRoom as fbJoinRoom,
  subscribeToRoom,
  updateRoom,
  setRoomData,
  getRoomData,
  sendChatMessage,
  subscribeToChat,
  sendReaction as fbSendReaction,
  subscribeToReactions,
  setGameState,
  updateGameState,
  subscribeToGameState,
} from './firebase.js';
import {
  LANG, EMOJIS, createDeck, shuffle, cardValue, isRedSuit,
  getCardAbility, generateRoomCode, generatePlayerId, dealCards, playSound,
} from './gameLogic.js';

// ============================================================
// CARD COMPONENT
// ============================================================
function Card({ card, faceUp, highlighted, onClick, small, disabled, peeking, animClass, style }) {
  const isJoker = card?.rank === 'JK';
  const isRed = card && isRedSuit(card.suit);
  const show = faceUp || peeking;

  return (
    <div
      className={`card ${show ? 'face-up' : 'face-down'} ${highlighted ? 'highlighted' : ''} ${small ? 'sm' : ''} ${disabled ? 'disabled' : ''} ${animClass || ''}`}
      onClick={disabled ? undefined : onClick}
      style={{
        ...style,
        color: show ? (isJoker ? '#6b21a8' : isRed ? 'var(--red-card)' : 'var(--black-card)') : undefined,
      }}
    >
      {show ? (
        <div className="card-face">
          <div className="card-corner" style={{ alignItems: 'flex-start' }}>
            <span className="card-rank">{isJoker ? '🃏' : card.rank}</span>
            {!isJoker && <span className="card-suit">{card.suit}</span>}
          </div>
          <div className="card-center-suit">{isJoker ? '🃏' : card.suit}</div>
          <div className="card-corner bottom-right">
            <span className="card-rank">{isJoker ? '🃏' : card.rank}</span>
            {!isJoker && <span className="card-suit">{card.suit}</span>}
          </div>
        </div>
      ) : (
        <div className="card-back">
          <div className="card-back-inner">♦</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  // --- Persisted state ---
  const [lang, setLang] = useState(() => localStorage.getItem('kaboo_lang') || 'tr');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('kaboo_name') || '');
  const [playerId] = useState(() => {
    let id = localStorage.getItem('kaboo_pid');
    if (!id) { id = generatePlayerId(); localStorage.setItem('kaboo_pid', id); }
    return id;
  });

  const t = LANG[lang];

  // --- Screens ---
  const [screen, setScreen] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // --- Room & game data (from Firebase) ---
  const [roomData, setRoomData2] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);

  // --- Local UI ---
  const [drawnCard, setDrawnCard] = useState(null);
  const [turnPhase, setTurnPhase] = useState('start'); // start, drawn, fromDiscard, ability
  const [peekingCards, setPeekingCards] = useState({});
  const [peekTimer, setPeekTimer] = useState(0);
  const [abilityMode, setAbilityMode] = useState(null);
  const [abilityStep, setAbilityStep] = useState(0);
  const [selectedMyCard, setSelectedMyCard] = useState(null);
  const [selectedOtherPlayer, setSelectedOtherPlayer] = useState(null);
  const [selectedOtherCard, setSelectedOtherCard] = useState(null);
  const [notification, setNotification] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [showReactions, setShowReactions] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [targetScoreInput, setTargetScoreInput] = useState(100);
  const [initialPeek, setInitialPeek] = useState(false);
  const [initialPeekTimer, setInitialPeekTimer] = useState(15);
  const [revealedCards, setRevealedCards] = useState(false);
  const [tempRevealCard, setTempRevealCard] = useState(null);

  const chatEndRef = useRef(null);
  const peekTimerRef = useRef(null);
  const unsubRoomRef = useRef(null);
  const unsubGameRef = useRef(null);
  const unsubChatRef = useRef(null);
  const unsubReactRef = useRef(null);
  const lastChatCountRef = useRef(0);
  const showChatRef = useRef(showChat);
  showChatRef.current = showChat;

  // Save preferences
  useEffect(() => { localStorage.setItem('kaboo_lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('kaboo_name', playerName); }, [playerName]);

  // --- URL param: auto-join ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setJoinCode(room.toUpperCase());
    }
  }, []);

  // --- Notification ---
  const showNotif = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  }, []);

  const addFloatingReaction = useCallback((emoji, name) => {
    const id = Date.now() + Math.random();
    setFloatingReactions(prev => [...prev, { id, emoji, name }]);
    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
  }, []);

  // --- Cleanup subscriptions ---
  const cleanupSubs = useCallback(() => {
    if (unsubRoomRef.current) unsubRoomRef.current();
    if (unsubGameRef.current) unsubGameRef.current();
    if (unsubChatRef.current) unsubChatRef.current();
    if (unsubReactRef.current) unsubReactRef.current();
  }, []);

  // --- Subscribe to room ---
  const subscribeAll = useCallback((code) => {
    cleanupSubs();

    unsubRoomRef.current = subscribeToRoom(code, (data) => {
      setRoomData2(data);
    });

    unsubGameRef.current = subscribeToGameState(code, (gs) => {
      setGameData(gs);
      // Auto-transition to game screen
      if (gs && gs.status && gs.status !== 'lobby') {
        setScreen('game');
      }
    });

    unsubChatRef.current = subscribeToChat(code, (msgs) => {
      setChatMessages(prev => {
        if (msgs.length > prev.length) {
          if (!showChatRef.current && msgs.length > lastChatCountRef.current) {
            setChatUnread(u => u + (msgs.length - lastChatCountRef.current));
          }
          lastChatCountRef.current = msgs.length;
          if (msgs.length > prev.length) playSound('chat');
        }
        return msgs;
      });
    });

    unsubReactRef.current = subscribeToReactions(code, (reactions) => {
      if (reactions.length > 0) {
        const latest = reactions[reactions.length - 1];
        if (latest.playerId !== playerId && Date.now() - latest.ts < 3000) {
          addFloatingReaction(latest.emoji, latest.playerName);
        }
      }
    });
  }, [cleanupSubs, playerId, addFloatingReaction]);

  // --- Room Management ---
  const handleCreateRoom = async () => {
    if (!playerName.trim()) { setError(t.nameRequired); return; }
    const code = generateRoomCode();
    try {
      await fbCreateRoom(code, playerId, playerName.trim());
      setRoomCode(code);
      subscribeAll(code);
      setScreen('lobby');
      setError('');
      playSound('join');
    } catch (e) {
      setError('Error: ' + e.message);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim()) { setError(t.nameRequired); return; }
    if (!joinCode.trim()) { setError(t.codeRequired); return; }
    const code = joinCode.trim().toUpperCase();
    try {
      const result = await fbJoinRoom(code, playerId, playerName.trim());
      if (result.error === 'notFound') { setError(t.roomNotFound); return; }
      if (result.error === 'full') { setError(t.roomFull); return; }
      if (result.error === 'started') { setError(t.gameStarted); return; }
      setRoomCode(code);
      subscribeAll(code);
      setScreen('lobby');
      setError('');
      playSound('join');
      // Clean URL params
      window.history.replaceState({}, '', window.location.pathname);
    } catch (e) {
      setError('Error: ' + e.message);
    }
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inviteFriend = () => {
    const url = window.location.origin + window.location.pathname;
    const msg = t.inviteMsg.replace('{code}', roomCode).replace('{url}', url);
    const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  };

  // --- Game helpers ---
  const players = roomData?.players ? Object.values(roomData.players).sort((a, b) => a.joinedAt - b.joinedAt) : [];
  const playerOrder = players.map(p => p.id);
  const otherPlayers = players.filter(p => p.id !== playerId);
  const currentPlayerIdx = gameData?.currentPlayerIndex ?? 0;
  const currentPlayerId = playerOrder[currentPlayerIdx];
  const currentPlayerName = players.find(p => p.id === currentPlayerId)?.name || '';
  const isMyTurn = gameData?.status === 'playing' && currentPlayerId === playerId && !abilityMode;
  const myHand = gameData?.hands?.[playerId] || [];
  const topDiscard = gameData?.discardPile ? gameData.discardPile[gameData.discardPile.length - 1] : null;
  const isHost = roomData?.hostId === playerId;
  const scores = roomData?.scores || {};

  // --- Start Game ---
  const startGame = async () => {
    if (players.length < 2) { showNotif(t.minPlayers); return; }
    const { hands, drawPile, discardPile } = dealCards(playerOrder);

    const gs = {
      status: 'peeking',
      round: (gameData?.round || 0) + 1,
      hands,
      drawPile,
      discardPile,
      currentPlayerIndex: 0,
      caboCallerId: null,
      caboFinalRound: false,
      lastAction: null,
      tempReveal: null,
    };

    await updateRoom(roomCode, { targetScore: targetScoreInput });
    await setGameState(roomCode, gs);

    setInitialPeek(true);
    setInitialPeekTimer(15);
    setDrawnCard(null);
    setTurnPhase('start');
    setAbilityMode(null);
    setRevealedCards(false);
    setTempRevealCard(null);
    playSound('cardDeal');
  };

  // --- Initial Peek ---
  useEffect(() => {
    if (initialPeek && initialPeekTimer > 0) {
      const timer = setTimeout(() => setInitialPeekTimer(t => t - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (initialPeek && initialPeekTimer === 0) {
      setInitialPeek(false);
      setPeekingCards({});
    }
  }, [initialPeek, initialPeekTimer]);

  useEffect(() => {
    if (initialPeek && gameData?.hands?.[playerId]) {
      setPeekingCards({ 2: true, 3: true });
    }
  }, [initialPeek, playerId, gameData?.hands]);

  // Auto-transition peeking -> playing
  useEffect(() => {
    if (gameData?.status === 'peeking' && !initialPeek && initialPeekTimer === 0 && isHost) {
      const timer = setTimeout(async () => {
        await updateGameState(roomCode, { status: 'playing' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [gameData?.status, initialPeek, initialPeekTimer, isHost, roomCode]);

  // --- Peek timer for abilities ---
  const startPeekTimer = useCallback((cardIndices, duration = 10) => {
    const obj = {};
    cardIndices.forEach(i => obj[i] = true);
    setPeekingCards(obj);
    setPeekTimer(duration);
    if (peekTimerRef.current) clearInterval(peekTimerRef.current);
    peekTimerRef.current = setInterval(() => {
      setPeekTimer(prev => {
        if (prev <= 1) {
          clearInterval(peekTimerRef.current);
          setPeekingCards({});
          setTempRevealCard(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const closePeek = () => {
    if (peekTimerRef.current) clearInterval(peekTimerRef.current);
    setPeekingCards({});
    setPeekTimer(0);
    setTempRevealCard(null);
  };

  // --- Advance Turn ---
  const advanceTurn = (gs) => {
    let nextIdx = (gs.currentPlayerIndex + 1) % playerOrder.length;
    let attempts = 0;
    while (gs.hands[playerOrder[nextIdx]]?.length === 0 && attempts < playerOrder.length) {
      nextIdx = (nextIdx + 1) % playerOrder.length;
      attempts++;
    }
    if (gs.caboFinalRound && playerOrder[nextIdx] === gs.caboCallerId) {
      return endRound(gs);
    }
    gs.currentPlayerIndex = nextIdx;
    return gs;
  };

  const endRound = (gs) => {
    gs.status = 'roundEnd';
    const roundScores = {};
    for (const pid of playerOrder) {
      const hand = gs.hands[pid] || [];
      roundScores[pid] = hand.reduce((sum, c) => sum + cardValue(c), 0);
    }
    gs.roundScores = roundScores;
    // Update total scores in room
    const newScores = { ...scores };
    for (const pid of playerOrder) {
      newScores[pid] = (newScores[pid] || 0) + roundScores[pid];
    }
    updateRoom(roomCode, { scores: newScores });
    return gs;
  };

  // --- Draw from pile ---
  const drawFromPile = async () => {
    if (!isMyTurn || turnPhase !== 'start' || drawnCard) return;
    const gs = { ...gameData };
    if (!gs.drawPile || gs.drawPile.length === 0) {
      const top = gs.discardPile.pop();
      gs.drawPile = shuffle(gs.discardPile);
      gs.discardPile = [top];
    }
    const card = gs.drawPile.shift();
    setDrawnCard(card);
    setTurnPhase('drawn');
    await setGameState(roomCode, gs);
    playSound('cardFlip');
  };

  // --- Take from discard ---
  const takeFromDiscard = async () => {
    if (!isMyTurn || turnPhase !== 'start' || !topDiscard) return;
    const gs = { ...gameData };
    const card = gs.discardPile.pop();
    setDrawnCard(card);
    setTurnPhase('fromDiscard');
    await setGameState(roomCode, gs);
    playSound('cardFlip');
  };

  // --- Keep drawn card (replace hand card) ---
  const keepDrawnCard = async (idx) => {
    if (!drawnCard) return;
    const gs = { ...gameData };
    const oldCard = gs.hands[playerId][idx];
    gs.hands[playerId][idx] = { ...drawnCard, position: idx };
    gs.discardPile.push(oldCard);
    gs.lastAction = { type: 'swap', playerId, discarded: oldCard, ts: Date.now() };

    // Check ability of discarded card (only from draw pile)
    if (turnPhase === 'drawn') {
      const ability = getCardAbility(oldCard);
      if (ability) {
        setDrawnCard(null);
        setAbilityMode(ability);
        setAbilityStep(0);
        setSelectedMyCard(null);
        setSelectedOtherPlayer(null);
        setSelectedOtherCard(null);
        setTurnPhase('ability');
        await setGameState(roomCode, gs);
        playSound('cardDeal');
        return;
      }
    }

    const advanced = advanceTurn(gs);
    setDrawnCard(null);
    setTurnPhase('start');
    if (advanced.status === 'roundEnd') setRevealedCards(true);
    await setGameState(roomCode, advanced);
    playSound('cardDeal');
  };

  // --- Discard drawn card ---
  const discardDrawnCard = async () => {
    if (!drawnCard) return;
    const gs = { ...gameData };
    gs.discardPile.push(drawnCard);
    gs.lastAction = { type: 'discard', playerId, discarded: drawnCard, ts: Date.now() };

    const ability = getCardAbility(drawnCard);
    if (ability && turnPhase === 'drawn') {
      setAbilityMode(ability);
      setAbilityStep(0);
      setSelectedMyCard(null);
      setSelectedOtherPlayer(null);
      setSelectedOtherCard(null);
      setDrawnCard(null);
      setTurnPhase('ability');
      await setGameState(roomCode, gs);
      return;
    }

    const advanced = advanceTurn(gs);
    setDrawnCard(null);
    setTurnPhase('start');
    if (advanced.status === 'roundEnd') setRevealedCards(true);
    await setGameState(roomCode, advanced);
    playSound('cardDeal');
  };

  // --- Skip ability ---
  const skipAbility = async () => {
    const gs = { ...gameData };
    const advanced = advanceTurn(gs);
    setAbilityMode(null);
    setTurnPhase('start');
    if (advanced.status === 'roundEnd') setRevealedCards(true);
    await setGameState(roomCode, advanced);
  };

  // --- Execute ability ---
  const executeAbility = async () => {
    const gs = { ...gameData };

    if (abilityMode === 'peekSelf' && selectedMyCard !== null) {
      startPeekTimer([selectedMyCard], 10);
      playSound('cardFlip');
      const advanced = advanceTurn(gs);
      setAbilityMode(null);
      setTurnPhase('start');
      if (advanced.status === 'roundEnd') setRevealedCards(true);
      await setGameState(roomCode, advanced);

    } else if (abilityMode === 'peekOther' && selectedOtherPlayer && selectedOtherCard !== null) {
      const otherHand = gs.hands[selectedOtherPlayer];
      if (otherHand?.[selectedOtherCard]) {
        setTempRevealCard(otherHand[selectedOtherCard]);
        startPeekTimer([], 10);
      }
      playSound('cardFlip');
      const advanced = advanceTurn(gs);
      setAbilityMode(null);
      setTurnPhase('start');
      if (advanced.status === 'roundEnd') setRevealedCards(true);
      await setGameState(roomCode, advanced);

    } else if (abilityMode === 'blindSwap' && selectedMyCard !== null && selectedOtherPlayer && selectedOtherCard !== null) {
      const myCard = gs.hands[playerId][selectedMyCard];
      const otherCard = gs.hands[selectedOtherPlayer][selectedOtherCard];
      gs.hands[playerId][selectedMyCard] = { ...otherCard, position: selectedMyCard };
      gs.hands[selectedOtherPlayer][selectedOtherCard] = { ...myCard, position: selectedOtherCard };
      const advanced = advanceTurn(gs);
      setAbilityMode(null);
      setTurnPhase('start');
      if (advanced.status === 'roundEnd') setRevealedCards(true);
      await setGameState(roomCode, advanced);
      playSound('cardDeal');

    } else if (abilityMode === 'lookSwap') {
      if (abilityStep === 0 && selectedOtherPlayer && selectedOtherCard !== null) {
        const otherHand = gs.hands[selectedOtherPlayer];
        if (otherHand?.[selectedOtherCard]) {
          setTempRevealCard(otherHand[selectedOtherCard]);
          startPeekTimer([], 10);
        }
        setAbilityStep(1);
        playSound('cardFlip');
        return;
      }
      if (abilityStep === 1) {
        if (selectedMyCard !== null) {
          const myCard = gs.hands[playerId][selectedMyCard];
          const otherCard = gs.hands[selectedOtherPlayer][selectedOtherCard];
          gs.hands[playerId][selectedMyCard] = { ...otherCard, position: selectedMyCard };
          gs.hands[selectedOtherPlayer][selectedOtherCard] = { ...myCard, position: selectedOtherCard };
        }
        closePeek();
        const advanced = advanceTurn(gs);
        setAbilityMode(null);
        setAbilityStep(0);
        setTurnPhase('start');
        if (advanced.status === 'roundEnd') setRevealedCards(true);
        await setGameState(roomCode, advanced);
        playSound('cardDeal');
      }
    }
  };

  // --- CABO ---
  const callCabo = async () => {
    if (!isMyTurn || turnPhase !== 'start') return;
    const gs = { ...gameData };
    gs.caboCallerId = playerId;
    gs.caboFinalRound = true;
    gs.lastAction = { type: 'cabo', playerId, ts: Date.now() };
    const advanced = advanceTurn(gs);
    setTurnPhase('start');
    if (advanced.status === 'roundEnd') setRevealedCards(true);
    await setGameState(roomCode, advanced);
    playSound('cabo');
    showNotif(t.cabo + '!');
  };

  // --- SNAP ---
  const handleSnap = async (targetPid, cardIdx) => {
    if (!gameData || gameData.status !== 'playing') return;
    const lastDiscard = gameData.discardPile?.[gameData.discardPile.length - 1];
    if (!lastDiscard) return;

    const gs = { ...gameData };
    const targetCard = gs.hands[targetPid]?.[cardIdx];
    if (!targetCard) return;

    if (cardValue(targetCard) === cardValue(lastDiscard)) {
      playSound('snap');
      if (targetPid === playerId) {
        gs.hands[playerId] = gs.hands[playerId].filter((_, i) => i !== cardIdx);
      } else {
        gs.hands[targetPid] = gs.hands[targetPid].filter((_, i) => i !== cardIdx);
        if (gs.hands[playerId].length > 0) {
          const given = gs.hands[playerId].pop();
          gs.hands[targetPid].push({ ...given, position: gs.hands[targetPid].length });
        }
      }
      gs.lastAction = { type: 'snap', playerId, success: true, ts: Date.now() };
      showNotif(t.snapSuccess);
    } else {
      playSound('fail');
      for (let i = 0; i < 2; i++) {
        if (gs.drawPile?.length > 0) {
          gs.hands[playerId].push({ ...gs.drawPile.shift(), position: gs.hands[playerId].length });
        }
      }
      gs.lastAction = { type: 'snap', playerId, success: false, ts: Date.now() };
      showNotif(t.snapFail);
    }
    await setGameState(roomCode, gs);
  };

  // --- Next Round ---
  const startNextRound = async () => {
    const totalScores = roomData?.scores || {};
    const target = roomData?.targetScore || 100;
    const exceeded = playerOrder.filter(pid => (totalScores[pid] || 0) >= target);

    if (exceeded.length > 0) {
      await updateGameState(roomCode, { status: 'gameOver' });
      return;
    }

    const { hands, drawPile, discardPile } = dealCards(playerOrder);
    const gs = {
      status: 'peeking',
      round: (gameData?.round || 0) + 1,
      hands,
      drawPile,
      discardPile,
      currentPlayerIndex: 0,
      caboCallerId: null,
      caboFinalRound: false,
      lastAction: null,
      roundScores: null,
      tempReveal: null,
    };
    await setGameState(roomCode, gs);
    setInitialPeek(true);
    setInitialPeekTimer(15);
    setDrawnCard(null);
    setTurnPhase('start');
    setAbilityMode(null);
    setRevealedCards(false);
    setTempRevealCard(null);
    playSound('cardDeal');
  };

  // --- Chat ---
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    await sendChatMessage(roomCode, playerId, playerName, chatInput.trim());
    setChatInput('');
  };

  const handleReaction = async (emoji) => {
    await fbSendReaction(roomCode, playerId, playerName, emoji);
    addFloatingReaction(emoji, playerName);
    setShowReactions(false);
  };

  useEffect(() => {
    if (showChat) { setChatUnread(0); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }
  }, [showChat, chatMessages]);

  // --- Leave ---
  const leaveRoom = () => {
    cleanupSubs();
    setScreen('menu');
    setRoomCode('');
    setRoomData2(null);
    setGameData(null);
    setChatMessages([]);
    setDrawnCard(null);
    setTurnPhase('start');
    setAbilityMode(null);
    setInitialPeek(false);
    setRevealedCards(false);
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={{ minHeight: '100vh', minHeight: '100dvh', padding: 16, position: 'relative' }}>

      {/* LANG TOGGLE */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100, display: 'flex', gap: 4, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 4 }}>
        <button onClick={() => setLang('tr')} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer', background: lang === 'tr' ? 'var(--gold)' : 'transparent', color: lang === 'tr' ? '#1a1a1a' : 'var(--text-dim)' }}>TR</button>
        <button onClick={() => setLang('en')} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer', background: lang === 'en' ? 'var(--gold)' : 'transparent', color: lang === 'en' ? '#1a1a1a' : 'var(--text-dim)' }}>EN</button>
      </div>

      {/* NOTIFICATION */}
      {notification && (
        <div style={{ position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,0.88)', border: '1px solid var(--gold)', padding: '10px 24px', borderRadius: 8, color: 'var(--gold-bright)', fontWeight: 600, fontSize: 15, animation: 'notif-in 0.3s ease-out', whiteSpace: 'nowrap' }}>
          {notification}
        </div>
      )}

      {/* FLOATING REACTIONS */}
      {floatingReactions.map(r => (
        <div key={r.id} style={{ position: 'fixed', zIndex: 200, fontSize: 36, animation: 'float-up 2.5s ease-out forwards', pointerEvents: 'none', left: `${25 + Math.random() * 50}%`, top: '55%' }}>
          {r.emoji}
        </div>
      ))}

      {/* ===== MENU SCREEN ===== */}
      {screen === 'menu' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 24 }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 72, fontWeight: 900, color: 'var(--gold-bright)', textShadow: '0 2px 4px rgba(0,0,0,0.5), 0 0 40px rgba(212,168,67,0.3)', letterSpacing: 12, margin: 0 }}>KABOO</h1>
          <p style={{ fontFamily: "'Crimson Text', serif", fontSize: 18, color: 'var(--text-dim)', letterSpacing: 4, marginTop: -8, fontStyle: 'italic' }}>{t.subtitle}</p>

          <div style={{ background: 'linear-gradient(145deg, rgba(0,0,0,0.3), rgba(0,0,0,0.15))', border: '1px solid rgba(212,168,67,0.2)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 380, backdropFilter: 'blur(10px)' }}>
            <input className="input" placeholder={t.enterName} value={playerName} onChange={e => setPlayerName(e.target.value.slice(0, 16))} maxLength={16} style={{ marginBottom: 12 }} />
            <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={handleCreateRoom}>{t.createRoom}</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,0.2)' }} />
              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t.or}</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,0.2)' }} />
            </div>

            <input className="input" placeholder={t.enterRoomCode} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 5))} maxLength={5} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 22, marginBottom: 12 }} />
            <button className="btn btn-secondary" onClick={handleJoinRoom}>{t.joinRoom}</button>

            {error && <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginTop: 10 }}>{error}</p>}
          </div>
        </div>
      )}

      {/* ===== LOBBY SCREEN ===== */}
      {screen === 'lobby' && roomData && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', paddingTop: 40, gap: 20 }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 48, fontWeight: 900, color: 'var(--gold-bright)', letterSpacing: 8 }}>KABOO</h1>

          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 6 }}>{t.roomCode}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--gold)', borderRadius: 12, padding: '12px 20px' }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 700, color: 'var(--gold-bright)', letterSpacing: 6 }}>{roomCode}</span>
              <button className="btn btn-small btn-secondary" onClick={copyCode}>{copied ? t.copied : t.copyCode}</button>
            </div>
          </div>

          <button className="btn btn-small btn-invite" onClick={inviteFriend}>{t.inviteFriend}</button>

          <div style={{ width: '100%', maxWidth: 380 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 8 }}>{t.players} ({players.length}/6)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(212,168,67,0.15)', borderRadius: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{p.name} {p.id === playerId ? t.you : ''}</span>
                  {p.id === roomData.hostId && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(212,168,67,0.2)', color: 'var(--gold)' }}>{t.host}</span>}
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16 }}>
                <span>{t.targetScore}:</span>
                <input className="input" type="number" value={targetScoreInput} onChange={e => setTargetScoreInput(Math.max(50, Math.min(999, parseInt(e.target.value) || 100)))} style={{ width: 80, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 18 }} />
              </div>
              <button className="btn btn-primary" style={{ maxWidth: 280 }} onClick={startGame}>{t.startGame}</button>
            </div>
          )}

          {!isHost && <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.waiting}</div>}

          <button className="btn btn-secondary btn-small" style={{ maxWidth: 120 }} onClick={leaveRoom}>{t.back}</button>
        </div>
      )}

      {/* ===== GAME SCREEN ===== */}
      {screen === 'game' && gameData && roomData && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 32px)', gap: 8 }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: 'var(--gold)' }}>{t.round} {gameData.round}</span>
            {gameData.status === 'playing' && (
              <span style={{ fontSize: 14, padding: '6px 14px', borderRadius: 20, background: isMyTurn ? 'rgba(212,168,67,0.2)' : 'rgba(0,0,0,0.3)', border: `1px solid ${isMyTurn ? 'var(--gold)' : 'rgba(212,168,67,0.3)'}`, color: isMyTurn ? 'var(--gold-bright)' : 'var(--text-light)', animation: isMyTurn ? 'glow 1.5s ease-in-out infinite alternate' : 'none' }}>
                {isMyTurn ? t.yourTurn : `${currentPlayerName}${t.notYourTurn}`}
              </span>
            )}
            <button className="btn btn-small btn-secondary" onClick={() => setShowReactions(!showReactions)} style={{ width: 'auto' }}>{t.reactions}</button>
          </div>

          {/* Reactions */}
          {showReactions && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => handleReaction(e)} style={{ width: 38, height: 38, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,0.08)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{e}</button>
              ))}
            </div>
          )}

          {/* CABO Banner */}
          {gameData.caboFinalRound && (
            <div style={{ textAlign: 'center', padding: '8px 16px', background: 'linear-gradient(135deg, rgba(201,48,44,0.3), rgba(201,48,44,0.15))', border: '1px solid rgba(201,48,44,0.4)', borderRadius: 8, color: '#ff6b6b', fontWeight: 600, animation: 'cabo-flash 1s ease-in-out infinite alternate' }}>
              {players.find(p => p.id === gameData.caboCallerId)?.name} {t.caboCall} — {t.caboLastRound}
            </div>
          )}

          {/* Scores bar */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {players.map(p => (
              <div key={p.id} style={{ padding: '3px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", border: p.id === playerId ? '1px solid var(--gold)' : '1px solid transparent' }}>
                {p.name}: {scores[p.id] || 0}
              </div>
            ))}
          </div>

          {/* Other players */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
            {otherPlayers.map(p => {
              const isActive = currentPlayerId === p.id;
              const hand = gameData.hands?.[p.id] || [];
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 10px', background: 'rgba(0,0,0,0.15)', border: `1px solid ${isActive ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 12, minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? 'var(--gold-bright)' : 'var(--text-dim)' }}>{p.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 }}>
                    {hand.map((card, ci) => (
                      <Card key={ci} card={card} faceUp={revealedCards} small
                        onClick={() => {
                          if (abilityMode && ['peekOther', 'blindSwap', 'lookSwap'].includes(abilityMode) && abilityStep === 0) {
                            setSelectedOtherPlayer(p.id);
                            setSelectedOtherCard(ci);
                          } else if (gameData.status === 'playing') {
                            handleSnap(p.id, ci);
                          }
                        }}
                        highlighted={selectedOtherPlayer === p.id && selectedOtherCard === ci}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center - Piles */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, padding: 16 }}>
            {/* Draw Pile */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && turnPhase === 'start' && !drawnCard) ? 'pointer' : 'default', opacity: (isMyTurn && turnPhase === 'start' && !drawnCard) ? 1 : 0.5, transition: 'all 0.2s' }} onClick={drawFromPile}>
              <Card card={{ rank: '?', suit: '?' }} faceUp={false} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{t.drawPile} ({gameData.drawPile?.length || 0})</span>
            </div>

            {/* Drawn Card */}
            {drawnCard && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, background: 'rgba(0,0,0,0.2)', border: '2px dashed var(--gold)', borderRadius: 12 }}>
                <Card card={drawnCard} faceUp={true} animClass="deal-anim" />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {turnPhase === 'fromDiscard' ? (
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>↓ {t.selectYourCard}</span>
                  ) : (
                    <button className="btn btn-small btn-secondary" onClick={discardDrawnCard}>{t.discardCard}</button>
                  )}
                </div>
              </div>
            )}

            {/* Discard Pile */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && turnPhase === 'start' && topDiscard) ? 'pointer' : 'default', opacity: (isMyTurn && turnPhase === 'start' && topDiscard) ? 1 : 0.5, transition: 'all 0.2s' }} onClick={takeFromDiscard}>
              {topDiscard ? <Card card={topDiscard} faceUp={true} /> : <div className="card" style={{ background: 'rgba(0,0,0,0.2)', border: '2px dashed rgba(255,255,255,0.1)' }} />}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{t.discardPile}</span>
            </div>
          </div>

          {/* My Hand */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(212,168,67,0.15)', borderRadius: '16px 16px 0 0', marginTop: 'auto' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: 'var(--gold)' }}>{playerName} {t.you}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {myHand.map((card, ci) => (
                <Card key={ci} card={card} faceUp={revealedCards} peeking={peekingCards[ci]}
                  highlighted={(drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard')) || (abilityMode && ['peekSelf', 'blindSwap'].includes(abilityMode) && selectedMyCard === ci) || (abilityMode === 'lookSwap' && abilityStep === 1 && selectedMyCard === ci)}
                  onClick={() => {
                    if (drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard')) {
                      keepDrawnCard(ci);
                    } else if (abilityMode === 'peekSelf') {
                      setSelectedMyCard(ci);
                    } else if (abilityMode === 'blindSwap' || (abilityMode === 'lookSwap' && abilityStep === 1)) {
                      setSelectedMyCard(ci);
                    } else if (gameData.status === 'playing') {
                      handleSnap(playerId, ci);
                    }
                  }}
                  animClass="deal-anim"
                  style={{ animationDelay: `${ci * 0.08}s` }}
                />
              ))}
            </div>

            {/* CABO Button */}
            {isMyTurn && turnPhase === 'start' && !drawnCard && !gameData.caboFinalRound && (
              <button className="btn btn-cabo" onClick={callCabo}>{t.cabo}</button>
            )}

            {/* Turn hint */}
            {isMyTurn && turnPhase === 'start' && !drawnCard && (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.drawOrDiscard}</div>
            )}
            {drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard') && (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.chooseAction}</div>
            )}
          </div>

          {/* INITIAL PEEK OVERLAY */}
          {initialPeek && (
            <div onClick={() => { setInitialPeek(false); setPeekingCards({}); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 52, color: 'var(--gold-bright)' }}>{initialPeekTimer}</div>
              <div style={{ color: 'var(--gold)', fontFamily: "'Playfair Display', serif", fontSize: 20 }}>{t.lookingAtCards}</div>
              <div style={{ display: 'flex', gap: 16 }}>
                {myHand.slice(2, 4).map((card, i) => <Card key={i} card={card} faceUp={true} animClass="deal-anim" />)}
              </div>
              <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 14 }}>{t.closeCard}</div>
            </div>
          )}

          {/* PEEK OVERLAY (abilities) */}
          {(Object.keys(peekingCards).length > 0 || tempRevealCard) && !initialPeek && (
            <div onClick={closePeek} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 52, color: 'var(--gold-bright)' }}>{peekTimer}</div>
              <div style={{ display: 'flex', gap: 16 }}>
                {Object.keys(peekingCards).map(ci => <Card key={ci} card={myHand[ci]} faceUp={true} />)}
                {tempRevealCard && <Card card={tempRevealCard} faceUp={true} />}
              </div>
              <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 14 }}>{t.closeCard} ({peekTimer} {t.timeLeft})</div>
            </div>
          )}

          {/* ABILITY MODAL */}
          {abilityMode && !Object.keys(peekingCards).length && !tempRevealCard && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)', padding: 20 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: 'var(--gold-bright)' }}>
                {t[abilityMode]}
              </div>
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', maxWidth: 300 }}>
                {abilityMode === 'peekSelf' && t.selectYourCard}
                {abilityMode === 'peekOther' && (selectedOtherPlayer ? t.selectOtherCard : t.selectOtherPlayer)}
                {abilityMode === 'blindSwap' && (!selectedMyCard ? t.selectYourCard : !selectedOtherPlayer ? t.selectOtherPlayer : t.selectOtherCard)}
                {abilityMode === 'lookSwap' && abilityStep === 0 && (selectedOtherPlayer ? t.selectOtherCard : t.selectOtherPlayer)}
                {abilityMode === 'lookSwap' && abilityStep === 1 && `${t.selectYourCard} (${t.skip}?)`}
              </div>

              {/* Player select */}
              {['peekOther', 'blindSwap', 'lookSwap'].includes(abilityMode) && !selectedOtherPlayer && abilityStep === 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {otherPlayers.map(p => (
                    <button key={p.id} className={`btn btn-small ${selectedOtherPlayer === p.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedOtherPlayer(p.id)}>{p.name}</button>
                  ))}
                </div>
              )}

              {/* Other player's cards */}
              {selectedOtherPlayer && ['peekOther', 'blindSwap'].includes(abilityMode) && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {(gameData.hands[selectedOtherPlayer] || []).map((card, ci) => (
                    <Card key={ci} card={card} faceUp={false} highlighted={selectedOtherCard === ci} onClick={() => setSelectedOtherCard(ci)} />
                  ))}
                </div>
              )}
              {selectedOtherPlayer && abilityMode === 'lookSwap' && abilityStep === 0 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {(gameData.hands[selectedOtherPlayer] || []).map((card, ci) => (
                    <Card key={ci} card={card} faceUp={false} highlighted={selectedOtherCard === ci} onClick={() => setSelectedOtherCard(ci)} />
                  ))}
                </div>
              )}

              {/* My cards (for blindSwap / lookSwap step 1) */}
              {abilityMode === 'blindSwap' && selectedOtherPlayer && selectedOtherCard !== null && (
                <div>
                  <div style={{ color: 'var(--text-dim)', marginBottom: 6, textAlign: 'center', fontSize: 13 }}>{t.selectYourCard}</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {myHand.map((card, ci) => <Card key={ci} card={card} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}
                  </div>
                </div>
              )}

              {/* My cards for peekSelf */}
              {abilityMode === 'peekSelf' && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {myHand.map((card, ci) => <Card key={ci} card={card} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}
                </div>
              )}

              {/* lookSwap step 1: my cards */}
              {abilityMode === 'lookSwap' && abilityStep === 1 && (
                <div>
                  <div style={{ color: 'var(--text-dim)', marginBottom: 6, textAlign: 'center', fontSize: 13 }}>{t.selectYourCard}</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {myHand.map((card, ci) => <Card key={ci} card={card} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                {((abilityMode === 'peekSelf' && selectedMyCard !== null) ||
                  (abilityMode === 'peekOther' && selectedOtherCard !== null) ||
                  (abilityMode === 'blindSwap' && selectedMyCard !== null && selectedOtherCard !== null) ||
                  (abilityMode === 'lookSwap' && abilityStep === 0 && selectedOtherCard !== null) ||
                  (abilityMode === 'lookSwap' && abilityStep === 1)) && (
                  <button className="btn btn-primary btn-small" onClick={executeAbility}>{t.confirm}</button>
                )}
                <button className="btn btn-secondary btn-small" onClick={skipAbility}>{t.cancel}</button>
              </div>
            </div>
          )}

          {/* ROUND END OVERLAY */}
          {gameData.status === 'roundEnd' && gameData.roundScores && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, backdropFilter: 'blur(6px)', padding: 20, overflowY: 'auto' }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, color: 'var(--gold-bright)' }}>{t.roundOver}</div>

              <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'left' }}>{t.players}</th>
                    <th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'center' }}>{t.round} {gameData.round}</th>
                    <th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'center' }}>{t.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {players.sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => (
                    <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,0.15)' : 'transparent' }}>
                      <td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'left' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === playerId ? t.you : ''}</td>
                      <td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>{gameData.roundScores[p.id]}</td>
                      <td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {players.map(p => (
                  <div key={p.id} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--text-dim)' }}>{p.name}</div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {(gameData.hands[p.id] || []).map((card, ci) => <Card key={ci} card={card} faceUp={true} small />)}
                    </div>
                  </div>
                ))}
              </div>

              {isHost && <button className="btn btn-primary" style={{ maxWidth: 240 }} onClick={startNextRound}>{t.nextRound}</button>}
            </div>
          )}

          {/* GAME OVER */}
          {gameData.status === 'gameOver' && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, backdropFilter: 'blur(6px)', padding: 20 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, color: 'var(--gold-bright)' }}>{t.gameOver}</div>
              <table style={{ width: '100%', maxWidth: 360, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', textAlign: 'left', fontFamily: "'Playfair Display', serif", color: 'var(--gold)' }}>{t.players}</th>
                    <th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', textAlign: 'center', fontFamily: "'Playfair Display', serif", color: 'var(--gold)' }}>{t.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {players.sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => (
                    <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,0.15)' : 'transparent' }}>
                      <td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === playerId ? t.you : ''}</td>
                      <td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-primary" style={{ maxWidth: 200 }} onClick={leaveRoom}>{t.newGame}</button>
            </div>
          )}

          {/* CHAT */}
          <button onClick={() => { setShowChat(!showChat); if (!showChat) setChatUnread(0); }} style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 40, width: 48, height: 48, borderRadius: '50%', background: 'var(--gold)', color: '#1a1a1a', border: 'none', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            💬
            {chatUnread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: '#c9302c', color: 'white', fontSize: 11, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono', monospace" }}>{chatUnread}</span>}
          </button>

          {showChat && (
            <div style={{ position: 'fixed', bottom: 72, right: 16, zIndex: 40, width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: 400, background: 'rgba(14,58,26,0.95)', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", fontSize: 14, color: 'var(--gold)' }}>{t.chat}</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', maxHeight: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {chatMessages.map((m, i) => (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--gold)', marginRight: 6 }}>{m.name}:</span>
                    {m.text}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid rgba(212,168,67,0.15)' }}>
                <input className="input" style={{ fontSize: 13 }} placeholder={t.sendMsg} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} maxLength={200} />
                <button className="btn btn-small btn-primary" style={{ width: 'auto', flexShrink: 0 }} onClick={sendChat}>{t.send}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

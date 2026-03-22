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

const BOT_NAMES = ['Robo', 'Pixel', 'Byte', 'Chip', 'Nova', 'Turbo'];

function Card({ card, faceUp, highlighted, onClick, small, disabled, peeking, animClass, style }) {
  const isJoker = card?.rank === 'JK';
  const isRed = card && isRedSuit(card.suit);
  const show = faceUp || peeking;
  return (
    <div className={`card ${show ? 'face-up' : 'face-down'} ${highlighted ? 'highlighted' : ''} ${small ? 'sm' : ''} ${disabled ? 'disabled' : ''} ${animClass || ''}`}
      onClick={disabled ? undefined : onClick}
      style={{ ...style, color: show ? (isJoker ? '#6b21a8' : isRed ? 'var(--red-card)' : 'var(--black-card)') : undefined }}>
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
        <div className="card-back"><div className="card-back-inner">♦</div></div>
      )}
    </div>
  );
}

// 2x2 grid: top[0,1] bottom[2,3], penalty cards stack as extra rows on TOP
function HandGrid({ cards, small, faceUp, peekingCards, highlighted, onCardClick, animClass }) {
  const base = cards.slice(0, 4);
  const penalty = cards.slice(4);
  const penaltyRows = [];
  for (let i = 0; i < penalty.length; i += 2) penaltyRows.push(penalty.slice(i, i + 2));
  const gap = small ? 3 : 6;
  const renderCard = (card, idx) => (
    <Card key={idx} card={card} faceUp={faceUp} small={small} peeking={peekingCards?.[idx]}
      highlighted={highlighted?.(idx)} onClick={() => onCardClick?.(idx)} animClass={animClass}
      style={animClass ? { animationDelay: `${idx * 0.08}s` } : undefined} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: gap }}>
      {penaltyRows.map((row, ri) => (
        <div key={`p${ri}`} style={{ display: 'flex', gap, justifyContent: 'center' }}>
          {row.map((c, ci) => renderCard(c, 4 + ri * 2 + ci))}
        </div>
      ))}
      <div style={{ display: 'flex', gap, justifyContent: 'center' }}>
        {[0, 1].map(i => base[i] ? renderCard(base[i], i) : <div key={i} style={{ width: small ? 44 : 62, height: small ? 62 : 88 }} />)}
      </div>
      <div style={{ display: 'flex', gap, justifyContent: 'center' }}>
        {[2, 3].map(i => base[i] ? renderCard(base[i], i) : <div key={i} style={{ width: small ? 44 : 62, height: small ? 62 : 88 }} />)}
      </div>
    </div>
  );
}

// Simple bot: draw, keep low cards, discard high
async function executeBotTurn(gs, botId, playerOrder) {
  const hand = gs.hands[botId] || [];
  if (hand.length === 0) return gs;
  if (!gs.caboFinalRound && hand.length <= 3 && Math.random() < 0.15) {
    gs.caboCallerId = botId; gs.caboFinalRound = true;
    gs.lastAction = { type: 'cabo', playerId: botId, ts: Date.now() };
    return gs;
  }
  if (!gs.drawPile || gs.drawPile.length === 0) {
    const top = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [top];
  }
  const drawn = gs.drawPile.shift();
  const dv = cardValue(drawn);
  if (dv <= 5) {
    const ri = Math.floor(Math.random() * hand.length);
    const old = gs.hands[botId][ri];
    gs.hands[botId][ri] = { ...drawn, position: ri };
    gs.discardPile.push(old);
    gs.lastAction = { type: 'swap', playerId: botId, discarded: old, ts: Date.now() };
  } else {
    gs.discardPile.push(drawn);
    gs.lastAction = { type: 'discard', playerId: botId, discarded: drawn, ts: Date.now() };
  }
  return gs;
}

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('kaboo_lang') || 'tr');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('kaboo_name') || '');
  const [playerId] = useState(() => {
    let id = localStorage.getItem('kaboo_pid');
    if (!id) { id = generatePlayerId(); localStorage.setItem('kaboo_pid', id); }
    return id;
  });
  const t = LANG[lang];

  const [screen, setScreen] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [roomData, setRoomData2] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [drawnCard, setDrawnCard] = useState(null);
  const [turnPhase, setTurnPhase] = useState('start');
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
  const [botCount, setBotCount] = useState(0);

  const chatEndRef = useRef(null);
  const peekTimerRef = useRef(null);
  const unsubRefs = useRef({ room: null, game: null, chat: null, react: null });
  const lastChatCountRef = useRef(0);
  const showChatRef = useRef(showChat);
  const botTimeoutRef = useRef(null);
  showChatRef.current = showChat;

  useEffect(() => { localStorage.setItem('kaboo_lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('kaboo_name', playerName); }, [playerName]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('room');
    if (p) setJoinCode(p.toUpperCase());
  }, []);

  const showNotif = useCallback((msg) => { setNotification(msg); setTimeout(() => setNotification(''), 3000); }, []);
  const addFloatingReaction = useCallback((emoji, name) => {
    const id = Date.now() + Math.random();
    setFloatingReactions(p => [...p, { id, emoji, name }]);
    setTimeout(() => setFloatingReactions(p => p.filter(r => r.id !== id)), 2500);
  }, []);

  const cleanupSubs = useCallback(() => {
    Object.values(unsubRefs.current).forEach(u => u && u());
    unsubRefs.current = { room: null, game: null, chat: null, react: null };
  }, []);

  const subscribeAll = useCallback((code) => {
    cleanupSubs();
    unsubRefs.current.room = subscribeToRoom(code, d => setRoomData2(d));
    unsubRefs.current.game = subscribeToGameState(code, gs => {
      setGameData(gs);
      if (gs?.status && gs.status !== 'lobby') setScreen('game');
    });
    unsubRefs.current.chat = subscribeToChat(code, msgs => {
      setChatMessages(prev => {
        if (msgs.length > prev.length) {
          if (!showChatRef.current && msgs.length > lastChatCountRef.current) setChatUnread(u => u + (msgs.length - lastChatCountRef.current));
          lastChatCountRef.current = msgs.length; playSound('chat');
        }
        return msgs;
      });
    });
    unsubRefs.current.react = subscribeToReactions(code, reactions => {
      if (reactions.length > 0) {
        const l = reactions[reactions.length - 1];
        if (l.playerId !== playerId && Date.now() - l.ts < 3000) addFloatingReaction(l.emoji, l.playerName);
      }
    });
  }, [cleanupSubs, playerId, addFloatingReaction]);

  // Room
  const handleCreateRoom = async () => {
    if (!playerName.trim()) { setError(t.nameRequired); return; }
    const code = generateRoomCode();
    await fbCreateRoom(code, playerId, playerName.trim());
    setRoomCode(code); subscribeAll(code); setScreen('lobby'); setError(''); setBotCount(0); playSound('join');
  };
  const handleJoinRoom = async () => {
    if (!playerName.trim()) { setError(t.nameRequired); return; }
    if (!joinCode.trim()) { setError(t.codeRequired); return; }
    const code = joinCode.trim().toUpperCase();
    const res = await fbJoinRoom(code, playerId, playerName.trim());
    if (res.error === 'notFound') { setError(t.roomNotFound); return; }
    if (res.error === 'full') { setError(t.roomFull); return; }
    if (res.error === 'started') { setError(t.gameStarted); return; }
    setRoomCode(code); subscribeAll(code); setScreen('lobby'); setError(''); playSound('join');
    window.history.replaceState({}, '', window.location.pathname);
  };
  const copyCode = () => { navigator.clipboard?.writeText(roomCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const inviteFriend = () => {
    const url = window.location.origin + window.location.pathname;
    window.open(`https://wa.me/?text=${encodeURIComponent(t.inviteMsg.replace('{code}', roomCode).replace('{url}', url))}`, '_blank');
  };

  // Bots
  const addBot = async () => {
    const curr = roomData?.players ? Object.values(roomData.players).filter(Boolean) : [];
    if (curr.length >= 6) { showNotif(t.roomFull); return; }
    const bi = botCount;
    const botId = `bot_${bi}_${roomCode}`;
    const botName = `${BOT_NAMES[bi % BOT_NAMES.length]} 🤖`;
    await setRoomData(roomCode, `players/${botId}`, { id: botId, name: botName, connected: true, isBot: true, joinedAt: Date.now() });
    await setRoomData(roomCode, `scores/${botId}`, 0);
    setBotCount(c => c + 1); playSound('join');
  };
  const removeBot = async (botId) => {
    await setRoomData(roomCode, `players/${botId}`, null);
    await setRoomData(roomCode, `scores/${botId}`, null);
    setBotCount(c => Math.max(0, c - 1));
  };

  // Helpers
  const players = roomData?.players ? Object.values(roomData.players).filter(Boolean).sort((a, b) => a.joinedAt - b.joinedAt) : [];
  const playerOrder = players.map(p => p.id);
  const otherPlayers = players.filter(p => p.id !== playerId);
  const cidx = gameData?.currentPlayerIndex ?? 0;
  const cpid = playerOrder[cidx];
  const cpname = players.find(p => p.id === cpid)?.name || '';
  const isBot = cpid?.startsWith('bot_');
  const isMyTurn = gameData?.status === 'playing' && cpid === playerId && !abilityMode;
  const myHand = gameData?.hands?.[playerId] || [];
  const topDiscard = gameData?.discardPile?.[gameData.discardPile.length - 1] || null;
  const isHost = roomData?.hostId === playerId;
  const scores = roomData?.scores || {};

  function advTurn(gs) {
    let ni = (gs.currentPlayerIndex + 1) % playerOrder.length; let a = 0;
    while (gs.hands[playerOrder[ni]]?.length === 0 && a < playerOrder.length) { ni = (ni + 1) % playerOrder.length; a++; }
    if (gs.caboFinalRound && playerOrder[ni] === gs.caboCallerId) return endRnd(gs);
    gs.currentPlayerIndex = ni; return gs;
  }
  function endRnd(gs) {
    gs.status = 'roundEnd'; const rs = {};
    for (const pid of playerOrder) { rs[pid] = (gs.hands[pid] || []).reduce((s, c) => s + cardValue(c), 0); }
    gs.roundScores = rs;
    const ns = { ...scores }; for (const pid of playerOrder) ns[pid] = (ns[pid] || 0) + rs[pid];
    updateRoom(roomCode, { scores: ns }); return gs;
  }

  // Start game
  const startGame = async () => {
    if (players.length < 2) { showNotif(t.minPlayers); return; }
    const { hands, drawPile, discardPile } = dealCards(playerOrder);
    await updateRoom(roomCode, { targetScore: targetScoreInput });
    await setGameState(roomCode, {
      status: 'peeking', round: (gameData?.round || 0) + 1, hands, drawPile, discardPile,
      currentPlayerIndex: 0, caboCallerId: null, caboFinalRound: false, lastAction: null, tempReveal: null,
    });
    setInitialPeek(true); setInitialPeekTimer(15); setDrawnCard(null); setTurnPhase('start');
    setAbilityMode(null); setRevealedCards(false); setTempRevealCard(null); playSound('cardDeal');
  };

  // Peek
  useEffect(() => {
    if (initialPeek && initialPeekTimer > 0) { const t = setTimeout(() => setInitialPeekTimer(v => v - 1), 1000); return () => clearTimeout(t); }
    if (initialPeek && initialPeekTimer === 0) { setInitialPeek(false); setPeekingCards({}); }
  }, [initialPeek, initialPeekTimer]);
  useEffect(() => { if (initialPeek && gameData?.hands?.[playerId]) setPeekingCards({ 2: true, 3: true }); }, [initialPeek, playerId, gameData?.hands]);
  useEffect(() => {
    if (gameData?.status === 'peeking' && !initialPeek && initialPeekTimer === 0 && isHost) {
      const t = setTimeout(() => updateGameState(roomCode, { status: 'playing' }), 500); return () => clearTimeout(t);
    }
  }, [gameData?.status, initialPeek, initialPeekTimer, isHost, roomCode]);

  // Bot auto-play
  useEffect(() => {
    if (!gameData || gameData.status !== 'playing' || !isHost || !isBot) return;
    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    botTimeoutRef.current = setTimeout(async () => {
      const gs = JSON.parse(JSON.stringify(gameData));
      const updated = await executeBotTurn(gs, cpid, playerOrder);
      const adv = advTurn(updated);
      if (adv.status === 'roundEnd') setRevealedCards(true);
      await setGameState(roomCode, adv); playSound('cardDeal');
    }, 1200 + Math.random() * 800);
    return () => { if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); };
  }, [gameData?.currentPlayerIndex, gameData?.status, isBot, isHost]);

  const startPeekTimer = useCallback((ci, dur = 10) => {
    const o = {}; ci.forEach(i => o[i] = true); setPeekingCards(o); setPeekTimer(dur);
    if (peekTimerRef.current) clearInterval(peekTimerRef.current);
    peekTimerRef.current = setInterval(() => {
      setPeekTimer(p => { if (p <= 1) { clearInterval(peekTimerRef.current); setPeekingCards({}); setTempRevealCard(null); return 0; } return p - 1; });
    }, 1000);
  }, []);
  const closePeek = () => { if (peekTimerRef.current) clearInterval(peekTimerRef.current); setPeekingCards({}); setPeekTimer(0); setTempRevealCard(null); };

  // Actions
  const drawFromPile = async () => {
    if (!isMyTurn || turnPhase !== 'start' || drawnCard) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    if (!gs.drawPile?.length) { const top = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [top]; }
    setDrawnCard(gs.drawPile.shift()); setTurnPhase('drawn'); await setGameState(roomCode, gs); playSound('cardFlip');
  };
  const takeFromDiscard = async () => {
    if (!isMyTurn || turnPhase !== 'start' || !topDiscard) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    setDrawnCard(gs.discardPile.pop()); setTurnPhase('fromDiscard'); await setGameState(roomCode, gs); playSound('cardFlip');
  };
  const keepDrawnCard = async (idx) => {
    if (!drawnCard) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    const old = gs.hands[playerId][idx]; gs.hands[playerId][idx] = { ...drawnCard, position: idx }; gs.discardPile.push(old);
    gs.lastAction = { type: 'swap', playerId, discarded: old, ts: Date.now() };
    if (turnPhase === 'drawn') { const ab = getCardAbility(old); if (ab) { setDrawnCard(null); setAbilityMode(ab); setAbilityStep(0); setSelectedMyCard(null); setSelectedOtherPlayer(null); setSelectedOtherCard(null); setTurnPhase('ability'); await setGameState(roomCode, gs); playSound('cardDeal'); return; } }
    const adv = advTurn(gs); setDrawnCard(null); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv); playSound('cardDeal');
  };
  const discardDrawnCard = async () => {
    if (!drawnCard) return;
    const gs = JSON.parse(JSON.stringify(gameData)); gs.discardPile.push(drawnCard);
    gs.lastAction = { type: 'discard', playerId, discarded: drawnCard, ts: Date.now() };
    const ab = getCardAbility(drawnCard);
    if (ab && turnPhase === 'drawn') { setAbilityMode(ab); setAbilityStep(0); setSelectedMyCard(null); setSelectedOtherPlayer(null); setSelectedOtherCard(null); setDrawnCard(null); setTurnPhase('ability'); await setGameState(roomCode, gs); return; }
    const adv = advTurn(gs); setDrawnCard(null); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv); playSound('cardDeal');
  };
  const skipAbility = async () => {
    const gs = JSON.parse(JSON.stringify(gameData)); const adv = advTurn(gs); setAbilityMode(null); setTurnPhase('start');
    if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv);
  };
  const executeAbility = async () => {
    const gs = JSON.parse(JSON.stringify(gameData));
    if (abilityMode === 'peekSelf' && selectedMyCard !== null) {
      startPeekTimer([selectedMyCard], 10); playSound('cardFlip');
      const adv = advTurn(gs); setAbilityMode(null); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv);
    } else if (abilityMode === 'peekOther' && selectedOtherPlayer && selectedOtherCard !== null) {
      const oh = gs.hands[selectedOtherPlayer]; if (oh?.[selectedOtherCard]) { setTempRevealCard(oh[selectedOtherCard]); startPeekTimer([], 10); }
      playSound('cardFlip'); const adv = advTurn(gs); setAbilityMode(null); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv);
    } else if (abilityMode === 'blindSwap' && selectedMyCard !== null && selectedOtherPlayer && selectedOtherCard !== null) {
      const mc = gs.hands[playerId][selectedMyCard]; const oc = gs.hands[selectedOtherPlayer][selectedOtherCard];
      gs.hands[playerId][selectedMyCard] = { ...oc, position: selectedMyCard }; gs.hands[selectedOtherPlayer][selectedOtherCard] = { ...mc, position: selectedOtherCard };
      const adv = advTurn(gs); setAbilityMode(null); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv); playSound('cardDeal');
    } else if (abilityMode === 'lookSwap') {
      if (abilityStep === 0 && selectedOtherPlayer && selectedOtherCard !== null) {
        const oh = gs.hands[selectedOtherPlayer]; if (oh?.[selectedOtherCard]) { setTempRevealCard(oh[selectedOtherCard]); startPeekTimer([], 10); }
        setAbilityStep(1); playSound('cardFlip'); return;
      }
      if (abilityStep === 1) {
        if (selectedMyCard !== null) { const mc = gs.hands[playerId][selectedMyCard]; const oc = gs.hands[selectedOtherPlayer][selectedOtherCard]; gs.hands[playerId][selectedMyCard] = { ...oc, position: selectedMyCard }; gs.hands[selectedOtherPlayer][selectedOtherCard] = { ...mc, position: selectedOtherCard }; }
        closePeek(); const adv = advTurn(gs); setAbilityMode(null); setAbilityStep(0); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true); await setGameState(roomCode, adv); playSound('cardDeal');
      }
    }
  };
  const callCabo = async () => {
    if (!isMyTurn || turnPhase !== 'start') return;
    const gs = JSON.parse(JSON.stringify(gameData)); gs.caboCallerId = playerId; gs.caboFinalRound = true;
    gs.lastAction = { type: 'cabo', playerId, ts: Date.now() };
    const adv = advTurn(gs); setTurnPhase('start'); if (adv.status === 'roundEnd') setRevealedCards(true);
    await setGameState(roomCode, adv); playSound('cabo'); showNotif(t.cabo + '!');
  };
  const handleSnap = async (tid, ci) => {
    if (!gameData || gameData.status !== 'playing') return;
    const ld = gameData.discardPile?.[gameData.discardPile.length - 1]; if (!ld) return;
    const gs = JSON.parse(JSON.stringify(gameData)); const tc = gs.hands[tid]?.[ci]; if (!tc) return;
    if (cardValue(tc) === cardValue(ld)) {
      playSound('snap');
      if (tid === playerId) { gs.hands[playerId] = gs.hands[playerId].filter((_, i) => i !== ci); }
      else { gs.hands[tid] = gs.hands[tid].filter((_, i) => i !== ci); if (gs.hands[playerId].length > 0) { const g = gs.hands[playerId].pop(); gs.hands[tid].push({ ...g, position: gs.hands[tid].length }); } }
      gs.lastAction = { type: 'snap', playerId, success: true, ts: Date.now() }; showNotif(t.snapSuccess);
    } else {
      playSound('fail'); for (let i = 0; i < 2; i++) { if (gs.drawPile?.length > 0) gs.hands[playerId].push({ ...gs.drawPile.shift(), position: gs.hands[playerId].length }); }
      gs.lastAction = { type: 'snap', playerId, success: false, ts: Date.now() }; showNotif(t.snapFail);
    }
    await setGameState(roomCode, gs);
  };
  const startNextRound = async () => {
    const ts2 = roomData?.scores || {}; const tgt = roomData?.targetScore || 100;
    if (playerOrder.some(pid => (ts2[pid] || 0) >= tgt)) { await updateGameState(roomCode, { status: 'gameOver' }); return; }
    const { hands, drawPile, discardPile } = dealCards(playerOrder);
    await setGameState(roomCode, { status: 'peeking', round: (gameData?.round || 0) + 1, hands, drawPile, discardPile, currentPlayerIndex: 0, caboCallerId: null, caboFinalRound: false, lastAction: null, roundScores: null, tempReveal: null });
    setInitialPeek(true); setInitialPeekTimer(15); setDrawnCard(null); setTurnPhase('start'); setAbilityMode(null); setRevealedCards(false); setTempRevealCard(null); playSound('cardDeal');
  };
  const sendChat = async () => { if (!chatInput.trim()) return; await sendChatMessage(roomCode, playerId, playerName, chatInput.trim()); setChatInput(''); };
  const handleReaction = async (emoji) => { await fbSendReaction(roomCode, playerId, playerName, emoji); addFloatingReaction(emoji, playerName); setShowReactions(false); };
  useEffect(() => { if (showChat) { setChatUnread(0); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [showChat, chatMessages]);
  const leaveRoom = () => { cleanupSubs(); if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current); setScreen('menu'); setRoomCode(''); setRoomData2(null); setGameData(null); setChatMessages([]); setDrawnCard(null); setTurnPhase('start'); setAbilityMode(null); setInitialPeek(false); setRevealedCards(false); setBotCount(0); };

  // RENDER
  return (
    <div style={{ minHeight: '100dvh', padding: 16, position: 'relative' }}>
      {/* Lang */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100, display: 'flex', gap: 4, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 4 }}>
        {['TR', 'EN'].map(l => <button key={l} onClick={() => setLang(l.toLowerCase())} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer', background: lang === l.toLowerCase() ? 'var(--gold)' : 'transparent', color: lang === l.toLowerCase() ? '#1a1a1a' : 'var(--text-dim)' }}>{l}</button>)}
      </div>
      {notification && <div style={{ position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,0.88)', border: '1px solid var(--gold)', padding: '10px 24px', borderRadius: 8, color: 'var(--gold-bright)', fontWeight: 600, fontSize: 15, animation: 'notif-in 0.3s ease-out', whiteSpace: 'nowrap' }}>{notification}</div>}
      {floatingReactions.map(r => <div key={r.id} style={{ position: 'fixed', zIndex: 200, fontSize: 36, animation: 'float-up 2.5s ease-out forwards', pointerEvents: 'none', left: `${25 + Math.random() * 50}%`, top: '55%' }}>{r.emoji}</div>)}

      {/* MENU */}
      {screen === 'menu' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 24 }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 72, fontWeight: 900, color: 'var(--gold-bright)', textShadow: '0 2px 4px rgba(0,0,0,0.5), 0 0 40px rgba(212,168,67,0.3)', letterSpacing: 12 }}>KABOO</h1>
          <p style={{ fontFamily: "'Crimson Text', serif", fontSize: 18, color: 'var(--text-dim)', letterSpacing: 4, fontStyle: 'italic' }}>{t.subtitle}</p>
          <div style={{ background: 'linear-gradient(145deg, rgba(0,0,0,0.3), rgba(0,0,0,0.15))', border: '1px solid rgba(212,168,67,0.2)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 380 }}>
            <input className="input" placeholder={t.enterName} value={playerName} onChange={e => setPlayerName(e.target.value.slice(0, 16))} style={{ marginBottom: 12 }} />
            <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={handleCreateRoom}>{t.createRoom}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,0.2)' }} /><span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t.or}</span><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,0.2)' }} /></div>
            <input className="input" placeholder={t.enterRoomCode} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 5))} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 22, marginBottom: 12 }} />
            <button className="btn btn-secondary" onClick={handleJoinRoom}>{t.joinRoom}</button>
            {error && <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginTop: 10 }}>{error}</p>}
          </div>
        </div>
      )}

      {/* LOBBY */}
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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.id === roomData.hostId && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(212,168,67,0.2)', color: 'var(--gold)' }}>{t.host}</span>}
                    {p.isBot && isHost && <button className="btn btn-small" style={{ padding: '3px 10px', fontSize: 11, background: 'rgba(200,50,50,0.3)', color: '#ff6b6b', border: '1px solid rgba(200,50,50,0.3)' }} onClick={() => removeBot(p.id)}>✕</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', width: '100%', maxWidth: 380 }}>
              {players.length < 6 && <button className="btn btn-secondary" style={{ background: 'rgba(100,100,255,0.1)', borderColor: 'rgba(100,100,255,0.3)' }} onClick={addBot}>{t.addBot}</button>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16 }}>
                <span>{t.targetScore}:</span>
                <input className="input" type="number" value={targetScoreInput} onChange={e => setTargetScoreInput(Math.max(50, Math.min(999, parseInt(e.target.value) || 100)))} style={{ width: 80, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 18 }} />
              </div>
              <button className="btn btn-primary" style={{ maxWidth: 300, fontSize: 18, padding: '14px 32px', opacity: players.length < 2 ? 0.5 : 1 }} onClick={startGame} disabled={players.length < 2}>
                {t.startGame} {players.length >= 2 ? '🎴' : ''}
              </button>
            </div>
          )}
          {!isHost && <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.waiting}</div>}
          <button className="btn btn-secondary btn-small" style={{ maxWidth: 120 }} onClick={leaveRoom}>{t.back}</button>
        </div>
      )}

      {/* GAME */}
      {screen === 'game' && gameData && roomData && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 32px)', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: 'var(--gold)' }}>{t.round} {gameData.round}</span>
            {gameData.status === 'playing' && (
              <span style={{ fontSize: 14, padding: '6px 14px', borderRadius: 20, background: isMyTurn ? 'rgba(212,168,67,0.2)' : isBot ? 'rgba(100,100,255,0.15)' : 'rgba(0,0,0,0.3)', border: `1px solid ${isMyTurn ? 'var(--gold)' : 'rgba(212,168,67,0.3)'}`, color: isMyTurn ? 'var(--gold-bright)' : 'var(--text-light)', animation: isMyTurn ? 'glow 1.5s ease-in-out infinite alternate' : 'none' }}>
                {isMyTurn ? t.yourTurn : isBot ? `${cpname} ${t.botThinking}` : `${cpname}${t.notYourTurn}`}
              </span>
            )}
            <button className="btn btn-small btn-secondary" onClick={() => setShowReactions(!showReactions)} style={{ width: 'auto' }}>{t.reactions}</button>
          </div>
          {showReactions && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>{EMOJIS.map(e => <button key={e} onClick={() => handleReaction(e)} style={{ width: 38, height: 38, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,0.08)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{e}</button>)}</div>}
          {gameData.caboFinalRound && <div style={{ textAlign: 'center', padding: '8px 16px', background: 'linear-gradient(135deg, rgba(201,48,44,0.3), rgba(201,48,44,0.15))', border: '1px solid rgba(201,48,44,0.4)', borderRadius: 8, color: '#ff6b6b', fontWeight: 600, animation: 'cabo-flash 1s ease-in-out infinite alternate' }}>{players.find(p => p.id === gameData.caboCallerId)?.name} {t.caboCall} — {t.caboLastRound}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>{players.map(p => <div key={p.id} style={{ padding: '3px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", border: p.id === playerId ? '1px solid var(--gold)' : '1px solid transparent' }}>{p.name}: {scores[p.id] || 0}</div>)}</div>

          {/* Others */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
            {otherPlayers.map(p => (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 10px', background: 'rgba(0,0,0,0.15)', border: `1px solid ${cpid === p.id ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 12, minWidth: 100 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: cpid === p.id ? 'var(--gold-bright)' : 'var(--text-dim)' }}>{p.name}</div>
                <HandGrid cards={gameData.hands?.[p.id] || []} small faceUp={revealedCards}
                  onCardClick={ci => { if (abilityMode && ['peekOther','blindSwap','lookSwap'].includes(abilityMode) && abilityStep === 0) { setSelectedOtherPlayer(p.id); setSelectedOtherCard(ci); } else if (gameData.status === 'playing') handleSnap(p.id, ci); }}
                  highlighted={ci => selectedOtherPlayer === p.id && selectedOtherCard === ci} />
              </div>
            ))}
          </div>

          {/* Center */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && turnPhase === 'start' && !drawnCard) ? 'pointer' : 'default', opacity: (isMyTurn && turnPhase === 'start' && !drawnCard) ? 1 : 0.5 }} onClick={drawFromPile}>
              <Card card={{ rank: '?', suit: '?' }} faceUp={false} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', letterSpacing: 1 }}>{t.drawPile} ({gameData.drawPile?.length || 0})</span>
            </div>
            {drawnCard && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, background: 'rgba(0,0,0,0.2)', border: '2px dashed var(--gold)', borderRadius: 12 }}>
                <Card card={drawnCard} faceUp animClass="deal-anim" />
                {turnPhase === 'fromDiscard' ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>↓ {t.selectYourCard}</span> : <button className="btn btn-small btn-secondary" onClick={discardDrawnCard}>{t.discardCard}</button>}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && turnPhase === 'start' && topDiscard) ? 'pointer' : 'default', opacity: (isMyTurn && turnPhase === 'start' && topDiscard) ? 1 : 0.5 }} onClick={takeFromDiscard}>
              {topDiscard ? <Card card={topDiscard} faceUp /> : <div className="card" style={{ background: 'rgba(0,0,0,0.2)', border: '2px dashed rgba(255,255,255,0.1)' }} />}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)', letterSpacing: 1 }}>{t.discardPile}</span>
            </div>
          </div>

          {/* My hand */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(212,168,67,0.15)', borderRadius: '16px 16px 0 0', marginTop: 'auto' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: 'var(--gold)' }}>{playerName} {t.you}</div>
            <HandGrid cards={myHand} faceUp={revealedCards} peekingCards={peekingCards}
              highlighted={ci => (drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard')) || (abilityMode && ['peekSelf','blindSwap'].includes(abilityMode) && selectedMyCard === ci) || (abilityMode === 'lookSwap' && abilityStep === 1 && selectedMyCard === ci)}
              onCardClick={ci => {
                if (drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard')) keepDrawnCard(ci);
                else if (abilityMode === 'peekSelf') setSelectedMyCard(ci);
                else if (abilityMode === 'blindSwap' || (abilityMode === 'lookSwap' && abilityStep === 1)) setSelectedMyCard(ci);
                else if (gameData.status === 'playing') handleSnap(playerId, ci);
              }}
              animClass="deal-anim" />
            {isMyTurn && turnPhase === 'start' && !drawnCard && !gameData.caboFinalRound && <button className="btn btn-cabo" onClick={callCabo}>{t.cabo}</button>}
            {isMyTurn && turnPhase === 'start' && !drawnCard && <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.drawOrDiscard}</div>}
            {drawnCard && (turnPhase === 'drawn' || turnPhase === 'fromDiscard') && <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>{t.chooseAction}</div>}
          </div>

          {/* Peek overlays */}
          {initialPeek && <div onClick={() => { setInitialPeek(false); setPeekingCards({}); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 52, color: 'var(--gold-bright)' }}>{initialPeekTimer}</div>
            <div style={{ color: 'var(--gold)', fontFamily: "'Playfair Display', serif", fontSize: 20 }}>{t.lookingAtCards}</div>
            <div style={{ display: 'flex', gap: 16 }}>{myHand.slice(2, 4).map((c, i) => <Card key={i} card={c} faceUp animClass="deal-anim" />)}</div>
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 14 }}>{t.closeCard}</div>
          </div>}

          {(Object.keys(peekingCards).length > 0 || tempRevealCard) && !initialPeek && <div onClick={closePeek} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 52, color: 'var(--gold-bright)' }}>{peekTimer}</div>
            <div style={{ display: 'flex', gap: 16 }}>
              {Object.keys(peekingCards).map(ci => myHand[ci] && <Card key={ci} card={myHand[ci]} faceUp />)}
              {tempRevealCard && <Card card={tempRevealCard} faceUp />}
            </div>
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 14 }}>{t.closeCard} ({peekTimer} {t.timeLeft})</div>
          </div>}

          {/* Ability modal */}
          {abilityMode && !Object.keys(peekingCards).length && !tempRevealCard && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(4px)', padding: 20 }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: 'var(--gold-bright)' }}>{t[abilityMode]}</div>
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', maxWidth: 300 }}>
              {abilityMode === 'peekSelf' && t.selectYourCard}
              {abilityMode === 'peekOther' && (selectedOtherPlayer ? t.selectOtherCard : t.selectOtherPlayer)}
              {abilityMode === 'blindSwap' && (selectedMyCard === null ? t.selectYourCard : !selectedOtherPlayer ? t.selectOtherPlayer : t.selectOtherCard)}
              {abilityMode === 'lookSwap' && abilityStep === 0 && (selectedOtherPlayer ? t.selectOtherCard : t.selectOtherPlayer)}
              {abilityMode === 'lookSwap' && abilityStep === 1 && `${t.selectYourCard} (${t.skip}?)`}
            </div>
            {['peekOther','blindSwap','lookSwap'].includes(abilityMode) && !selectedOtherPlayer && abilityStep === 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{otherPlayers.map(p => <button key={p.id} className="btn btn-small btn-secondary" onClick={() => setSelectedOtherPlayer(p.id)}>{p.name}</button>)}</div>}
            {selectedOtherPlayer && ['peekOther','blindSwap'].includes(abilityMode) && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{(gameData.hands[selectedOtherPlayer] || []).map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selectedOtherCard === ci} onClick={() => setSelectedOtherCard(ci)} />)}</div>}
            {selectedOtherPlayer && abilityMode === 'lookSwap' && abilityStep === 0 && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{(gameData.hands[selectedOtherPlayer] || []).map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selectedOtherCard === ci} onClick={() => setSelectedOtherCard(ci)} />)}</div>}
            {abilityMode === 'peekSelf' && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}</div>}
            {abilityMode === 'blindSwap' && selectedOtherPlayer && selectedOtherCard !== null && <div><div style={{ color: 'var(--text-dim)', marginBottom: 6, textAlign: 'center', fontSize: 13 }}>{t.selectYourCard}</div><div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}</div></div>}
            {abilityMode === 'lookSwap' && abilityStep === 1 && <div><div style={{ color: 'var(--text-dim)', marginBottom: 6, textAlign: 'center', fontSize: 13 }}>{t.selectYourCard}</div><div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selectedMyCard === ci} onClick={() => setSelectedMyCard(ci)} />)}</div></div>}
            <div style={{ display: 'flex', gap: 8 }}>
              {((abilityMode === 'peekSelf' && selectedMyCard !== null) || (abilityMode === 'peekOther' && selectedOtherCard !== null) || (abilityMode === 'blindSwap' && selectedMyCard !== null && selectedOtherCard !== null) || (abilityMode === 'lookSwap' && abilityStep === 0 && selectedOtherCard !== null) || (abilityMode === 'lookSwap' && abilityStep === 1)) && <button className="btn btn-primary btn-small" onClick={executeAbility}>{t.confirm}</button>}
              <button className="btn btn-secondary btn-small" onClick={skipAbility}>{t.cancel}</button>
            </div>
          </div>}

          {/* Round end */}
          {gameData.status === 'roundEnd' && gameData.roundScores && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, backdropFilter: 'blur(6px)', padding: 20, overflowY: 'auto' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, color: 'var(--gold-bright)' }}>{t.roundOver}</div>
            <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'left' }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'center' }}>{t.round} {gameData.round}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", color: 'var(--gold)', fontSize: 14, textAlign: 'center' }}>{t.total}</th></tr></thead>
              <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,0.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === playerId ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>{gameData.roundScores[p.id]}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
            </table>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>{players.map(p => <div key={p.id} style={{ textAlign: 'center' }}><div style={{ fontSize: 12, marginBottom: 4, color: 'var(--text-dim)' }}>{p.name}</div><HandGrid cards={gameData.hands[p.id] || []} small faceUp /></div>)}</div>
            {isHost && <button className="btn btn-primary" style={{ maxWidth: 240 }} onClick={startNextRound}>{t.nextRound}</button>}
          </div>}

          {/* Game over */}
          {gameData.status === 'gameOver' && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, backdropFilter: 'blur(6px)', padding: 20 }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, color: 'var(--gold-bright)' }}>{t.gameOver}</div>
            <table style={{ width: '100%', maxWidth: 360, borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', textAlign: 'left', fontFamily: "'Playfair Display', serif", color: 'var(--gold)' }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', textAlign: 'center', fontFamily: "'Playfair Display', serif", color: 'var(--gold)' }}>{t.total}</th></tr></thead>
              <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,0.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === playerId ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,0.08)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
            </table>
            <button className="btn btn-primary" style={{ maxWidth: 200 }} onClick={leaveRoom}>{t.newGame}</button>
          </div>}

          {/* Chat */}
          <button onClick={() => { setShowChat(!showChat); if (!showChat) setChatUnread(0); }} style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 40, width: 48, height: 48, borderRadius: '50%', background: 'var(--gold)', color: '#1a1a1a', border: 'none', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💬{chatUnread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: '#c9302c', color: 'white', fontSize: 11, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{chatUnread}</span>}</button>
          {showChat && <div style={{ position: 'fixed', bottom: 72, right: 16, zIndex: 40, width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: 400, background: 'rgba(14,58,26,0.95)', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(212,168,67,0.15)', fontFamily: "'Playfair Display', serif", fontSize: 14, color: 'var(--gold)' }}>{t.chat}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', maxHeight: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>{chatMessages.map((m, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.4 }}><span style={{ fontWeight: 600, color: 'var(--gold)', marginRight: 6 }}>{m.name}:</span>{m.text}</div>)}<div ref={chatEndRef} /></div>
            <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid rgba(212,168,67,0.15)' }}><input className="input" style={{ fontSize: 13 }} placeholder={t.sendMsg} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} maxLength={200} /><button className="btn btn-small btn-primary" style={{ width: 'auto', flexShrink: 0 }} onClick={sendChat}>{t.send}</button></div>
          </div>}
        </div>
      )}
    </div>
  );
}

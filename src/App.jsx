import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createRoom as fbCreateRoom, joinRoom as fbJoinRoom,
  subscribeToRoom, updateRoom, setRoomData,
  sendChatMessage, subscribeToChat,
  sendReaction as fbSendReaction, subscribeToReactions,
  setGameState, updateGameState, subscribeToGameState,
} from './firebase.js';
import {
  LANG, EMOJIS, shuffle, cardValue, isRedSuit,
  getCardAbility, generateRoomCode, generatePlayerId, dealCards, playSound,
} from './gameLogic.js';

const BOT_NAMES = ['Robo', 'Pixel', 'Byte', 'Chip', 'Nova'];

// ── Card ──
function Card({ card, faceUp, highlighted, onClick, small, disabled, peeking, anim, style: st }) {
  const jk = card?.rank === 'JK', red = card && isRedSuit(card.suit), show = faceUp || peeking;
  return (
    <div className={`kc ${show ? 'fu' : 'fd'} ${highlighted ? 'hl' : ''} ${small ? 'sm' : ''} ${disabled ? 'dis' : ''} ${anim || ''}`}
      onClick={disabled ? undefined : onClick} style={{ ...st, color: show ? (jk ? '#6b21a8' : red ? '#dc2626' : '#1e293b') : undefined }}>
      {show ? (
        <div className="kcf">
          <div className="kcr"><span className="kr">{jk ? '🃏' : card.rank}</span>{!jk && <span className="ks">{card.suit}</span>}</div>
          <div className="kcc">{jk ? '🃏' : card.suit}</div>
          <div className="kcr kbr"><span className="kr">{jk ? '🃏' : card.rank}</span>{!jk && <span className="ks">{card.suit}</span>}</div>
        </div>
      ) : (<div className="kcb"><div className="kcbi">♦</div></div>)}
    </div>
  );
}

// ── HandGrid: top[0,1] bottom[2,3], penalty rows above ──
function HandGrid({ cards, small, faceUp, peek, hl, onClick, anim }) {
  const base = cards.slice(0, 4), pen = cards.slice(4), rows = [];
  for (let i = 0; i < pen.length; i += 2) rows.push(pen.slice(i, i + 2));
  const g = small ? 3 : 6;
  const rc = (c, idx) => <Card key={idx} card={c} faceUp={faceUp} small={small} peeking={peek?.[idx]}
    highlighted={hl?.(idx)} onClick={() => onClick?.(idx)} anim={anim}
    style={anim ? { animationDelay: `${idx * 0.08}s` } : undefined} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: g }}>
      {rows.map((r, ri) => <div key={`p${ri}`} style={{ display: 'flex', gap: g }}>{r.map((c, ci) => rc(c, 4 + ri * 2 + ci))}</div>)}
      <div style={{ display: 'flex', gap: g }}>{[0, 1].map(i => base[i] ? rc(base[i], i) : <div key={i} style={{ width: small ? 44 : 62, height: small ? 62 : 88 }} />)}</div>
      <div style={{ display: 'flex', gap: g }}>{[2, 3].map(i => base[i] ? rc(base[i], i) : <div key={i} style={{ width: small ? 44 : 62, height: small ? 62 : 88 }} />)}</div>
    </div>
  );
}

// ── Bot AI ──
function botPlay(gs, botId) {
  const h = gs.hands[botId] || []; if (!h.length) return gs;
  // CABO check: only if first round complete and turnCount > playerCount
  if (!gs.caboFinalRound && gs.turnCount >= gs.players.length && h.length <= 3 && Math.random() < 0.1) {
    gs.caboCallerId = botId; gs.caboFinalRound = true; gs.caboTurnsLeft = gs.players.length - 1;
    gs.lastAction = { type: 'cabo', pid: botId, ts: Date.now() }; return gs;
  }
  if (!gs.drawPile?.length) { const t = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [t]; }
  const d = gs.drawPile.shift(), dv = cardValue(d);
  if (dv <= 4) {
    const ri = Math.floor(Math.random() * h.length);
    const old = h[ri]; gs.hands[botId][ri] = { ...d, position: ri }; gs.discardPile.push(old);
    gs.lastAction = { type: 'swap', pid: botId, discarded: old, ts: Date.now() };
  } else {
    gs.discardPile.push(d);
    gs.lastAction = { type: 'discard', pid: botId, discarded: d, ts: Date.now() };
  }
  gs.turnCount = (gs.turnCount || 0) + 1;
  return gs;
}

// ══════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════
export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('kaboo_lang') || 'tr');
  const [pname, setPname] = useState(() => localStorage.getItem('kaboo_name') || '');
  const [pid] = useState(() => { let id = localStorage.getItem('kaboo_pid'); if (!id) { id = generatePlayerId(); localStorage.setItem('kaboo_pid', id); } return id; });
  const t = LANG[lang];

  const [screen, setScreen] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [roomData, setRoomData2] = useState(null);
  const [gameData, setGameData2] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);

  // Local UI state
  const [drawn, setDrawn] = useState(null);
  const [phase, setPhase] = useState('start');
  const [peekCards, setPeekCards] = useState({});
  const [peekTime, setPeekTime] = useState(0);
  const [ability, setAbility] = useState(null);
  const [aStep, setAStep] = useState(0);
  const [selMy, setSelMy] = useState(null);
  const [selOp, setSelOp] = useState(null);
  const [selOc, setSelOc] = useState(null);
  const [notif, setNotif] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatIn, setChatIn] = useState('');
  const [showReact, setShowReact] = useState(false);
  const [floats, setFloats] = useState([]);
  const [targetScore, setTargetScore] = useState(100);
  const [iPeek, setIPeek] = useState(false);
  const [iPeekT, setIPeekT] = useState(15);
  const [revealed, setRevealed] = useState(false);
  const [tempCard, setTempCard] = useState(null);
  const [botCnt, setBotCnt] = useState(0);
  // Snap state
  const [snapMode, setSnapMode] = useState(null); // null | {targetPid, cardIdx}
  const [snapGiveMode, setSnapGiveMode] = useState(false);

  const peekRef = useRef(null);
  const unsubRefs = useRef({});
  const chatEndRef = useRef(null);
  const botRef = useRef(null);
  const showChatRef = useRef(showChat);
  const lastChatRef = useRef(0);
  showChatRef.current = showChat;

  useEffect(() => { localStorage.setItem('kaboo_lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('kaboo_name', pname); }, [pname]);
  useEffect(() => { const p = new URLSearchParams(window.location.search).get('room'); if (p) setJoinCode(p.toUpperCase()); }, []);

  const notify = useCallback((m) => { setNotif(m); setTimeout(() => setNotif(''), 3000); }, []);
  const addFloat = useCallback((e) => { const id = Date.now() + Math.random(); setFloats(p => [...p, { id, e }]); setTimeout(() => setFloats(p => p.filter(r => r.id !== id)), 2500); }, []);

  const cleanupSubs = useCallback(() => { Object.values(unsubRefs.current).forEach(u => u && u()); unsubRefs.current = {}; }, []);
  const subscribeAll = useCallback((code) => {
    cleanupSubs();
    unsubRefs.current.room = subscribeToRoom(code, d => setRoomData2(d));
    unsubRefs.current.game = subscribeToGameState(code, gs => { setGameData2(gs); if (gs?.status && gs.status !== 'lobby') setScreen('game'); });
    unsubRefs.current.chat = subscribeToChat(code, msgs => {
      setChatMsgs(prev => { if (msgs.length > prev.length) { if (!showChatRef.current) setChatUnread(u => u + (msgs.length - lastChatRef.current)); lastChatRef.current = msgs.length; playSound('chat'); } return msgs; });
    });
    unsubRefs.current.react = subscribeToReactions(code, reactions => {
      if (reactions.length > 0) { const l = reactions[reactions.length - 1]; if (l.playerId !== pid && Date.now() - l.ts < 3000) addFloat(l.emoji); }
    });
  }, [cleanupSubs, pid, addFloat]);

  // ── Room ──
  const handleCreate = async () => {
    if (!pname.trim()) { setError(t.nameRequired); return; }
    const code = generateRoomCode();
    await fbCreateRoom(code, pid, pname.trim());
    setRoomCode(code); subscribeAll(code); setScreen('lobby'); setError(''); setBotCnt(0); playSound('join');
  };
  const handleJoin = async () => {
    if (!pname.trim()) { setError(t.nameRequired); return; }
    if (!joinCode.trim()) { setError(t.codeRequired); return; }
    const code = joinCode.trim().toUpperCase();
    const res = await fbJoinRoom(code, pid, pname.trim());
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

  // ── Bots ──
  const addBot = async () => {
    const curr = roomData?.players ? Object.values(roomData.players).filter(Boolean) : [];
    if (curr.length >= 6) { notify(t.roomFull); return; }
    const botId = `bot_${botCnt}_${Date.now()}`; const botName = `${BOT_NAMES[botCnt % BOT_NAMES.length]} 🤖`;
    await setRoomData(roomCode, `players/${botId}`, { id: botId, name: botName, connected: true, isBot: true, joinedAt: Date.now() });
    await setRoomData(roomCode, `scores/${botId}`, 0);
    setBotCnt(c => c + 1); playSound('join');
  };
  const removeBot = async (botId) => {
    await setRoomData(roomCode, `players/${botId}`, null);
    await setRoomData(roomCode, `scores/${botId}`, null);
    setBotCnt(c => Math.max(0, c - 1));
  };

  // ── Helpers ──
  const players = roomData?.players ? Object.values(roomData.players).filter(Boolean).sort((a, b) => a.joinedAt - b.joinedAt) : [];
  const pOrder = players.map(p => p.id);
  const others = players.filter(p => p.id !== pid);
  const cidx = gameData?.currentPlayerIndex ?? 0;
  const cpid = pOrder[cidx];
  const cpname = players.find(p => p.id === cpid)?.name || '';
  const cpBot = players.find(p => p.id === cpid)?.isBot || false;
  const isMyTurn = gameData?.status === 'playing' && cpid === pid && !ability;
  const myHand = gameData?.hands?.[pid] || [];
  const topDiscard = gameData?.discardPile?.[gameData.discardPile.length - 1] || null;
  const isHost = roomData?.hostId === pid;
  const scores = roomData?.scores || {};

  // CABO available: everyone played at least once (turnCount >= player count)
  const caboAvailable = gameData && !gameData.caboFinalRound && (gameData.turnCount || 0) >= pOrder.length;

  // ── Advance turn (CLOCKWISE = increment index) ──
  function advTurn(gs) {
    if (gs.caboFinalRound) {
      gs.caboTurnsLeft = (gs.caboTurnsLeft || 1) - 1;
      if (gs.caboTurnsLeft <= 0) return endRound(gs);
    }
    let ni = (gs.currentPlayerIndex + 1) % pOrder.length;
    let att = 0;
    while (gs.hands[pOrder[ni]]?.length === 0 && att < pOrder.length) { ni = (ni + 1) % pOrder.length; att++; }
    // Skip the cabo caller
    if (gs.caboFinalRound && pOrder[ni] === gs.caboCallerId) {
      ni = (ni + 1) % pOrder.length;
    }
    gs.currentPlayerIndex = ni;
    return gs;
  }
  function endRound(gs) {
    gs.status = 'roundEnd'; const rs = {};
    for (const p of gs.players || players) { const id = p.id || p; rs[id] = (gs.hands[id] || []).reduce((s, c) => s + cardValue(c), 0); }
    gs.roundScores = rs;
    const ns = { ...scores }; for (const id of pOrder) ns[id] = (ns[id] || 0) + (rs[id] || 0);
    updateRoom(roomCode, { scores: ns });
    return gs;
  }

  // ── Start game (HOST) ──
  const startGame = async () => {
    if (players.length < 2) { notify(t.minPlayers); return; }
    try {
      console.log('Starting game with players:', pOrder);
      const { hands, drawPile, discardPile } = dealCards(pOrder);
      console.log('Cards dealt, hands:', Object.keys(hands));
      // Host is index 0, game starts from index 1 (dağıtıcıdan sonraki)
      const startIdx = pOrder.length > 1 ? 1 : 0;
      await updateRoom(roomCode, { targetScore });
      console.log('Room updated');
      const gsData = {
        status: 'peeking', round: (gameData?.round || 0) + 1, hands, drawPile, discardPile,
        currentPlayerIndex: startIdx, caboCallerId: null, caboFinalRound: false, caboTurnsLeft: 0,
        lastAction: null, roundScores: null, turnCount: 0, players: players.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
      };
      console.log('Setting game state...');
      await setGameState(roomCode, gsData);
      console.log('Game state set successfully!');
      setScreen('game');
      setIPeek(true); setIPeekT(15); setDrawn(null); setPhase('start');
      setAbility(null); setRevealed(false); setTempCard(null); setSnapMode(null); setSnapGiveMode(false);
      playSound('cardDeal');
    } catch (err) {
      console.error('START GAME ERROR:', err);
      notify('Error: ' + err.message);
    }
  };

  // ── Peek ──
  useEffect(() => {
    if (iPeek && iPeekT > 0) { const t2 = setTimeout(() => setIPeekT(v => v - 1), 1000); return () => clearTimeout(t2); }
    if (iPeek && iPeekT === 0) { setIPeek(false); setPeekCards({}); }
  }, [iPeek, iPeekT]);
  useEffect(() => { if (iPeek && gameData?.hands?.[pid]) setPeekCards({ 2: true, 3: true }); }, [iPeek, pid, gameData?.hands]);

  // peeking → playing (only after peek was started AND completed)
  const peekStartedRef = useRef(false);
  useEffect(() => {
    if (iPeek) peekStartedRef.current = true;
  }, [iPeek]);
  useEffect(() => {
    if (gameData?.status === 'peeking' && !iPeek && peekStartedRef.current && isHost) {
      peekStartedRef.current = false;
      const t2 = setTimeout(() => updateGameState(roomCode, { status: 'playing' }), 500);
      return () => clearTimeout(t2);
    }
  }, [gameData?.status, iPeek, isHost, roomCode]);

  // ── Bot auto-play ──
  useEffect(() => {
    if (!gameData || gameData.status !== 'playing' || !isHost || !cpBot) return;
    if (botRef.current) clearTimeout(botRef.current);
    botRef.current = setTimeout(async () => {
      const gs = JSON.parse(JSON.stringify(gameData));
      const updated = botPlay(gs, cpid);
      const adv = advTurn(updated);
      if (adv.status === 'roundEnd') setRevealed(true);
      adv.ts = Date.now();
      await setGameState(roomCode, adv); playSound('cardDeal');
    }, 1200 + Math.random() * 800);
    return () => { if (botRef.current) clearTimeout(botRef.current); };
  }, [gameData?.currentPlayerIndex, gameData?.status, cpBot, isHost]);

  // Peek timer
  const startPeek = useCallback((idxs, dur = 10) => {
    const o = {}; idxs.forEach(i => o[i] = true); setPeekCards(o); setPeekTime(dur);
    if (peekRef.current) clearInterval(peekRef.current);
    peekRef.current = setInterval(() => { setPeekTime(p => { if (p <= 1) { clearInterval(peekRef.current); setPeekCards({}); setTempCard(null); return 0; } return p - 1; }); }, 1000);
  }, []);
  const closePeek = () => { if (peekRef.current) clearInterval(peekRef.current); setPeekCards({}); setPeekTime(0); setTempCard(null); };

  // ── Actions ──
  const save = async (g) => { g.ts = Date.now(); await setGameState(roomCode, g); };

  const drawFromPile = async () => {
    if (!isMyTurn || phase !== 'start' || drawn) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    if (!gs.drawPile?.length) { const top = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [top]; }
    setDrawn(gs.drawPile.shift()); setPhase('drawn'); await save(gs); playSound('cardFlip');
  };

  const takeFromDiscard = async () => {
    if (!isMyTurn || phase !== 'start' || !topDiscard) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    setDrawn(gs.discardPile.pop()); setPhase('fromDiscard'); await save(gs); playSound('cardFlip');
  };

  const keepDrawn = async (idx) => {
    if (!drawn) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    const old = gs.hands[pid][idx]; gs.hands[pid][idx] = { ...drawn, position: idx }; gs.discardPile.push(old);
    gs.lastAction = { type: 'swap', pid, discarded: old, ts: Date.now() };
    gs.turnCount = (gs.turnCount || 0) + 1;

    // NO ability when swapping — abilities ONLY activate on direct discard (option b)
    const adv = advTurn(gs); setDrawn(null); setPhase('start');
    if (adv.status === 'roundEnd') setRevealed(true);
    await save(adv); playSound('cardDeal');
  };

  const discardDrawn = async () => {
    if (!drawn) return;
    const gs = JSON.parse(JSON.stringify(gameData));
    gs.discardPile.push(drawn);
    gs.lastAction = { type: 'discard', pid, discarded: drawn, ts: Date.now() };
    gs.turnCount = (gs.turnCount || 0) + 1;

    // Ability on discard
    const ab = getCardAbility(drawn);
    if (ab && phase === 'drawn') {
      setAbility(ab); setAStep(0); setSelMy(null); setSelOp(null); setSelOc(null);
      setDrawn(null); setPhase('ability'); await save(gs); return;
    }
    const adv = advTurn(gs); setDrawn(null); setPhase('start');
    if (adv.status === 'roundEnd') setRevealed(true);
    await save(adv); playSound('cardDeal');
  };

  const skipAbil = async () => {
    const gs = JSON.parse(JSON.stringify(gameData));
    const adv = advTurn(gs); setAbility(null); setPhase('start');
    if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
  };

  const execAbil = async () => {
    const gs = JSON.parse(JSON.stringify(gameData));
    if (ability === 'peekSelf' && selMy !== null) {
      startPeek([selMy], 10); playSound('cardFlip');
      const adv = advTurn(gs); setAbility(null); setPhase('start');
      if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
    } else if (ability === 'peekOther' && selOp && selOc !== null) {
      const oh = gs.hands[selOp]; if (oh?.[selOc]) { setTempCard(oh[selOc]); startPeek([], 10); }
      playSound('cardFlip'); const adv = advTurn(gs); setAbility(null); setPhase('start');
      if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
    } else if (ability === 'blindSwap' && selMy !== null && selOp && selOc !== null) {
      const mc = gs.hands[pid][selMy], oc = gs.hands[selOp][selOc];
      gs.hands[pid][selMy] = { ...oc, position: selMy }; gs.hands[selOp][selOc] = { ...mc, position: selOc };
      const adv = advTurn(gs); setAbility(null); setPhase('start');
      if (adv.status === 'roundEnd') setRevealed(true); await save(adv); playSound('cardDeal');
    } else if (ability === 'lookSwap') {
      if (aStep === 0 && selOp && selOc !== null) {
        const oh = gs.hands[selOp]; if (oh?.[selOc]) { setTempCard(oh[selOc]); startPeek([], 10); }
        setAStep(1); playSound('cardFlip'); return;
      }
      if (aStep === 1) {
        if (selMy !== null) { const mc = gs.hands[pid][selMy], oc = gs.hands[selOp][selOc]; gs.hands[pid][selMy] = { ...oc, position: selMy }; gs.hands[selOp][selOc] = { ...mc, position: selOc }; }
        closePeek(); const adv = advTurn(gs); setAbility(null); setAStep(0); setPhase('start');
        if (adv.status === 'roundEnd') setRevealed(true); await save(adv); playSound('cardDeal');
      }
    }
  };

  // ── CABO ──
  const callCabo = async () => {
    if (!isMyTurn || phase !== 'start') return;
    if (!caboAvailable) { notify(t.caboNotYet); return; }
    const gs = JSON.parse(JSON.stringify(gameData));
    gs.caboCallerId = pid; gs.caboFinalRound = true;
    // Everyone else gets one more turn
    gs.caboTurnsLeft = pOrder.length - 1;
    gs.lastAction = { type: 'cabo', pid, ts: Date.now() };
    const adv = advTurn(gs); setPhase('start');
    if (adv.status === 'roundEnd') setRevealed(true);
    await save(adv); playSound('cabo'); notify(t.cabo + '!');
  };

  // ── SNAP (TIK TIK! 👊) ──
  // Step 1: Player clicks TIK TIK on a player zone → enters snap select mode
  // Step 2: Player selects which card to snap (from that player or themselves)
  const startSnap = (targetPid) => {
    if (!gameData || gameData.status !== 'playing') return;
    if (!topDiscard) return;
    playSound('tikTik');
    setSnapMode({ targetPid }); // show card selection for that player
  };

  const executeSnap = async (targetPid, cardIdx) => {
    const gs = JSON.parse(JSON.stringify(gameData));
    const tc = gs.hands[targetPid]?.[cardIdx]; if (!tc) { setSnapMode(null); return; }
    const ld = gs.discardPile[gs.discardPile.length - 1];

    if (cardValue(tc) === cardValue(ld)) {
      // CORRECT snap
      playSound('snap');
      if (targetPid === pid) {
        // Own card matched → remove it
        gs.hands[pid] = gs.hands[pid].filter((_, i) => i !== cardIdx);
        notify(t.snapSuccess);
        setSnapMode(null);
      } else {
        // Opponent's card matched → remove from opponent, give one of your cards
        gs.hands[targetPid] = gs.hands[targetPid].filter((_, i) => i !== cardIdx);
        notify(t.snapSuccess);
        // Now player needs to select which card to give
        if (gs.hands[pid].length > 0) {
          setSnapMode(null);
          setSnapGiveMode(true);
          // Store snap context
          gs._snapGiveTo = targetPid;
        } else {
          setSnapMode(null);
        }
      }
      gs.lastAction = { type: 'snap', pid, ok: true, ts: Date.now() };
    } else {
      // WRONG snap → 2 penalty cards
      playSound('fail');
      for (let i = 0; i < 2; i++) {
        if (gs.drawPile?.length > 0) gs.hands[pid].push({ ...gs.drawPile.shift(), position: gs.hands[pid].length });
      }
      gs.lastAction = { type: 'snap', pid, ok: false, ts: Date.now() };
      notify(t.snapFail);
      setSnapMode(null);
    }
    await save(gs);
  };

  const executeSnapGive = async (myCardIdx) => {
    const gs = JSON.parse(JSON.stringify(gameData));
    const giveTo = gs._snapGiveTo;
    if (giveTo && gs.hands[pid].length > 0) {
      const givenCard = gs.hands[pid][myCardIdx];
      gs.hands[pid] = gs.hands[pid].filter((_, i) => i !== myCardIdx);
      gs.hands[giveTo].push({ ...givenCard, position: gs.hands[giveTo].length });
    }
    delete gs._snapGiveTo;
    setSnapGiveMode(false);
    await save(gs);
  };

  // ── Next round ──
  const nextRound = async () => {
    try {
      const ts2 = roomData?.scores || {}; const tgt = roomData?.targetScore || 100;
      if (pOrder.some(p2 => (ts2[p2] || 0) >= tgt)) { await updateGameState(roomCode, { status: 'gameOver' }); return; }
      const { hands, drawPile, discardPile } = dealCards(pOrder);
      const startIdx = pOrder.length > 1 ? 1 : 0;
      await setGameState(roomCode, {
        status: 'peeking', round: (gameData?.round || 0) + 1, hands, drawPile, discardPile,
        currentPlayerIndex: startIdx, caboCallerId: null, caboFinalRound: false, caboTurnsLeft: 0,
        lastAction: null, roundScores: null, turnCount: 0, players: players.map(p => ({ id: p.id, name: p.name || '', isBot: !!p.isBot })),
      });
      setIPeek(true); setIPeekT(15); setDrawn(null); setPhase('start'); setAbility(null); setRevealed(false); setTempCard(null); setSnapMode(null); setSnapGiveMode(false); playSound('cardDeal');
    } catch (err) {
      console.error('NEXT ROUND ERROR:', err);
      notify('Error: ' + err.message);
    }
  };

  // ── Chat ──
  const sendMsg = async () => { if (!chatIn.trim()) return; await sendChatMessage(roomCode, pid, pname, chatIn.trim()); setChatIn(''); };
  const handleReact = async (emoji) => { await fbSendReaction(roomCode, pid, pname, emoji); addFloat(emoji); setShowReact(false); };
  useEffect(() => { if (showChat) { setChatUnread(0); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [showChat, chatMsgs]);
  const leave = () => { cleanupSubs(); if (botRef.current) clearTimeout(botRef.current); setScreen('menu'); setRoomCode(''); setRoomData2(null); setGameData2(null); setChatMsgs([]); setDrawn(null); setPhase('start'); setAbility(null); setIPeek(false); setRevealed(false); setBotCnt(0); setSnapMode(null); setSnapGiveMode(false); };

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════
  const S = { // style shortcuts
    gold: '#d4a843', gbright: '#f0c75e', dim: '#a89b85', light: '#e8dcc8',
    bg: 'rgba(0,0,0,.3)', bdr: '1px solid rgba(212,168,67,.2)',
  };

  return (
    <div className="kaboo-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@500&display=swap');
        .kaboo-root{font-family:'Crimson Text',Georgia,serif;min-height:100vh;background:radial-gradient(ellipse at center,#2d7a42 0%,#1a5c2e 40%,#0e3a1a 100%);color:#e8dcc8;position:relative;overflow-x:hidden}
        .kaboo-root::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");pointer-events:none;z-index:0}
        .kaboo-root::after{content:'';position:fixed;inset:0;border:10px solid #5c3a1e;border-image:linear-gradient(135deg,#8b6914,#5c3a1e,#8b6914,#3d2510) 1;pointer-events:none;z-index:1}
        .kaboo-root>*{position:relative;z-index:2}.kaboo-root *{box-sizing:border-box}
        .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:12px 24px;border:none;border-radius:8px;font-family:'Playfair Display',serif;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:1px;user-select:none}.btn:active{transform:scale(.97)}
        .bp{background:linear-gradient(135deg,#d4a843,#f0c75e);color:#1a1a1a;width:100%}.bp:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(212,168,67,.4)}
        .bs{background:rgba(255,255,255,.08);color:#e8dcc8;border:1px solid rgba(212,168,67,.2);width:100%}.bs:hover{background:rgba(255,255,255,.15)}
        .bsm{padding:6px 14px;font-size:13px;width:auto}
        .bcabo{background:linear-gradient(135deg,#c9302c,#ff4757);color:#fff;font-size:18px;letter-spacing:3px;padding:12px 32px;animation:cpulse 2s infinite;width:auto}
        .bcabo.disabled{opacity:.4;animation:none;cursor:default}
        @keyframes cpulse{0%,100%{box-shadow:0 0 0 0 rgba(201,48,44,.4)}50%{box-shadow:0 0 0 12px rgba(201,48,44,0)}}
        .btik{background:linear-gradient(135deg,#e67e22,#f39c12);color:#fff;font-size:12px;padding:5px 10px;width:auto;font-family:'Crimson Text',serif;font-weight:700;letter-spacing:0}
        .binv{background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;width:auto}
        .inp{width:100%;padding:12px 16px;border:1px solid rgba(212,168,67,.3);border-radius:8px;background:rgba(0,0,0,.3);color:#e8dcc8;font-family:'Crimson Text',serif;font-size:16px;outline:none}.inp:focus{border-color:#d4a843}.inp::placeholder{color:#a89b85}
        .kc{width:62px;height:88px;border-radius:7px;cursor:pointer;transition:all .25s;position:relative;box-shadow:0 2px 8px rgba(0,0,0,.4);flex-shrink:0}.kc.sm{width:44px;height:62px}
        .kc.fu{background:#faf8f0}.kc.fd{background:linear-gradient(135deg,#1e3a5f,#2c5282)}
        .kc:hover:not(.dis){transform:translateY(-5px);box-shadow:0 8px 20px rgba(0,0,0,.4)}
        .kc.hl{box-shadow:0 0 0 3px #f0c75e,0 4px 14px rgba(212,168,67,.5)}.kc.dis{opacity:.5;cursor:default;pointer-events:none}
        .kcf{width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;padding:4px;position:relative}
        .kcr{display:flex;flex-direction:column;align-items:center;line-height:1}
        .kr{font-family:'Playfair Display',serif;font-weight:700;font-size:15px}.kc.sm .kr{font-size:11px}
        .ks{font-size:11px}.kc.sm .ks{font-size:8px}
        .kbr{align-self:flex-end;transform:rotate(180deg)}
        .kcc{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:26px;opacity:.25}.kc.sm .kcc{font-size:16px}
        .kcb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.08);border-radius:7px;background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(255,255,255,.025) 5px,rgba(255,255,255,.025) 10px)}
        .kcbi{width:65%;height:65%;border:1px solid rgba(255,255,255,.12);border-radius:4px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.15);font-size:18px}.kc.sm .kcbi{font-size:12px}
        @keyframes din{from{opacity:0;transform:translateY(-30px) scale(.8)}to{opacity:1;transform:translateY(0) scale(1)}}.da{animation:din .35s ease-out both}
        @keyframes glow{from{box-shadow:0 0 5px rgba(212,168,67,.2)}to{box-shadow:0 0 18px rgba(212,168,67,.4)}}
        @keyframes cflash{from{opacity:.7}to{opacity:1}}
        @keyframes fup{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-180px) scale(.4)}}
        @keyframes nin{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .turn-badge{font-size:14px;padding:8px 18px;border-radius:20px;font-weight:700;text-align:center}
        .turn-mine{background:rgba(212,168,67,.25);border:2px solid #f0c75e;color:#f0c75e;animation:glow 1.5s ease-in-out infinite alternate}
        .turn-other{background:rgba(0,0,0,.3);border:1px solid rgba(212,168,67,.3);color:#e8dcc8}
        .turn-bot{background:rgba(100,100,255,.15);border:1px solid rgba(100,100,255,.3);color:#a0a0ff}
        .overlay{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16;backdrop-filter:blur(4px);padding:20px}
        @media(max-width:480px){.kc{width:52px;height:74px}.kc.sm{width:38px;height:54px}.kr{font-size:12px}.kc.sm .kr{font-size:9px}}
      `}</style>

      {/* Lang */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100, display: 'flex', gap: 4, background: 'rgba(0,0,0,.3)', borderRadius: 8, padding: 4 }}>
        {['TR', 'EN'].map(l => <button key={l} onClick={() => setLang(l.toLowerCase())} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, cursor: 'pointer', background: lang === l.toLowerCase() ? S.gold : 'transparent', color: lang === l.toLowerCase() ? '#1a1a1a' : S.dim }}>{l}</button>)}
      </div>

      {notif && <div style={{ position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,.9)', border: `1px solid ${S.gold}`, padding: '10px 24px', borderRadius: 8, color: S.gbright, fontWeight: 600, fontSize: 15, animation: 'nin .3s ease-out', whiteSpace: 'nowrap' }}>{notif}</div>}
      {floats.map(r => <div key={r.id} style={{ position: 'fixed', zIndex: 200, fontSize: 36, animation: 'fup 2.5s ease-out forwards', pointerEvents: 'none', left: `${25 + Math.random() * 50}%`, top: '55%' }}>{r.e}</div>)}

      <div style={{ padding: 16, minHeight: '100vh' }}>

        {/* ── MENU ── */}
        {screen === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 24 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 72, fontWeight: 900, color: S.gbright, textShadow: '0 2px 4px rgba(0,0,0,.5),0 0 40px rgba(212,168,67,.3)', letterSpacing: 12 }}>KABOO</h1>
            <p style={{ fontSize: 18, color: S.dim, letterSpacing: 4, fontStyle: 'italic' }}>{t.subtitle}</p>
            <div style={{ background: 'linear-gradient(145deg,rgba(0,0,0,.3),rgba(0,0,0,.15))', border: S.bdr, borderRadius: 16, padding: 32, width: '100%', maxWidth: 380 }}>
              <input className="inp" placeholder={t.enterName} value={pname} onChange={e => setPname(e.target.value.slice(0, 16))} style={{ marginBottom: 12 }} />
              <button className="btn bp" style={{ marginBottom: 10 }} onClick={handleCreate}>{t.createRoom}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,.2)' }} /><span style={{ color: S.dim, fontSize: 13 }}>{t.or}</span><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,.2)' }} /></div>
              <input className="inp" placeholder={t.enterRoomCode} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 5))} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 22, marginBottom: 12 }} />
              <button className="btn bs" onClick={handleJoin}>{t.joinRoom}</button>
              {error && <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginTop: 10 }}>{error}</p>}
            </div>
          </div>
        )}

        {/* ── LOBBY ── */}
        {screen === 'lobby' && roomData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', paddingTop: 40, gap: 20 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 48, fontWeight: 900, color: S.gbright, letterSpacing: 8 }}>KABOO</h1>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: S.dim, fontSize: 13, marginBottom: 6 }}>{t.roomCode}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: S.bg, border: `1px solid ${S.gold}`, borderRadius: 12, padding: '12px 20px' }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 32, fontWeight: 700, color: S.gbright, letterSpacing: 6 }}>{roomCode}</span>
                <button className="btn bsm bs" onClick={copyCode}>{copied ? t.copied : t.copyCode}</button>
              </div>
            </div>
            <button className="btn bsm binv" onClick={inviteFriend}>{t.inviteFriend}</button>
            <div style={{ width: '100%', maxWidth: 380 }}>
              <div style={{ color: S.dim, fontSize: 14, marginBottom: 8 }}>{t.players} ({players.length}/6)</div>
              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(0,0,0,.2)', border: '1px solid rgba(212,168,67,.15)', borderRadius: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{p.name} {p.id === pid ? t.you : ''}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.id === roomData.hostId && <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(212,168,67,.2)', color: S.gold }}>{t.host}</span>}
                    {p.isBot && isHost && <button className="btn bsm" style={{ padding: '3px 10px', fontSize: 11, background: 'rgba(200,50,50,.3)', color: '#ff6b6b', border: '1px solid rgba(200,50,50,.3)' }} onClick={() => removeBot(p.id)}>{t.removeBot}</button>}
                  </div>
                </div>
              ))}
            </div>
            {isHost && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', width: '100%', maxWidth: 380 }}>
                {players.length < 6 && <button className="btn bs" style={{ background: 'rgba(100,100,255,.1)', borderColor: 'rgba(100,100,255,.3)' }} onClick={addBot}>{t.addBot}</button>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16 }}>
                  <span>{t.targetScore}:</span>
                  <input className="inp" type="number" value={targetScore} onChange={e => setTargetScore(Math.max(50, Math.min(999, parseInt(e.target.value) || 100)))} style={{ width: 80, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 18 }} />
                </div>
                <button className="btn bp" style={{ maxWidth: 300, fontSize: 18, padding: '14px 32px', opacity: players.length < 2 ? .5 : 1 }} onClick={startGame} disabled={players.length < 2}>{t.startGame} 🎴</button>
              </div>
            )}
            {!isHost && <div style={{ color: S.dim, fontStyle: 'italic' }}>{t.waiting}</div>}
            <button className="btn bs bsm" style={{ maxWidth: 120 }} onClick={leave}>{t.back}</button>
          </div>
        )}

        {/* ── GAME ── */}
        {screen === 'game' && gameData && roomData && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 32px)', gap: 8 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: S.gold }}>{t.round} {gameData.round}</span>
              {gameData.status === 'playing' && (
                <div className={`turn-badge ${isMyTurn ? 'turn-mine' : cpBot ? 'turn-bot' : 'turn-other'}`}>
                  {isMyTurn ? t.yourTurn : cpBot ? `🤖 ${cpname} ${t.botThinking}` : `⏳ ${cpname}${t.notYourTurn}`}
                </div>
              )}
              <button className="btn bsm bs" onClick={() => setShowReact(!showReact)} style={{ width: 'auto' }}>{t.reactions}</button>
            </div>
            {showReact && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: 8, background: S.bg, borderRadius: 8 }}>{EMOJIS.map(e => <button key={e} onClick={() => handleReact(e)} style={{ width: 38, height: 38, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,.08)', fontSize: 18, cursor: 'pointer' }}>{e}</button>)}</div>}
            {gameData.caboFinalRound && <div style={{ textAlign: 'center', padding: '8px 16px', background: 'linear-gradient(135deg,rgba(201,48,44,.3),rgba(201,48,44,.15))', border: '1px solid rgba(201,48,44,.4)', borderRadius: 8, color: '#ff6b6b', fontWeight: 600, animation: 'cflash 1s ease-in-out infinite alternate' }}>{players.find(p => p.id === gameData.caboCallerId)?.name} {t.caboCall} — {t.caboLastRound}</div>}

            {/* Scores */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>{players.map(p => <div key={p.id} style={{ padding: '3px 10px', background: cpid === p.id ? 'rgba(212,168,67,.15)' : 'rgba(0,0,0,.2)', borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono',monospace", border: p.id === pid ? `1px solid ${S.gold}` : cpid === p.id ? '1px solid rgba(212,168,67,.3)' : '1px solid transparent' }}>{p.name}: {scores[p.id] || 0}</div>)}</div>

            {/* Others + TIK TIK */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {others.map(p => {
                const active = cpid === p.id; const hand = gameData.hands?.[p.id] || [];
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 10px', background: 'rgba(0,0,0,.15)', border: `2px solid ${active ? S.gbright : 'rgba(255,255,255,.08)'}`, borderRadius: 12, minWidth: 100 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? S.gbright : S.dim }}>{active ? '⏳ ' : ''}{p.name}</div>
                    <HandGrid cards={hand} small faceUp={revealed}
                      onClick={ci => {
                        if (ability && ['peekOther', 'blindSwap', 'lookSwap'].includes(ability) && aStep === 0) { setSelOp(p.id); setSelOc(ci); }
                      }}
                      hl={ci => (selOp === p.id && selOc === ci)} />
                    {/* TIK TIK button */}
                    {gameData.status === 'playing' && !snapMode && !snapGiveMode && (
                      <button className="btn btik" onClick={() => startSnap(p.id)}>{t.tikTik}</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* SNAP SELECT OVERLAY — full size 2x2 grid */}
            {snapMode && !snapGiveMode && (
              <div className="overlay" style={{ background: 'rgba(0,0,0,.8)', zIndex: 55 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: '#f39c12' }}>{t.tikTik}</div>
                <div style={{ color: S.dim, fontSize: 14 }}>{t.snapSelectCard}</div>
                <div style={{ color: S.light, fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                  {snapMode.targetPid === pid ? `${pname} ${t.you}` : players.find(p => p.id === snapMode.targetPid)?.name}
                </div>
                <HandGrid
                  cards={gameData.hands?.[snapMode.targetPid] || []}
                  faceUp={false}
                  hl={() => true}
                  onClick={ci => executeSnap(snapMode.targetPid, ci)}
                />
                <button className="btn bs bsm" style={{ marginTop: 8 }} onClick={() => setSnapMode(null)}>{t.cancel}</button>
              </div>
            )}

            {/* Center piles */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, padding: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && phase === 'start' && !drawn) ? 'pointer' : 'default', opacity: (isMyTurn && phase === 'start' && !drawn) ? 1 : .5, transition: 'all .2s' }} onClick={drawFromPile}>
                <Card card={{ rank: '?', suit: '?' }} faceUp={false} />
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: S.dim, letterSpacing: 1 }}>{t.drawPile} ({gameData.drawPile?.length || 0})</span>
              </div>
              {drawn && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, background: 'rgba(0,0,0,.2)', border: `2px dashed ${S.gold}`, borderRadius: 12 }}>
                  <Card card={drawn} faceUp anim="da" />
                  {phase === 'fromDiscard' ? <span style={{ fontSize: 12, color: S.dim }}>↓ {t.selectYourCard}</span> : <button className="btn bsm bs" onClick={discardDrawn}>{t.discardCard}</button>}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: (isMyTurn && phase === 'start' && topDiscard) ? 'pointer' : 'default', opacity: (isMyTurn && phase === 'start' && topDiscard) ? 1 : .5, transition: 'all .2s' }} onClick={takeFromDiscard}>
                {topDiscard ? <Card card={topDiscard} faceUp /> : <div className="kc" style={{ background: 'rgba(0,0,0,.2)', border: '2px dashed rgba(255,255,255,.1)' }} />}
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: S.dim, letterSpacing: 1 }}>{t.discardPile}</span>
              </div>
            </div>

            {/* My hand */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, background: 'rgba(0,0,0,.15)', borderTop: '1px solid rgba(212,168,67,.15)', borderRadius: '16px 16px 0 0', marginTop: 'auto' }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: S.gold }}>{pname} {t.you}</div>

              {/* Snap give mode */}
              {snapGiveMode && <div style={{ fontSize: 14, color: '#f39c12', fontWeight: 700, marginBottom: 4 }}>{t.snapSelectGive}</div>}

              <HandGrid cards={myHand} faceUp={revealed} peek={peekCards}
                hl={ci => (drawn && (phase === 'drawn' || phase === 'fromDiscard')) || (ability && ['peekSelf', 'blindSwap'].includes(ability) && selMy === ci) || (ability === 'lookSwap' && aStep === 1 && selMy === ci) || snapGiveMode}
                onClick={ci => {
                  if (snapGiveMode) { executeSnapGive(ci); }
                  else if (drawn && (phase === 'drawn' || phase === 'fromDiscard')) keepDrawn(ci);
                  else if (ability === 'peekSelf') setSelMy(ci);
                  else if (ability === 'blindSwap' || (ability === 'lookSwap' && aStep === 1)) setSelMy(ci);
                }} anim="da" />

              {/* TIK TIK for own cards */}
              {gameData.status === 'playing' && !snapMode && !snapGiveMode && !drawn && !ability && (
                <button className="btn btik" onClick={() => startSnap(pid)}>{t.tikTik}</button>
              )}

              {/* CABO button */}
              {isMyTurn && phase === 'start' && !drawn && (
                <button className={`btn bcabo ${!caboAvailable ? 'disabled' : ''}`} onClick={callCabo} disabled={!caboAvailable}>{t.cabo}</button>
              )}
              {isMyTurn && phase === 'start' && !drawn && <div style={{ fontSize: 13, color: S.dim, fontStyle: 'italic' }}>{t.drawOrDiscard}</div>}
              {drawn && (phase === 'drawn' || phase === 'fromDiscard') && <div style={{ fontSize: 13, color: S.dim, fontStyle: 'italic' }}>{t.chooseAction}</div>}
            </div>

            {/* ── OVERLAYS ── */}
            {/* Initial peek */}
            {iPeek && <div className="overlay" style={{ background: 'rgba(0,0,0,.75)' }} onClick={() => { setIPeek(false); setPeekCards({}); }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 52, color: S.gbright }}>{iPeekT}</div>
              <div style={{ color: S.gold, fontFamily: "'Playfair Display',serif", fontSize: 20 }}>{t.lookingAtCards}</div>
              <div style={{ color: S.dim, fontSize: 14 }}>{t.bottomCards}</div>
              <div style={{ display: 'flex', gap: 16 }}>{myHand.slice(2, 4).map((c, i) => <Card key={i} card={c} faceUp anim="da" />)}</div>
              <div style={{ color: S.dim, fontStyle: 'italic', fontSize: 14, marginTop: 8 }}>{t.closeCard}</div>
            </div>}

            {/* Ability peek */}
            {(Object.keys(peekCards).length > 0 || tempCard) && !iPeek && <div className="overlay" style={{ background: 'rgba(0,0,0,.75)' }} onClick={closePeek}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 52, color: S.gbright }}>{peekTime}</div>
              <div style={{ display: 'flex', gap: 16 }}>
                {Object.keys(peekCards).map(ci => myHand[ci] && <Card key={ci} card={myHand[ci]} faceUp />)}
                {tempCard && <Card card={tempCard} faceUp />}
              </div>
              <div style={{ color: S.dim, fontStyle: 'italic', fontSize: 14 }}>{t.closeCard} ({peekTime} {t.timeLeft})</div>
            </div>}

            {/* Ability modal */}
            {ability && !Object.keys(peekCards).length && !tempCard && <div className="overlay" style={{ background: 'rgba(0,0,0,.8)' }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, color: S.gbright }}>{t[ability]}</div>
              <div style={{ color: S.dim, textAlign: 'center', maxWidth: 300 }}>
                {ability === 'peekSelf' && t.selectYourCard}
                {ability === 'peekOther' && (selOp ? t.selectOtherCard : t.selectOtherPlayer)}
                {ability === 'blindSwap' && (selMy === null ? t.selectYourCard : !selOp ? t.selectOtherPlayer : t.selectOtherCard)}
                {ability === 'lookSwap' && aStep === 0 && (selOp ? t.selectOtherCard : t.selectOtherPlayer)}
                {ability === 'lookSwap' && aStep === 1 && `${t.selectYourCard} (${t.skip}?)`}
              </div>
              {['peekOther', 'blindSwap', 'lookSwap'].includes(ability) && !selOp && aStep === 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{others.map(p => <button key={p.id} className="btn bsm bs" onClick={() => setSelOp(p.id)}>{p.name}</button>)}</div>}
              {selOp && ['peekOther', 'blindSwap'].includes(ability) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(gameData.hands[selOp] || []).map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selOc === ci} onClick={() => setSelOc(ci)} />)}</div>}
              {selOp && ability === 'lookSwap' && aStep === 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(gameData.hands[selOp] || []).map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selOc === ci} onClick={() => setSelOc(ci)} />)}</div>}
              {ability === 'peekSelf' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selMy === ci} onClick={() => setSelMy(ci)} />)}</div>}
              {ability === 'blindSwap' && selOp && selOc !== null && <div><div style={{ color: S.dim, marginBottom: 6, fontSize: 13 }}>{t.selectYourCard}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selMy === ci} onClick={() => setSelMy(ci)} />)}</div></div>}
              {ability === 'lookSwap' && aStep === 1 && <div><div style={{ color: S.dim, marginBottom: 6, fontSize: 13 }}>{t.selectYourCard}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{myHand.map((c, ci) => <Card key={ci} card={c} faceUp={false} highlighted={selMy === ci} onClick={() => setSelMy(ci)} />)}</div></div>}
              <div style={{ display: 'flex', gap: 8 }}>
                {((ability === 'peekSelf' && selMy !== null) || (ability === 'peekOther' && selOc !== null) || (ability === 'blindSwap' && selMy !== null && selOc !== null) || (ability === 'lookSwap' && aStep === 0 && selOc !== null) || (ability === 'lookSwap' && aStep === 1)) && <button className="btn bp bsm" onClick={execAbil}>{t.confirm}</button>}
                <button className="btn bs bsm" onClick={skipAbil}>{t.skipAbility}</button>
              </div>
            </div>}

            {/* Round end */}
            {gameData.status === 'roundEnd' && gameData.roundScores && <div className="overlay" style={{ background: 'rgba(0,0,0,.85)', zIndex: 60, overflowY: 'auto' }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 36, color: S.gbright }}>{t.roundOver}</div>
              <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'left' }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'center' }}>{t.round} {gameData.round}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'center' }}>{t.total}</th></tr></thead>
                <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === pid ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace" }}>{gameData.roundScores[p.id]}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
              </table>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>{players.map(p => <div key={p.id} style={{ textAlign: 'center' }}><div style={{ fontSize: 12, marginBottom: 4, color: S.dim }}>{p.name}</div><HandGrid cards={gameData.hands[p.id] || []} small faceUp /></div>)}</div>
              {isHost && <button className="btn bp" style={{ maxWidth: 240 }} onClick={nextRound}>{t.nextRound}</button>}
            </div>}

            {/* Game over */}
            {gameData.status === 'gameOver' && <div className="overlay" style={{ background: 'rgba(0,0,0,.88)', zIndex: 60 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 40, color: S.gbright }}>{t.gameOver}</div>
              <table style={{ width: '100%', maxWidth: 360, borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', textAlign: 'left', fontFamily: "'Playfair Display',serif", color: S.gold }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', textAlign: 'center', fontFamily: "'Playfair Display',serif", color: S.gold }}>{t.total}</th></tr></thead>
                <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === pid ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
              </table>
              <button className="btn bp" style={{ maxWidth: 200 }} onClick={leave}>{t.newGame}</button>
            </div>}

            {/* Chat */}
            <button onClick={() => { setShowChat(!showChat); if (!showChat) setChatUnread(0); }} style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 40, width: 48, height: 48, borderRadius: '50%', background: S.gold, color: '#1a1a1a', border: 'none', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💬{chatUnread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: '#c9302c', color: '#fff', fontSize: 11, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{chatUnread}</span>}</button>
            {showChat && <div style={{ position: 'fixed', bottom: 72, right: 16, zIndex: 40, width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: 400, background: 'rgba(14,58,26,.95)', border: '1px solid rgba(212,168,67,.3)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", fontSize: 14, color: S.gold }}>{t.chat}</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', maxHeight: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>{chatMsgs.map((m, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.4 }}><span style={{ fontWeight: 600, color: S.gold, marginRight: 6 }}>{m.name}:</span>{m.text}</div>)}<div ref={chatEndRef} /></div>
              <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid rgba(212,168,67,.15)' }}><input className="inp" style={{ fontSize: 13 }} placeholder={t.sendMsg} value={chatIn} onChange={e => setChatIn(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMsg()} maxLength={200} /><button className="btn bsm bp" style={{ width: 'auto', flexShrink: 0 }} onClick={sendMsg}>{t.send}</button></div>
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}

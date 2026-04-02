import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createRoom as fbCreateRoom, joinRoom as fbJoinRoom,
  subscribeToRoom, updateRoom, setRoomData, deleteRoom, removePlayer,
  sendChatMessage, subscribeToChat,
  sendReaction as fbSendReaction, subscribeToReactions,
  setGameState, updateGameState, subscribeToGameState,
} from './firebase.js';
import {
  LANG, EMOJIS, shuffle, cardValue, isRedSuit,
  getCardAbility, generateRoomCode, generatePlayerId, dealCards, playSound,
} from './gameLogic.js';

const BOT_NAMES = ['Robo', 'Pixel', 'Byte', 'Chip', 'Nova'];

// ══════════════════════════════════════════
// CARD — bigger fonts for readability + number badge
// ══════════════════════════════════════════
function Card({ card, faceUp, highlighted, onClick, small, disabled, peeking, anim, style: st, hoverLabel, onHover, onLeave, cardNumber, glowColor }) {
  const jk = card?.rank === 'JK', red = card && isRedSuit(card.suit), show = faceUp || peeking;
  const extra = glowColor ? { boxShadow: `0 0 0 3px ${glowColor}, 0 0 16px ${glowColor}` } : {};
  return (
    <div className={`kc ${show ? 'fu' : 'fd'} ${highlighted ? 'hl' : ''} ${small ? 'sm' : ''} ${disabled ? 'dis' : ''} ${anim || ''}`}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={onHover} onMouseLeave={onLeave} onTouchStart={onHover}
      style={{ ...st, ...extra, color: show ? (jk ? '#6b21a8' : red ? '#dc2626' : '#1e293b') : undefined, position: 'relative' }}>
      {show ? (
        <div className="kcf">
          <div className="kcr"><span className="kr">{jk ? '🃏' : card.rank}</span>{!jk && <span className="ks" style={{marginTop: 2}}>{card.suit}</span>}</div>
          <div className="kcc">{jk ? '🃏' : card.suit}</div>
          <div className="kcr kbr"><span className="kr">{jk ? '🃏' : card.rank}</span>{!jk && <span className="ks" style={{marginTop: 2}}>{card.suit}</span>}</div>
        </div>
      ) : (<div className="kcb"><div className="kcbi">♦</div></div>)}
      {cardNumber != null && (
        <div style={{ position: 'absolute', bottom: small ? -9 : -11, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.75)', color: '#d4a843', fontSize: small ? 9 : 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: small ? '1px 5px' : '2px 7px', borderRadius: 4, border: '1px solid rgba(212,168,67,.3)', lineHeight: 1.3, zIndex: 5 }}>#{cardNumber}</div>
      )}
      {hoverLabel && (
        <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', background: 'rgba(243,156,18,.9)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>✓ {hoverLabel}</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// HAND GRID — 2x2 base, penalties on top, stable positions (null = empty slot)
// ══════════════════════════════════════════
function HandGrid({ cards, small, faceUp, peek, hl, onClick, anim, hoveredIdx, onHoverIdx, onLeaveIdx, hoverLabelText, glowIdx, flipped }) {
  // Cards array: [0]=top-left, [1]=top-right, [2]=bottom-left, [3]=bottom-right
  // Display numbers are ALWAYS the same for everyone:
  //   idx 2,3 = #1,#2 (owner's near cards, the ones they peek at start)
  //   idx 0,1 = #3,#4 (owner's far cards)
  const displayNum = { 0: 3, 1: 4, 2: 1, 3: 2 };
  const base = [cards[0] || null, cards[1] || null, cards[2] || null, cards[3] || null];
  const pen = cards.slice(4);
  const penRows = [];
  for (let i = 0; i < pen.length; i += 2) penRows.push(pen.slice(i, i + 2));
  const g = small ? 3 : 6;
  const vg = small ? g + 9 : g + 12;

  const rc = (c, idx) => {
    if (!c) return <div key={idx} style={{ width: small ? 44 : 62, height: small ? 62 : 88, border: '2px dashed rgba(255,255,255,.1)', borderRadius: 7, opacity: 0.3 }} />;
    const dn = idx < 4 ? displayNum[idx] : idx + 1;
    return <Card key={idx} card={c} faceUp={faceUp} small={small} peeking={peek?.[idx]}
      highlighted={hl?.(idx) || hoveredIdx === idx} onClick={() => onClick?.(idx)} anim={anim}
      style={anim ? { animationDelay: `${idx * 0.08}s` } : undefined}
      cardNumber={dn}
      glowColor={glowIdx === idx ? '#f39c12' : null}
      hoverLabel={hoveredIdx === idx ? hoverLabelText : null}
      onHover={() => onHoverIdx?.(idx)} onLeave={() => onLeaveIdx?.()} />;
  };

  if (flipped) {
    // Flipped: opponent view — their #1,#2 (idx 2,3) on top, #3,#4 (idx 0,1) on bottom, penalties at bottom
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: vg }}>
        {/* Top: opponent's #1,#2 (their near cards) */}
        <div style={{ display: 'flex', gap: g }}>{[2, 3].map(i => rc(base[i], i))}</div>
        {/* Bottom: opponent's #3,#4 (their far cards) */}
        <div style={{ display: 'flex', gap: g }}>{[0, 1].map(i => rc(base[i], i))}</div>
        {/* Penalty cards at bottom (farthest from viewer) */}
        {penRows.map((r, ri) => <div key={`p${ri}`} style={{ display: 'flex', gap: g }}>{r.map((c, ci) => rc(c, 4 + ri * 2 + ci))}</div>)}
      </div>
    );
  }

  // Normal: own view — #3,#4 on top (far), #1,#2 on bottom (near)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: vg }}>
      {/* Penalty cards on top (farthest) */}
      {penRows.map((r, ri) => <div key={`p${ri}`} style={{ display: 'flex', gap: g }}>{r.map((c, ci) => rc(c, 4 + ri * 2 + ci))}</div>)}
      {/* Top row: #3,#4 (uzak) */}
      <div style={{ display: 'flex', gap: g }}>{[0, 1].map(i => rc(base[i], i))}</div>
      {/* Bottom row: #1,#2 (yakın) */}
      <div style={{ display: 'flex', gap: g }}>{[2, 3].map(i => rc(base[i], i))}</div>
    </div>
  );
}

// ══════════════════════════════════════════
// CONFIRM DIALOG
// ══════════════════════════════════════════
function ConfirmDialog({ message, onYes, onNo, t }) {
  return (
    <div className="overlay" style={{ background: 'rgba(0,0,0,.85)', zIndex: 80 }}>
      <div style={{ background: 'rgba(30,60,30,.95)', border: '2px solid #d4a843', borderRadius: 16, padding: '24px 32px', maxWidth: 340, textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#f0c75e', fontWeight: 700, marginBottom: 16 }}>{message}</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn bp bsm" style={{ minWidth: 80 }} onClick={onYes}>{t.yes}</button>
          <button className="btn bs bsm" style={{ minWidth: 80 }} onClick={onNo}>{t.no}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ACTION BANNER — slides in for 3s, visible to all
// ══════════════════════════════════════════
function ActionBanner({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: 'fixed', top: 'calc(100px + env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'rgba(0,0,0,.88)', border: '2px solid #d4a843', padding: '12px 28px', borderRadius: 12, color: '#f0c75e', fontWeight: 700, fontSize: 15, maxWidth: '90vw', textAlign: 'center', animation: 'slideInBanner .4s ease-out', boxShadow: '0 8px 32px rgba(0,0,0,.5)', whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}

// ══════════════════════════════════════════
// LAST MOVE BAR — clickable to show detail popup
// ══════════════════════════════════════════
function LastMoveBar({ text, detail, t, showPopup, onToggle }) {
  if (!text) return null;
  return (
    <>
      <div onClick={onToggle} style={{ textAlign: 'center', padding: '6px 14px', background: 'rgba(0,0,0,.35)', border: '1px solid rgba(212,168,67,.2)', borderRadius: 8, fontSize: 13, color: '#e8dcc8', cursor: 'pointer', transition: 'background .2s' }}>
        <span style={{ color: '#d4a843', fontWeight: 700, marginRight: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{t.lastMove} ▾</span>
        {text}
      </div>
      {showPopup && (
        <div onClick={onToggle} style={{ position: 'fixed', inset: 0, zIndex: 75, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)' }}>
          <div style={{ background: 'rgba(20,50,20,.97)', border: '2px solid #d4a843', borderRadius: 16, padding: '20px 28px', maxWidth: 360, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: '#f0c75e', marginBottom: 12 }}>{t.lastMove}</div>
            <div style={{ fontSize: 16, color: '#e8dcc8', lineHeight: 1.6 }}>{detail || text}</div>
            <button className="btn bs bsm" style={{ marginTop: 16 }} onClick={onToggle}>{t.cancel}</button>
          </div>
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════
// BOT AI
// ══════════════════════════════════════════
function botPlay(gs, botId, pOrder) {
  const h = gs.hands[botId] || []; if (!h.length) return gs;
  if (!gs.caboFinalRound && (gs.turnCount || 0) >= pOrder.length && h.filter(Boolean).length <= 3 && Math.random() < 0.1) {
    gs.caboCallerId = botId; gs.caboFinalRound = true; gs.caboTurnsLeft = pOrder.length;
    gs.lastAction = { type: 'cabo', pid: botId, name: gs.players?.find(p => p.id === botId)?.name || 'Bot', ts: Date.now() };
    return gs;
  }
  if (!gs.drawPile?.length) { const top = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [top]; }
  const d = gs.drawPile.shift(), dv = cardValue(d);
  const botName = gs.players?.find(p => p.id === botId)?.name || 'Bot';
  const activeSlots = h.map((c, i) => c ? i : -1).filter(i => i >= 0);
  if (dv <= 4 && activeSlots.length > 0) {
    const ri = activeSlots[Math.floor(Math.random() * activeSlots.length)];
    const old = h[ri]; gs.hands[botId][ri] = { ...d, position: ri }; gs.discardPile.push(old);
    gs.lastAction = { type: 'swap', pid: botId, name: botName, slot: ri, discarded: old, ts: Date.now() };
    gs.tikTikUsedForCard = null; gs.tikTikLock = null; // new discard, reset tik tik
  } else {
    gs.discardPile.push(d);
    gs.lastAction = { type: 'discard', pid: botId, name: botName, discarded: d, ts: Date.now() };
    gs.tikTikUsedForCard = null; gs.tikTikLock = null;
  }
  gs.turnCount = (gs.turnCount || 0) + 1;
  return gs;
}

// ══════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════
export default function App() {
  const [lang] = useState('tr');
  const [pname, setPname] = useState(() => localStorage.getItem('kaboo_name') || '');
  const [pid] = useState(() => { let id = localStorage.getItem('kaboo_pid'); if (!id) { id = generatePlayerId(); localStorage.setItem('kaboo_pid', id); } return id; });
  const t = LANG[lang];

  // Screens
  const [screen, setScreen] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Data from Firebase
  const [roomData, setRoomData2] = useState(null);
  const [gameData, setGameData2] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);

  // Local game UI
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

  // TIK TIK
  const [snapMode, setSnapMode] = useState(null);
  const [snapGiveMode, setSnapGiveMode] = useState(false);
  const [hovIdx, setHovIdx] = useState(null);
  const [tikTikLock, setTikTikLock] = useState(false); // blocks all moves during TIK TIK

  // Swap animation
  const [swapAnim, setSwapAnim] = useState(null);
  const swapPendingRef = useRef(null);

  // PWA install prompt
  const [showInstall, setShowInstall] = useState(false);
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  useEffect(() => {
    if (!isPWA) setShowInstall(true);
  }, []);

  // Confirm dialog
  const [confirm, setConfirm] = useState(null); // { message, onYes }

  // Last move text (derived from gameData.lastAction)
  const [lastMoveText, setLastMoveText] = useState('');
  const [lastMoveDetail, setLastMoveDetail] = useState('');
  const [showLastMovePopup, setShowLastMovePopup] = useState(false);

  // Action banner (slides in for 3s)
  const [actionBanner, setActionBanner] = useState('');

  // Glow effect on placed card
  const [glowSlot, setGlowSlot] = useState(null);

  const peekRef = useRef(null);
  const unsubRefs = useRef({});
  const chatEndRef = useRef(null);
  const botRef = useRef(null);
  const showChatRef = useRef(showChat);
  const lastChatRef = useRef(0);
  const peekStartedRef = useRef(false);
  const lastSwapTsRef = useRef(0);
  const lastActionTsRef = useRef(0);
  showChatRef.current = showChat;

  useEffect(() => { localStorage.setItem('kaboo_name', pname); }, [pname]);
  useEffect(() => { const p = new URLSearchParams(window.location.search).get('room'); if (p) setJoinCode(p.toUpperCase()); }, []);

  const notify = useCallback((m) => { setNotif(m); setTimeout(() => setNotif(''), 3500); }, []);
  const addFloat = useCallback((e) => { const id = Date.now() + Math.random(); setFloats(p => [...p, { id, e }]); setTimeout(() => setFloats(p => p.filter(r => r.id !== id)), 2500); }, []);

  const askConfirm = (message, onYes) => setConfirm({ message, onYes });

  // ── Subscriptions ──
  const cleanupSubs = useCallback(() => { Object.values(unsubRefs.current).forEach(u => u && u()); unsubRefs.current = {}; }, []);
  const subscribeAll = useCallback((code) => {
    cleanupSubs();
    unsubRefs.current.room = subscribeToRoom(code, d => setRoomData2(d));
    unsubRefs.current.game = subscribeToGameState(code, gs => {
      setGameData2(gs);
      if (gs?.status && gs.status !== 'lobby') setScreen('game');
    });
    unsubRefs.current.chat = subscribeToChat(code, msgs => {
      setChatMsgs(prev => {
        if (msgs.length > prev.length) {
          if (!showChatRef.current) setChatUnread(u => u + (msgs.length - lastChatRef.current));
          lastChatRef.current = msgs.length; playSound('chat');
        }
        return msgs;
      });
    });
    unsubRefs.current.react = subscribeToReactions(code, reactions => {
      if (reactions.length > 0) { const l = reactions[reactions.length - 1]; if (l.playerId !== pid && Date.now() - l.ts < 3000) addFloat(l.emoji); }
    });
  }, [cleanupSubs, pid, addFloat]);

  // ── Room management ──
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
    const msg = t.inviteMsg.replaceAll('{code}', roomCode).replaceAll('{url}', url);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Leave game with confirmation ──
  const handleLeave = () => {
    askConfirm(t.leaveConfirm, async () => {
      setConfirm(null);
      if (isHost) {
        // Host leaves: delete room, everyone gets kicked
        await updateGameState(roomCode, { status: 'disbanded', lastAction: { type: 'hostLeft', ts: Date.now() } }).catch(() => {});
        await deleteRoom(roomCode).catch(() => {});
      } else {
        // Non-host leaves: remove from players
        await removePlayer(roomCode, pid).catch(() => {});
      }
      cleanupSubs(); if (botRef.current) clearTimeout(botRef.current);
      setScreen('menu'); setRoomCode(''); setRoomData2(null); setGameData2(null); setChatMsgs([]);
      setDrawn(null); setPhase('start'); setAbility(null); setIPeek(false); setRevealed(false); setBotCnt(0); setSnapMode(null); setSnapGiveMode(false);
    });
  };

  // Watch for disbanded game
  useEffect(() => {
    if (gameData?.status === 'disbanded') {
      notify(t.hostLeft);
      setTimeout(() => {
        cleanupSubs(); setScreen('menu'); setRoomCode(''); setRoomData2(null); setGameData2(null);
      }, 2000);
    }
  }, [gameData?.status]);

  // ── Bots ──
  const addBot = async () => {
    const curr = roomData?.players ? Object.values(roomData.players).filter(Boolean) : [];
    if (curr.length >= 6) { notify(t.roomFull); return; }
    const botId = `bot_${botCnt}_${Date.now()}`; const botName = `${BOT_NAMES[botCnt % BOT_NAMES.length]} 🤖`;
    await setRoomData(roomCode, `players/${botId}`, { id: botId, name: botName, connected: true, isBot: true, joinedAt: Date.now() });
    await setRoomData(roomCode, `scores/${botId}`, 0);
    setBotCnt(c => c + 1); playSound('join');
  };
  const removeBotFn = async (botId) => {
    await setRoomData(roomCode, `players/${botId}`, null);
    await setRoomData(roomCode, `scores/${botId}`, null);
    setBotCnt(c => Math.max(0, c - 1));
  };

  // ── Derived state ──
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
  const caboAvailable = gameData && !gameData.caboFinalRound && (gameData.turnCount || 0) >= pOrder.length;

  // ── Last move text — update when lastAction changes, show banner for 3s ──
  useEffect(() => {
    if (!gameData?.lastAction || gameData.lastAction.ts <= lastActionTsRef.current) return;
    lastActionTsRef.current = gameData.lastAction.ts;
    const la = gameData.lastAction;
    const nm = la.name || '???';
    // Convert data index to display number: idx 0→#3, 1→#4, 2→#1, 3→#2, 4+→#5+
    const dn = (idx) => { const map = { 0: 3, 1: 4, 2: 1, 3: 2 }; return idx < 4 ? map[idx] : idx + 1; };
    let txt = '';
    let detail = '';
    if (la.type === 'discard') { txt = `${nm} ${t.discardedCard}`; detail = `${nm} çektiği kartı atma destesine attı.`; }
    else if (la.type === 'swap') { txt = `${nm} ${t.placedAtSlot.replace('{slot}', dn(la.slot))}`; detail = `${nm} çektiği kartı #${dn(la.slot)} numaraya koydu, eski kartı attı.`; }
    else if (la.type === 'cabo') { txt = `🚨 ${nm} ${t.calledCabo}`; detail = `${nm} KABOO dedi! Diğer oyuncular 1'er tur daha oynayacak.`; }
    else if (la.type === 'peek_self') { txt = `👁️ ${nm} ${t.peekedSelf.replace('{slot}', dn(la.slot))}`; detail = `${nm} kendi #${dn(la.slot)} numaralı kartına baktı.`; }
    else if (la.type === 'peek_other') { txt = `👁️ ${nm} ${t.peekedOther.replace('{target}', la.targetName || '?').replace('{slot}', dn(la.slot))}`; detail = `${nm}, ${la.targetName || '?'} oyuncusunun #${dn(la.slot)} numaralı kartına baktı.`; }
    else if (la.type === 'swap_anim') { txt = `🔄 ${t.swappedCards.replace('{p1}', la.p1).replace('{c1}', dn(la.c1)).replace('{p2}', la.p2).replace('{c2}', dn(la.c2))}`; detail = `${la.p1} #${dn(la.c1)} kartı ile ${la.p2} #${dn(la.c2)} kartı değiştirildi!`; }
    else if (la.type === 'snap_ok') { txt = `👊 ${nm} TIK TIK! #${dn(la.slot)} ${t.snappedCard.replace('{slot}', dn(la.slot))}`; detail = `${nm} TIK TIK ile #${dn(la.slot)} numaralı kartı eşleştirdi ve çıkardı!`; }
    else if (la.type === 'snap_fail') { txt = `❌ ${nm} ${t.snappedWrong}`; detail = `${nm} yanlış eşleşme yaptı! 2 ceza kartı aldı.`; }
    else if (la.type === 'drew') { txt = `${nm} ${t.drewFromPile}`; detail = `${nm} çekme destesinden kart çekti.`; }
    else if (la.type === 'took_discard') { txt = `${nm} ${t.tookFromDiscard}`; detail = `${nm} atma destesinden kart aldı.`; }
    else if (la.type === 'tikTik_claimed') { txt = `👊 ${nm} TIK TIK'a bastı — hamle yapıyor, bekle!`; detail = `${nm} TIK TIK hakkını kullandı. Kart seçiyor...`; }
    else if (la.type === 'tikTik_late') { txt = `⏰ ${nm} TIK TIK için geç kaldı! (${la.winner} kazandı)`; detail = `${nm} TIK TIK'a basmak istedi ama ${la.winner} daha hızlıydı!`; }
    if (txt) {
      setLastMoveText(txt);
      setLastMoveDetail(detail);
      // Show sliding banner for 3 seconds
      setActionBanner(txt);
      setTimeout(() => setActionBanner(''), 3000);
    }
  }, [gameData?.lastAction, t]);

  // ── Swap animation for other players ──
  useEffect(() => {
    if (!gameData?.lastAction) return;
    const la = gameData.lastAction;
    if (la.type === 'swap_anim' && la.ts > lastSwapTsRef.current && la.pid !== pid) {
      lastSwapTsRef.current = la.ts;
      setSwapAnim({ p1: la.p1, c1: la.c1, p2: la.p2, c2: la.c2, phase: 'start' }); requestAnimationFrame(() => { requestAnimationFrame(() => { setSwapAnim(prev => prev ? { ...prev, phase: 'sliding' } : null); }); });
      setTimeout(() => setSwapAnim(prev => prev ? { ...prev, phase: 'done' } : null), 5000);
      setTimeout(() => setSwapAnim(null), 8000);
    }
  }, [gameData?.lastAction, pid]);

  // ── Glow placed card for all players ──
  useEffect(() => {
    if (!gameData?.lastAction) return;
    const la = gameData.lastAction;
    if (la.type === 'swap' && la.slot != null) {
      setGlowSlot({ pid: la.pid, slot: la.slot });
      setTimeout(() => setGlowSlot(null), 3000);
    }
  }, [gameData?.lastAction]);

  // ── Advance turn ──
  function advTurn(gs) {
    if (gs.caboFinalRound) {
      gs.caboTurnsLeft = (gs.caboTurnsLeft || 1) - 1;
      if (gs.caboTurnsLeft <= 0) return endRound(gs);
    }
    let ni = (gs.currentPlayerIndex + 1) % pOrder.length; let att = 0;
    // Skip players with no cards and cabo caller
    while (att < pOrder.length) {
      const hand = gs.hands[pOrder[ni]] || [];
      const hasCards = hand.some(c => c !== null);
      if (hasCards && !(gs.caboFinalRound && pOrder[ni] === gs.caboCallerId)) break;
      ni = (ni + 1) % pOrder.length; att++;
    }
    gs.currentPlayerIndex = ni;
    return gs;
  }

  function endRound(gs) {
    gs.status = 'roundEnd'; const rs = {};
    for (const id of pOrder) {
      const hand = gs.hands[id] || [];
      rs[id] = hand.filter(Boolean).reduce((s, c) => s + cardValue(c), 0);
    }
    gs.roundScores = rs;
    const ns = { ...scores }; for (const id of pOrder) ns[id] = (ns[id] || 0) + (rs[id] || 0);
    updateRoom(roomCode, { scores: ns });
    return gs;
  }

  const save = async (g) => { g.ts = Date.now(); await setGameState(roomCode, g); };

  // ── Start game ──
  const startGame = async () => {
    if (players.length < 2) { notify(t.minPlayers); return; }
    try {
      const { hands, drawPile, discardPile } = dealCards(pOrder);
      const startIdx = pOrder.length > 1 ? 1 : 0;
      await updateRoom(roomCode, { targetScore });
      await setGameState(roomCode, {
        status: 'peeking', round: (gameData?.round || 0) + 1, hands, drawPile, discardPile,
        currentPlayerIndex: startIdx, caboCallerId: null, caboFinalRound: false, caboTurnsLeft: 0,
        lastAction: null, roundScores: null, turnCount: 0, tikTikUsedForCard: null, tikTikLock: null,
        players: players.map(p => ({ id: p.id, name: p.name || '', isBot: !!p.isBot })),
      });
      setScreen('game');
      setIPeek(true); setIPeekT(15); setDrawn(null); setPhase('start');
      setAbility(null); setRevealed(false); setTempCard(null); setSnapMode(null); setSnapGiveMode(false);
      setLastMoveText(''); setGlowSlot(null);
      playSound('cardDeal');
    } catch (err) {
      console.error('START GAME ERROR:', err);
      notify('Error: ' + err.message);
    }
  };

  // ── Peek — triggers for ALL players. Uses round number to ensure each player peeks once per round ──
  const peekedRoundRef = useRef(0); // which round we already peeked for

  useEffect(() => {
    if (!gameData?.hands?.[pid] || !gameData?.round) return;
    const curStatus = gameData.status;
    const curRound = gameData.round;

    // Already peeked for this round? Skip
    if (peekedRoundRef.current >= curRound) return;

    // Trigger peek if status is 'peeking' OR 'playing' (in case we missed 'peeking')
    if (curStatus === 'peeking' || curStatus === 'playing') {
      console.log('PEEK TRIGGERED for', pid, 'round', curRound, 'status', curStatus);
      peekedRoundRef.current = curRound;
      setIPeek(true); setIPeekT(15); setDrawn(null); setPhase('start'); setAbility(null); setRevealed(false);
      setTempCard(null); setSnapMode(null); setSnapGiveMode(false); setLastMoveText('');
      setPeekCards({ 2: true, 3: true });
      playSound('cardDeal');
    }
  }, [gameData?.status, gameData?.round, gameData?.hands, pid]);

  // Peek countdown
  useEffect(() => {
    if (iPeek && iPeekT > 0) { const tm = setTimeout(() => setIPeekT(v => v - 1), 1000); return () => clearTimeout(tm); }
    if (iPeek && iPeekT === 0) { setIPeek(false); setPeekCards({}); }
  }, [iPeek, iPeekT]);

  // Host transitions peeking → playing after their peek ends
  useEffect(() => { if (iPeek) peekStartedRef.current = true; }, [iPeek]);
  useEffect(() => {
    if (gameData?.status === 'peeking' && !iPeek && peekStartedRef.current && isHost) {
      peekStartedRef.current = false;
      const tm = setTimeout(() => updateGameState(roomCode, { status: 'playing' }), 500);
      return () => clearTimeout(tm);
    }
  }, [gameData?.status, iPeek, isHost, roomCode]);

  // ── Bot auto-play ──
  useEffect(() => {
    if (!gameData || gameData.status !== 'playing' || !isHost || !cpBot) return;
    if (botRef.current) clearTimeout(botRef.current);
    botRef.current = setTimeout(async () => {
      const gs = JSON.parse(JSON.stringify(gameData));
      const updated = botPlay(gs, cpid, pOrder);
      const adv = advTurn(updated);
      if (adv.status === 'roundEnd') setRevealed(true);
      adv.ts = Date.now();
      await setGameState(roomCode, adv); playSound('cardDeal');
    }, 1200 + Math.random() * 800);
    return () => { if (botRef.current) clearTimeout(botRef.current); };
  }, [gameData?.currentPlayerIndex, gameData?.status, cpBot, isHost]);

  // ── Peek timer for abilities ──
  const startPeek = useCallback((idxs, dur = 10) => {
    const o = {}; idxs.forEach(i => o[i] = true); setPeekCards(o); setPeekTime(dur);
    if (peekRef.current) clearInterval(peekRef.current);
    peekRef.current = setInterval(() => { setPeekTime(p => { if (p <= 1) { clearInterval(peekRef.current); setPeekCards({}); setTempCard(null); return 0; } return p - 1; }); }, 1000);
  }, []);
  const closePeek = () => { if (peekRef.current) clearInterval(peekRef.current); setPeekCards({}); setPeekTime(0); setTempCard(null); };

  // ══════════════════════════════════════════
  // GAME ACTIONS — all with confirmation
  // ══════════════════════════════════════════
  const drawFromPile = async () => {
    if (!isMyTurn || phase !== 'start' || drawn) return;
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    const gs = JSON.parse(JSON.stringify(gameData));
    if (!gs.drawPile?.length) { const top = gs.discardPile.pop(); gs.drawPile = shuffle(gs.discardPile); gs.discardPile = [top]; }
    const card = gs.drawPile.shift();
    gs.lastAction = { type: 'drew', pid, name: pname, ts: Date.now() };
    setDrawn(card); setPhase('drawn'); await save(gs); playSound('cardFlip');
  };

  const takeFromDiscard = async () => {
    if (!isMyTurn || phase !== 'start' || !topDiscard) return;
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    const gs = JSON.parse(JSON.stringify(gameData));
    const card = gs.discardPile.pop();
    gs.lastAction = { type: 'took_discard', pid, name: pname, ts: Date.now() };
    setDrawn(card); setPhase('fromDiscard'); await save(gs); playSound('cardFlip');
  };

  const keepDrawn = (idx) => {
    if (!drawn) return;
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    const dnMap = { 0: 3, 1: 4, 2: 1, 3: 2 };
    const displaySlot = idx < 4 ? dnMap[idx] : idx + 1;
    askConfirm(t.confirmKeep.replace('{slot}', displaySlot), async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      const old = gs.hands[pid][idx]; gs.hands[pid][idx] = { ...drawn, position: idx }; gs.discardPile.push(old);
      gs.lastAction = { type: 'swap', pid, name: pname, slot: idx, discarded: old, ts: Date.now() };
      gs.turnCount = (gs.turnCount || 0) + 1;
      gs.tikTikUsedForCard = null; gs.tikTikLock = null; // new card discarded, reset tik tik
      const adv = advTurn(gs); setDrawn(null); setPhase('start'); setHovIdx(null);
      if (adv.status === 'roundEnd') setRevealed(true);
      await save(adv); playSound('cardDeal');
    });
  };

  const discardDrawn = () => {
    if (!drawn) return;
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    askConfirm(t.confirmDiscard, async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      gs.discardPile.push(drawn);
      gs.lastAction = { type: 'discard', pid, name: pname, discarded: drawn, ts: Date.now() };
      gs.turnCount = (gs.turnCount || 0) + 1;
      gs.tikTikUsedForCard = null; gs.tikTikLock = null;
      const ab = getCardAbility(drawn);
      if (ab && phase === 'drawn') {
        setAbility(ab); setAStep(0); setSelMy(null); setSelOp(null); setSelOc(null);
        setDrawn(null); setPhase('ability'); await save(gs); return;
      }
      const adv = advTurn(gs); setDrawn(null); setPhase('start');
      if (adv.status === 'roundEnd') setRevealed(true);
      await save(adv); playSound('cardDeal');
    });
  };

  const skipAbil = async () => {
    const gs = JSON.parse(JSON.stringify(gameData));
    const adv = advTurn(gs); setAbility(null); setPhase('start');
    if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
  };

  const execAbil = () => {
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    const doExec = async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      if (ability === 'peekSelf' && selMy !== null) {
        startPeek([selMy], 10); playSound('cardFlip');
        gs.lastAction = { type: 'peek_self', pid, name: pname, slot: selMy, ts: Date.now() };
        const adv = advTurn(gs); setAbility(null); setPhase('start');
        if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
      } else if (ability === 'peekOther' && selOp && selOc !== null) {
        const oh = gs.hands[selOp]; if (oh?.[selOc]) { setTempCard(oh[selOc]); startPeek([], 10); }
        const targetName = players.find(p => p.id === selOp)?.name || '?';
        gs.lastAction = { type: 'peek_other', pid, name: pname, targetName, slot: selOc, ts: Date.now() };
        playSound('cardFlip'); const adv = advTurn(gs); setAbility(null); setPhase('start');
        if (adv.status === 'roundEnd') setRevealed(true); await save(adv);
      } else if (ability === 'blindSwap' && selMy !== null && selOp && selOc !== null) {
        const p1name = pname;
        const p2name = players.find(p => p.id === selOp)?.name || '';
        setSwapAnim({ p1: p1name, c1: selMy, p2: p2name, c2: selOc, phase: 'start' }); requestAnimationFrame(() => { requestAnimationFrame(() => { setSwapAnim(prev => prev ? { ...prev, phase: 'sliding' } : null); }); });
        setAbility(null);
        const mc = gs.hands[pid][selMy], oc = gs.hands[selOp][selOc];
        gs.hands[pid][selMy] = { ...oc, position: selMy }; gs.hands[selOp][selOc] = { ...mc, position: selOc };
        gs.lastAction = { type: 'swap_anim', pid, p1: p1name, c1: selMy, p2: p2name, c2: selOc, ts: Date.now() };
        const adv = advTurn(gs);
        if (adv.status === 'roundEnd') setRevealed(true);
        swapPendingRef.current = adv;
        await save({ ...gs, currentPlayerIndex: adv.currentPlayerIndex });
        setTimeout(() => setSwapAnim(prev => prev ? { ...prev, phase: 'done' } : null), 5000);
        setTimeout(async () => { setSwapAnim(null); setPhase('start'); if (swapPendingRef.current) { await save(swapPendingRef.current); swapPendingRef.current = null; } playSound('cardDeal'); }, 8000);
      } else if (ability === 'lookSwap') {
        if (aStep === 0 && selOp && selOc !== null) {
          const oh = gs.hands[selOp]; if (oh?.[selOc]) { setTempCard(oh[selOc]); startPeek([], 10); }
          setAStep(1); playSound('cardFlip'); return;
        }
        if (aStep === 1) {
          if (selMy !== null) {
            const p1name = pname; const p2name = players.find(p => p.id === selOp)?.name || '';
            setSwapAnim({ p1: p1name, c1: selMy, p2: p2name, c2: selOc, phase: 'start' }); requestAnimationFrame(() => { requestAnimationFrame(() => { setSwapAnim(prev => prev ? { ...prev, phase: 'sliding' } : null); }); });
            const mc = gs.hands[pid][selMy], oc = gs.hands[selOp][selOc];
            gs.hands[pid][selMy] = { ...oc, position: selMy }; gs.hands[selOp][selOc] = { ...mc, position: selOc };
            gs.lastAction = { type: 'swap_anim', pid, p1: p1name, c1: selMy, p2: p2name, c2: selOc, ts: Date.now() };
            closePeek(); const adv = advTurn(gs); setAbility(null); setAStep(0);
            if (adv.status === 'roundEnd') setRevealed(true);
            swapPendingRef.current = adv;
            await save({ ...gs, currentPlayerIndex: adv.currentPlayerIndex });
            setTimeout(() => setSwapAnim(prev => prev ? { ...prev, phase: 'done' } : null), 5000);
            setTimeout(async () => { setSwapAnim(null); setPhase('start'); if (swapPendingRef.current) { await save(swapPendingRef.current); swapPendingRef.current = null; } playSound('cardDeal'); }, 8000);
          } else {
            // Didn't swap, but tell everyone which card was looked at
            const targetName = players.find(p => p.id === selOp)?.name || '?';
            gs.lastAction = { type: 'peek_other', pid, name: pname, targetName, slot: selOc, ts: Date.now() };
            closePeek(); const adv = advTurn(gs); setAbility(null); setAStep(0); setPhase('start');
            if (adv.status === 'roundEnd') setRevealed(true); await save(adv); playSound('cardDeal');
          }
        }
      }
    };
    // For swaps, ask confirmation
    if (ability === 'blindSwap' || (ability === 'lookSwap' && aStep === 1 && selMy !== null)) {
      askConfirm(t.confirmSwap, doExec);
    } else {
      doExec();
    }
  };

  // ── CABO with confirmation ──
  const callCabo = () => {
    if (!isMyTurn || phase !== 'start') return;
    if (!caboAvailable) { notify(t.caboNotYet); return; }
    if (gameData.tikTikLock) { notify(`${gameData.tikTikLock} TIK TIK yapıyor, bekle!`); return; }
    askConfirm(t.confirmCabo, async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      gs.caboCallerId = pid; gs.caboFinalRound = true;
      gs.caboTurnsLeft = pOrder.length;
      gs.lastAction = { type: 'cabo', pid, name: pname, ts: Date.now() };
      const adv = advTurn(gs); setPhase('start');
      if (adv.status === 'roundEnd') setRevealed(true);
      await save(adv); playSound('cabo'); notify(t.cabo + '!');
    });
  };

  // ── TIK TIK — one per discarded card, first click wins ──
  const startSnap = (targetPid) => {
    if (!gameData || gameData.status !== 'playing') return;
    if (!topDiscard) return;
    if (gameData.tikTikUsedForCard === true) { notify(t.tikTikUsed); return; }
    if (gameData.tikTikLock) {
      // Someone else already clicked TIK TIK — broadcast "late" to everyone
      const broadcastLate = async () => {
        const gs = JSON.parse(JSON.stringify(gameData));
        gs.lastAction = { type: 'tikTik_late', pid, name: pname, winner: gameData.tikTikLock, ts: Date.now() };
        await save(gs);
      };
      broadcastLate();
      return;
    }
    // Confirmation before TIK TIK
    askConfirm(t.confirmSnap, async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      if (gs.tikTikUsedForCard === true || gs.tikTikLock) {
        // Lost the race after confirm — broadcast late
        gs.lastAction = { type: 'tikTik_late', pid, name: pname, winner: gs.tikTikLock || '?', ts: Date.now() };
        await save(gs);
        return;
      }
      gs.tikTikLock = pname;
      gs.lastAction = { type: 'tikTik_claimed', pid, name: pname, ts: Date.now() };
      await save(gs);
      playSound('tikTik');
      setSnapMode({ targetPid });
    });
  };

  const executeSnap = (targetPid, cardIdx) => {
    const doSnap = async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      if (gs.tikTikUsedForCard === true) { notify(t.tikTikUsed); setSnapMode(null); gs.tikTikLock = null; await save(gs); return; }
      gs.tikTikUsedForCard = true;
      // Keep lock active — will release 3s after result

      const tc = gs.hands[targetPid]?.[cardIdx];
      if (!tc) { setSnapMode(null); gs.tikTikLock = null; await save(gs); return; }
      const ld = gs.discardPile[gs.discardPile.length - 1];

      if (cardValue(tc) === cardValue(ld)) {
        playSound('snap');
        gs.hands[targetPid][cardIdx] = null;
        if (targetPid !== pid) {
          const myActiveSlots = myHand.map((c, i) => c ? i : -1).filter(i => i >= 0);
          if (myActiveSlots.length > 0) {
            setSnapMode(null);
            setSnapGiveMode(true);
            gs._snapGiveTo = targetPid;
            gs._snapGiveSlot = cardIdx;
          } else { setSnapMode(null); }
        } else { setSnapMode(null); }
        gs.lastAction = { type: 'snap_ok', pid, name: pname, target: targetPid, slot: cardIdx, ts: Date.now() };
        notify(t.snapSuccess);
      } else {
        playSound('fail');
        for (let i = 0; i < 2; i++) {
          if (gs.drawPile?.length > 0) gs.hands[pid].push({ ...gs.drawPile.shift(), position: gs.hands[pid].length });
        }
        gs.lastAction = { type: 'snap_fail', pid, name: pname, ts: Date.now() };
        notify(t.snapFail);
        setSnapMode(null);
      }
      await save(gs);

      // Release tikTikLock after 3 seconds so everyone sees the result
      setTimeout(async () => {
        try {
          await updateGameState(roomCode, { tikTikLock: null });
        } catch (e) { /* silent */ }
      }, 3000);
    };
    doSnap();
  };

  const executeSnapGive = (myCardIdx) => {
    askConfirm(t.confirmSwap, async () => {
      setConfirm(null);
      const gs = JSON.parse(JSON.stringify(gameData));
      const giveTo = gs._snapGiveTo;
      const giveSlot = gs._snapGiveSlot;
      if (giveTo && gs.hands[pid][myCardIdx]) {
        const givenCard = gs.hands[pid][myCardIdx];
        gs.hands[pid][myCardIdx] = null; // leave empty
        gs.hands[giveTo][giveSlot] = { ...givenCard, position: giveSlot };
      }
      delete gs._snapGiveTo; delete gs._snapGiveSlot;
      setSnapGiveMode(false);
      await save(gs);
    });
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
        lastAction: null, roundScores: null, turnCount: 0, tikTikUsedForCard: null, tikTikLock: null,
        players: players.map(p => ({ id: p.id, name: p.name || '', isBot: !!p.isBot })),
      });
    } catch (err) { console.error('NEXT ROUND ERROR:', err); notify('Error: ' + err.message); }
  };

  // ── Chat ──
  const sendMsg = async () => { if (!chatIn.trim()) return; await sendChatMessage(roomCode, pid, pname, chatIn.trim()); setChatIn(''); };
  const handleReact = async (emoji) => { await fbSendReaction(roomCode, pid, pname, emoji); addFloat(emoji); setShowReact(false); };
  useEffect(() => { if (showChat) { setChatUnread(0); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [showChat, chatMsgs]);

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  const S = { gold: '#d4a843', gbright: '#f0c75e', dim: '#a89b85', light: '#e8dcc8' };

  return (
    <div className="kaboo-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@500&display=swap');
        .kaboo-root{font-family:'Crimson Text',Georgia,serif;min-height:100vh;min-height:100dvh;background:radial-gradient(ellipse at center,#2d7a42 0%,#1a5c2e 40%,#0e3a1a 100%);color:#e8dcc8;position:relative;overflow-x:hidden}
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
        .btik{background:linear-gradient(135deg,#e67e22,#f39c12);color:#fff;font-size:12px;padding:5px 10px;width:auto;font-family:'Crimson Text',serif;font-weight:700}
        .btik.used{background:#555;color:#888;cursor:default;opacity:.5;pointer-events:none}
        .binv{background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;width:auto}
        .bleave{background:rgba(200,50,50,.2);color:#ff6b6b;border:1px solid rgba(200,50,50,.3);width:auto}
        .inp{width:100%;padding:12px 16px;border:1px solid rgba(212,168,67,.3);border-radius:8px;background:rgba(0,0,0,.3);color:#e8dcc8;font-family:'Crimson Text',serif;font-size:16px;outline:none}.inp:focus{border-color:#d4a843}.inp::placeholder{color:#a89b85}
        /* CARD — BIGGER FONTS for readability */
        .kc{width:62px;height:88px;border-radius:7px;cursor:pointer;transition:all .25s;position:relative;box-shadow:0 2px 8px rgba(0,0,0,.4);flex-shrink:0}
        .kc.sm{width:46px;height:66px}
        .kc.fu{background:#faf8f0}.kc.fd{background:linear-gradient(135deg,#1e3a5f,#2c5282)}
        .kc:hover:not(.dis){transform:translateY(-5px);box-shadow:0 8px 20px rgba(0,0,0,.4)}
        .kc.hl{box-shadow:0 0 0 3px #f0c75e,0 4px 14px rgba(212,168,67,.5)}.kc.dis{opacity:.5;cursor:default;pointer-events:none}
        .kcf{width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;padding:3px 5px;position:relative}
        .kcr{display:flex;flex-direction:column;align-items:center;line-height:1}
        .kr{font-family:'Playfair Display',serif;font-weight:900;font-size:22px;text-shadow:0 1px 2px rgba(0,0,0,.15)}.kc.sm .kr{font-size:16px}
        .ks{font-size:18px;font-weight:700}.kc.sm .ks{font-size:13px}
        .kbr{align-self:flex-end;transform:rotate(180deg)}
        .kcc{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:30px;opacity:.2}.kc.sm .kcc{font-size:20px}
        .kcb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.08);border-radius:7px;background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(255,255,255,.025) 5px,rgba(255,255,255,.025) 10px)}
        .kcbi{width:65%;height:65%;border:1px solid rgba(255,255,255,.12);border-radius:4px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.15);font-size:18px}.kc.sm .kcbi{font-size:12px}
        @keyframes din{from{opacity:0;transform:translateY(-30px) scale(.8)}to{opacity:1;transform:translateY(0) scale(1)}}.da{animation:din .35s ease-out both}
        @keyframes glow{from{box-shadow:0 0 5px rgba(212,168,67,.2)}to{box-shadow:0 0 18px rgba(212,168,67,.4)}}
        @keyframes cflash{from{opacity:.7}to{opacity:1}}
        @keyframes fup{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-180px) scale(.4)}}
        @keyframes nin{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes slideInBanner{from{opacity:0;transform:translateX(-50%) translateY(-30px) scale(.9)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
        .turn-badge{font-size:14px;padding:8px 18px;border-radius:20px;font-weight:700;text-align:center}
        .turn-mine{background:rgba(212,168,67,.25);border:2px solid #f0c75e;color:#f0c75e;animation:glow 1.5s ease-in-out infinite alternate}
        .turn-other{background:rgba(0,0,0,.3);border:1px solid rgba(212,168,67,.3);color:#e8dcc8}
        .turn-bot{background:rgba(100,100,255,.15);border:1px solid rgba(100,100,255,.3);color:#a0a0ff}
        .overlay{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16;backdrop-filter:blur(4px);padding:20px}
        @media(max-width:480px){.kc{width:56px;height:80px}.kc.sm{width:42px;height:60px}.kr{font-size:18px}.kc.sm .kr{font-size:13px}.ks{font-size:14px}.kc.sm .ks{font-size:10px}}
      `}</style>

      {/* Notifications */}
      {notif && <div style={{ position: 'fixed', top: 'calc(56px + env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,.9)', border: `1px solid ${S.gold}`, padding: '10px 24px', borderRadius: 8, color: S.gbright, fontWeight: 600, fontSize: 15, animation: 'nin .3s ease-out', whiteSpace: 'nowrap' }}>{notif}</div>}
      {floats.map(r => <div key={r.id} style={{ position: 'fixed', zIndex: 200, fontSize: 36, animation: 'fup 2.5s ease-out forwards', pointerEvents: 'none', left: `${25 + Math.random() * 50}%`, top: '55%' }}>{r.e}</div>)}

      {/* Confirm dialog */}
      {confirm && <ConfirmDialog message={confirm.message} onYes={confirm.onYes} onNo={() => setConfirm(null)} t={t} />}

      <div style={{ padding: 16, minHeight: '100dvh' }}>

        {/* ═══ MENU ═══ */}
        {screen === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 24 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 72, fontWeight: 900, color: S.gbright, textShadow: '0 2px 4px rgba(0,0,0,.5),0 0 40px rgba(212,168,67,.3)', letterSpacing: 12 }}>KABOO</h1>
            <p style={{ fontSize: 18, color: S.dim, letterSpacing: 4, fontStyle: 'italic' }}>{t.subtitle}</p>
            <div style={{ background: 'linear-gradient(145deg,rgba(0,0,0,.3),rgba(0,0,0,.15))', border: '1px solid rgba(212,168,67,.2)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 380 }}>
              <input className="inp" placeholder={t.enterName} value={pname} onChange={e => setPname(e.target.value.slice(0, 16))} style={{ marginBottom: 12 }} />
              <button className="btn bp" style={{ marginBottom: 10 }} onClick={handleCreate}>{t.createRoom}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,.2)' }} /><span style={{ color: S.dim, fontSize: 13 }}>{t.or}</span><div style={{ flex: 1, height: 1, background: 'rgba(212,168,67,.2)' }} /></div>
              <input className="inp" placeholder={t.enterRoomCode} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 5))} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 22, marginBottom: 12 }} />
              <button className="btn bs" onClick={handleJoin}>{t.joinRoom}</button>
              {error && <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginTop: 10 }}>{error}</p>}
            </div>
            {/* PWA Install Prompt */}
            {showInstall && !isPWA && (
              <div style={{ background: 'rgba(0,0,0,.3)', border: '1px solid rgba(212,168,67,.25)', borderRadius: 12, padding: '14px 20px', maxWidth: 380, width: '100%', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: S.gold, fontWeight: 600, marginBottom: 6 }}>
                  📱 {'Tam ekran deneyim için:'}
                </div>
                <div style={{ fontSize: 13, color: S.dim, lineHeight: 1.5 }}>
                  Safari → Paylaş (⬆️) → "Ana Ekrana Ekle" ile uygulama gibi oyna!
                </div>
                <button onClick={() => setShowInstall(false)} style={{ marginTop: 8, background: 'none', border: 'none', color: S.dim, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  {'Kapat'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ LOBBY ═══ */}
        {screen === 'lobby' && roomData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100dvh', paddingTop: 40, gap: 20 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 48, fontWeight: 900, color: S.gbright, letterSpacing: 8 }}>KABOO</h1>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: S.dim, fontSize: 13, marginBottom: 6 }}>{t.roomCode}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,.3)', border: `1px solid ${S.gold}`, borderRadius: 12, padding: '12px 20px' }}>
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
                    {p.isBot && isHost && <button className="btn bsm" style={{ padding: '3px 10px', fontSize: 11, background: 'rgba(200,50,50,.3)', color: '#ff6b6b', border: '1px solid rgba(200,50,50,.3)' }} onClick={() => removeBotFn(p.id)}>✕</button>}
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
            <button className="btn bsm bleave" onClick={handleLeave}>{t.leaveGame}</button>
          </div>
        )}

        {/* ═══ GAME ═══ */}
        {screen === 'game' && gameData && roomData && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 32px)', gap: 8 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: S.gold }}>{t.round} {gameData.round}</span>
              {gameData.status === 'playing' && (
                <div className={`turn-badge ${isMyTurn ? 'turn-mine' : cpBot ? 'turn-bot' : 'turn-other'}`}>
                  {isMyTurn ? t.yourTurn : cpBot ? `🤖 ${cpname} ${t.botThinking}` : `⏳ ${cpname}${t.notYourTurn}`}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn bsm bs" onClick={() => setShowReact(!showReact)} style={{ width: 'auto' }}>{t.reactions}</button>
                <button className="btn bsm bleave" onClick={handleLeave}>{t.leaveGame}</button>
              </div>
            </div>

            {showReact && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: 8, background: 'rgba(0,0,0,.3)', borderRadius: 8 }}>{EMOJIS.map(e => <button key={e} onClick={() => handleReact(e)} style={{ width: 38, height: 38, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,.08)', fontSize: 18, cursor: 'pointer' }}>{e}</button>)}</div>}

            {/* CABO banner */}
            {gameData.caboFinalRound && <div style={{ textAlign: 'center', padding: '8px 16px', background: 'linear-gradient(135deg,rgba(201,48,44,.3),rgba(201,48,44,.15))', border: '1px solid rgba(201,48,44,.4)', borderRadius: 8, color: '#ff6b6b', fontWeight: 600, animation: 'cflash 1s ease-in-out infinite alternate' }}>{players.find(p => p.id === gameData.caboCallerId)?.name} {t.caboCall} — {t.caboLastRound}</div>}

            {/* TIK TIK lock banner */}
            {gameData.tikTikLock && !snapMode && (
              <div style={{ textAlign: 'center', padding: '8px 16px', background: 'linear-gradient(135deg,rgba(243,156,18,.3),rgba(243,156,18,.15))', border: '1px solid rgba(243,156,18,.5)', borderRadius: 8, color: '#f39c12', fontWeight: 600, animation: 'cflash .8s ease-in-out infinite alternate' }}>
                👊 {gameData.tikTikLock} TIK TIK {'yapıyor — hamle bekle!'}
              </div>
            )}

            {/* Last Move */}
            {/* Sliding action banner */}
            {actionBanner && <ActionBanner text={actionBanner} />}

            {/* Last Move — clickable */}
            <LastMoveBar text={lastMoveText} detail={lastMoveDetail} t={t} showPopup={showLastMovePopup} onToggle={() => setShowLastMovePopup(p => !p)} />

            {/* Scores */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>{players.map(p => <div key={p.id} style={{ padding: '3px 10px', background: cpid === p.id ? 'rgba(212,168,67,.15)' : 'rgba(0,0,0,.2)', borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono',monospace", border: p.id === pid ? `1px solid ${S.gold}` : cpid === p.id ? '1px solid rgba(212,168,67,.3)' : '1px solid transparent' }}>{p.name}: {scores[p.id] || 0}</div>)}</div>

            {/* Other players */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {others.map(p => {
                const active = cpid === p.id; const hand = gameData.hands?.[p.id] || [];
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 10px', background: 'rgba(0,0,0,.15)', border: `2px solid ${active ? S.gbright : 'rgba(255,255,255,.08)'}`, borderRadius: 12, minWidth: 110 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? S.gbright : S.dim }}>{active ? '⏳ ' : ''}{p.name}</div>
                    <HandGrid cards={hand} small faceUp={revealed} flipped
                      glowIdx={glowSlot?.pid === p.id ? glowSlot.slot : null}
                      onClick={ci => { if (ability && ['peekOther', 'blindSwap', 'lookSwap'].includes(ability) && aStep === 0) { setSelOp(p.id); setSelOc(ci); } }}
                      hl={ci => selOp === p.id && selOc === ci} />
                    {gameData.status === 'playing' && !snapMode && !snapGiveMode && (
                      <button className={`btn btik ${gameData.tikTikUsedForCard || gameData.tikTikLock ? 'used' : ''}`} onClick={() => !(gameData.tikTikUsedForCard || gameData.tikTikLock) && startSnap(p.id)}>{t.tikTik}</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* TIK TIK overlay */}
            {snapMode && !snapGiveMode && (
              <div className="overlay" style={{ background: 'rgba(0,0,0,.85)', zIndex: 55 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: '#f39c12' }}>{t.tikTik}</div>
                <div style={{ color: S.dim, fontSize: 14 }}>{t.snapSelectCard}</div>
                <div style={{ color: S.light, fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                  {snapMode.targetPid === pid ? `${pname} ${t.you}` : players.find(p => p.id === snapMode.targetPid)?.name}
                </div>
                <HandGrid cards={gameData.hands?.[snapMode.targetPid] || []} faceUp={false}
                  flipped={snapMode.targetPid !== pid}
                  hl={ci => hovIdx === ci} hoveredIdx={hovIdx}
                  onHoverIdx={ci => setHovIdx(ci)} onLeaveIdx={() => setHovIdx(null)}
                  hoverLabelText={t.selectedCard}
                  onClick={ci => { setHovIdx(null); executeSnap(snapMode.targetPid, ci); }} />
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
              {snapGiveMode && <div style={{ fontSize: 14, color: '#f39c12', fontWeight: 700, marginBottom: 4 }}>{t.snapSelectGive}</div>}

              <HandGrid cards={myHand} faceUp={revealed} peek={peekCards}
                glowIdx={glowSlot?.pid === pid ? glowSlot.slot : null}
                hl={ci => (drawn && (phase === 'drawn' || phase === 'fromDiscard') && hovIdx === ci) || (ability && ['peekSelf', 'blindSwap'].includes(ability) && selMy === ci) || (ability === 'lookSwap' && aStep === 1 && selMy === ci) || snapGiveMode}
                hoveredIdx={(drawn && (phase === 'drawn' || phase === 'fromDiscard')) ? hovIdx : undefined}
                onHoverIdx={(drawn && (phase === 'drawn' || phase === 'fromDiscard')) ? (ci => setHovIdx(ci)) : undefined}
                onLeaveIdx={(drawn && (phase === 'drawn' || phase === 'fromDiscard')) ? (() => setHovIdx(null)) : undefined}
                hoverLabelText={(drawn && (phase === 'drawn' || phase === 'fromDiscard')) ? t.placeCardHere : undefined}
                onClick={ci => {
                  if (snapGiveMode) { executeSnapGive(ci); }
                  else if (drawn && (phase === 'drawn' || phase === 'fromDiscard')) { setHovIdx(null); keepDrawn(ci); }
                  else if (ability === 'peekSelf') setSelMy(ci);
                  else if (ability === 'blindSwap' || (ability === 'lookSwap' && aStep === 1)) setSelMy(ci);
                }} anim="da" />

              {/* TIK TIK for own cards */}
              {gameData.status === 'playing' && !snapMode && !snapGiveMode && !drawn && !ability && (
                <button className={`btn btik ${gameData.tikTikUsedForCard || gameData.tikTikLock ? 'used' : ''}`} onClick={() => !(gameData.tikTikUsedForCard || gameData.tikTikLock) && startSnap(pid)}>{t.tikTik}</button>
              )}

              {/* CABO */}
              {isMyTurn && phase === 'start' && !drawn && (
                <button className={`btn bcabo ${!caboAvailable ? 'disabled' : ''}`} onClick={callCabo} disabled={!caboAvailable}>{t.cabo}</button>
              )}
              {isMyTurn && phase === 'start' && !drawn && <div style={{ fontSize: 13, color: S.dim, fontStyle: 'italic' }}>{t.drawOrDiscard}</div>}
              {drawn && (phase === 'drawn' || phase === 'fromDiscard') && <div style={{ fontSize: 13, color: S.dim, fontStyle: 'italic' }}>{t.chooseAction}</div>}
            </div>

            {/* ═══ OVERLAYS ═══ */}

            {/* Swap animation */}
            {swapAnim && (() => {
              const dn = (idx) => { const map = { 0: 3, 1: 4, 2: 1, 3: 2 }; return idx < 4 ? map[idx] : idx + 1; };
              return (
              <div className="overlay" style={{ background: 'rgba(0,0,0,.92)', zIndex: 70 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 32, color: S.gbright, textAlign: 'center', letterSpacing: 4, textShadow: '0 0 30px rgba(212,168,67,.4)' }}>
                  🔄 {t.swapAnimation}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 24, position: 'relative', minHeight: 180 }}>
                  {/* Player 1 — left side */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    marginRight: 50,
                    transform: swapAnim.phase === 'sliding' ? 'translateX(70px)' : 'translateX(0)',
                    transition: 'transform 3s cubic-bezier(0.25,0.1,0.25,1)',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: S.gbright, padding: '4px 12px', background: 'rgba(212,168,67,.15)', borderRadius: 6, border: '1px solid rgba(212,168,67,.3)' }}>{swapAnim.p1}</div>
                    <Card card={{ rank: '?', suit: '?' }} faceUp={false} />
                    <div style={{ fontSize: 13, color: S.gold, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Kart #{dn(swapAnim.c1)}</div>
                  </div>

                  {/* Arrow — between cards */}
                  <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: 32, color: S.gold, textShadow: '0 0 20px rgba(212,168,67,.5)', zIndex: 2 }}>⇄</div>

                  {/* Player 2 — right side */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    marginLeft: 50,
                    transform: swapAnim.phase === 'sliding' ? 'translateX(-70px)' : 'translateX(0)',
                    transition: 'transform 3s cubic-bezier(0.25,0.1,0.25,1)',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: S.gbright, padding: '4px 12px', background: 'rgba(212,168,67,.15)', borderRadius: 6, border: '1px solid rgba(212,168,67,.3)' }}>{swapAnim.p2}</div>
                    <Card card={{ rank: '?', suit: '?' }} faceUp={false} />
                    <div style={{ fontSize: 13, color: S.gold, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Kart #{dn(swapAnim.c2)}</div>
                  </div>
                </div>

                {swapAnim.phase === 'done' && (
                  <div style={{ marginTop: 24, padding: '14px 28px', background: 'rgba(212,168,67,.12)', border: `2px solid ${S.gold}`, borderRadius: 12, textAlign: 'center', animation: 'din .4s ease-out' }}>
                    <div style={{ fontSize: 18, color: S.gbright, fontWeight: 700 }}>
                      {swapAnim.p1} #{dn(swapAnim.c1)} ⇄ {swapAnim.p2} #{dn(swapAnim.c2)}
                    </div>
                    <div style={{ fontSize: 14, color: S.dim, marginTop: 6 }}>{t.cardsSwapped}</div>
                  </div>
                )}
              </div>
              );
            })()}

            {/* Initial peek */}
            {iPeek && <div className="overlay" style={{ background: 'rgba(0,0,0,.75)' }} onClick={() => { setIPeek(false); setPeekCards({}); }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 52, color: S.gbright }}>{iPeekT}</div>
              <div style={{ color: S.gold, fontFamily: "'Playfair Display',serif", fontSize: 20 }}>{t.lookingAtCards}</div>
              <div style={{ color: S.dim, fontSize: 14 }}>📍 #1 ve #2 {'numaralı kartların'}</div>
              <div style={{ display: 'flex', gap: 16 }}>{myHand.slice(2, 4).map((c, i) => c && <Card key={i} card={c} faceUp anim="da" cardNumber={i + 1} />)}</div>
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
            {ability && !Object.keys(peekCards).length && !tempCard && <div className="overlay" style={{ background: 'rgba(0,0,0,.85)' }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, color: S.gbright }}>{t[ability]}</div>
              <div style={{ color: S.dim, textAlign: 'center', maxWidth: 300 }}>
                {ability === 'peekSelf' && t.selectYourCard}
                {ability === 'peekOther' && (selOp ? t.selectOtherCard : t.selectOtherPlayer)}
                {ability === 'blindSwap' && (selMy === null ? t.selectYourCard : !selOp ? t.selectOtherPlayer : t.selectOtherCard)}
                {ability === 'lookSwap' && aStep === 0 && (selOp ? t.selectOtherCard : t.selectOtherPlayer)}
                {ability === 'lookSwap' && aStep === 1 && `${t.selectYourCard} (${t.skip}?)`}
              </div>
              {['peekOther', 'blindSwap', 'lookSwap'].includes(ability) && !selOp && aStep === 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{others.map(p => <button key={p.id} className="btn bsm bs" onClick={() => setSelOp(p.id)}>{p.name}</button>)}</div>}
              {selOp && (['peekOther', 'blindSwap'].includes(ability) || (ability === 'lookSwap' && aStep === 0)) && (
                <div><div style={{ color: S.light, fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 6 }}>{players.find(p => p.id === selOp)?.name}</div>
                <HandGrid cards={gameData.hands[selOp] || []} faceUp={false} flipped hl={ci => selOc === ci || hovIdx === ci} hoveredIdx={hovIdx} onHoverIdx={ci => setHovIdx(ci)} onLeaveIdx={() => setHovIdx(null)} hoverLabelText={t.selectedCard} onClick={ci => { setSelOc(ci); setHovIdx(null); }} /></div>
              )}
              {ability === 'peekSelf' && <div><div style={{ color: S.light, fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 6 }}>{pname}</div><HandGrid cards={myHand} faceUp={false} hl={ci => selMy === ci || hovIdx === ci} hoveredIdx={hovIdx} onHoverIdx={ci => setHovIdx(ci)} onLeaveIdx={() => setHovIdx(null)} hoverLabelText={t.selectedCard} onClick={ci => { setSelMy(ci); setHovIdx(null); }} /></div>}
              {ability === 'blindSwap' && selOp && selOc !== null && <div><div style={{ color: S.dim, marginBottom: 6, fontSize: 13, textAlign: 'center' }}>{t.selectYourCard}</div><HandGrid cards={myHand} faceUp={false} hl={ci => selMy === ci || hovIdx === ci} hoveredIdx={hovIdx} onHoverIdx={ci => setHovIdx(ci)} onLeaveIdx={() => setHovIdx(null)} hoverLabelText={t.selectedCard} onClick={ci => { setSelMy(ci); setHovIdx(null); }} /></div>}
              {ability === 'lookSwap' && aStep === 1 && <div><div style={{ color: S.dim, marginBottom: 6, fontSize: 13, textAlign: 'center' }}>{t.selectYourCard}</div><HandGrid cards={myHand} faceUp={false} hl={ci => selMy === ci || hovIdx === ci} hoveredIdx={hovIdx} onHoverIdx={ci => setHovIdx(ci)} onLeaveIdx={() => setHovIdx(null)} hoverLabelText={t.selectedCard} onClick={ci => { setSelMy(ci); setHovIdx(null); }} /></div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {((ability === 'peekSelf' && selMy !== null) || (ability === 'peekOther' && selOc !== null) || (ability === 'blindSwap' && selMy !== null && selOc !== null) || (ability === 'lookSwap' && aStep === 0 && selOc !== null) || (ability === 'lookSwap' && aStep === 1)) && <button className="btn bp bsm" onClick={execAbil}>{t.confirm}</button>}
                <button className="btn bs bsm" onClick={() => { skipAbil(); setHovIdx(null); }}>{t.skipAbility}</button>
              </div>
            </div>}

            {/* Round end */}
            {gameData.status === 'roundEnd' && gameData.roundScores && <div className="overlay" style={{ background: 'rgba(0,0,0,.85)', zIndex: 60, overflowY: 'auto' }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 36, color: S.gbright }}>{t.roundOver}</div>
              <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'left' }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'center' }}>{t.round} {gameData.round}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', fontFamily: "'Playfair Display',serif", color: S.gold, fontSize: 14, textAlign: 'center' }}>{t.total}</th></tr></thead>
                <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === pid ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace" }}>{gameData.roundScores[p.id]}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
              </table>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>{players.map(p => <div key={p.id} style={{ textAlign: 'center' }}><div style={{ fontSize: 12, marginBottom: 4, color: S.dim }}>{p.name}</div><HandGrid cards={gameData.hands[p.id] || []} small faceUp flipped={p.id !== pid} /></div>)}</div>
              {isHost && <button className="btn bp" style={{ maxWidth: 240 }} onClick={nextRound}>{t.nextRound}</button>}
            </div>}

            {/* Game over */}
            {gameData.status === 'gameOver' && <div className="overlay" style={{ background: 'rgba(0,0,0,.88)', zIndex: 60 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 40, color: S.gbright }}>{t.gameOver}</div>
              <table style={{ width: '100%', maxWidth: 360, borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', textAlign: 'left', fontFamily: "'Playfair Display',serif", color: S.gold }}>{t.players}</th><th style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.15)', textAlign: 'center', fontFamily: "'Playfair Display',serif", color: S.gold }}>{t.total}</th></tr></thead>
                <tbody>{[...players].sort((a, b) => (scores[a.id] || 0) - (scores[b.id] || 0)).map((p, i) => <tr key={p.id} style={{ background: i === 0 ? 'rgba(212,168,67,.15)' : 'transparent' }}><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)' }}>{i === 0 ? '🏆 ' : ''}{p.name} {p.id === pid ? t.you : ''}</td><td style={{ padding: '8px 16px', borderBottom: '1px solid rgba(212,168,67,.08)', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{scores[p.id] || 0}</td></tr>)}</tbody>
              </table>
              <button className="btn bp" style={{ maxWidth: 200 }} onClick={handleLeave}>{t.newGame}</button>
            </div>}

            {/* Chat */}
            <button onClick={() => { setShowChat(!showChat); if (!showChat) setChatUnread(0); }} style={{ position: 'fixed', bottom: 'calc(16px + env(safe-area-inset-bottom))', right: 'calc(16px + env(safe-area-inset-right))', zIndex: 40, width: 48, height: 48, borderRadius: '50%', background: S.gold, color: '#1a1a1a', border: 'none', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              💬
              {chatUnread > 0 && <span style={{ position: 'absolute', top: -6, right: -6, background: '#c9302c', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", padding: '0 4px' }}>{chatUnread}</span>}
            </button>
            {showChat && <div style={{ position: 'fixed', bottom: 'calc(72px + env(safe-area-inset-bottom))', right: 'calc(16px + env(safe-area-inset-right))', zIndex: 40, width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: 400, background: 'rgba(14,58,26,.95)', border: '1px solid rgba(212,168,67,.3)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)' }}>
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

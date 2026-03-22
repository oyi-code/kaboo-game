// ============================================================
// KABOO - Game Logic & Utilities
// ============================================================

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}${suit}` });
    }
  }
  deck.push({ suit: '🃏', rank: 'JK', id: 'JK1' });
  deck.push({ suit: '🃏', rank: 'JK', id: 'JK2' });
  return shuffle([...deck]);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardValue(card) {
  if (!card) return 0;
  if (card.rank === 'JK') return -1;
  if (card.rank === 'K') {
    return (card.suit === '♠' || card.suit === '♣') ? 13 : 0;
  }
  if (card.rank === 'Q') return 12;
  if (card.rank === 'J') return 11;
  if (card.rank === 'A') return 1;
  return parseInt(card.rank);
}

export function isRedSuit(suit) {
  return suit === '♥' || suit === '♦';
}

export function getCardAbility(card) {
  if (!card) return null;
  if (card.rank === '7' || card.rank === '8') return 'peekSelf';
  if (card.rank === '9' || card.rank === '10') return 'peekOther';
  if (card.rank === 'Q' || card.rank === 'J') return 'blindSwap';
  if (card.rank === 'K' && !isRedSuit(card.suit)) return 'lookSwap';
  return null;
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

export function dealCards(playerIds) {
  const deck = createDeck();
  const hands = {};
  let deckIdx = 0;

  for (const pid of playerIds) {
    hands[pid] = [];
    for (let i = 0; i < 4; i++) {
      hands[pid].push({ ...deck[deckIdx], position: i });
      deckIdx++;
    }
  }

  const discardCard = deck[deckIdx];
  deckIdx++;
  const drawPile = deck.slice(deckIdx);

  return { hands, drawPile, discardPile: [discardCard] };
}

// Sound effects
const AudioCtx = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx && AudioCtx) {
    audioCtx = new AudioCtx();
  }
  return audioCtx;
}

export function playSound(type) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.12;

    const sounds = {
      cardFlip: { freq: 800, dur: 0.1, type: 'sine' },
      cardDeal: { freq: 500, dur: 0.15, type: 'sine' },
      cabo: { freq: 440, dur: 0.5, type: 'sawtooth', ramp: 880 },
      snap: { freq: 600, dur: 0.08, type: 'square' },
      success: { freq: 523, dur: 0.4, type: 'sine' },
      fail: { freq: 200, dur: 0.3, type: 'sawtooth' },
      chat: { freq: 1200, dur: 0.06, type: 'sine', vol: 0.06 },
      join: { freq: 660, dur: 0.2, type: 'sine' },
      turn: { freq: 880, dur: 0.15, type: 'sine' },
    };

    const s = sounds[type] || sounds.cardFlip;
    osc.type = s.type || 'sine';
    osc.frequency.value = s.freq;
    if (s.ramp) osc.frequency.linearRampToValueAtTime(s.ramp, ctx.currentTime + s.dur);
    gain.gain.value = s.vol || 0.12;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + s.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + s.dur);
  } catch (e) { /* silent */ }
}

// Translations
export const LANG = {
  tr: {
    title: 'KABOO',
    subtitle: 'Klasik Kart Oyunu',
    createRoom: 'Oda Oluştur',
    joinRoom: 'Odaya Katıl',
    enterName: 'Adını gir',
    enterRoomCode: 'Oda kodu gir',
    join: 'Katıl',
    back: 'Geri',
    waiting: 'Oyuncular bekleniyor...',
    startGame: 'Oyunu Başlat',
    players: 'Oyuncular',
    targetScore: 'Hedef Puan',
    roomCode: 'Oda Kodu',
    copyCode: 'Kopyala',
    copied: 'Kopyalandı!',
    round: 'El',
    scores: 'Puanlar',
    yourTurn: 'Senin sıran!',
    notYourTurn: "'in sırası",
    drawPile: 'Çekme Destesi',
    discardPile: 'Atma Destesi',
    cabo: 'CABO!',
    caboCall: 'CABO dedi!',
    keepCard: 'Kartı al',
    discardCard: 'Kartı at',
    useAbility: 'Yeteneği kullan',
    snap: 'Aklımda! 👊',
    peekSelf: 'Kendine Bak',
    peekOther: 'Başkasına Bak',
    blindSwap: 'Kör Değişim',
    lookSwap: 'Bak & Değiştir',
    selectYourCard: 'Kendi kartını seç',
    selectOtherCard: 'Rakip kartı seç',
    selectOtherPlayer: 'Bir oyuncu seç',
    confirm: 'Onayla',
    cancel: 'İptal',
    skip: 'Geç',
    revealCards: 'Kartlar Açılıyor!',
    roundOver: 'El Bitti!',
    gameOver: 'Oyun Bitti!',
    winner: 'Kazanan',
    nextRound: 'Sonraki El',
    newGame: 'Yeni Oyun',
    leave: 'Ayrıl',
    chat: 'Sohbet',
    sendMsg: 'Mesaj gönder...',
    send: 'Gönder',
    lookingAtCards: 'Kartlarına bakıyor...',
    timeLeft: 'sn kaldı',
    closeCard: 'Kapatmak için tıkla',
    minPlayers: 'En az 2 oyuncu gerekli',
    roomFull: 'Oda dolu!',
    roomNotFound: 'Oda bulunamadı!',
    nameRequired: 'İsim gerekli!',
    codeRequired: 'Oda kodu gerekli!',
    gameStarted: 'Oyun zaten başlamış!',
    you: '(Sen)',
    host: 'Ev Sahibi',
    caboLastRound: 'Son tur! CABO denildi!',
    snapSuccess: 'Eşleşme başarılı! 👊',
    snapFail: 'Yanlış eşleşme! 😅',
    total: 'Toplam',
    eliminated: 'Elendi!',
    reactions: '😀',
    inviteFriend: '📲 Davet Et',
    inviteMsg: '🎴 KABOO oynayalım! Oda kodum: {code}\n\n👉 Katıl: {url}?room={code}',
    or: 'veya',
    replaceWith: 'ile değiştir',
    drawOrDiscard: 'Desteden çek, atılandan al veya CABO de',
    chooseAction: 'Çektiğin kartı tut veya at',
    addBot: '🤖 Bot Ekle',
    removeBot: 'Çıkar',
    bot: 'Bot',
    botThinking: 'düşünüyor...',
  },
  en: {
    title: 'KABOO',
    subtitle: 'Classic Card Game',
    createRoom: 'Create Room',
    joinRoom: 'Join Room',
    enterName: 'Enter your name',
    enterRoomCode: 'Enter room code',
    join: 'Join',
    back: 'Back',
    waiting: 'Waiting for players...',
    startGame: 'Start Game',
    players: 'Players',
    targetScore: 'Target Score',
    roomCode: 'Room Code',
    copyCode: 'Copy',
    copied: 'Copied!',
    round: 'Round',
    scores: 'Scores',
    yourTurn: 'Your turn!',
    notYourTurn: "'s turn",
    drawPile: 'Draw Pile',
    discardPile: 'Discard Pile',
    cabo: 'CABO!',
    caboCall: 'called CABO!',
    keepCard: 'Keep card',
    discardCard: 'Discard card',
    useAbility: 'Use ability',
    snap: 'Got it! 👊',
    peekSelf: 'Peek Self',
    peekOther: 'Peek Other',
    blindSwap: 'Blind Swap',
    lookSwap: 'Look & Swap',
    selectYourCard: 'Select your card',
    selectOtherCard: "Select opponent's card",
    selectOtherPlayer: 'Select a player',
    confirm: 'Confirm',
    cancel: 'Cancel',
    skip: 'Skip',
    revealCards: 'Revealing Cards!',
    roundOver: 'Round Over!',
    gameOver: 'Game Over!',
    winner: 'Winner',
    nextRound: 'Next Round',
    newGame: 'New Game',
    leave: 'Leave',
    chat: 'Chat',
    sendMsg: 'Send message...',
    send: 'Send',
    lookingAtCards: 'Looking at cards...',
    timeLeft: 'sec left',
    closeCard: 'Click to close',
    minPlayers: 'At least 2 players needed',
    roomFull: 'Room is full!',
    roomNotFound: 'Room not found!',
    nameRequired: 'Name required!',
    codeRequired: 'Room code required!',
    gameStarted: 'Game already started!',
    you: '(You)',
    host: 'Host',
    caboLastRound: 'Last round! CABO called!',
    snapSuccess: 'Snap success! 👊',
    snapFail: 'Wrong snap! 😅',
    total: 'Total',
    eliminated: 'Eliminated!',
    reactions: '😀',
    inviteFriend: '📲 Invite',
    inviteMsg: '🎴 Let\'s play KABOO! Room code: {code}\n\n👉 Join: {url}?room={code}',
    or: 'or',
    replaceWith: 'replace with',
    drawOrDiscard: 'Draw from pile, take from discard, or call CABO',
    chooseAction: 'Keep or discard the drawn card',
    addBot: '🤖 Add Bot',
    removeBot: 'Remove',
    bot: 'Bot',
    botThinking: 'is thinking...',
  }
};

export const EMOJIS = ['👊', '😂', '😮', '👏', '😎', '🤔', '😱', '🔥', '💀', '🎉'];

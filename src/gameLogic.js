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

export function cardValue(c) {
  if (!c) return 0;
  if (c.rank === 'JK') return -1;
  if (c.rank === 'K') return (c.suit === '♠' || c.suit === '♣') ? 13 : 0; // black=13, red=0
  if (c.rank === 'Q') return 12;
  if (c.rank === 'J') return 11;
  if (c.rank === 'A') return 1;
  return parseInt(c.rank);
}

export function isRedSuit(s) { return s === '♥' || s === '♦'; }

// Abilities activate ONLY when a card is DISCARDED (atıldığında)
export function getCardAbility(c) {
  if (!c) return null;
  if (c.rank === '7' || c.rank === '8') return 'peekSelf';       // Kendine Bak
  if (c.rank === '9' || c.rank === '10') return 'peekOther';     // Başkasına Bak
  if (c.rank === 'Q' || c.rank === 'J') return 'blindSwap';      // Kör Değişim
  if (c.rank === 'K' && !isRedSuit(c.suit)) return 'lookSwap';   // Bak & Değiştir (only black K)
  return null;
}

export function generateRoomCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += ch[Math.floor(Math.random() * ch.length)];
  return c;
}

export function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

export function dealCards(playerIds) {
  const deck = createDeck();
  const hands = {};
  let idx = 0;
  for (const pid of playerIds) {
    hands[pid] = [];
    for (let i = 0; i < 4; i++) {
      hands[pid].push({ ...deck[idx], position: i });
      idx++;
    }
  }
  const discardCard = deck[idx]; idx++;
  return { hands, drawPile: deck.slice(idx), discardPile: [discardCard] };
}

// Sound
const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
let ac = null;
export function playSound(type) {
  if (!AC) return; if (!ac) ac = new AC();
  try {
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); g.gain.value = 0.1;
    const m = {
      cardFlip: { f: 800, d: .1 }, cardDeal: { f: 500, d: .15 },
      cabo: { f: 440, d: .5, t: 'sawtooth', r: 880 },
      snap: { f: 600, d: .08, t: 'square' },
      fail: { f: 200, d: .3, t: 'sawtooth' },
      chat: { f: 1200, d: .06, v: .05 },
      join: { f: 660, d: .2 },
      turn: { f: 880, d: .15 },
      tikTik: { f: 1000, d: .05, t: 'square' },
    };
    const s = m[type] || m.cardFlip;
    o.type = s.t || 'sine'; o.frequency.value = s.f;
    if (s.r) o.frequency.linearRampToValueAtTime(s.r, ac.currentTime + s.d);
    g.gain.value = s.v || 0.1;
    g.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + s.d);
    o.start(ac.currentTime); o.stop(ac.currentTime + s.d);
  } catch (e) { }
}

export const LANG = {
  tr: {
    title: 'KABOO', subtitle: 'Klasik Kart Oyunu',
    createRoom: 'Oda Oluştur', joinRoom: 'Odaya Katıl',
    enterName: 'Adını gir', enterRoomCode: 'Oda kodu gir',
    back: 'Geri', waiting: 'Oyuncular bekleniyor...',
    startGame: 'Oyunu Başlat', players: 'Oyuncular',
    targetScore: 'Hedef Puan', roomCode: 'Oda Kodu',
    copyCode: 'Kopyala', copied: 'Kopyalandı!',
    round: 'El', yourTurn: '🎯 Senin sıran!',
    notYourTurn: "'in sırası", waitingTurn: 'Sıranı bekle...',
    drawPile: 'Çekme Destesi', discardPile: 'Atma Destesi',
    cabo: 'KABOO!', caboCall: 'KABOO dedi!',
    discardCard: 'Kartı at',
    tikTik: 'TIK TIK! 👊',
    peekSelf: 'Kendine Bak', peekOther: 'Başkasına Bak',
    blindSwap: 'Kör Değişim', lookSwap: 'Bak & Değiştir',
    selectYourCard: 'Kendi kartını seç',
    selectOtherCard: 'Rakip kartı seç',
    selectOtherPlayer: 'Bir oyuncu seç',
    confirm: 'Onayla', cancel: 'İptal', skip: 'Geç',
    roundOver: 'El Bitti!', gameOver: 'Oyun Bitti!',
    nextRound: 'Sonraki El', newGame: 'Yeni Oyun',
    chat: 'Sohbet', sendMsg: 'Mesaj gönder...', send: 'Gönder',
    lookingAtCards: 'Alt kartlarına bak!',
    timeLeft: 'sn', closeCard: 'Kapatmak için tıkla',
    minPlayers: 'En az 2 oyuncu gerekli',
    roomFull: 'Oda dolu!', roomNotFound: 'Oda bulunamadı!',
    nameRequired: 'İsim gerekli!', codeRequired: 'Oda kodu gerekli!',
    gameStarted: 'Oyun zaten başlamış!',
    you: '(Sen)', host: 'Ev Sahibi',
    caboLastRound: 'Son tur! KABOO denildi!',
    snapSuccess: 'Eşleşme başarılı! 👊',
    snapFail: 'Yanlış eşleşme! +2 ceza kartı 😅',
    snapSelectCard: 'Eşleştirmek istediğin kartı seç',
    snapSelectGive: 'Rakibe vermek istediğin kartını seç',
    total: 'Toplam', reactions: '😀',
    addBot: '🤖 Bot Ekle', removeBot: '✕',
    botThinking: 'düşünüyor...', or: 'veya',
    drawOrDiscard: 'Desteden çek, atılandan al veya KABOO de',
    chooseAction: 'Kartlarından birini seç → değiştirilecek',
    eliminated: 'Elendi!',
    inviteFriend: '📲 Davet Et',
    inviteMsg: '🎴 KABOO oynayalım! Oda kodum: {code}\n\n👉 Katıl: {url}?room={code}',
    caboNotYet: 'Herkes en az 1 kez oynamalı!',
    bottomCards: '⬇️ Alt sıradaki kartların:',
    useAbility: 'Yeteneği kullan',
    skipAbility: 'Kullanma',
  },
  en: {
    title: 'KABOO', subtitle: 'Classic Card Game',
    createRoom: 'Create Room', joinRoom: 'Join Room',
    enterName: 'Enter your name', enterRoomCode: 'Enter room code',
    back: 'Back', waiting: 'Waiting for players...',
    startGame: 'Start Game', players: 'Players',
    targetScore: 'Target Score', roomCode: 'Room Code',
    copyCode: 'Copy', copied: 'Copied!',
    round: 'Round', yourTurn: '🎯 Your turn!',
    notYourTurn: "'s turn", waitingTurn: 'Wait for your turn...',
    drawPile: 'Draw Pile', discardPile: 'Discard Pile',
    cabo: 'KABOO!', caboCall: 'called KABOO!',
    discardCard: 'Discard',
    tikTik: 'TIK TIK! 👊',
    peekSelf: 'Peek Self', peekOther: 'Peek Other',
    blindSwap: 'Blind Swap', lookSwap: 'Look & Swap',
    selectYourCard: 'Select your card',
    selectOtherCard: "Select opponent's card",
    selectOtherPlayer: 'Select a player',
    confirm: 'Confirm', cancel: 'Cancel', skip: 'Skip',
    roundOver: 'Round Over!', gameOver: 'Game Over!',
    nextRound: 'Next Round', newGame: 'New Game',
    chat: 'Chat', sendMsg: 'Send message...', send: 'Send',
    lookingAtCards: 'Look at your bottom cards!',
    timeLeft: 'sec', closeCard: 'Click to close',
    minPlayers: 'At least 2 players needed',
    roomFull: 'Room is full!', roomNotFound: 'Room not found!',
    nameRequired: 'Name required!', codeRequired: 'Code required!',
    gameStarted: 'Game already started!',
    you: '(You)', host: 'Host',
    caboLastRound: 'Last round! KABOO called!',
    snapSuccess: 'Snap success! 👊',
    snapFail: 'Wrong snap! +2 penalty cards 😅',
    snapSelectCard: 'Select the card you want to match',
    snapSelectGive: 'Select your card to give to opponent',
    total: 'Total', reactions: '😀',
    addBot: '🤖 Add Bot', removeBot: '✕',
    botThinking: 'thinking...', or: 'or',
    drawOrDiscard: 'Draw from pile, take from discard, or call KABOO',
    chooseAction: 'Select one of your cards → it will be replaced',
    eliminated: 'Eliminated!',
    inviteFriend: '📲 Invite',
    inviteMsg: "🎴 Let's play KABOO! Room code: {code}\n\n👉 Join: {url}?room={code}",
    caboNotYet: 'Everyone must play at least once!',
    bottomCards: '⬇️ Your bottom cards:',
    useAbility: 'Use ability',
    skipAbility: "Don't use",
  }
};

export const EMOJIS = ['👊', '😂', '😮', '👏', '😎', '🤔', '😱', '🔥', '💀', '🎉'];

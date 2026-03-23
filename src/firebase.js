import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, push, update, remove, serverTimestamp } from 'firebase/database';

// ============================================================
// FIREBASE CONFIG - Kendi Firebase bilgilerinizi buraya girin!
// ============================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Room Operations ---
export async function createRoom(roomCode, hostId, hostName) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  await set(roomRef, {
    roomCode,
    hostId,
    status: 'lobby',
    targetScore: 100,
    round: 0,
    createdAt: Date.now(),
    ts: Date.now()
  });
  // Add host as first player
  const playerRef = ref(db, `rooms/${roomCode}/players/${hostId}`);
  await set(playerRef, { id: hostId, name: hostName, connected: true, isBot: false, joinedAt: Date.now() });
  // Init scores
  const scoreRef = ref(db, `rooms/${roomCode}/scores/${hostId}`);
  await set(scoreRef, 0);
}

export async function joinRoom(roomCode, playerId, playerName) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return { error: 'notFound' };

  const data = snapshot.val();
  if (data.status !== 'lobby') return { error: 'started' };

  const players = data.players || {};
  if (Object.keys(players).length >= 6) return { error: 'full' };

  // Add player
  const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
  await set(playerRef, { id: playerId, name: playerName, connected: true, isBot: false, joinedAt: Date.now() });
  const scoreRef = ref(db, `rooms/${roomCode}/scores/${playerId}`);
  await set(scoreRef, 0);

  return { success: true, data };
}

export function subscribeToRoom(roomCode, callback) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return onValue(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });
}

export async function updateRoom(roomCode, updates) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  await update(roomRef, { ...updates, ts: Date.now() });
}

export async function setRoomData(roomCode, path, data) {
  const dataRef = ref(db, `rooms/${roomCode}/${path}`);
  await set(dataRef, data);
}

export async function getRoomData(roomCode) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  return snapshot.exists() ? snapshot.val() : null;
}

// --- Chat Operations ---
export async function sendChatMessage(roomCode, playerId, playerName, text) {
  const chatRef = ref(db, `rooms/${roomCode}/chat`);
  await push(chatRef, {
    playerId,
    name: playerName,
    text,
    ts: Date.now()
  });
}

export function subscribeToChat(roomCode, callback) {
  const chatRef = ref(db, `rooms/${roomCode}/chat`);
  return onValue(chatRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const messages = Object.values(data).sort((a, b) => a.ts - b.ts);
      callback(messages);
    } else {
      callback([]);
    }
  });
}

// --- Reactions ---
export async function sendReaction(roomCode, playerId, playerName, emoji) {
  const reactionRef = ref(db, `rooms/${roomCode}/reactions`);
  await push(reactionRef, { playerId, playerName, emoji, ts: Date.now() });
}

export function subscribeToReactions(roomCode, callback) {
  const reactionsRef = ref(db, `rooms/${roomCode}/reactions`);
  return onValue(reactionsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const reactions = Object.values(data).sort((a, b) => a.ts - b.ts);
      callback(reactions);
    } else {
      callback([]);
    }
  });
}

// --- Game State ---
export async function setGameState(roomCode, gameState) {
  const gsRef = ref(db, `rooms/${roomCode}/gameState`);
  await set(gsRef, { ...gameState, ts: Date.now() });
}

export async function updateGameState(roomCode, updates) {
  const gsRef = ref(db, `rooms/${roomCode}/gameState`);
  await update(gsRef, { ...updates, ts: Date.now() });
}

export function subscribeToGameState(roomCode, callback) {
  const gsRef = ref(db, `rooms/${roomCode}/gameState`);
  return onValue(gsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });
}

export { db, ref, set, get, update, onValue, remove };

// --- Room cleanup ---
export async function deleteRoom(roomCode) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  await remove(roomRef);
}

export async function removePlayer(roomCode, playerId) {
  const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
  await remove(playerRef);
  const scoreRef = ref(db, `rooms/${roomCode}/scores/${playerId}`);
  await remove(scoreRef);
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const requireSignedIn = () => {
  if (!auth.currentUser) throw new Error("Entre na sua conta para continuar.");
  return auth.currentUser;
};
const normalizeEmail = email => String(email || "").trim().toLowerCase();

export async function registerAccount(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
  return credential.user;
}
export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  return credential.user;
}
export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, normalizeEmail(email));
}
export async function logout() { return signOut(auth); }
export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }

// Modelo: repertoires/{id}, repertoires/{id}/songs/{songId}, comments/{commentId}.
export async function listRepertoires() {
  requireSignedIn();
  const snap = await getDocs(collection(db, "repertoires"));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}
export async function createRepertoire(name) {
  const user = requireSignedIn();
  const ref = await addDoc(collection(db, "repertoires"), {
    name: String(name).trim(), ownerUid: user.uid, ownerEmail: normalizeEmail(user.email),
    editorEmails: [], createdAt: serverTimestamp()
  });
  return ref.id;
}
export async function setRepertoireName(repertoireId, name) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId), { name: String(name).trim() });
}
export async function deleteRepertoire(repertoireId) {
  requireSignedIn();
  // Firestore não remove subcoleções junto com o documento pai.
  // As músicas e comentários devem ser removidos antes do documento.
  for (const sub of ["songs", "comments"]) {
    const snap = await getDocs(collection(db, "repertoires", repertoireId, sub));
    await Promise.all(snap.docs.map(item => deleteDoc(item.ref)));
  }
  return deleteDoc(doc(db, "repertoires", repertoireId));
}
export async function grantEditorAccess(repertoireId, email) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId), {
    editorEmails: arrayUnion(normalizeEmail(email))
  });
}
export async function revokeEditorAccess(repertoireId, email) {
  requireSignedIn();
  const normalized = normalizeEmail(email);
  const user = requireSignedIn();
  if (normalized === normalizeEmail(user.email)) throw new Error("O dono não pode remover a própria conta.");
  return updateDoc(doc(db, "repertoires", repertoireId), {
    editorEmails: arrayRemove(normalized)
  });
}
export async function listSongs(repertoireId) {
  requireSignedIn();
  const q = query(collection(db, "repertoires", repertoireId, "songs"), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(s => ({ id: s.id, ...s.data() }));
}
export async function addSong(repertoireId, song) {
  requireSignedIn();
  const songs = await listSongs(repertoireId);
  const ref = await addDoc(collection(db, "repertoires", repertoireId, "songs"), {
    title: String(song.title).trim(), key: String(song.key || "").trim(),
    body: String(song.body || ""), bodyHtml: String(song.bodyHtml || ""),
    order: songs.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}
export async function updateSong(repertoireId, songId, song) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId, "songs", songId), {
    title: String(song.title).trim(), key: String(song.key || "").trim(),
    body: String(song.body || ""), bodyHtml: String(song.bodyHtml || ""),
    order: Number(song.order || 0), updatedAt: serverTimestamp()
  });
}
export async function deleteSong(repertoireId, songId) {
  requireSignedIn();
  await deleteDoc(doc(db, "repertoires", repertoireId, "songs", songId)); const remaining = await listSongs(repertoireId); await Promise.all(remaining.map((song, index) => song.order === index ? Promise.resolve() : updateDoc(doc(db, "repertoires", repertoireId, "songs", song.id), { order: index })));
}
export async function addComment(repertoireId, text, authorName) {
  const user = requireSignedIn();
  return addDoc(collection(db, "repertoires", repertoireId, "comments"), {
    authorUid: user.uid, authorEmail: normalizeEmail(user.email),
    authorName: String(authorName || user.displayName || "Integrante").trim(),
    text: String(text).trim(), reviewed: false, createdAt: serverTimestamp()
  });
}
export async function listComments(repertoireId) {
  requireSignedIn();
  const q = query(collection(db, "repertoires", repertoireId, "comments"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(s => ({ id: s.id, ...s.data() }));
}
export async function reviewComment(repertoireId, commentId, reviewed = true) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId, "comments", commentId), { reviewed });
}
export async function deleteComment(repertoireId, commentId) {
  requireSignedIn();
  return deleteDoc(doc(db, "repertoires", repertoireId, "comments", commentId));
}







import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
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
  deleteField,
  writeBatch,
  onSnapshot
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
const siteOwnerEmail = "nadsonp850@gmail.com";
const allowedEmailDomains = new Set(["gmail.com", "hotmail.com", "icloud.com"]);
function assertAllowedEmail(email) {
  const domain = normalizeEmail(email).split("@").pop();
  if (!allowedEmailDomains.has(domain)) {
    throw Object.assign(new Error("Use um e-mail @gmail.com, @hotmail.com ou @icloud.com."), { code: "auth/unsupported-email-domain" });
  }
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
export function sanitizeSongHtml(value) {
  const dirty = String(value || "");
  if (!globalThis.DOMPurify) {
    return dirty.split(/\r?\n/).map(line => "<div>" + (line ? escapeText(line) : "<br>") + "</div>").join("");
  }
  const safe = globalThis.DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ["div", "br", "span", "b", "strong", "i", "em", "u"],
    ALLOWED_ATTR: ["class", "style"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "svg", "math"]
  });
  const template = document.createElement("template");
  template.innerHTML = safe;
  template.content.querySelectorAll("*").forEach(element => {
    const isMarker = element.classList.contains("marker");
    const textColorClass = [...element.classList].find(name => /^lyric-color-(red|blue|green|purple|orange|black)$/.test(name));
    const background = element.style.backgroundColor;
    const safeColor = /^(#[\da-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i.test(background);
    element.removeAttribute("class");
    element.removeAttribute("style");
    if (isMarker) {
      element.classList.add("marker");
      if (safeColor) element.style.backgroundColor = background;
    }
    if (textColorClass) element.classList.add(textColorClass);
  });
  return template.innerHTML;
}

export async function registerAccount(email, password) {
  assertAllowedEmail(email);
  const credential = await createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
  try {
    await sendEmailVerification(credential.user);
  } finally {
    await signOut(auth);
  }
  return credential.user;
}
export async function login(email, password) {
  assertAllowedEmail(email);
  const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  if (!credential.user.emailVerified) {
    await signOut(auth);
    throw Object.assign(new Error("Confirme seu endereço de e-mail antes de entrar."), { code: "auth/email-not-verified" });
  }
  return credential.user;
}
export async function resendVerification(email, password) {
  assertAllowedEmail(email);
  const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  try {
    if (credential.user.emailVerified) {
      throw Object.assign(new Error("Este e-mail já foi confirmado. Entre na sua conta."), { code: "auth/email-already-verified" });
    }
    await sendEmailVerification(credential.user);
  } finally {
    await signOut(auth);
  }
}
export async function resetPassword(email) {
  assertAllowedEmail(email);
  return sendPasswordResetEmail(auth, normalizeEmail(email));
}
export async function logout() { return signOut(auth); }
export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }

// Modelo: repertoires/{id}, repertoires/{id}/songs/{songId}, comments/{commentId}.
export async function listRepertoires() {
  const user = requireSignedIn();
  const source = collection(db, "repertoires");
  const owned = await getDocs(query(source, where("ownerUid", "==", user.uid)));
  let publicDocs;
  try {
    publicDocs = await getDocs(query(source, where("publicRead", "==", true)));
  } catch (error) {
    // A public query is rejected if even one matching legacy document still
    // contains private email fields. Returning owned docs lets their owners
    // reach the cleanup path in reloadData() instead of failing the whole load.
    if (error?.code !== "permission-denied") throw error;
    console.warn("A consulta pública foi bloqueada por documentos legados; carregando os repertórios próprios para permitir a migração.");
    if (owned.empty) {
      throw Object.assign(new Error("A visualização compartilhada está temporariamente bloqueada enquanto o dono migra dados antigos. Peça ao administrador para entrar no site e atualizar os repertórios."), { code: "app/legacy-public-repertoires" });
    }
    publicDocs = { docs: [] };
  }
  const byId = new Map();
  [...owned.docs, ...publicDocs.docs].forEach(item => byId.set(item.id, { id: item.id, ...item.data() }));
  return [...byId.values()];
}
export function watchRepertoireChanges(callback) {
  const user = requireSignedIn();
  let ownedDocs = [], publicDocs = [], stopped = false;
  const parentStops = [];
  const childStops = new Map();
  const ownerMode = normalizeEmail(user.email) === siteOwnerEmail;
  const refreshSubscriptions = () => {
    if (stopped) return;
    const parents = new Map();
    [...ownedDocs, ...publicDocs].forEach(item => parents.set(item.id, { id: item.id, ...item.data() }));
    const desired = new Set();
    const listen = (key, ref) => {
      desired.add(key);
      if (!childStops.has(key)) childStops.set(key, onSnapshot(ref, () => callback(), error => callback(error)));
    };
    parents.forEach(record => {
      const base = collection(db, "repertoires", record.id, "songs");
      listen(record.id + ":songs", query(base, orderBy("order", "asc")));
      listen(record.id + ":notes", doc(db, "repertoires", record.id, "settings", "notes"));
      if (ownerMode || record.ownerUid === user.uid) {
        listen(record.id + ":comments", query(collection(db, "repertoires", record.id, "comments"), orderBy("createdAt", "desc")));
        listen(record.id + ":editors", collection(db, "repertoires", record.id, "editorAccess"));
      } else if (user.email) {
        listen(record.id + ":my-editor", doc(db, "repertoires", record.id, "editorAccess", normalizeEmail(user.email)));
      }
    });
    childStops.forEach((unsubscribe, key) => {
      if (!desired.has(key)) { unsubscribe(); childStops.delete(key); }
    });
  };
  const ownedQuery = query(collection(db, "repertoires"), where("ownerUid", "==", user.uid));
  const publicQuery = query(collection(db, "repertoires"), where("publicRead", "==", true));
  parentStops.push(onSnapshot(ownedQuery, snapshot => {
    ownedDocs = snapshot.docs; refreshSubscriptions(); callback();
  }, error => callback(error)));
  parentStops.push(onSnapshot(publicQuery, snapshot => {
    publicDocs = snapshot.docs; refreshSubscriptions(); callback();
  }, error => callback(error)));
  return () => {
    stopped = true;
    parentStops.forEach(unsubscribe => unsubscribe());
    childStops.forEach(unsubscribe => unsubscribe());
    childStops.clear();
  };
}
export async function createRepertoire(name) {
  const user = requireSignedIn();
  if (normalizeEmail(user.email) !== siteOwnerEmail) {
    throw Object.assign(new Error("Somente o administrador do site pode criar repertórios."), { code: "permission-denied" });
  }
  const ref = await addDoc(collection(db, "repertoires"), {
    name: String(name).trim(), ownerUid: user.uid, publicRead: true,
    createdAt: serverTimestamp()
  });
  return ref.id;
}
export async function secureLegacyRepertoire(repertoireId, previousData) {
  const user = requireSignedIn();
  if (previousData.ownerUid !== user.uid && normalizeEmail(user.email) !== siteOwnerEmail) {
    throw new Error("Somente o dono pode limpar os dados antigos de acesso.");
  }
  return updateDoc(doc(db, "repertoires", repertoireId), {
    publicRead: true,
    ownerEmail: deleteField(), memberEmails: deleteField(), editorEmails: deleteField(), editorUids: deleteField()
  });
}
export async function setRepertoireName(repertoireId, name) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId), { name: String(name).trim() });
}
export async function deleteRepertoire(repertoireId) {
  requireSignedIn();
  // Firestore não remove subcoleções junto com o documento pai.
  // Remova todas as subcoleções antes do documento pai para não deixar dados órfãos.
  for (const sub of ["songs", "comments", "editorAccess"]) {
    const snap = await getDocs(collection(db, "repertoires", repertoireId, sub));
    await Promise.all(snap.docs.map(item => deleteDoc(item.ref)));
  }
  await deleteDoc(doc(db, "repertoires", repertoireId, "settings", "notes"));
  return deleteDoc(doc(db, "repertoires", repertoireId));
}
export async function grantEditorAccess(repertoireId, email) {
  requireSignedIn();
  const normalized = normalizeEmail(email);
  assertAllowedEmail(normalized);
  return setDoc(doc(db, "repertoires", repertoireId, "editorAccess", normalized), {
    grantedAt: serverTimestamp()
  });
}
export async function revokeEditorAccess(repertoireId, email) {
  requireSignedIn();
  const normalized = normalizeEmail(email);
  const user = requireSignedIn();
  if (normalized === normalizeEmail(user.email)) throw new Error("O dono não pode remover o próprio acesso.");
  return deleteDoc(doc(db, "repertoires", repertoireId, "editorAccess", normalized));
}
export async function listEditorAccess(repertoireId) {
  requireSignedIn();
  const snap = await getDocs(collection(db, "repertoires", repertoireId, "editorAccess"));
  return snap.docs.map(item => item.id);
}
export async function hasEditorAccess(repertoireId) {
  const user = requireSignedIn();
  if (!user.email) return false;
  const snap = await getDoc(doc(db, "repertoires", repertoireId, "editorAccess", normalizeEmail(user.email)));
  return snap.exists();
}
export async function getRepertoireNotes(repertoireId) {
  requireSignedIn();
  const snap = await getDoc(doc(db, "repertoires", repertoireId, "settings", "notes"));
  return snap.exists() ? String(snap.data().text || "") : "";
}
export async function saveRepertoireNotes(repertoireId, text) {
  const user = requireSignedIn();
  const value = String(text || "").slice(0, 5000);
  return setDoc(doc(db, "repertoires", repertoireId, "settings", "notes"), {
    text: value, updatedAt: serverTimestamp(), updatedByUid: user.uid
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
    body: String(song.body || ""), bodyHtml: sanitizeSongHtml(song.bodyHtml || ""),
    order: songs.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}
export async function updateSong(repertoireId, songId, song) {
  requireSignedIn();
  return updateDoc(doc(db, "repertoires", repertoireId, "songs", songId), {
    title: String(song.title).trim(), key: String(song.key || "").trim(),
    body: String(song.body || ""), bodyHtml: sanitizeSongHtml(song.bodyHtml || ""),
    order: Number(song.order || 0), updatedAt: serverTimestamp()
  });
}
export async function reorderSongs(repertoireId, orderedSongs) {
  requireSignedIn();
  const batch = writeBatch(db);
  orderedSongs.forEach((song, index) => {
    batch.update(doc(db, "repertoires", repertoireId, "songs", song.id), {
      order: index, updatedAt: serverTimestamp()
    });
  });
  return batch.commit();
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







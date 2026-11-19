import * as FB from "./firebase-client.js";

let user = null;
let data = [];
let activeId = null;
let busy = false;
let editMode = false;
let markerColor = "#fff2a8";
let selectedRange = null;
let readerFontSize = null;
let scrollTimer = null;
let scrollLastTime = 0;
let scrollRemainder = 0;
let screenWakeLock = null;
let stopLiveSync = null;
let liveSyncTimer = null;
let liveSyncPending = false;
let activePresenceStop = null;
let activePresenceId = null;
let activePresenceUsers = [];
let viewingAccessLogs = false;
let accessLogData = null;
const loginAttemptStoragePrefix = "repertorio-login-failures:";
const sharedRouteId = new URLSearchParams(location.search).get("repertory");
const appRoot = document.getElementById("app");
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function linkifyLeadingUrl(value) {
  const text = String(value ?? "");
  const match = text.match(/^\s*(https?:\/\/[^\s<>"']+)/i);
  if (!match) return escapeHtml(text);
  let url = match[1], trailing = "";
  while (/[.,!?;:)]$/.test(url)) { trailing = url.slice(-1) + trailing; url = url.slice(0, -1); }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return escapeHtml(text);
    const prefix = text.slice(0, match.index + match[0].indexOf(match[1]));
    const suffix = text.slice(prefix.length + match[1].length);
    return escapeHtml(prefix) + '<a href="' + escapeHtml(parsed.href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + "</a>" + escapeHtml(trailing + suffix);
  } catch { return escapeHtml(text); }
}
const currentRep = () => data.find(item => item.id === activeId);
const normalized = value => String(value || "").trim().toLowerCase();
const siteOwnerEmail = "nadsonp850@gmail.com";
const isSiteOwner = () => normalized(user?.email) === siteOwnerEmail;
document.addEventListener("click", event => {
  const summary = event.target.closest(".palette-menu > summary");
  if (!summary) return;
  const openingMenu = summary.parentElement;
  if (!openingMenu.open) document.querySelectorAll(".palette-menu[open]").forEach(menu => {
    if (menu !== openingMenu) menu.open = false;
  });
});

function notice(message, error = false) {
  const box = byId("appNotice");
  if (box) {
    box.textContent = message;
    box.className = "authnotice" + (error ? " autherror" : "");
    box.hidden = false;
  } else {
    const toast = byId("toast");
    if (toast) { toast.textContent = message; toast.classList.add("on"); setTimeout(() => toast.classList.remove("on"), 2400); }
  }
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach(button => { if (button.dataset.busyButton === "true") button.disabled = value; });
}
function initials(name) { return String(name || "?").trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function membersFor(record) {
  const editors = Array.isArray(record.editorEmails) ? record.editorEmails : [];
  return [{ email: record.isOwner ? user?.email : "", name: record.isOwner ? "Você · dono" : "Dono", isOwner: true },
    ...editors.map(email => ({ email, name: email.split("@")[0], isOwner: false }))];
}
function avatars(members) {
  return '<div class="faces">' + members.slice(0, 4).map(member => '<span class="face" title="' + escapeHtml(member.name) + '">' + escapeHtml(initials(member.name)) + '</span>').join("") + (members.length > 4 ? '<span class="face more">+' + (members.length - 4) + '</span>' : '') + '</div>';
}
function showLogin(message = "") {
  stopRepertoirePresence();
  if (stopLiveSync) { stopLiveSync(); stopLiveSync = null; }
  clearTimeout(liveSyncTimer); liveSyncPending = false;
  activeId = null;
  data = [];
  viewingAccessLogs = false;
  byId("barInfo").textContent = "Entre para sincronizar seu repertório";
  appRoot.innerHTML = '<div class="authwrap"><section class="panel"><div class="eyebrow">REPERTÓRIO · ACESSO DA BANDA</div><h1>Entrar na sua conta</h1><p class="muted">Use um endereço @gmail.com, @hotmail.com ou @icloud.com e confirme-o pelo link enviado ao seu e-mail. As contas confirmadas podem visualizar; o dono libera a edição pelo e-mail.</p><div id="appNotice" class="authnotice"' + (message ? '' : ' hidden') + '>' + escapeHtml(message) + '</div><form id="loginForm"><input id="authEmail" type="email" autocomplete="email" placeholder="Seu e-mail" required><div class="password-field"><input id="authPassword" type="password" autocomplete="current-password" placeholder="Senha" required><button id="togglePassword" class="password-toggle" type="button" aria-label="Mostrar senha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button></div><div class="authactions"><button class="btn primary" type="submit" data-busy-button="true">Entrar</button><button class="btn" type="button" onclick="registerAccount()" data-busy-button="true">Criar conta</button></div><a id="resetPasswordLink" class="reset-password-link" href="#" onclick="resetAccountPassword(event)" hidden>Esqueci minha senha</a></form></section></div>';
  const emailField = byId("authEmail"), passwordField = byId("authPassword");
  const updateResetLink = () => {
    const email = normalized(emailField.value);
    const attempts = email ? Number(localStorage.getItem(loginAttemptStoragePrefix + email) || 0) : 0;
    byId("resetPasswordLink").hidden = attempts < 3;
  };
  emailField.addEventListener("input", updateResetLink);
  updateResetLink();
  byId("togglePassword").addEventListener("click", () => {
    const shouldShow = passwordField.type === "password";
    passwordField.type = shouldShow ? "text" : "password";
    byId("togglePassword").setAttribute("aria-label", shouldShow ? "Ocultar senha" : "Mostrar senha");
    byId("togglePassword").innerHTML = shouldShow
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 5.2A11 11 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.2 4.1"></path><path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4-.8"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });
  byId("loginForm").addEventListener("submit", event => { event.preventDefault(); loginAccount(); });
}
async function loginAccount() {
  if (busy) return;
  const email = normalized(byId("authEmail").value);
  setBusy(true);
  try {
    await FB.login(email, byId("authPassword").value);
    localStorage.removeItem(loginAttemptStoragePrefix + email);
  }
  catch (error) {
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(error?.code)) {
      const attempts = Number(localStorage.getItem(loginAttemptStoragePrefix + email) || 0) + 1;
      localStorage.setItem(loginAttemptStoragePrefix + email, String(attempts));
      byId("resetPasswordLink").hidden = attempts < 3;
      notice(attempts >= 3 ? "E-mail ou senha incorretos. Você pode recuperar sua senha pelo link abaixo." : friendlyError(error), true);
    } else notice(friendlyError(error), true);
  }
  finally { setBusy(false); }
}
async function registerAccount() {
  if (busy) return;
  setBusy(true);
  try {
    await FB.registerAccount(byId("authEmail").value, byId("authPassword").value);
    showLogin("Enviamos um link de confirmação para seu e-mail. Confirme o endereço e depois entre no site.");
  } catch (error) { notice(friendlyError(error), true); }
  finally { setBusy(false); }
}
async function resetAccountPassword(event) {
  event?.preventDefault();
  const email = byId("authEmail")?.value;
  if (!email) { notice("Digite seu e-mail no campo acima primeiro.", true); return; }
  try { await FB.resetPassword(email); notice("Enviamos um link para redefinir sua senha."); }
  catch (error) { notice(friendlyError(error), true); }
}
async function logoutUser() {
  stopRepertoirePresence();
  await FB.logout();
  user = null; data = []; activeId = null;
  showLogin("Você saiu da sua conta.");
}
function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Não encontrei uma conta com esse e-mail.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Entre em vez de criar outra.",
    "auth/weak-password": "Use uma senha com pelo menos 6 caracteres.",
    "auth/invalid-email": "Confira o formato do e-mail.",
    "auth/unsupported-email-domain": "Use um endereço @gmail.com, @hotmail.com ou @icloud.com.",
    "auth/email-not-verified": "Confirme seu e-mail pelo link de verificação enviado antes de entrar.",
    "auth/email-already-verified": "Este e-mail já está confirmado. Entre na sua conta.",
    "permission-denied": "O Firebase negou esta ação. Confira se você entrou na conta e se as regras do Firestore foram publicadas.",
    "unavailable": "O Firebase está temporariamente indisponível. Tente novamente."
  };
  return messages[code] || error?.message || "Não foi possível concluir. Tente novamente.";
}
async function reloadData() {
  if (!user) return;
  const docs = await FB.listRepertoires();
  let cleanedLegacyEmails = false;
  const preparedDocs = await Promise.all(docs.map(async item => {
    const itemIsOwner = item.ownerUid === user.uid || isSiteOwner();
    const needsCleanup = itemIsOwner && (
      Object.prototype.hasOwnProperty.call(item, "ownerEmail")
      || Object.prototype.hasOwnProperty.call(item, "memberEmails")
      || Object.prototype.hasOwnProperty.call(item, "editorEmails")
      || Object.prototype.hasOwnProperty.call(item, "editorUids")
      || item.publicRead !== true
    );
    if (needsCleanup) {
      await FB.secureLegacyRepertoire(item.id, item);
      cleanedLegacyEmails = true;
      return { ...item, publicRead: true };
    }
    return item;
  }));
  const loaded = await Promise.all(preparedDocs.map(async item => {
    const isOwner = item.ownerUid === user.uid || isSiteOwner();
    const editorEmails = isOwner ? await FB.listEditorAccess(item.id) : [];
    const canEdit = isOwner || await FB.hasEditorAccess(item.id);
    const songs = await FB.listSongs(item.id);
    const comments = isOwner ? await FB.listComments(item.id) : [];
    const observations = await FB.getRepertoireNotes(item.id);
    return {
      id: item.id,
      name: item.name || "Repertório sem nome",
      ownerUid: item.ownerUid,
      isOwner,
      canEdit,
      editorEmails,
      members: membersFor({ ...item, isOwner, editorEmails }),
      observations,
      songs: songs.map(song => ({ id: song.id, name: song.title, key: song.key || "—", body: song.body || "", bodyHtml: song.bodyHtml || "", order: song.order || 0 })),
      comments
    };
  }));
  data = loaded;
  if (cleanedLegacyEmails) setTimeout(() => notice("Removi os dados de acesso antigos. Reautorize os editores pelo e-mail confirmado."), 250);
  return loaded;
}
async function bootUser(authUser) {
  if (!authUser) {
    user = null;
    if (!byId("appNotice")) showLogin();
    return;
  }
  if (!authUser.emailVerified) {
    user = null;
    await FB.logout();
    showLogin("Confirme seu e-mail pelo link enviado. Depois volte e entre novamente.");
    return;
  }
  user = authUser;
  byId("barInfo").innerHTML = '<span class="userpill">' + escapeHtml(user.email) + '</span><button class="btn" style="padding:6px 9px;font-size:10px" onclick="logoutUser()">Sair</button>';
  appRoot.innerHTML = '<div class="loading">Carregando seus repertórios…</div>';
  try {
    await reloadData();
    startLiveSync();
    if (sharedRouteId) {
      const target = data.find(item => item.id === sharedRouteId);
      if (target) { openRep(target.id); return; }
      appRoot.innerHTML = '<div class="empty">Este repertório não foi encontrado. Entre em uma conta para visualizar os repertórios disponíveis.</div>';
      return;
    }
    renderHome();
  } catch (error) {
    appRoot.innerHTML = '<div class="empty">' + escapeHtml(friendlyError(error)) + '<br><button class="btn" style="margin-top:12px" onclick="refreshData()">Tentar novamente</button></div>';
  }
}
function startLiveSync() {
  if (stopLiveSync) stopLiveSync();
  stopLiveSync = FB.watchRepertoireChanges(error => {
    if (error) { console.warn("Atualização em tempo real:", error); return; }
    liveSyncPending = true;
    clearTimeout(liveSyncTimer);
    liveSyncTimer = setTimeout(flushLiveSync, 350);
  });
}
async function flushLiveSync() {
  if (!liveSyncPending || !user) return;
  if (editMode || byId("full")?.classList.contains("open") || byId("modalback")?.classList.contains("open") || byId("observationsText") === document.activeElement) return;
  liveSyncPending = false;
  try {
    await reloadData();
    if (activeId) renderDetail(); else renderHome();
  } catch (error) { console.warn("Não foi possível sincronizar em tempo real:", error); }
}
async function refreshData() {
  try { await reloadData(); renderHome(); }
  catch (error) { notice(friendlyError(error), true); }
}
function renderHome() {
  if (viewingAccessLogs) { renderAccessLogs(accessLogData); return; }
  activeId = null;
  appRoot.innerHTML = '<div class="heading"><div><div class="eyebrow">SEUS REPERTÓRIOS</div><h1>Bem-vindo, ' + escapeHtml(user?.displayName || user?.email?.split("@")[0] || "músico") + '</h1><p>Repertórios e cifras sincronizados com sua conta.</p></div><div class="authactions">' + (isSiteOwner() ? '<button class="btn" onclick="openAccessLogs()">Histórico de acessos</button><button class="btn primary" onclick="newRep()">＋ Novo repertório</button>' : '') + '</div></div><div class="cards" id="cards"></div>';
  const cards = byId("cards");
  if (!data.length) { cards.innerHTML = '<div class="empty">Você ainda não tem repertórios. Crie o primeiro para começar.</div>'; return; }
  data.forEach(record => {
    const card = document.createElement("article");
    card.className = "repcard";
    card.onclick = () => openRep(record.id);
    card.innerHTML = '<div class="rephead"><div><h2>' + escapeHtml(record.name) + '</h2><p>' + record.songs.length + ' músicas · visualização para contas confirmadas' + (record.isOwner ? ' · ' + record.editorEmails.length + ' editor(es)' : '') + '</p></div><span class="repicon">▤</span></div><div class="repfoot">' + avatars(record.members) + '<span class="statsmall">Abrir repertório →</span></div>';
    if (record.isOwner) {
      const del = document.createElement("button"); del.className = "delete-action"; del.textContent = "Apagar repertório";
      del.onclick = event => { event.stopPropagation(); confirmDeleteRep(record.id); };
      card.appendChild(del);
    }
    cards.appendChild(card);
  });
}
function openRep(id) {
  activeId = id;
  if (sharedRouteId && id !== sharedRouteId) return;
  const record = currentRep();
  if (record) FB.recordRepertoireAccess(record.id, record.name).catch(error => console.warn("Não foi possível registrar este acesso:", error));
  startRepertoirePresence(id);
  renderDetail();
}
async function openAccessLogs() {
  if (!isSiteOwner()) return;
  viewingAccessLogs = true;
  accessLogData = null;
  renderAccessLogs(null);
  try {
    accessLogData = await FB.listAccessLogs();
    if (viewingAccessLogs) renderAccessLogs(accessLogData);
  } catch (error) {
    accessLogData = { error: friendlyError(error) };
    if (viewingAccessLogs) renderAccessLogs(accessLogData);
  }
}
function renderAccessLogs(logs) {
  const rows = Array.isArray(logs) ? logs.map(item => {
    const date = item.accessedAt?.toDate ? item.accessedAt.toDate().toLocaleString("pt-BR") : "Registrando horário…";
    return '<article class="access-log-row" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #edf0eb"><div style="display:grid;gap:3px"><strong style="font-size:12px">' + escapeHtml(item.email || "Conta sem e-mail") + '</strong><span class="muted">' + escapeHtml(item.repertoireName || "Repertório") + '</span></div><time class="muted">' + escapeHtml(date) + '</time></article>';
  }).join("") : logs?.error ? '<div class="empty">' + escapeHtml(logs.error) + '</div>' : '<div class="loading">Carregando acessos…</div>';
  appRoot.innerHTML = '<div class="detailbar"><button class="back" onclick="closeAccessLogs()">← Repertórios</button></div><div class="heading"><div><div class="eyebrow">SOMENTE ADMINISTRADOR</div><h1>Histórico de acessos</h1><p>Repertório aberto, e-mail da conta e horário. Mostrando os 100 acessos mais recentes.</p></div><button class="btn" onclick="openAccessLogs()">Atualizar</button></div><section class="panel access-log-list">' + (Array.isArray(logs) && logs.length ? rows : Array.isArray(logs) ? '<div class="empty">Nenhum acesso registrado ainda.</div>' : rows) + '</section>';
}
function closeAccessLogs() {
  viewingAccessLogs = false;
  accessLogData = null;
  renderHome();
}
function startRepertoirePresence(repertoireId) {
  if (activePresenceId === repertoireId && activePresenceStop) return;
  stopRepertoirePresence();
  activePresenceId = repertoireId;
  activePresenceUsers = [];
  activePresenceStop = FB.watchRepertoirePresence(repertoireId, (users, error) => {
    if (error) {
      console.warn("Não foi possível atualizar quem está acessando o repertório:", error);
      const container = byId("presenceList");
      if (container) container.innerHTML = '<span class="muted">Presença ao vivo indisponível. Confira as regras publicadas no Firestore.</span>';
      return;
    }
    activePresenceUsers = users;
    renderPresence(users);
  });
}
function stopRepertoirePresence() {
  if (activePresenceStop) activePresenceStop();
  activePresenceStop = null;
  activePresenceId = null;
  activePresenceUsers = [];
}
function renderPresence(users) {
  const container = byId("presenceList");
  if (!container) return;
  if (!users.length) {
    container.innerHTML = '<span class="muted">Só você está acessando agora.</span>';
    return;
  }
  container.innerHTML = users.map(item => '<span class="presence-person"><i></i>' + escapeHtml(item.uid === user?.uid ? "Você" : item.name || "Integrante") + '</span>').join("");
}
function goHome() {
  if (sharedRouteId) return;
  stopRepertoirePresence();
  history.replaceState({}, "", location.pathname);
  renderHome();
}
function renderDetail() {
  const record = currentRep();
  if (!record) { renderHome(); return; }
  const owner = record.isOwner;
  const detailActions = owner ? '<button class="btn" onclick="openComments()">Comentários (' + record.comments.length + ')</button>' : '<button class="btn" onclick="openCommentForm()">Deixar comentário</button>';
  appRoot.innerHTML = '<div class="detailbar"><button class="back" onclick="goHome()">← ' + (sharedRouteId ? 'Acesso compartilhado' : 'Repertórios') + '</button><span class="spacer"></span>' + detailActions + '</div><div class="heading"><div><div class="eyebrow">' + (owner ? 'REPERTÓRIO DA BANDA' : 'REPERTÓRIO COMPARTILHADO') + '</div><h1>' + escapeHtml(record.name) + '</h1><p>' + record.songs.length + ' músicas · ' + (owner ? 'você é o dono' : record.canEdit ? 'você pode editar músicas e cifras' : 'somente leitura e comentários') + '</p></div><div class="heading-actions"><button class="btn primary" onclick="openReader()">▤ Ver em sequência</button></div></div><section class="panel presence-panel"><h2>Acessando agora</h2><div class="presence-list" id="presenceList"><span class="muted">Atualizando presença…</span></div></section><section class="panel"><h2>Músicas neste repertório</h2><p class="muted">Use as setas para definir a ordem em que as músicas aparecerão na folha contínua.</p><div class="songlist" id="songlist"></div></section><section class="panel observations-panel"><h2>Observações para os músicos</h2><p class="muted">Estas observações ficam visíveis para todos neste repertório.</p><textarea id="observationsText" class="observations-input" maxlength="5000" ' + (owner ? '' : 'readonly') + ' placeholder="' + (owner ? 'Escreva avisos para os músicos...' : 'Nenhuma observação cadastrada.') + '">' + escapeHtml(record.observations || '') + '</textarea><div class="observations-footer"><span class="muted">Até 5.000 caracteres</span>' + (owner ? '<button class="btn primary" onclick="saveObservations()">Salvar observações</button>' : '') + '</div></section><section class="panel"><h2>Acesso ao repertório</h2><p class="muted">Contas com e-mail confirmado podem visualizar. O dono libera a edição para e-mails específicos.</p><div class="memberline">' + avatars(record.members) + '<span class="muted">' + (owner ? record.editorEmails.length + ' editor(es)' : 'visualização compartilhada') + '</span>' + (owner ? '<button class="btn" onclick="shareRep()">Designar editor</button>' : '') + '</div></section>';
  const panels = [...appRoot.querySelectorAll(".panel")];
  const observationsPanel = panels.find(panel => panel.querySelector("h2")?.textContent.includes("Observações para os músicos"));
  const songsPanel = panels.find(panel => panel.querySelector("h2")?.textContent.includes("Músicas neste repertório"));
  const headingActions = appRoot.querySelector(".heading-actions");
  if (headingActions) {
    const pdfButton = document.createElement("button");
    pdfButton.className = "btn";
    pdfButton.type = "button";
    pdfButton.textContent = "⇩ Baixar PDF";
    pdfButton.onclick = downloadRepertoirePdf;
    headingActions.insertBefore(pdfButton, headingActions.firstChild);
  }
  if (observationsPanel && songsPanel) appRoot.insertBefore(observationsPanel, songsPanel);
  renderPresence(activePresenceUsers);
  const songsHeading = songsPanel?.querySelector("h2");
  if (songsHeading && record.canEdit) {
    const headingRow = document.createElement("div"); headingRow.className = "panel-title-row";
    songsHeading.parentNode.insertBefore(headingRow, songsHeading);
    headingRow.append(songsHeading);
    const addButton = document.createElement("button"); addButton.className = "btn primary"; addButton.textContent = "＋ Adicionar música"; addButton.onclick = addSong;
    headingRow.append(addButton);
  }
  const list = byId("songlist");
  if (!record.songs.length) list.innerHTML = '<div class="empty">Este repertório ainda não tem músicas.</div>';
  record.songs.forEach((song, index) => {
    const row = document.createElement("div"); row.className = "songitem";
    row.innerHTML = '<span class="songnum">' + String(index + 1).padStart(2, "0") + '</span><span class="disc">♫</span><div><strong>' + linkifyLeadingUrl(song.name) + '</strong><small>Tom: ' + escapeHtml(song.key) + '</small></div><div class="right">' + (owner ? '<button class="btn order-btn" aria-label="Mover ' + escapeHtml(song.name) + ' para cima" title="Mover para cima" ' + (index === 0 ? 'disabled' : '') + ' onclick="moveSong(' + index + ',-1)">↑</button><button class="btn order-btn" aria-label="Mover ' + escapeHtml(song.name) + ' para baixo" title="Mover para baixo" ' + (index === record.songs.length - 1 ? 'disabled' : '') + ' onclick="moveSong(' + index + ',1)">↓</button>' : '') + '<span class="tag">' + escapeHtml(song.key) + '</span>' + (record.canEdit ? '<button class="btn" onclick="editSong(' + index + ')">Editar</button>' : '') + (owner ? '<button class="btn danger" onclick="confirmDeleteSong(' + index + ')">Apagar</button>' : '') + '</div>';
    list.appendChild(row);
  });
}
async function refreshCurrent() {
  try { await reloadData(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function newRep() {
  if (sharedRouteId || !isSiteOwner()) return;
  openModal('<h2>Novo repertório</h2><p>Crie um repertório sincronizado com sua conta.</p><input id="repname" placeholder="Nome do repertório" maxlength="100"><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="createRep()">Criar repertório</button></div>');
}
async function createRep() {
  if (!isSiteOwner()) { notice("Somente o administrador do site pode criar repertórios.", true); return; }
  const name = byId("repname").value.trim(); if (!name) return;
  try { const id = await FB.createRepertoire(name); await reloadData(); closeModal(); openRep(id); }
  catch (error) { notice(friendlyError(error), true); }
}
function addSong() {
  if (!currentRep()?.canEdit) return;
  openModal('<h2>Adicionar música</h2><p>Letra e cifra vão ficar salvas no Firestore.</p><input id="songname" placeholder="Nome da música" maxlength="160"><input id="songkey" placeholder="Tom (ex.: G, Am, Bb)" maxlength="12"><textarea id="songbody" placeholder="[Intro] G D Em C\n\n[Verso]\n[ G ] Escreva a letra com os acordes entre colchetes..."></textarea><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveSong()">Adicionar</button></div>');
}
async function saveSong() {
  const record = currentRep(), name = byId("songname").value.trim(), body = byId("songbody").value.trim(); if (!name) return;
  try { await FB.addSong(record.id, { title: name, key: byId("songkey").value.trim() || "—", body, bodyHtml: plainToHtml(body) }); await refreshDataForCurrent(); closeModal(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function editSong(index) {
  if (!currentRep()?.canEdit) return;
  const song = currentRep().songs[index];
  openModal('<h2>Editar música</h2><p>O dono e os editores designados podem editar músicas e cifras.</p><input id="songname" value="' + escapeHtml(song.name) + '" maxlength="160"><input id="songkey" value="' + escapeHtml(song.key) + '" maxlength="12"><textarea id="songbody">' + escapeHtml(song.body) + '</textarea><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="updateSong(' + index + ')">Salvar</button></div>');
}
async function updateSong(index) {
  const record = currentRep(), song = record.songs[index], body = byId("songbody").value;
  try { await FB.updateSong(record.id, song.id, { title: byId("songname").value.trim() || song.name, key: byId("songkey").value.trim() || "—", body, bodyHtml: plainToHtml(body), order: index }); await refreshDataForCurrent(); closeModal(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function refreshDataForCurrent() {
  await reloadData();
  const queryRep = currentRep();
  if (!queryRep && activeId) activeId = null;
}
async function confirmDeleteRep(id) {
  const record = data.find(item => item.id === id);
  if (!record?.isOwner || !await window.siteConfirm('Apagar o repertório “' + record.name + '” e todas as músicas e comentários? Essa ação não pode ser desfeita.', 'Apagar repertório')) return;
  try { await FB.deleteRepertoire(id); await reloadData(); activeId = null; renderHome(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function confirmDeleteSong(index) {
  const record = currentRep(), song = record?.songs[index];
  if (!record?.isOwner || !song || !await window.siteConfirm('Apagar a música “' + song.name + '” deste repertório? Essa ação não pode ser desfeita.', 'Apagar música')) return;
  try { await FB.deleteSong(record.id, song.id); await refreshDataForCurrent(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function shareRep() {
  const record = currentRep(); if (!record?.isOwner) return;
  const members = record.editorEmails.map((email, index) => '<div class="person"><span class="face">' + escapeHtml(initials(email)) + '</span><div><div style="font-size:11px;font-weight:650">' + escapeHtml(email.split("@")[0]) + '</div><div class="email">' + escapeHtml(email) + '</div></div><button onclick="removeMemberByEmail(' + index + ')">Remover editor</button></div>').join("") || '<div class="muted">Nenhum editor designado ainda.</div>';
  openModal('<h2>Editar acesso · ' + escapeHtml(record.name) + '</h2><p>Contas com e-mail confirmado podem visualizar. Digite o e-mail confirmado para liberar edição das músicas e cifras. Só você pode apagar músicas/repertórios e designar editores.</p><input id="personemail" type="email" autocomplete="email" placeholder="E-mail confirmado do editor"><div class="modalfoot" style="justify-content:space-between"><button class="btn" onclick="copyLink()">Copiar link do repertório</button><button class="btn primary" onclick="invite()">Liberar edição</button></div><div class="linkbox" id="linkbox">A pessoa precisa confirmar este e-mail antes de usar a edição.</div><h3>Editores designados</h3><div class="sharelist">' + members + '</div>');
}
async function invite() {
  const record = currentRep(), email = normalized(byId("personemail").value);
  if (!email || !email.includes("@")) { notice("Digite um e-mail válido.", true); return; }
  if (email === normalized(user.email)) { notice("Seu e-mail já é o dono deste repertório.", true); return; }
  try { await FB.grantEditorAccess(record.id, email); await refreshDataForCurrent(); shareRep(); notice("Edição liberada para esse e-mail confirmado."); }
  catch (error) { notice(friendlyError(error), true); }
}
async function removeMemberByEmail(index) {
  const record = currentRep(), email = record?.editorEmails[index];
  if (!email || !await window.siteConfirm('Remover a permissão de edição de ' + email + '? A pessoa continuará podendo visualizar.', 'Remover editor')) return;
  try { await FB.revokeEditorAccess(record.id, email); await refreshDataForCurrent(); shareRep(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function moveSong(index, direction) {
  const record = currentRep();
  if (!record?.isOwner) return;
  const target = index + direction;
  if (target < 0 || target >= record.songs.length) return;
  const reordered = [...record.songs];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  try {
    await FB.reorderSongs(record.id, reordered);
    await refreshDataForCurrent(); renderDetail();
  } catch (error) { notice(friendlyError(error), true); }
}
async function copyLink() {
  const target = new URL(location.href); target.search = ""; target.searchParams.set("repertory", activeId);
  const link = target.href; byId("linkbox").textContent = link;
  try { await navigator.clipboard.writeText(link); notice("Link copiado. Qualquer pessoa com conta poderá visualizar o repertório."); }
  catch { notice("Link gerado. Selecione e copie o endereço exibido."); }
}
function openCommentForm() {
  openModal('<h2>Comentar no repertório</h2><p>O dono verá este comentário. Você não pode alterar músicas ou cifras.</p><textarea id="commentText" class="commentbox" placeholder="Escreva seu comentário" maxlength="5000"></textarea><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="submitComment()">Enviar comentário</button></div>');
}
async function submitComment() {
  const record = currentRep(), text = byId("commentText").value.trim(); if (!record || !text) { notice("Escreva um comentário antes de enviar.", true); return; }
  try { await FB.addComment(record.id, text, user.displayName || user.email.split("@")[0]); closeModal(); notice("Comentário enviado ao dono do repertório."); }
  catch (error) { notice(friendlyError(error), true); }
}
function openComments() {
  const record = currentRep(); if (!record?.isOwner) return;
  const rows = record.comments.length ? record.comments.map((comment, index) => {
    const date = comment.createdAt?.toDate ? comment.createdAt.toDate().toLocaleString("pt-BR") : "Agora";
    return '<div class="commentrow"><strong>' + escapeHtml(comment.authorName || comment.authorEmail) + '</strong><time>' + escapeHtml(date) + '</time><p>' + escapeHtml(comment.text) + '</p><button class="btn" onclick="markCommentRead(' + index + ')">' + (comment.reviewed ? 'Visto' : 'Marcar como visto') + '</button> <button class="btn danger" onclick="deleteComment(' + index + ')">Apagar comentário</button></div>';
  }).join("") : '<div class="empty">Ainda não há comentários.</div>';
  openModal('<h2>Comentários · ' + escapeHtml(record.name) + '</h2><p>Comentários enviados pelos integrantes deste repertório.</p><div>' + rows + '</div><div class="modalfoot"><button class="btn" onclick="closeModal()">Fechar</button></div>');
}
async function markCommentRead(index) {
  const record = currentRep(), comment = record?.comments[index]; if (!comment) return;
  try { await FB.reviewComment(record.id, comment.id, true); await refreshDataForCurrent(); openComments(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function deleteComment(index) {
  const record = currentRep(), comment = record?.comments[index]; if (!comment || !await window.siteConfirm("Apagar este comentário?", "Apagar comentário")) return;
  try { await FB.deleteComment(record.id, comment.id); await refreshDataForCurrent(); openComments(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function openModal(html) { byId("modal").removeAttribute("role"); byId("modal").removeAttribute("aria-modal"); byId("modal").innerHTML = html; byId("modalback").classList.add("open"); }
function closeModal() { if (window.siteConfirmPending?.()) { window.resolveSiteConfirm(false); return; } byId("modalback").classList.remove("open"); if (liveSyncPending) setTimeout(flushLiveSync, 50); }
async function saveObservations() {
  const record = currentRep(), field = byId("observationsText"); if (!record?.isOwner || !field) return;
  const text = field.value.slice(0, 5000);
  try {
    await FB.saveRepertoireNotes(record.id, text); record.observations = text;
    notice("Observações salvas para todos neste repertório.");
  } catch (error) { notice(friendlyError(error), true); }
}
function openReader() { openReaderNow(); }
function downloadRepertoirePdf() {
  const record = currentRep();
  if (!record) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    notice("Permita pop-ups para gerar o PDF.", true);
    return;
  }
  printWindow.opener = null;
  const songsHtml = record.songs.map((song, index) =>
    '<section class="song"><h2>' + (index + 1) + ". " + linkifyLeadingUrl(song.name) + '</h2><p class="key">Tom: ' + escapeHtml(song.key || "—") + '</p><div class="lyrics">' + FB.sanitizeSongHtml(song.bodyHtml || plainToHtml(song.body)) + "</div></section>"
  ).join("");
  const observationsHtml = record.observations
    ? '<section class="observations"><h2>Observações para os músicos</h2><p>' + escapeHtml(record.observations) + "</p></section>"
    : "";
  const safeTitle = escapeHtml(record.name);
  const filename = String(record.name || "repertorio").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "repertorio";
  printWindow.document.open();
  printWindow.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + filename + '</title><style>@page{size:A4;margin:16mm 15mm}*{box-sizing:border-box}body{color:#202e26;font:11pt/1.55 Georgia,"Times New Roman",serif;margin:0}h1{font:700 20pt/1.2 Arial,sans-serif;margin:0 0 5mm}h2{font:700 13pt/1.3 Arial,sans-serif;margin:0 0 2mm}.subtitle{font:10pt Arial,sans-serif;color:#66746a;margin:0 0 9mm}.song{margin:0 0 9mm;break-inside:avoid;page-break-inside:avoid}.key{font:9pt Arial,sans-serif;color:#66746a;margin:0 0 3mm}.lyrics{white-space:pre-wrap;overflow-wrap:anywhere}.lyrics>div{min-height:1.55em}.observations{border-top:1px solid #dce3dc;padding-top:6mm;margin-top:8mm;break-inside:avoid}.observations p{white-space:pre-wrap;margin:0}.marker{print-color-adjust:exact;-webkit-print-color-adjust:exact}.lyric-color-red{color:#b42318}.lyric-color-blue{color:#175cd3}.lyric-color-green{color:#18794e}.lyric-color-purple{color:#6941c6}.lyric-color-orange{color:#c4320a}.lyric-color-black{color:#26382e}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><h1>' + safeTitle + '</h1><p class="subtitle">' + record.songs.length + ' músicas</p>' + (songsHtml || '<p>Este repertório ainda não tem músicas.</p>') + observationsHtml + '</body></html>');
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 300);
}
function openReaderNow() {
  const record = currentRep(); if (!record) return;
  stopScroll();
  const paper = byId("paper"); paper.innerHTML = "";
  record.songs.forEach((song, index) => {
    const section = document.createElement("section"); section.className = "readsong";
    const title = document.createElement("h2"); title.innerHTML = "[ " + linkifyLeadingUrl(song.name) + " ]";
    const key = document.createElement("span"); key.textContent = "Tom: " + song.key; title.appendChild(key);
    const body = document.createElement("div"); body.className = "readbody"; body.innerHTML = FB.sanitizeSongHtml(song.bodyHtml || plainToHtml(song.body));
    section.append(title, body); paper.appendChild(section);
    if (index < record.songs.length - 1) { const gap = document.createElement("div"); gap.className = "readgap"; paper.appendChild(gap); }
  });
  byId("readCount").textContent = "· " + record.songs.length + " músicas · " + record.name;
  byId("area").scrollTop = 0; byId("editToggle").hidden = !record.canEdit;
  byId("editbar").style.display = "none"; editMode = false;
  byId("full").classList.add("open"); document.body.style.overflow = "hidden";
  syncReaderFont();
  byId("play").textContent = "▶ Iniciar rolagem";
}
function syncReaderFont() {
  const paper = byId("paper");
  if (readerFontSize === null) readerFontSize = Number.parseFloat(getComputedStyle(paper).fontSize) || 15;
  paper.style.fontSize = readerFontSize + "px";
  if (byId("fontSizeLabel")) byId("fontSizeLabel").textContent = Math.round(readerFontSize) + " px";
}
function changeReaderFont(amount) {
  if (readerFontSize === null) syncReaderFont();
  readerFontSize = Math.min(32, Math.max(12, readerFontSize + amount));
  syncReaderFont();
}
function plainToHtml(text) {
  const linkify = value => {
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    let html = "", lastIndex = 0, match;
    while ((match = urlPattern.exec(value))) {
      let url = match[0];
      let trailing = "";
      while (/[.,!?;:)]$/.test(url)) { trailing = url.slice(-1) + trailing; url = url.slice(0, -1); }
      html += escapeHtml(value.slice(lastIndex, match.index));
      if (url) {
        const href = escapeHtml(url);
        html += '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + "</a>";
      }
      html += escapeHtml(trailing);
      lastIndex = match.index + match[0].length;
    }
    return html + escapeHtml(value.slice(lastIndex));
  };
  return String(text || "").split(/\r?\n/).map(line => "<div>" + (line ? linkify(line) : "<br>") + "</div>").join("");
}
function closeReader() { stopScroll(); byId("full").classList.remove("open"); document.body.style.overflow = ""; if (liveSyncPending && !editMode) setTimeout(flushLiveSync, 50); }
function toggleEdit() {
  const record = currentRep(); if (!record?.canEdit) return;
  if (editMode) { saveReaderEdits(); return; }
  editMode = true; stopScroll(); document.querySelectorAll(".readbody").forEach(body => body.contentEditable = "true");
  byId("editbar").style.display = "flex"; byId("editToggle").textContent = "✎ Editando";
}
async function saveReaderEdits() {
  if (!editMode) return;
  const record = currentRep();
  if (!record?.canEdit) { editMode = false; notice("Você não tem permissão para editar este repertório.", true); return; }
  try {
    await Promise.all([...document.querySelectorAll(".readbody")].map((body, index) => {
      const song = record.songs[index]; body.innerHTML = FB.sanitizeSongHtml(body.innerHTML); song.bodyHtml = body.innerHTML; song.body = body.innerText;
      return FB.updateSong(record.id, song.id, { title: song.name, key: song.key, body: song.body, bodyHtml: song.bodyHtml, order: index });
    }));
    editMode = false; document.querySelectorAll(".readbody").forEach(body => body.contentEditable = "false");
    byId("editbar").style.display = "none"; byId("editToggle").textContent = "✎ Editar"; selectedRange = null;
    await reloadData(); notice("Letra, cifra e marcações salvas no Firebase.");
  } catch (error) { notice(friendlyError(error), true); }
}
function chooseColor(color, button) {
  markerColor = color; document.querySelectorAll(".swatch").forEach(item => item.classList.remove("selected"));
  if (button) { button.classList.add("selected"); button.closest("details")?.removeAttribute("open"); }
}
function applyHighlightColor(color, button) { chooseColor(color, button); applyHighlight(); }
function selectedTextRanges(editor, range) {
  const ranges = [], walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const length = textNode.textContent.length;
    if (!length) continue;
    const compareAt = offset => range.comparePoint(textNode, offset);
    if (compareAt(0) === 1 || compareAt(length) === -1) continue;
    let start = 0, end = length;
    if (compareAt(0) === -1) {
      let low = 0, high = length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (compareAt(middle) === -1) low = middle + 1; else high = middle;
      }
      start = low;
    }
    if (compareAt(length) === 1) {
      let low = 0, high = length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (compareAt(middle) === 1) high = middle - 1; else low = middle;
      }
      end = low;
    }
    if (end > start) {
      const part = document.createRange(); part.setStart(textNode, start); part.setEnd(textNode, end);
      ranges.push(part);
    }
  }
  return ranges;
}
function wrapSelectedText(className, backgroundColor = "") {
  if (!editMode || !selectedRange) { notice("Selecione um trecho com o mouse primeiro.", true); return; }
  const range = selectedRange.cloneRange(), node = range.startContainer;
  const editor = (node.nodeType === 1 ? node : node.parentElement)?.closest('.readbody[contenteditable="true"]');
  if (!editor || range.collapsed) { notice("Selecione um trecho de letra ou cifra.", true); return; }
  try {
    const textRanges = selectedTextRanges(editor, range);
    if (!textRanges.length) { notice("Não encontrei texto selecionado para formatar.", true); return; }
    const wrappers = [];
    for (const part of textRanges.reverse()) {
      const wrapper = document.createElement("span"); wrapper.className = className;
      if (backgroundColor) wrapper.style.backgroundColor = backgroundColor;
      wrapper.appendChild(part.extractContents()); part.insertNode(wrapper); wrappers.unshift(wrapper);
    }
    const selection = window.getSelection(); selection.removeAllRanges();
    const next = document.createRange(); next.setStartBefore(wrappers[0]); next.setEndAfter(wrappers[wrappers.length - 1]);
    selection.addRange(next); selectedRange = next.cloneRange();
  } catch { notice("Não consegui formatar esse trecho. Selecione-o novamente.", true); }
}
const textColorClasses = new Set(["lyric-color-red", "lyric-color-blue", "lyric-color-green", "lyric-color-purple", "lyric-color-orange", "lyric-color-black"]);
function applyTextColor(colorClass, button) {
  if (!textColorClasses.has(colorClass)) return;
  document.querySelectorAll(".text-color-swatch").forEach(item => item.classList.remove("selected"));
  if (button) { button.classList.add("selected"); button.closest("details")?.removeAttribute("open"); }
  wrapSelectedText(colorClass);
}
document.addEventListener("selectionchange", () => {
  if (!editMode) return;
  const selection = window.getSelection(); if (!selection?.rangeCount) return;
  if (selection.isCollapsed) return;
  const node = selection.anchorNode, element = node && (node.nodeType === 1 ? node : node.parentElement);
  if (element?.closest('.readbody[contenteditable="true"]')) selectedRange = selection.getRangeAt(0).cloneRange();
});
function applyHighlight() {
  wrapSelectedText("marker", markerColor);
}
function clearHighlights() {
  if (!editMode) return;
  document.querySelectorAll(".readbody .marker").forEach(mark => mark.replaceWith(...mark.childNodes));
  selectedRange = null; window.getSelection()?.removeAllRanges();
  notice("Marcações de cor removidas. Salve para guardar a alteração.");
}
function formatSelectedText(command) {
  const record = currentRep();
  if (!editMode || !record?.canEdit || !["bold", "italic"].includes(command) || !selectedRange || selectedRange.collapsed) {
    notice("Entre em Editar e selecione o trecho que deseja formatar.", true); return;
  }
  const range = selectedRange.cloneRange();
  const node = range.startContainer;
  const editor = (node.nodeType === 1 ? node : node.parentElement)?.closest('.readbody[contenteditable="true"]');
  if (!editor) { notice("Selecione o texto dentro da letra ou cifra.", true); return; }
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  const applied = document.execCommand(command, false, null);
  if (!applied && selection.rangeCount) {
    const wrapper = document.createElement(command === "bold" ? "strong" : "em");
    const selected = selection.getRangeAt(0);
    wrapper.appendChild(selected.extractContents()); selected.insertNode(wrapper);
    selection.removeAllRanges(); const next = document.createRange(); next.selectNodeContents(wrapper); selection.addRange(next);
  }
  if (selection.rangeCount) selectedRange = selection.getRangeAt(0).cloneRange();
}
function topScroll() { byId("area").scrollTo({ top: 0, behavior: "smooth" }); }
function toggleScroll() {
  if (scrollTimer !== null) { stopScroll(); return; }
  byId("play").textContent = "Ⅱ Pausar rolagem";
  scrollLastTime = 0;
  scrollRemainder = 0;
  if ("wakeLock" in navigator) navigator.wakeLock.request("screen").then(lock => { screenWakeLock = lock; }).catch(() => {});
  scrollTimer = setInterval(() => {
    if (!byId("full").classList.contains("open")) { stopScroll(); return; }
    const now = performance.now();
    if (!scrollLastTime) { scrollLastTime = now; return; }
    const elapsed = Math.min(now - scrollLastTime, 120);
    scrollLastTime = now;
    const area = byId("area");
    scrollRemainder += Number(byId("speed").value) * elapsed / 1000;
    const pixels = Math.floor(scrollRemainder);
    if (pixels > 0) {
      area.scrollTop = area.scrollTop + pixels;
      scrollRemainder -= pixels;
    }
    if (area.scrollTop + area.clientHeight >= area.scrollHeight - 1) stopScroll();
  }, 30);
}
function stopScroll() {
  if (scrollTimer !== null) { clearInterval(scrollTimer); scrollTimer = null; }
  scrollLastTime = 0; scrollRemainder = 0;
  if (screenWakeLock) { screenWakeLock.release().catch(() => {}); screenWakeLock = null; }
  if (byId("play")) byId("play").textContent = "▶ Iniciar rolagem";
}
Object.assign(window, {
  render: renderHome, renderDetail, openRep, goHome, refreshData, refreshCurrent,
  logoutUser, registerAccount, resetAccountPassword, newRep, createRep, addSong, saveSong,
  editSong, updateSong, confirmDeleteRep, confirmDeleteSong, shareRep, invite,
  removeMemberByEmail, moveSong, copyLink, openCommentForm, submitComment, openComments,
  markCommentRead, deleteComment, openModal, closeModal, openReader, downloadRepertoirePdf, closeReader,
  openAccessLogs, closeAccessLogs,
  toggleEdit, saveReaderEdits, chooseColor, applyHighlight, applyHighlightColor, clearHighlights,
  changeReaderFont, formatSelectedText, applyTextColor, topScroll, toggleScroll, saveObservations
});
window.addEventListener("error", event => console.error("Repertório:", event.message));
FB.watchAuth(authUser => {
  if (busy && authUser && !authUser.emailVerified) return;
  bootUser(authUser);
});




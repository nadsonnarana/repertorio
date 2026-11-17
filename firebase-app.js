import * as FB from "./firebase-client.js";

let user = null;
let data = [];
let activeId = null;
let busy = false;
let editMode = false;
let markerColor = "#fff2a8";
let selectedRange = null;
let scrollTimer = null;
const sharedRouteId = new URLSearchParams(location.search).get("repertory");
const appRoot = document.getElementById("app");
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const currentRep = () => data.find(item => item.id === activeId);
const normalized = value => String(value || "").trim().toLowerCase();

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
  const emails = Array.isArray(record.memberEmails) ? record.memberEmails : [];
  return emails.map(email => ({ email, name: email === normalized(user?.email) ? (user?.displayName || email.split("@")[0]) : email.split("@")[0] }));
}
function avatars(members) {
  return '<div class="faces">' + members.slice(0, 4).map(member => '<span class="face" title="' + escapeHtml(member.email) + '">' + escapeHtml(initials(member.name)) + '</span>').join("") + (members.length > 4 ? '<span class="face more">+' + (members.length - 4) + '</span>' : '') + '</div>';
}
function showLogin(message = "") {
  activeId = null;
  data = [];
  byId("barInfo").textContent = "Entre para sincronizar seu repertório";
  appRoot.innerHTML = '<div class="authwrap"><section class="panel"><div class="eyebrow">REPERTÓRIO · ACESSO DA BANDA</div><h1>Entrar na sua conta</h1><p class="muted">Use o e-mail autorizado pelo dono do repertório. A confirmação do e-mail é necessária para proteger o acesso.</p><div id="appNotice" class="authnotice"' + (message ? '' : ' hidden') + '>' + escapeHtml(message) + '</div><form id="loginForm"><input id="authEmail" type="email" autocomplete="email" placeholder="Seu e-mail" required><input id="authPassword" type="password" autocomplete="current-password" placeholder="Senha" required><div class="authactions"><button class="btn primary" type="submit" data-busy-button="true">Entrar</button><button class="btn" type="button" onclick="registerAccount()" data-busy-button="true">Criar conta</button><button class="btn" type="button" onclick="resetAccountPassword()">Esqueci a senha</button></div></form></section></div>';
  byId("loginForm").addEventListener("submit", event => { event.preventDefault(); loginAccount(); });
}
async function loginAccount() {
  if (busy) return;
  setBusy(true);
  try { await FB.login(byId("authEmail").value, byId("authPassword").value); }
  catch (error) { notice(friendlyError(error), true); }
  finally { setBusy(false); }
}
async function registerAccount() {
  if (busy) return;
  setBusy(true);
  try {
    await FB.registerAccount(byId("authEmail").value, byId("authPassword").value);
    await FB.logout();
    showLogin("Conta criada. Confira seu e-mail e clique no link de confirmação; depois volte aqui para entrar.");
  } catch (error) { notice(friendlyError(error), true); }
  finally { setBusy(false); }
}
async function resetAccountPassword() {
  const email = byId("authEmail")?.value;
  if (!email) { notice("Digite seu e-mail no campo acima primeiro.", true); return; }
  try { await FB.resetPassword(email); notice("Enviamos um link para redefinir sua senha."); }
  catch (error) { notice(friendlyError(error), true); }
}
async function logoutUser() {
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
    "permission-denied": "O Firebase negou esta ação. Confira se seu e-mail foi autorizado e se as regras do Firestore foram publicadas.",
    "unavailable": "O Firebase está temporariamente indisponível. Tente novamente."
  };
  return messages[code] || error?.message || "Não foi possível concluir. Tente novamente.";
}
async function reloadData() {
  if (!user) return;
  const docs = await FB.listRepertoires();
  const loaded = await Promise.all(docs.map(async item => {
    const isOwner = item.ownerUid === user.uid;
    const songs = await FB.listSongs(item.id);
    const comments = isOwner ? await FB.listComments(item.id) : [];
    return {
      id: item.id,
      name: item.name || "Repertório sem nome",
      ownerUid: item.ownerUid,
      isOwner,
      memberEmails: item.memberEmails || [],
      members: membersFor(item),
      songs: songs.map(song => ({ id: song.id, name: song.title, key: song.key || "—", body: song.body || "", bodyHtml: song.bodyHtml || "", order: song.order || 0 })),
      comments
    };
  }));
  data = loaded;
  return loaded;
}
async function bootUser(authUser) {
  user = authUser;
  if (!user) { showLogin(); return; }
  if (!user.emailVerified) { showLogin("Confirme o endereço de e-mail pelo link recebido antes de entrar."); return; }
  byId("barInfo").innerHTML = '<span class="userpill">' + escapeHtml(user.email) + '</span><button class="btn" style="padding:6px 9px;font-size:10px" onclick="logoutUser()">Sair</button>';
  appRoot.innerHTML = '<div class="loading">Carregando seus repertórios…</div>';
  try {
    await reloadData();
    if (sharedRouteId) {
      const target = data.find(item => item.id === sharedRouteId);
      if (target) { openRep(target.id); return; }
      appRoot.innerHTML = '<div class="empty">Este link não dá acesso a um repertório disponível para esta conta. Entre com o e-mail autorizado.</div>';
      return;
    }
    renderHome();
  } catch (error) {
    appRoot.innerHTML = '<div class="empty">' + escapeHtml(friendlyError(error)) + '<br><button class="btn" style="margin-top:12px" onclick="refreshData()">Tentar novamente</button></div>';
  }
}
async function refreshData() {
  try { await reloadData(); renderHome(); }
  catch (error) { notice(friendlyError(error), true); }
}
function renderHome() {
  activeId = null;
  appRoot.innerHTML = '<div class="heading"><div><div class="eyebrow">SEUS REPERTÓRIOS</div><h1>Bem-vindo, ' + escapeHtml(user?.displayName || user?.email?.split("@")[0] || "músico") + '</h1><p>Repertórios e cifras sincronizados com sua conta.</p></div><div class="authactions"><button class="btn" onclick="refreshData()">↻ Atualizar</button><button class="btn primary" onclick="newRep()">＋ Novo repertório</button></div></div><div class="cards" id="cards"></div>';
  const cards = byId("cards");
  if (!data.length) { cards.innerHTML = '<div class="empty">Você ainda não tem repertórios. Crie o primeiro para começar.</div>'; return; }
  data.forEach(record => {
    const card = document.createElement("article");
    card.className = "repcard";
    card.onclick = () => openRep(record.id);
    card.innerHTML = '<div class="rephead"><div><h2>' + escapeHtml(record.name) + '</h2><p>' + record.songs.length + ' músicas · ' + record.members.length + ' pessoas com acesso</p></div><span class="repicon">▤</span></div><div class="repfoot">' + avatars(record.members) + '<span class="statsmall">Abrir repertório →</span></div>';
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
  renderDetail();
}
function goHome() {
  if (sharedRouteId) return;
  history.replaceState({}, "", location.pathname);
  renderHome();
}
function renderDetail() {
  const record = currentRep();
  if (!record) { renderHome(); return; }
  const owner = record.isOwner;
  const detailActions = owner
    ? '<button class="btn" onclick="openComments()">Comentários (' + record.comments.length + ')</button><button class="btn" onclick="shareRep()">↗ Compartilhar acesso</button><button class="btn primary" onclick="addSong()">＋ Adicionar música</button><button class="btn danger" onclick="confirmDeleteRep(\'' + record.id + '\')">Apagar</button>'
    : '<button class="btn" onclick="openCommentForm()">Deixar comentário</button>';
  appRoot.innerHTML = '<div class="detailbar"><button class="back" onclick="goHome()">← ' + (sharedRouteId ? 'Acesso compartilhado' : 'Repertórios') + '</button><span class="spacer"></span><button class="btn" onclick="refreshCurrent()">↻ Atualizar</button>' + detailActions + '</div><div class="heading"><div><div class="eyebrow">' + (owner ? 'REPERTÓRIO DA BANDA' : 'REPERTÓRIO COMPARTILHADO') + '</div><h1>' + escapeHtml(record.name) + '</h1><p>' + record.songs.length + ' músicas · ' + (owner ? 'só você pode editar' : 'somente leitura e comentários') + '</p></div><button class="btn primary" onclick="openReader()">▤ Ver em sequência</button></div><section class="panel"><h2>Pessoas com acesso</h2><div class="memberline">' + avatars(record.members) + '<span class="muted">' + record.members.length + ' pessoas</span>' + (owner ? '<button class="btn" onclick="shareRep()">Adicionar pessoa</button>' : '') + '</div></section>' + (owner ? '<section class="panel"><h2>Ideias de acordes de ligação</h2><div class="muted">Escolha os tons de saída e chegada para gerar caminhos harmônicos.</div><div class="toolrow"><label class="field">Tom que termina<select id="from"></select></label><span style="padding-bottom:8px;color:#9aa49c">→</span><label class="field">Tom que começa<select id="to"></select></label><button class="btn primary" onclick="generate()">Gerar ideias</button></div><div class="result" id="result"></div></section>' : '') + '<section class="panel"><h2>Músicas neste repertório</h2><div class="songlist" id="songlist"></div></section>';
  const list = byId("songlist");
  if (!record.songs.length) list.innerHTML = '<div class="empty">Este repertório ainda não tem músicas.</div>';
  record.songs.forEach((song, index) => {
    const row = document.createElement("div"); row.className = "songitem";
    row.innerHTML = '<span class="songnum">' + String(index + 1).padStart(2, "0") + '</span><span class="disc">♫</span><div><strong>' + escapeHtml(song.name) + '</strong><small>Tom: ' + escapeHtml(song.key) + '</small></div><div class="right"><span class="tag">' + escapeHtml(song.key) + '</span>' + (owner ? '<button class="btn" onclick="editSong(' + index + ')">Editar</button><button class="btn danger" onclick="confirmDeleteSong(' + index + ')">Apagar</button>' : '') + '</div>';
    list.appendChild(row);
  });
  if (owner) initGenerator(record);
}
async function refreshCurrent() {
  try { await reloadData(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function newRep() {
  if (sharedRouteId) return;
  openModal('<h2>Novo repertório</h2><p>Crie um repertório sincronizado com sua conta.</p><input id="repname" placeholder="Nome do repertório" maxlength="100"><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="createRep()">Criar repertório</button></div>');
}
async function createRep() {
  const name = byId("repname").value.trim(); if (!name) return;
  try { const id = await FB.createRepertoire(name); await reloadData(); closeModal(); openRep(id); }
  catch (error) { notice(friendlyError(error), true); }
}
function addSong() {
  openModal('<h2>Adicionar música</h2><p>Letra e cifra vão ficar salvas no Firestore.</p><input id="songname" placeholder="Nome da música" maxlength="160"><input id="songkey" placeholder="Tom (ex.: G, Am, Bb)" maxlength="12"><textarea id="songbody" placeholder="[Intro] G D Em C\n\n[Verso]\n[ G ] Escreva a letra com os acordes entre colchetes..."></textarea><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveSong()">Adicionar</button></div>');
}
async function saveSong() {
  const record = currentRep(), name = byId("songname").value.trim(); if (!name) return;
  try { await FB.addSong(record.id, { title: name, key: byId("songkey").value.trim() || "—", body: byId("songbody").value.trim() }); await refreshDataForCurrent(); closeModal(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function editSong(index) {
  const song = currentRep().songs[index];
  openModal('<h2>Editar música</h2><p>Somente o dono do repertório pode editar.</p><input id="songname" value="' + escapeHtml(song.name) + '" maxlength="160"><input id="songkey" value="' + escapeHtml(song.key) + '" maxlength="12"><textarea id="songbody">' + escapeHtml(song.body) + '</textarea><div class="modalfoot"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="updateSong(' + index + ')">Salvar</button></div>');
}
async function updateSong(index) {
  const record = currentRep(), song = record.songs[index];
  try { await FB.updateSong(record.id, song.id, { title: byId("songname").value.trim() || song.name, key: byId("songkey").value.trim() || "—", body: byId("songbody").value, bodyHtml: song.bodyHtml || "", order: index }); await refreshDataForCurrent(); closeModal(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function refreshDataForCurrent() {
  await reloadData();
  const queryRep = currentRep();
  if (!queryRep && activeId) activeId = null;
}
async function confirmDeleteRep(id) {
  const record = data.find(item => item.id === id);
  if (!record?.isOwner || !confirm('Apagar o repertório “' + record.name + '” e todas as músicas e comentários? Essa ação não pode ser desfeita.')) return;
  try { await FB.deleteRepertoire(id); await reloadData(); activeId = null; renderHome(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function confirmDeleteSong(index) {
  const record = currentRep(), song = record?.songs[index];
  if (!record?.isOwner || !song || !confirm('Apagar a música “' + song.name + '” deste repertório? Essa ação não pode ser desfeita.')) return;
  try { await FB.deleteSong(record.id, song.id); await refreshDataForCurrent(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function shareRep() {
  const record = currentRep(); if (!record?.isOwner) return;
  const members = record.members.map((member, index) => '<div class="person"><span class="face">' + escapeHtml(initials(member.name)) + '</span><div><div style="font-size:11px;font-weight:650">' + escapeHtml(member.name) + '</div><div class="email">' + escapeHtml(member.email) + '</div></div>' + (normalized(member.email) === normalized(user.email) ? '<span class="email">Dono</span>' : '<button onclick="removeMemberByEmail(' + index + ')">Remover</button>') + '</div>').join('');
  openModal('<h2>Compartilhar ' + escapeHtml(record.name) + '</h2><p>Autorize pelo e-mail usado na conta Firebase. Integrantes poderão ler e comentar, sem editar cifras.</p><input id="personemail" type="email" placeholder="E-mail do integrante"><div class="modalfoot" style="justify-content:space-between"><button class="btn" onclick="copyLink()">Copiar link deste repertório</button><button class="btn primary" onclick="invite()">Adicionar acesso</button></div><div class="linkbox" id="linkbox">O link só funcionará para um e-mail autorizado e confirmado.</div><div class="sharelist">' + members + '</div>');
}
async function invite() {
  const record = currentRep(), email = normalized(byId("personemail").value);
  if (!email || !email.includes("@")) { notice("Digite um endereço de e-mail válido.", true); return; }
  try { await FB.grantRepertoireAccess(record.id, email); await refreshDataForCurrent(); shareRep(); notice("Acesso autorizado. Envie o link ao integrante; ele precisa criar uma conta com esse e-mail e confirmar o endereço."); }
  catch (error) { notice(friendlyError(error), true); }
}
async function removeMemberByEmail(index) {
  const record = currentRep(), member = record.members[index];
  if (!member || normalized(member.email) === normalized(user.email)) return;
  if (!confirm('Remover o acesso de ' + member.email + '?')) return;
  try { await FB.revokeRepertoireAccess(record.id, member.email); await refreshDataForCurrent(); shareRep(); }
  catch (error) { notice(friendlyError(error), true); }
}
async function copyLink() {
  const target = new URL(location.href); target.search = ""; target.searchParams.set("repertory", activeId);
  const link = target.href; byId("linkbox").textContent = link;
  try { await navigator.clipboard.writeText(link); notice("Link copiado. Só contas com e-mail autorizado poderão abrir."); }
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
  const record = currentRep(), comment = record?.comments[index]; if (!comment || !confirm("Apagar este comentário?")) return;
  try { await FB.deleteComment(record.id, comment.id); await refreshDataForCurrent(); openComments(); renderDetail(); }
  catch (error) { notice(friendlyError(error), true); }
}
function openModal(html) { byId("modal").innerHTML = html; byId("modalback").classList.add("open"); }
function closeModal() { byId("modalback").classList.remove("open"); }
function openReader() {
  const record = currentRep(); if (!record) return;
  const paper = byId("paper"); paper.innerHTML = "";
  record.songs.forEach((song, index) => {
    const section = document.createElement("section"); section.className = "readsong";
    const title = document.createElement("h2"); title.textContent = "[ " + song.name + " ]";
    const key = document.createElement("span"); key.textContent = "Tom: " + song.key; title.appendChild(key);
    const body = document.createElement("div"); body.className = "readbody"; body.innerHTML = song.bodyHtml || plainToHtml(song.body);
    section.append(title, body); paper.appendChild(section);
    if (index < record.songs.length - 1) { const gap = document.createElement("div"); gap.className = "readgap"; paper.appendChild(gap); }
  });
  byId("readCount").textContent = "· " + record.songs.length + " músicas · " + record.name;
  byId("area").scrollTop = 0; byId("editToggle").hidden = !record.isOwner;
  byId("editbar").style.display = "none"; editMode = false;
  byId("full").classList.add("open"); document.body.style.overflow = "hidden";
  setTimeout(() => { if (byId("full").classList.contains("open") && !scrollTimer) toggleScroll(); }, 450);
}
function plainToHtml(text) { return String(text || "").split(/\r?\n/).map(line => "<div>" + (line ? escapeHtml(line) : "<br>") + "</div>").join(""); }
function closeReader() { stopScroll(); byId("full").classList.remove("open"); document.body.style.overflow = ""; }
function toggleEdit() {
  const record = currentRep(); if (!record?.isOwner) return;
  if (editMode) { saveReaderEdits(); return; }
  editMode = true; stopScroll(); document.querySelectorAll(".readbody").forEach(body => body.contentEditable = "true");
  byId("editbar").style.display = "flex"; byId("editToggle").textContent = "✎ Editando";
}
async function saveReaderEdits() {
  if (!editMode) return;
  const record = currentRep();
  try {
    await Promise.all([...document.querySelectorAll(".readbody")].map((body, index) => {
      const song = record.songs[index]; song.bodyHtml = body.innerHTML; song.body = body.innerText;
      return FB.updateSong(record.id, song.id, { title: song.name, key: song.key, body: song.body, bodyHtml: song.bodyHtml, order: index });
    }));
    editMode = false; document.querySelectorAll(".readbody").forEach(body => body.contentEditable = "false");
    byId("editbar").style.display = "none"; byId("editToggle").textContent = "✎ Editar"; selectedRange = null;
    await reloadData(); notice("Letra, cifra e marcações salvas no Firebase.");
  } catch (error) { notice(friendlyError(error), true); }
}
function chooseColor(color, button) {
  markerColor = color; document.querySelectorAll(".swatch").forEach(item => item.classList.remove("selected"));
  if (button) button.classList.add("selected");
}
function applyHighlightColor(color, button) { chooseColor(color, button); applyHighlight(); }
document.addEventListener("selectionchange", () => {
  if (!editMode) return;
  const selection = window.getSelection(); if (!selection?.rangeCount) return;
  const node = selection.anchorNode, element = node && (node.nodeType === 1 ? node : node.parentElement);
  if (element?.closest('.readbody[contenteditable="true"]')) selectedRange = selection.getRangeAt(0).cloneRange();
});
function applyHighlight() {
  if (!editMode || !selectedRange) { notice("Selecione um trecho com o mouse e escolha uma cor.", true); return; }
  const range = selectedRange.cloneRange(), node = range.startContainer;
  const editor = (node.nodeType === 1 ? node : node.parentElement)?.closest('.readbody[contenteditable="true"]');
  if (!editor || range.collapsed) { notice("Selecione um trecho de letra ou cifra com o mouse.", true); return; }
  try {
    const mark = document.createElement("span"); mark.className = "marker"; mark.style.backgroundColor = markerColor;
    mark.appendChild(range.extractContents()); range.insertNode(mark);
    const selection = window.getSelection(); selection.removeAllRanges(); const next = document.createRange(); next.selectNodeContents(mark); selection.addRange(next); selectedRange = next.cloneRange();
  } catch { notice("Selecione o trecho dentro de uma única linha.", true); }
}
function topScroll() { byId("area").scrollTo({ top: 0, behavior: "smooth" }); }
function toggleScroll() {
  if (scrollTimer) { stopScroll(); return; }
  byId("play").textContent = "Ⅱ Pausar";
  const speed = Number(byId("speed").value);
  scrollTimer = setInterval(() => { const area = byId("area"); area.scrollTop += speed / 20; if (area.scrollTop + area.clientHeight >= area.scrollHeight - 1) stopScroll(); }, 50);
}
function stopScroll() { if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; } if (byId("play")) byId("play").textContent = "▶ Iniciar rolagem"; }
function initGenerator(record) {
  if (!window.generate || !byId("from")) return;
  const keys = ["C","C#","Db","D","Eb","E","F","F#","G","Ab","A","Bb","B","Am","Bbm","Bm","Cm","C#m","Dm","Ebm","Em","Fm","F#m","Gm","G#m"];
  ["from", "to"].forEach(id => { const select = byId(id); keys.forEach(key => { const option = document.createElement("option"); option.value = key; option.textContent = key; select.appendChild(option); }); });
  byId("from").value = keys.includes(record.songs.at(-1)?.key) ? record.songs.at(-1).key : "G";
  byId("to").value = keys.includes(record.songs[0]?.key) ? record.songs[0].key : "D";
  window.generate();
}

Object.assign(window, {
  render: renderHome, renderDetail, openRep, goHome, refreshData, refreshCurrent,
  logoutUser, registerAccount, resetAccountPassword, newRep, createRep, addSong, saveSong,
  editSong, updateSong, confirmDeleteRep, confirmDeleteSong, shareRep, invite,
  removeMemberByEmail, copyLink, openCommentForm, submitComment, openComments,
  markCommentRead, deleteComment, openModal, closeModal, openReader, closeReader,
  toggleEdit, saveReaderEdits, chooseColor, applyHighlight, applyHighlightColor,
  topScroll, toggleScroll
});
window.addEventListener("error", event => console.error("Repertório:", event.message));
FB.watchAuth(authUser => { bootUser(authUser); });


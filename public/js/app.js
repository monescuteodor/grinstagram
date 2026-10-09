"use strict";

/* ============================================================
   Grinstagram - frontend SPA (vanilla JS)
   ============================================================ */

const state = { me: null };

const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");
const modalRoot = document.getElementById("modal-root");

/* ---------- API helper ---------- */
async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (form) {
    opts.body = form; // FormData: let the browser set the boundary
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Eroare de retea.");
  return data;
}

/* ---------- Small utils ---------- */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function toast(msg) {
  const t = el(`<div class="toast">${escapeHtml(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function timeAgo(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "acum " + s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return "acum " + m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return "acum " + h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return "acum " + d + "z";
  const w = Math.floor(d / 7);
  if (w < 5) return "acum " + w + " sapt";
  return new Date(then).toLocaleDateString("ro-RO");
}

function avatarHtml(user, size) {
  const letter = (user.username || "?").charAt(0);
  const inner = user.avatar
    ? `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.username)}" />`
    : escapeHtml(letter);
  return `<span class="avatar ${size}">${inner}</span>`;
}

/* ---------- Post card ---------- */
function postCard(post) {
  const card = el(`
    <article class="card" data-id="${post.id}">
      <div class="card-head">
        <a href="#/u/${encodeURIComponent(post.author.username)}">${avatarHtml(post.author, "sm")}</a>
        <a href="#/u/${encodeURIComponent(post.author.username)}" class="username">${escapeHtml(post.author.username)}</a>
        ${post.mine ? '<button class="menu icon-btn js-del" title="Sterge">🗑</button>' : ""}
      </div>
      <img class="card-img" src="${escapeHtml(post.image)}" alt="postare" />
      <div class="card-actions">
        <button class="like ${post.likedByMe ? "active" : ""} js-like">${post.likedByMe ? "❤️" : "🤍"}</button>
        <button class="js-open-comments" title="Comentarii">💬</button>
      </div>
      <div class="card-body">
        <div class="likes js-likecount">${post.likeCount} aprecieri</div>
        ${
          post.caption
            ? `<div class="caption"><a class="username" href="#/u/${encodeURIComponent(
                post.author.username
              )}">${escapeHtml(post.author.username)}</a>${escapeHtml(post.caption)}</div>`
            : ""
        }
        <button class="view-comments js-open-comments">Vezi toate comentariile (${post.commentCount})</button>
        <div class="time">${timeAgo(post.createdAt)}</div>
      </div>
      <form class="comment-form js-comment-form">
        <input type="text" placeholder="Adauga un comentariu…" maxlength="1000" />
        <button type="submit" disabled>Posteaza</button>
      </form>
    </article>
  `);

  // Like
  card.querySelector(".js-like").addEventListener("click", async (e) => {
    try {
      const r = await api(`/api/posts/${post.id}/like`, { method: "POST" });
      const btn = e.currentTarget;
      btn.classList.toggle("active", r.liked);
      btn.textContent = r.liked ? "❤️" : "🤍";
      card.querySelector(".js-likecount").textContent = r.likeCount + " aprecieri";
    } catch (err) {
      toast(err.message);
    }
  });

  // Delete
  const delBtn = card.querySelector(".js-del");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      if (!confirm("Stergi aceasta postare?")) return;
      try {
        await api(`/api/posts/${post.id}`, { method: "DELETE" });
        card.remove();
        toast("Postare stearsa.");
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // Open comments
  card
    .querySelectorAll(".js-open-comments")
    .forEach((b) => b.addEventListener("click", () => openPostModal(post.id)));

  // Inline comment
  const form = card.querySelector(".js-comment-form");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  input.addEventListener("input", () => (submit.disabled = !input.value.trim()));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    try {
      await api(`/api/posts/${post.id}/comments`, { method: "POST", body: { body } });
      input.value = "";
      submit.disabled = true;
      const link = card.querySelector(".view-comments");
      post.commentCount += 1;
      link.textContent = `Vezi toate comentariile (${post.commentCount})`;
      toast("Comentariu adaugat.");
    } catch (err) {
      toast(err.message);
    }
  });

  return card;
}

/* ---------- Views ---------- */
async function viewFeed() {
  appEl.innerHTML = '<div class="loader">Se incarca feed-ul…</div>';
  const { posts } = await api("/api/feed");
  if (!posts.length) {
    appEl.innerHTML = `
      <div class="empty">
        <h2>Feed gol 👋</h2>
        <p>Urmareste utilizatori din <a class="link" href="#/explore">Explore</a>
        sau creeaza prima ta postare cu butonul ➕.</p>
      </div>`;
    return;
  }
  const feed = el('<div class="feed"></div>');
  posts.forEach((p) => feed.appendChild(postCard(p)));
  appEl.innerHTML = "";
  appEl.appendChild(feed);
}

async function viewExplore() {
  appEl.innerHTML = '<div class="loader">Se incarca…</div>';
  const { posts } = await api("/api/explore");
  if (!posts.length) {
    appEl.innerHTML = `<div class="empty"><h2>Inca nu exista postari</h2><p>Fii primul care posteaza ceva!</p></div>`;
    return;
  }
  const grid = el('<div class="grid"></div>');
  posts.forEach((p) => {
    const tile = el(`
      <div class="tile" role="button" tabindex="0">
        <img src="${escapeHtml(p.image)}" alt="postare" />
        <div class="overlay"><span>❤️ ${p.likeCount}</span><span>💬 ${p.commentCount}</span></div>
      </div>`);
    tile.addEventListener("click", () => openPostModal(p.id));
    grid.appendChild(tile);
  });
  appEl.innerHTML = "<h2 style='margin:0 0 16px'>Explore</h2>";
  appEl.appendChild(grid);
}

async function viewProfile(username) {
  appEl.innerHTML = '<div class="loader">Se incarca profilul…</div>';
  let data;
  try {
    data = await api("/api/users/" + encodeURIComponent(username));
  } catch (err) {
    appEl.innerHTML = `<div class="empty"><h2>404</h2><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }
  const { user, counts, isMe, isFollowing, posts } = data;

  const head = el(`
    <div class="profile-head">
      ${avatarHtml(user, "lg")}
      <div class="profile-info">
        <div class="profile-top">
          <h2>${escapeHtml(user.username)}</h2>
          <div class="profile-top-actions"></div>
        </div>
        <div class="profile-stats">
          <span><b>${counts.posts}</b> postari</span>
          <span><b class="js-followers">${counts.followers}</b> urmaritori</span>
          <span><b>${counts.following}</b> urmaresti</span>
        </div>
        <div class="profile-bio">
          <div class="name">${escapeHtml(user.fullName || "")}</div>
          <div>${escapeHtml(user.bio || "")}</div>
        </div>
      </div>
    </div>
  `);

  const actions = head.querySelector(".profile-top-actions");
  if (isMe) {
    const edit = el('<button class="btn btn-outline">Editeaza profilul</button>');
    edit.addEventListener("click", openEditProfileModal);
    actions.appendChild(edit);
  } else if (state.me) {
    const btn = el(
      `<button class="btn ${isFollowing ? "btn-outline" : "btn-primary"}">${
        isFollowing ? "Urmaresti" : "Urmareste"
      }</button>`
    );
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/api/users/${encodeURIComponent(user.username)}/follow`, {
          method: "POST",
        });
        btn.textContent = r.following ? "Urmaresti" : "Urmareste";
        btn.classList.toggle("btn-primary", !r.following);
        btn.classList.toggle("btn-outline", r.following);
        head.querySelector(".js-followers").textContent = r.followers;
      } catch (err) {
        toast(err.message);
      }
    });
    actions.appendChild(btn);
  }

  appEl.innerHTML = "";
  appEl.appendChild(head);

  if (!posts.length) {
    appEl.appendChild(el('<div class="empty"><p>Nicio postare inca.</p></div>'));
    return;
  }
  const grid = el('<div class="grid"></div>');
  posts.forEach((p) => {
    const tile = el(`
      <div class="tile" role="button" tabindex="0">
        <img src="${escapeHtml(p.image)}" alt="postare" />
        <div class="overlay"><span>❤️ ${p.likeCount}</span><span>💬 ${p.commentCount}</span></div>
      </div>`);
    tile.addEventListener("click", () => openPostModal(p.id));
    grid.appendChild(tile);
  });
  appEl.appendChild(grid);
}

/* ---------- Post detail modal ---------- */
function closeModal() {
  modalRoot.innerHTML = "";
}

function mountModal(node) {
  const backdrop = el('<div class="modal-backdrop"></div>');
  backdrop.appendChild(node);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  modalRoot.innerHTML = "";
  modalRoot.appendChild(backdrop);
}

async function openPostModal(id) {
  const { post, comments } = await api("/api/posts/" + id);
  const modal = el(`
    <div class="modal">
      <div class="modal-head">${escapeHtml(post.author.username)}<button class="close">✕</button></div>
      <img class="card-img" src="${escapeHtml(post.image)}" alt="postare" />
      <div class="modal-body">
        <div class="card-head" style="padding:0 0 12px">
          <a href="#/u/${encodeURIComponent(post.author.username)}">${avatarHtml(post.author, "sm")}</a>
          <a href="#/u/${encodeURIComponent(post.author.username)}" class="username">${escapeHtml(post.author.username)}</a>
          <span style="margin-left:6px;color:var(--muted)">${timeAgo(post.createdAt)}</span>
        </div>
        ${
          post.caption
            ? `<div class="comment-row"><b>${escapeHtml(post.author.username)}</b>&nbsp;${escapeHtml(
                post.caption
              )}</div>`
            : ""
        }
        <div class="js-comments"></div>
      </div>
      <form class="comment-form js-comment-form">
        <input type="text" placeholder="Adauga un comentariu…" maxlength="1000" />
        <button type="submit" disabled>Posteaza</button>
      </form>
    </div>
  `);

  const list = modal.querySelector(".js-comments");
  function addComment(c) {
    list.appendChild(
      el(
        `<div class="comment-row">${avatarHtml(c, "sm")}<div class="body"><a class="username" href="#/u/${encodeURIComponent(
          c.username
        )}">${escapeHtml(c.username)}</a>${escapeHtml(c.body)}<div class="time" style="color:var(--muted);font-size:11px">${timeAgo(
          c.createdAt
        )}</div></div></div>`
      )
    );
  }
  if (!comments.length) {
    list.appendChild(el('<p style="color:var(--muted)">Niciun comentariu inca.</p>'));
  } else {
    comments.forEach(addComment);
  }

  modal.querySelector(".close").addEventListener("click", closeModal);

  const form = modal.querySelector(".js-comment-form");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  if (!state.me) {
    input.disabled = true;
    input.placeholder = "Autentifica-te ca sa comentezi";
  }
  input.addEventListener("input", () => (submit.disabled = !input.value.trim()));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    try {
      const r = await api(`/api/posts/${id}/comments`, { method: "POST", body: { body } });
      if (list.querySelector("p")) list.innerHTML = "";
      addComment(r.comment);
      input.value = "";
      submit.disabled = true;
    } catch (err) {
      toast(err.message);
    }
  });

  mountModal(modal);
}

/* ---------- New post modal ---------- */
function openNewPostModal() {
  const modal = el(`
    <div class="modal">
      <div class="modal-head">Creeaza o postare noua<button class="close">✕</button></div>
      <div class="modal-body">
        <div class="dropzone js-drop">📷<br />Apasa pentru a alege o imagine</div>
        <img class="preview" hidden />
        <input type="file" accept="image/*" hidden class="js-file" />
        <label>Descriere</label>
        <textarea class="js-caption" maxlength="2200" placeholder="Scrie o descriere…"></textarea>
        <button class="btn btn-primary btn-block js-share" style="margin-top:16px" disabled>Distribuie</button>
      </div>
    </div>
  `);

  const drop = modal.querySelector(".js-drop");
  const file = modal.querySelector(".js-file");
  const preview = modal.querySelector(".preview");
  const share = modal.querySelector(".js-share");

  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files[0];
    if (!f) return;
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
    drop.hidden = true;
    share.disabled = false;
  });

  modal.querySelector(".close").addEventListener("click", closeModal);

  share.addEventListener("click", async () => {
    if (!file.files[0]) return;
    const form = new FormData();
    form.append("image", file.files[0]);
    form.append("caption", modal.querySelector(".js-caption").value);
    share.disabled = true;
    share.textContent = "Se distribuie…";
    try {
      await api("/api/posts", { method: "POST", form });
      closeModal();
      toast("Postare publicata! 🎉");
      if ((location.hash || "").startsWith("#/feed") || !location.hash) viewFeed();
      else location.hash = "#/feed";
    } catch (err) {
      toast(err.message);
      share.disabled = false;
      share.textContent = "Distribuie";
    }
  });

  mountModal(modal);
}

/* ---------- Edit profile modal ---------- */
function openEditProfileModal() {
  const me = state.me;
  const modal = el(`
    <div class="modal">
      <div class="modal-head">Editeaza profilul<button class="close">✕</button></div>
      <div class="modal-body">
        <div style="text-align:center;margin-bottom:12px">${avatarHtml(me, "lg")}</div>
        <button class="btn btn-outline btn-block js-pick-avatar">Schimba poza de profil</button>
        <input type="file" accept="image/*" hidden class="js-avatar" />
        <label>Nume complet</label>
        <input type="text" class="js-fullname" maxlength="60" value="${escapeHtml(me.fullName || "")}" />
        <label>Bio</label>
        <textarea class="js-bio" maxlength="300">${escapeHtml(me.bio || "")}</textarea>
        <button class="btn btn-primary btn-block js-save" style="margin-top:16px">Salveaza</button>
      </div>
    </div>
  `);

  const avatarInput = modal.querySelector(".js-avatar");
  modal.querySelector(".js-pick-avatar").addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", () => {
    const f = avatarInput.files[0];
    if (f) {
      const av = modal.querySelector(".avatar");
      av.innerHTML = `<img src="${URL.createObjectURL(f)}" />`;
    }
  });

  modal.querySelector(".close").addEventListener("click", closeModal);

  modal.querySelector(".js-save").addEventListener("click", async (e) => {
    const form = new FormData();
    form.append("fullName", modal.querySelector(".js-fullname").value);
    form.append("bio", modal.querySelector(".js-bio").value);
    if (avatarInput.files[0]) form.append("avatar", avatarInput.files[0]);
    e.currentTarget.disabled = true;
    try {
      const { user } = await api("/api/profile", { method: "PUT", form });
      state.me = user;
      renderNav();
      closeModal();
      toast("Profil actualizat.");
      viewProfile(user.username);
    } catch (err) {
      toast(err.message);
      e.currentTarget.disabled = false;
    }
  });

  mountModal(modal);
}

/* ---------- Search ---------- */
function setupSearch() {
  const input = document.getElementById("search-input");
  const box = document.getElementById("search-results");
  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      box.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      try {
        const { users } = await api("/api/users?q=" + encodeURIComponent(q));
        if (!users.length) {
          box.innerHTML = '<div class="result" style="color:var(--muted)">Niciun rezultat</div>';
        } else {
          box.innerHTML = "";
          users.forEach((u) => {
            const r = el(
              `<a class="result" href="#/u/${encodeURIComponent(u.username)}">${avatarHtml(
                u,
                "md"
              )}<div><div style="font-weight:600">${escapeHtml(u.username)}</div><div style="color:var(--muted)">${escapeHtml(
                u.fullName || ""
              )}</div></div></a>`
            );
            r.addEventListener("click", () => {
              box.hidden = true;
              input.value = "";
            });
            box.appendChild(r);
          });
        }
        box.hidden = false;
      } catch {
        box.hidden = true;
      }
    }, 220);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) box.hidden = true;
  });
}

/* ---------- Nav ---------- */
function renderNav() {
  if (!state.me) {
    navEl.hidden = true;
    return;
  }
  navEl.hidden = false;
  const profileLink = document.getElementById("nav-profile");
  profileLink.href = "#/u/" + encodeURIComponent(state.me.username);
  profileLink.innerHTML = avatarHtml(state.me, "sm");
}

/* ---------- Auth screen ---------- */
function renderAuth() {
  navEl.hidden = true;
  const node = document.getElementById("tpl-auth").content.cloneNode(true);
  appEl.innerHTML = "";
  appEl.appendChild(node);

  let mode = "login"; // or "register"
  const form = document.getElementById("auth-form");
  const fullname = form.querySelector(".js-fullname");
  const submit = form.querySelector(".js-submit");
  const errorEl = document.getElementById("auth-error");
  const toggle = document.getElementById("auth-toggle");
  const switchText = document.querySelector(".js-switch-text");

  function applyMode() {
    const reg = mode === "register";
    fullname.hidden = !reg;
    submit.textContent = reg ? "Inregistreaza-te" : "Log in";
    switchText.textContent = reg ? "Ai deja cont?" : "Nu ai cont?";
    toggle.textContent = reg ? "Log in" : "Inregistreaza-te";
    errorEl.hidden = true;
  }
  toggle.addEventListener("click", () => {
    mode = mode === "login" ? "register" : "login";
    applyMode();
  });
  applyMode();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fd = new FormData(form);
    const payload = {
      username: (fd.get("username") || "").trim(),
      password: fd.get("password") || "",
    };
    if (mode === "register") payload.fullName = (fd.get("fullName") || "").trim();
    submit.disabled = true;
    try {
      const { user } = await api("/api/auth/" + mode, { method: "POST", body: payload });
      state.me = user;
      renderNav();
      location.hash = "#/feed";
      router();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submit.disabled = false;
    }
  });
}

/* ---------- Router ---------- */
async function router() {
  closeModal();
  if (!state.me) {
    // Explore and profiles are public; everything else -> auth screen.
    const hash = location.hash;
    if (hash.startsWith("#/explore")) return guard(viewExplore);
    if (hash.startsWith("#/u/")) return guard(() => viewProfile(decodeURIComponent(hash.slice(4))));
    return renderAuth();
  }

  const hash = location.hash || "#/feed";
  if (hash.startsWith("#/u/")) return guard(() => viewProfile(decodeURIComponent(hash.slice(4))));
  if (hash.startsWith("#/explore")) return guard(viewExplore);
  return guard(viewFeed);
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    appEl.innerHTML = `<div class="empty"><h2>Oops</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
}

/* ---------- Boot ---------- */
async function boot() {
  setupSearch();

  document.getElementById("btn-new-post").addEventListener("click", () => {
    if (state.me) openNewPostModal();
    else location.hash = "";
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.me = null;
    renderNav();
    location.hash = "";
    renderAuth();
  });

  window.addEventListener("hashchange", router);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  try {
    const { user } = await api("/api/auth/me");
    state.me = user;
  } catch {
    state.me = null;
  }
  renderNav();
  router();
}

boot();

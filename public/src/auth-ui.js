async function api(url, opts){
  const r = await fetch(url, {
    headers: { "Content-Type":"application/json" },
    credentials: "include",
    ...opts
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data.message || "request failed");
  return data;
}

const $id = (id) => document.getElementById(id);

const auth = {
  area: $id("authArea"),
  btnLogin: $id("btnLogin"),
  btnRegister: $id("btnRegister"),
  userBox: $id("authUser"),
  name: $id("authName"),
  btnLogout: $id("btnLogout"),
  backdrop: $id("authBackdrop"),
  modal: $id("authModal"),
  close: $id("authClose"),
  frame: $id("authFrame"),
  title: $id("authModalTitle"),

  lastFocus: null,
};

function openAuthModal(kind){
  auth.lastFocus = document.activeElement;

  let title = "로그인";
  let src = "/login?embed=1";
  if(kind === "signup"){ title = "회원가입"; src = "/signup?embed=1"; }
  if(kind === "forgot"){ title = "비밀번호 찾기"; src = "/forgot?embed=1"; }

  auth.title.textContent = title;
  auth.frame.src = src;

  auth.backdrop.hidden = false;
  auth.modal.hidden = false;
  auth.backdrop.style.display = "block";
  auth.modal.style.display = "grid";
  auth.close.focus({ preventScroll:true });
}

function closeAuthModal(){
  auth.frame.src = "about:blank";
  auth.modal.hidden = true;
  auth.backdrop.hidden = true;
  auth.modal.style.display = "none";
  auth.backdrop.style.display = "none";

  if(auth.lastFocus?.focus) auth.lastFocus.focus({ preventScroll:true });
}

async function refreshAuthUI(){
  try{
    const me = await api("/api/auth/me", { method:"GET" });
    if(me.ok && me.user){
      auth.btnLogin.hidden = true;
      auth.btnRegister.hidden = true;
      auth.userBox.hidden = false;
      auth.name.textContent = me.user.name || me.user.email || "USER";
    }else{
      throw new Error("no session");
    }
  }catch(e){
    auth.btnLogin.hidden = false;
    auth.btnRegister.hidden = false;
    auth.userBox.hidden = true;
    auth.name.textContent = "";
  }
}

function wireAuthUI(){
  if(!auth.btnLogin) return;

  auth.btnLogin.addEventListener("click", () => openAuthModal("login"));
  auth.btnRegister.addEventListener("click", () => openAuthModal("signup"));
  auth.close.addEventListener("click", closeAuthModal);
  auth.backdrop.addEventListener("click", closeAuthModal);

  window.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && !auth.modal.hidden) closeAuthModal();
  });

  auth.btnLogout?.addEventListener("click", async () => {
    try{
      await api("/api/auth/logout", { method:"POST" });
    }finally{
      await refreshAuthUI();
      // 필요하면 홈으로 이동
      // location.href = "/";
    }
  });

  // ✅ iframe에서 "로그인 성공" 같은 이벤트 오면 여기서 받음
  window.addEventListener("message", async (ev) => {
    if(!ev?.data) return;
    if(ev.data.type === "AUTH_SUCCESS"){
      closeAuthModal();
      await refreshAuthUI();
    }
    if(ev.data.type === "OPEN_AUTH"){
      openAuthModal(ev.data.kind || "login");
    }
  });
}

wireAuthUI();
refreshAuthUI();

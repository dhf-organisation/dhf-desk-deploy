// ── AUTH — loaded eagerly, blocking, before the rest of the app ────────────
// This file is deliberately small. It is everything index.html needs before
// a user has signed in: the theme toggle, the Supabase client, the Google
// Sign-In flow, and the allowlist check. Everything else — every view, every
// modal, all ~9,500 lines of it — lives in app-main.js, which this file
// loads dynamically (loadAppMain(), below) only after a sign-in actually
// succeeds. Splitting it this way means the login screen isn't paying to
// download, parse and execute code it doesn't need yet: before this split,
// index.html scored 36/100 on Lighthouse performance (2.35s of main-thread
// blocking time) purely from loading the full app up front, while
// staff.html and portal.html — which never loaded app.js at all — scored
// 87 and 91. See docs/architecture.md for the full before/after.
//
// Anything defined here must not depend on anything defined in app-main.js,
// and vice versa — there is no bundler to catch that at build time, so keep
// it that way on purpose: if a function needs something from "the rest", it
// belongs in "the rest".

// ── THEME ────────────────────────────────────────────────────
// Initialisation does NOT live here — it is an inline blocking script in
// <head> (see index.html). auth.js loads after the stylesheet, so setting the
// theme from here would paint one light frame first and flash white for
// dark-mode users on every load. This file only handles the toggle.
//
// The button's icon is NOT set here either: CSS derives the sun/moon from
// [data-theme], so this stays a single attribute write and the correct glyph
// is already correct on first paint. Writing textContent (as v3/v4 did) would
// also destroy the inline SVGs.
//
// Storage key is 'dhf-theme' — it MUST match the <head> script exactly, or
// the toggle writes one key while init reads another and the choice silently
// fails to persist. (v4 used 'dhf-desk-theme'; unified on the brief's name.)
function toggleTheme(){
  const el=document.documentElement;
  const next=el.getAttribute('data-theme')==='dark'?'light':'dark';
  el.setAttribute('data-theme',next);
  try{localStorage.setItem('dhf-theme',next)}catch(e){}
}

function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3000)}

// ── SUPABASE CLIENT & AUTH ──────────────────────────────────
// Environment config comes from config.js, loaded before this file — see that
// file for why none of it is secret. No fallback to production values here on
// purpose: a page that can't load its config must refuse to run, not quietly
// connect to the live database (see docs/security.md).
const DHF_CFG=window.DHF_CONFIG;
if(!DHF_CFG||!DHF_CFG.supabaseUrl||!DHF_CFG.supabaseKey){
  document.body.innerHTML='<div style="padding:40px;font:16px system-ui;color:#b91c1c">Configuration failed to load — refusing to start rather than risk connecting to the wrong database. Refresh the page, or contact support if this persists.</div>';
  throw new Error('DHF_CONFIG missing or incomplete — refusing to start');
}
const SB_URL=DHF_CFG.supabaseUrl;
const SB_KEY=DHF_CFG.supabaseKey;
// Public anon key — RLS (is_desk_user()/is_desk_admin() in the desk_* table
// policies) is what actually protects data, keyed off the verified identity
// in the Supabase Auth session below, exactly like the Hub and every other
// module. Nothing in this file is trusted as an authorization decision on
// its own.
const sb=supabase.createClient(SB_URL,SB_KEY);

const ALLOWED_DOMAIN=DHF_CFG.allowedDomain||'';
const ALLOWED_EMAILS=DHF_CFG.allowedEmails||[];

let currentUser=null;
let currentView='diary';
// Every routable view name switchView() knows. Used to validate a persisted
// view before restoring it, so a stale/garbage localStorage value can't leave
// the app on a blank screen.
const KNOWN_VIEWS=['diary','jobs','customers','service-schedule','invoices','pos','pipeline','reports','inventory','supplier-stock','chats','messages','timesheets','settings'];

// Loads app-main.js on demand, once, the first time a sign-in actually
// succeeds — not on every page load, and not for a silent re-auth of an
// already-loaded session (see the sameUserReauth check in enterSession()).
// A shared in-flight promise means a second concurrent call (unlikely in
// practice, but cheap to guard) awaits the same load instead of injecting a
// second <script> tag; a failed load clears the promise so a retry (the
// user refreshing) can try again rather than being stuck rejected forever.
let appMainLoadPromise=null;
function loadAppMain(){
  if(!appMainLoadPromise){
    appMainLoadPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='app-main.js';
      s.onload=resolve;
      s.onerror=()=>{appMainLoadPromise=null;reject(new Error('Failed to load app-main.js'))};
      document.head.appendChild(s);
    });
  }
  return appMainLoadPromise;
}

async function handleGoogleSignIn(r){
  try{
    const {data,error}=await sb.auth.signInWithIdToken({provider:'google',token:r.credential});
    if(error||!data.user){showToast('Sign-in failed');google.accounts.id.disableAutoSelect();return}
    await enterSession(data.user);
  }catch(e){showToast('Sign-in failed')}
}

async function enterSession(user){
  const email=user.email||'',domain=email.split('@')[1]||'';
  if(domain!==ALLOWED_DOMAIN&&!ALLOWED_EMAILS.includes(email)){
    showToast('Access denied for '+(email||'(no email returned)'));
    google.accounts.id.disableAutoSelect();
    await sb.auth.signOut();
    return;
  }
  // A silent re-auth (Google/FedCM re-issuing a token, a background session
  // refresh) calls this again with the same user. When that happens, just keep
  // the app as-is — don't re-run switchView(), which would yank whoever's
  // mid-task back to a freshly-rendered view. app-main.js is already loaded
  // by this point (this can only happen after a real sign-in already loaded
  // it), so there's nothing to await here either.
  const sameUserReauth=currentUser&&currentUser.email===email;
  currentUser={email,name:user.user_metadata?.full_name||user.user_metadata?.name||email.split('@')[0]};
  document.getElementById('login-page').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('header-name').textContent=currentUser.name;
  if(sameUserReauth)return;
  const mainEl=document.getElementById('main');
  if(mainEl)mainEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-tertiary,#888)">Loading…</div>';
  try{
    await loadAppMain();
  }catch(e){
    if(mainEl)mainEl.innerHTML='<div style="padding:40px;text-align:center;color:#b91c1c">Failed to load the app — check your connection and refresh.</div>';
    return;
  }
  loadInvoiceTemplateSetting(); // pre-load so print/email work with the saved template even if Settings hasn't been visited this session
  loadWorkshopDetailsSetting(); // pre-load so the invoice header/footer show real branding even if Settings hasn't been visited this session
  // Pick the starting view: an explicit #/<view> in the URL wins (deep link,
  // refresh, bookmark), otherwise fall back to the last view persisted by
  // activateNavView so a plain reload doesn't always dump them on the Diary.
  const hashView=(location.hash.match(/^#\/([a-z-]+)$/)||[])[1];
  if(hashView&&KNOWN_VIEWS.includes(hashView)){
    currentView=hashView;
  }else{
    try{const saved=localStorage.getItem('desk-view');if(saved&&KNOWN_VIEWS.includes(saved))currentView=saved;}catch(e){}
  }
  switchView(currentView);
}

async function handleLogout(){
  google.accounts.id.disableAutoSelect();
  await sb.auth.signOut();
  currentUser=null;
  document.getElementById('login-page').style.display='flex';
  document.getElementById('app').style.display='none';
}

// Supabase auto-refreshes the session token in the background. If that
// refresh ever fails (expired/revoked refresh token — e.g. after being
// signed out elsewhere, or a long idle tab), the client signs itself out
// locally and fires SIGNED_OUT here. Without this listener the app never
// finds out: currentUser stays set, the UI still looks logged in, and every
// request from then on silently 401s (this is what broke "add customer").
// Only react if we thought we were logged in — handleLogout() already drives
// the same UI reset for a deliberate sign-out, so this only covers the
// surprise case.
sb.auth.onAuthStateChange((event)=>{
  if(event==='SIGNED_OUT'&&currentUser){
    currentUser=null;
    google.accounts.id.disableAutoSelect();
    document.getElementById('login-page').style.display='flex';
    document.getElementById('app').style.display='none';
    showToast('Session expired — please sign in again');
  }
});

// ── HUB TOKEN BRIDGE ─────────────────────────────────────────
// Purely a "you came from the Hub" courtesy signal — DHF Desk is used all
// day, so it keeps its own persistent Supabase session (below) rather than
// relying on the Hub's short-lived hub_token as the access mechanism.
async function checkHubToken(){
  const p=new URLSearchParams(location.search),t=p.get('hub_token');
  if(!t)return;
  try{
    await fetch(SB_URL+'/rest/v1/rpc/validate_hub_token',{
      method:'POST',
      headers:{apikey:SB_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:t,p_module:'desk'})
    });
  }catch(e){}
  history.replaceState({},'',location.pathname+location.hash);
}

// On reload, ask Supabase for the current verified session rather than
// trusting anything held client-side — same pattern as the Hub.
window.onload=async()=>{
  checkHubToken();
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user) await enterSession(session.user);
};

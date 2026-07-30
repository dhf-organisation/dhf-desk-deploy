// ── THEME ────────────────────────────────────────────────────
// Initialisation does NOT live here — it is an inline blocking script in
// <head> (see index.html). app.js loads after the stylesheet, so setting the
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

// ── SUPABASE CLIENT & AUTH ──────────────────────────────────
const SB_URL='https://cztpumgrvhmcvvpqbfqo.supabase.co';
const SB_KEY='sb_publishable_uj8jlFriz9gRP-eo2vZEZA_u_qIhub3';
// Public anon key — RLS (is_desk_user()/is_desk_admin() in the desk_* table
// policies) is what actually protects data, keyed off the verified identity
// in the Supabase Auth session below, exactly like the Hub and every other
// module. Nothing in this file is trusted as an authorization decision on
// its own.
const sb=supabase.createClient(SB_URL,SB_KEY);

const ALLOWED_DOMAIN='dhftyres.com.au';
const ALLOWED_EMAILS=['dushentissera@gmail.com'];

let currentUser=null;
let currentView='diary';

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
  currentUser={email,name:user.user_metadata?.full_name||user.user_metadata?.name||email.split('@')[0]};
  document.getElementById('login-page').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('header-name').textContent=currentUser.name;
  loadInvoiceTemplateSetting(); // pre-load so print/email work with the saved template even if Settings hasn't been visited this session
  loadWorkshopDetailsSetting(); // pre-load so the invoice header/footer show real branding even if Settings hasn't been visited this session
  switchView(currentView);
}

async function handleLogout(){
  google.accounts.id.disableAutoSelect();
  await sb.auth.signOut();
  currentUser=null;
  document.getElementById('login-page').style.display='flex';
  document.getElementById('app').style.display='none';
}

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
  history.replaceState({},'',location.pathname);
}

// ── VIEW ROUTING ─────────────────────────────────────────────
function activateNavView(view){
  currentView=view;
  document.querySelectorAll('#app-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  document.getElementById('main').classList.toggle('full-width',view==='diary');
}

function switchView(view){
  activateNavView(view);
  if(view==='diary'){
    renderDiaryView();
  }else if(view==='jobs'){
    renderJobsView();
  }else if(view==='customers'){
    customersSubView='customers';
    selectedCustomerId=null;
    renderCustomersView();
  }else if(view==='invoices'){
    invoicesSubView='invoices';
    invoiceStatusFilter='all';
    selectedInvoiceId=null;
    renderInvoicesView();
  }else if(view==='messages'){
    messageChannelFilter='all';
    renderMessagesView();
  }else if(view==='pos'){
    renderPosView();
  }else if(view==='pipeline'){
    renderPipelineView();
  }else if(view==='inventory'){
    inventorySubView='stock';
    renderInventoryView();
  }else if(view==='supplier-stock'){
    supplierStockSupplierFilter='all';
    supplierStockSearchTerm='';
    renderSupplierStockView();
  }else if(view==='service-schedule'){
    serviceScheduleFilter='overdue';
    renderServiceScheduleView();
  }else if(view==='timesheets'){
    renderTimesheetsView();
  }else if(view==='reports'){
    reportsCategory='income';
    reportsActive='by-customer';
    renderReportsView();
  }else if(view==='settings'){
    renderSettingsView();
  }
}

function emptyState(icon,title,desc){
  return `<div class="empty-state"><div class="empty-state-title">${title}</div><div>${desc}</div></div>`;
}

// ── QUICK SEARCH (header) ────────────────────────────────────
// The trigger button in the header only opens this — see .search-palette-*
// in index.html for why it's a fixed-position overlay rather than an inline
// input: an inline input that grows on focus was, for a header with 12 nav
// buttons, enough to push the nav onto a second line and grow the header
// itself as you typed. A fixed overlay can't do that; it isn't part of the
// header's box model at all.
let quickSearchDebounce=null;

function openQuickSearchPanel(){
  if(document.querySelector('.search-palette-backdrop'))return; // already open
  const html=`<div class="search-palette-backdrop" onclick="if(event.target===this)closeQuickSearchPanel()">
    <div class="search-palette">
      <div class="search-palette-input-row">
        <span class="icon" aria-hidden="true">🔍</span>
        <input class="search-palette-input" id="quick-search" placeholder="Search customers, vehicles, rego, jobs, invoices, order no, tyre sizes…" autocomplete="off" oninput="onQuickSearch(this.value)">
        <span class="search-palette-esc" onclick="closeQuickSearchPanel()">ESC</span>
      </div>
      <div class="search-palette-results" id="quick-search-results"></div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('quick-search').focus();
}

function closeQuickSearchPanel(){
  clearTimeout(quickSearchDebounce);
  document.querySelector('.search-palette-backdrop')?.remove();
}

function onQuickSearch(v){
  clearTimeout(quickSearchDebounce);
  const results=document.getElementById('quick-search-results');
  if(!results)return;
  const term=v.trim();
  if(term.length<2){results.innerHTML='';return} // 1 char is noise, not a search
  quickSearchDebounce=setTimeout(()=>runQuickSearch(term),250);
}

// PostgREST's or=(...) filter string breaks if the term itself contains one
// of its own grammar characters. None of these appear in a rego, name, or
// order no. in practice, so stripping them is a safe simplification rather
// than a real feature loss — much cheaper than a real escaping scheme for a
// header search box.
function quickSearchSanitize(term){return term.replace(/[,()]/g,'')}
// Strips tyre-size-specific characters so "235/40R18", "2354018", "235 40 r18",
// "235.40R18" all collapse to the same stripped-size key the scraper stored.
function normalizeTyreTerm(term){return term.replace(/[/\s.Rr-]/g,'')}

async function runQuickSearch(rawTerm){
  const results=document.getElementById('quick-search-results');
  if(!results)return;
  results.innerHTML='<div class="quick-search-item" style="color:var(--text-secondary)">Searching…</div>';
  const term=quickSearchSanitize(rawTerm);
  const numTerm=term.replace(/\D/g,'');
  // Normalized tyre-size term so "235/40r18", "235.40R18", and "2354018" all
  // hit stripped_size. Only included when it actually differs from the raw term
  // (otherwise we'd duplicate a filter that's already there).
  const tyreTerm=normalizeTyreTerm(term);
  const tyreFilter=tyreTerm&&tyreTerm!==term?`,stripped_size.ilike.%${tyreTerm}%`:'';
  try{
    // Pass 1: entities searched on their OWN columns only (customers,
    // vehicles) — safe to OR together in one PostgREST filter string.
    // Their matching customer ids feed pass 2, so a rego or a customer name
    // also surfaces that customer's jobs and invoices, not just the
    // customer/vehicle row itself.
    const [custRes,vehRes,supRes]=await Promise.all([
      sb.from('desk_customers').select('id,name,mobile,phone').or(`name.ilike.%${term}%,mobile.ilike.%${term}%,phone.ilike.%${term}%`).limit(6),
      sb.from('desk_vehicles').select('id,rego,make,model,customer_id,customer:desk_customers(id,name)').or(`rego.ilike.%${term}%,make.ilike.%${term}%,model.ilike.%${term}%`).limit(6),
      sb.from('desk_supplier_stock').select('size,stripped_size,brand,model,sku,supplier,cost_price,available_qty,is_discontinued').or(`size.ilike.%${term}%,stripped_size.ilike.%${term}%${tyreFilter},brand.ilike.%${term}%,model.ilike.%${term}%`).order('available_qty',{ascending:false,nullsFirst:false}).limit(6)
    ]);
    const customerIds=new Set();
    (custRes.data||[]).forEach(c=>customerIds.add(c.id));
    (vehRes.data||[]).forEach(v=>{if(v.customer_id)customerIds.add(v.customer_id)});
    // PostgREST can't OR a filter on an embedded/joined table's column
    // (confirmed: desk_jobs?...&or=(customer.name.ilike.*x*) → PGRST100
    // parse error) — only same-table columns work inside or=(). Carrying the
    // matched ids across as `customer_id.in.(...)` keeps this a same-table
    // filter and sidesteps that limitation entirely.
    const idFilter=customerIds.size?`,customer_id.in.(${[...customerIds].join(',')})`:'';
    const [jobRes,invRes]=await Promise.all([
      sb.from('desk_jobs').select('id,job_type,order_no,customer:desk_customers(name)')
        .eq('is_deleted',false).or(`job_type.ilike.%${term}%,order_no.ilike.%${term}%${idFilter}`).limit(6),
      sb.from('desk_invoices').select('id,invoice_no,doc_type,order_no,customer:desk_customers(name)')
        .or(`order_no.ilike.%${term}%${idFilter}${numTerm?`,invoice_no.eq.${parseInt(numTerm,10)}`:''}`).limit(6)
    ]);
    let html='';
    (custRes.data||[]).forEach(c=>{html+=`<div class="quick-search-item" onclick="quickSearchGoCustomer('${c.id}')"><div class="quick-search-item-type">Customer</div>${esc(c.name)}${c.mobile?' · '+esc(c.mobile):''}</div>`});
    (vehRes.data||[]).forEach(v=>{
      const vehLabel=[v.make,v.model].filter(Boolean).join(' ')+(v.rego?' ('+v.rego+')':'');
      html+=`<div class="quick-search-item" onclick="quickSearchGoCustomer('${v.customer_id}')"><div class="quick-search-item-type">Vehicle</div>${esc(vehLabel||'Vehicle')}${v.customer?.name?' · '+esc(v.customer.name):''}</div>`;
    });
    (jobRes.data||[]).forEach(j=>{html+=`<div class="quick-search-item" onclick="quickSearchGoJob('${j.id}')"><div class="quick-search-item-type">Job</div>${esc(j.job_type)}${j.order_no?' · Order '+esc(j.order_no):''}${j.customer?.name?' · '+esc(j.customer.name):''}</div>`});
    (invRes.data||[]).forEach(i=>{html+=`<div class="quick-search-item" onclick="quickSearchGoInvoice('${i.id}','${i.doc_type}')"><div class="quick-search-item-type">${i.doc_type==='quote'?'Quote':'Invoice'}</div>${docPrefix(i.doc_type)}-${i.invoice_no}${i.order_no?' · Order '+esc(i.order_no):''}${i.customer?.name?' · '+esc(i.customer.name):''}</div>`});
    (supRes.data||[]).forEach(r=>{
      const label=r.size||r.stripped_size||'—';
      const detail=[r.brand,r.model].filter(Boolean).join(' ');
      const supplier=SUPPLIER_STOCK_LABELS[r.supplier]||r.supplier;
      const price=r.cost_price!=null?'$'+Number(r.cost_price).toFixed(2):'';
      const qty=r.available_qty!=null?r.available_qty+' in stock':'';
      const flags=r.is_discontinued?' · Discontinued':'';
      const meta=[supplier,price,qty].filter(Boolean).join(' · ');
      const searchArg=esc(rawTerm);
      html+=`<div class="quick-search-item" onclick="quickSearchGoSupplierStock('${searchArg}')"><div class="quick-search-item-type">Supplier Stock</div>${esc(label)}${detail?' · '+esc(detail):''}${flags}<br><span style="font-size:12px;color:var(--text-secondary)">${esc(meta)}</span></div>`;
    });
    results.innerHTML=html||'<div class="quick-search-item" style="color:var(--text-secondary)">No matches</div>';
  }catch(e){results.innerHTML='<div class="quick-search-item" style="color:var(--text-secondary)">Search failed</div>'}
}

async function quickSearchGoCustomer(id){
  closeQuickSearchPanel();
  activateNavView('customers');
  customersSubView='customers';
  await loadCustomers();
  selectedCustomerId=id;
  await renderCustomerDetail(id);
}

async function quickSearchGoJob(id){
  closeQuickSearchPanel();
  activateNavView('jobs');
  await loadJobs();
  selectedJobId=id;
  jobDetailReturnView='jobs';
  await renderJobDetail(id);
}

async function quickSearchGoInvoice(id,docType){
  closeQuickSearchPanel();
  await openInvoiceFromJob(id,docType);
}

async function quickSearchGoSupplierStock(searchTerm){
  closeQuickSearchPanel();
  activateNavView('supplier-stock');
  supplierStockSupplierFilter='all';
  supplierStockSearchTerm=searchTerm;
  await renderSupplierStockView();
}

// Ctrl+K / Cmd+K opens the palette from anywhere in the app; Escape closes
// it. Both claim the key with preventDefault() since some browsers bind
// Ctrl/Cmd+K themselves (address-bar search in Chrome/Firefox) — standard
// practice for the same shortcut in Slack/Linear/Stripe etc.
// Guarded to the logged-in app only: the login page has no palette to open.
document.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
    if(document.getElementById('app')?.style.display!=='block')return;
    e.preventDefault();
    openQuickSearchPanel();
  }else if(e.key==='Escape'&&document.querySelector('.search-palette-backdrop')){
    closeQuickSearchPanel();
  }
});

// ── QUICK ADD (header "+" menu) ──────────────────────────────
function toggleQuickAddMenu(e){
  e.stopPropagation();
  const existing=document.querySelector('.quick-add-menu');
  if(existing){closeQuickAddMenu();return}
  const rect=e.target.getBoundingClientRect();
  const html=`<div class="day-context-backdrop quick-add-backdrop" onclick="closeQuickAddMenu()"></div>
    <div class="quick-add-menu" style="top:${rect.bottom+6}px;right:${window.innerWidth-rect.right}px">
      <button onclick="closeQuickAddMenu();quickAddJob()">New Job</button>
      <button onclick="closeQuickAddMenu();quickAddInvoice('invoice')">New Invoice</button>
      <button onclick="closeQuickAddMenu();quickAddInvoice('quote')">New Quote/Estimate</button>
      <button onclick="closeQuickAddMenu();quickAddCustomer()">New Customer</button>
      <button onclick="closeQuickAddMenu();quickAddStock()">New Stock Item</button>
      <button onclick="closeQuickAddMenu();quickAddSupplier()">New Supplier</button>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeQuickAddMenu(){
  document.querySelector('.quick-add-menu')?.remove();
  document.querySelector('.quick-add-backdrop')?.remove();
}

async function quickAddJob(){
  if(!customers.length)await loadCustomers();
  openNewJobModal();
}
async function quickAddInvoice(docType){
  if(!customers.length)await loadCustomers();
  openNewInvoiceModal(docType);
}
function quickAddCustomer(){
  openCustomerModal();
}
async function quickAddStock(){
  if(!suppliers.length)await loadSuppliers();
  openStockModal();
}
function quickAddSupplier(){
  openSupplierModal();
}

function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function truncate(s,n){return s&&s.length>n?s.slice(0,n-1).trimEnd()+'…':(s||'')}
function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3000)}
function closeModal(){document.querySelectorAll('.modal-overlay').forEach(o=>o.remove())}

// ── GOOGLE PLACES ADDRESS AUTOCOMPLETE (shared by Customers & Suppliers) ──
function fillAddressFromPlace(place,prefix){
  const comp={};
  (place.address_components||[]).forEach(c=>{c.types.forEach(t=>{comp[t]=c})});
  const streetNumber=comp.street_number?comp.street_number.long_name:'';
  const route=comp.route?comp.route.long_name:'';
  const suburb=(comp.locality||comp.sublocality||comp.postal_town||{}).long_name||'';
  const state=comp.administrative_area_level_1?comp.administrative_area_level_1.short_name:'';
  const postcode=comp.postal_code?comp.postal_code.long_name:'';
  const streetLine=[streetNumber,route].filter(Boolean).join(' ');
  const streetEl=document.getElementById(prefix+'-street');
  const suburbEl=document.getElementById(prefix+'-suburb');
  const stateEl=document.getElementById(prefix+'-state');
  const postcodeEl=document.getElementById(prefix+'-postcode');
  if(streetEl)streetEl.value=streetLine;
  if(suburbEl)suburbEl.value=suburb;
  if(stateEl)stateEl.value=state;
  if(postcodeEl)postcodeEl.value=postcode;
}

// Retries briefly if the Maps script (loaded async) hasn't finished yet —
// modals are usually opened well after page load so this rarely matters,
// but it's a cheap safety net rather than a hard requirement on timing.
function initAddressAutocomplete(searchInputId,prefix){
  const input=document.getElementById(searchInputId);
  if(!input)return;
  if(!(window.google&&google.maps&&google.maps.places)){
    setTimeout(()=>initAddressAutocomplete(searchInputId,prefix),500);
    return;
  }
  const ac=new google.maps.places.Autocomplete(input,{fields:['address_components','formatted_address'],componentRestrictions:{country:'au'}});
  ac.addListener('place_changed',()=>{
    const place=ac.getPlace();
    if(!place||!place.address_components)return;
    fillAddressFromPlace(place,prefix);
  });
}

// ── CUSTOMERS & VEHICLES ─────────────────────────────────────
let customers=[];
let selectedCustomerId=null;
let selectedCustomerVehicles=[];
let customerSearchTerm='';
let customersSubView='customers'; // 'customers' | 'vehicles'
let allVehicles=[];
let vehicleSearchTerm='';

async function loadCustomers(){
  try{
    const {data,error}=await sb.from('desk_customers').select('*').order('name');
    if(error)throw error;
    customers=data||[];
  }catch(e){customers=[];showToast('Could not load customers')}
}

async function renderCustomersView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadCustomers();
  if(selectedCustomerId){
    await renderCustomerDetail(selectedCustomerId);
  }else if(customersSubView==='vehicles'){
    await loadAllVehicles();
    renderVehiclesList();
  }else{
    renderCustomerList();
  }
}

function switchCustomersSubView(v){
  customersSubView=v;
  renderCustomersView();
}

function customersTabBar(){
  return `<div class="status-tabs">
    <button class="status-tab ${customersSubView==='customers'?'active':''}" onclick="switchCustomersSubView('customers')">Customers</button>
    <button class="status-tab ${customersSubView==='vehicles'?'active':''}" onclick="switchCustomersSubView('vehicles')">Vehicles</button>
  </div>`;
}

async function loadAllVehicles(){
  try{
    const {data,error}=await sb.from('desk_vehicles').select('*,customer:desk_customers(id,name)').order('created_at',{ascending:false});
    if(error)throw error;
    allVehicles=data||[];
  }catch(e){allVehicles=[];showToast('Could not load vehicles')}
}

function renderVehiclesList(){
  const main=document.getElementById('main');
  const term=vehicleSearchTerm.toLowerCase();
  const filtered=allVehicles.filter(v=>!term||[v.rego,v.make,v.model,v.customer?.name].join(' ').toLowerCase().includes(term));
  let h=customersTabBar();
  h+=`<div class="toolbar">
    <input class="search-input" id="vehicle-search" placeholder="Search vehicles by rego, make, model, owner…" value="${esc(vehicleSearchTerm)}" oninput="onVehicleSearch(this.value)">
  </div>`;
  if(!filtered.length){
    h+=`<div class="list-card"><div class="list-empty">${allVehicles.length?'No vehicles match your search.':"No vehicles yet — add one from a customer's page."}</div></div>`;
  }else{
    h+='<div class="list-card">';
    filtered.forEach(v=>{
      h+=`<div class="list-row" onclick="openCustomerFromVehicle('${v.customer_id}')">
        <div class="list-row-name">${esc(v.make||'')} ${esc(v.model||'')}${v.rego?' ('+esc(v.rego)+')':''}</div>
        <div class="list-row-sub">${esc(v.customer?.name||'Unknown owner')}</div>
        <div class="list-row-sub">${v.odometer?v.odometer.toLocaleString()+' km':''}</div>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function onVehicleSearch(v){
  vehicleSearchTerm=v;
  renderVehiclesList();
  setTimeout(()=>{const i=document.getElementById('vehicle-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}

async function openCustomerFromVehicle(customerId){
  selectedCustomerId=customerId;
  await renderCustomerDetail(customerId);
}

function renderCustomerList(){
  const main=document.getElementById('main');
  const term=customerSearchTerm.toLowerCase();
  const filtered=customers.filter(c=>!term||[c.name,c.email,c.mobile,c.phone].join(' ').toLowerCase().includes(term));
  let h=customersTabBar();
  h+=`<div class="toolbar">
    <input class="search-input" id="customer-search" placeholder="Search customers by name, phone, email…" value="${esc(customerSearchTerm)}" oninput="onCustomerSearch(this.value)">
    <button class="btn-primary" onclick="openCustomerModal()">+ New Customer</button>
  </div>`;
  if(!filtered.length){
    h+=`<div class="list-card"><div class="list-empty">${customers.length?'No customers match your search.':'No customers yet — add your first one.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    filtered.forEach(c=>{
      h+=`<div class="list-row" onclick="openCustomer('${c.id}')">
        <div class="list-row-name">${esc(c.name)}</div>
        <div class="list-row-sub">${esc(c.mobile||c.phone||'')}</div>
        <div class="list-row-sub">${esc(c.email||'')}</div>
        <div class="list-row-sub">${esc(c.payment_term||'')}</div>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function onCustomerSearch(v){
  customerSearchTerm=v;
  renderCustomerList();
  setTimeout(()=>{const i=document.getElementById('customer-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}

async function openCustomer(id){
  selectedCustomerId=id;
  await renderCustomerDetail(id);
}

async function loadVehiclesFor(customerId){
  try{
    const {data,error}=await sb.from('desk_vehicles').select('*').eq('customer_id',customerId).order('created_at');
    if(error)throw error;
    selectedCustomerVehicles=data||[];
  }catch(e){selectedCustomerVehicles=[]}
}

async function loadCustomerCreditBalance(customerId){
  try{
    const {data,error}=await sb.from('desk_credit_notes').select('status,items:desk_credit_note_items(qty,unit_price),applications:desk_credit_applications(amount)').eq('customer_id',customerId).eq('status','issued');
    if(error)throw error;
    return (data||[]).reduce((sum,cn)=>{
      const total=(cn.items||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0);
      const applied=(cn.applications||[]).reduce((s,a)=>s+Number(a.amount),0);
      return sum+Math.max(0,total-applied);
    },0);
  }catch(e){return 0}
}

async function renderCustomerDetail(id){
  const c=customers.find(x=>x.id===id);
  const main=document.getElementById('main');
  if(!c){selectedCustomerId=null;renderCustomerList();return}
  await loadVehiclesFor(id);
  const creditBalance=await loadCustomerCreditBalance(id);
  let h=`<button class="back-link" onclick="backToCustomerList()">← All customers</button>
  <div class="detail-grid">
    <div class="panel">
      <div class="panel-head"><div class="panel-title">${esc(c.name)}</div><button class="btn-link" onclick="openCustomerModal('${c.id}')">Edit</button></div>
      <div class="field-row"><span class="field-label">Email</span><span class="field-val">${esc(c.email||'—')}</span></div>
      <div class="field-row"><span class="field-label">Mobile</span><span class="field-val">${esc(c.mobile||'—')}</span></div>
      <div class="field-row"><span class="field-label">Phone</span><span class="field-val">${esc(c.phone||'—')}</span></div>
      <div class="field-row"><span class="field-label">Address</span><span class="field-val">${esc([c.street_line,c.suburb,c.state,c.postcode].filter(Boolean).join(', ')||'—')}</span></div>
      <div class="field-row"><span class="field-label">Payment term</span><span class="field-val">${esc(c.payment_term||'—')}</span></div>
      <div class="field-row"><span class="field-label">Price level</span><span class="field-val">${esc(c.price_level||'—')}</span></div>
      ${c.notes?`<div class="field-row"><span class="field-label">Notes</span><span class="field-val">${esc(c.notes)}</span></div>`:''}
      <div class="field-row grand"><span class="field-label">Credit balance</span><span class="field-val" style="color:${creditBalance>0?'var(--success)':'inherit'}">$${creditBalance.toFixed(2)}</span></div>
      <button class="btn-link" onclick="viewCreditNotesFromCustomer()" style="margin-top:var(--space-2)">View credit notes →</button>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Vehicles</div><button class="btn-link" onclick="openVehicleModal(null,'${c.id}')">+ Add vehicle</button></div>
      ${selectedCustomerVehicles.length?selectedCustomerVehicles.map(v=>`
        <div class="vehicle-card" onclick="openVehicleModal('${v.id}','${c.id}')">
          <div class="vehicle-card-title">${esc(v.make||'')} ${esc(v.model||'')} ${v.rego?'— '+esc(v.rego)+' ('+esc(v.rego_state||'')+')':''}</div>
          <div class="vehicle-card-sub">${v.odometer?v.odometer.toLocaleString()+' km · ':''}${esc(v.next_service_note||'No service note')}</div>
          ${v.next_service_due_date?`<div class="vehicle-card-sub">${serviceDueBadge(daysUntil(v.next_service_due_date))} Next service due ${fmtDate(v.next_service_due_date)}${v.next_service_due_odometer?' · '+v.next_service_due_odometer.toLocaleString()+' km':''}</div>`:''}
        </div>`).join(''):'<div class="list-empty">No vehicles on file yet.</div>'}
    </div>
  </div>`;
  main.innerHTML=h;
}

function backToCustomerList(){
  selectedCustomerId=null;
  renderCustomerList();
}

function openCustomerModal(id){
  const c=id?customers.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${c?'Edit customer':'New customer'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="cf-name" value="${c?esc(c.name):''}">
      <label class="form-label">Mobile</label>
      <input class="form-input" id="cf-mobile" value="${c?esc(c.mobile||''):''}">
      <label class="form-label">Phone</label>
      <input class="form-input" id="cf-phone" value="${c?esc(c.phone||''):''}">
      <label class="form-label">Email</label>
      <input class="form-input" id="cf-email" value="${c?esc(c.email||''):''}">
      <label class="form-label">Address</label>
      <input class="form-input" id="cf-address-search" placeholder="Start typing an address…" autocomplete="off">
      <input class="form-input" id="cf-street" placeholder="Street" value="${c?esc(c.street_line||''):''}">
      <input class="form-input" id="cf-suburb" placeholder="Suburb" value="${c?esc(c.suburb||''):''}">
      <input class="form-input" id="cf-state" placeholder="State" value="${c?esc(c.state||''):''}">
      <input class="form-input" id="cf-postcode" placeholder="Postcode" value="${c?esc(c.postcode||''):''}">
      <label class="form-label">Payment term</label>
      <input class="form-input" id="cf-payment" value="${c?esc(c.payment_term||'COD'):'COD'}">
      <label class="form-label">Price level</label>
      <input class="form-input" id="cf-price" value="${c?esc(c.price_level||''):''}">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="cf-notes">${c?esc(c.notes||''):''}</textarea>
      <label style="display:flex;align-items:flex-start;gap:var(--space-2);font-size:13px;font-weight:600;margin:var(--space-1) 0 var(--space-4);cursor:pointer">
        <input type="checkbox" id="cf-requires-order" ${c&&c.requires_order_no?'checked':''} style="margin-top:2px;flex-shrink:0">
        <span>Requires an order no.
          <span style="display:block;font-weight:400;color:var(--text-secondary);margin-top:2px">Booking a job for this customer won't be allowed without one. Use this for panel beaters and anyone who issues their own order numbers.</span>
        </span>
      </label>
      ${c?'':`
      <div class="panel-title" style="font-size:13px;margin:var(--space-1) 0 var(--space-3)">Vehicle (optional)</div>
      <input class="form-input" id="cf-veh-rego" placeholder="Rego">
      <input class="form-input" id="cf-veh-make" placeholder="Make">
      <input class="form-input" id="cf-veh-model" placeholder="Model">
      <input class="form-input" id="cf-veh-odo" type="number" placeholder="Odometer (km)">
      `}
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveCustomerForm(${c?`'${c.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cf-name').focus();
  initAddressAutocomplete('cf-address-search','cf');
}

async function saveCustomerForm(id){
  const name=document.getElementById('cf-name').value.trim();
  if(!name){showToast('Name is required');return}
  const payload={
    name,
    mobile:document.getElementById('cf-mobile').value.trim()||null,
    phone:document.getElementById('cf-phone').value.trim()||null,
    email:document.getElementById('cf-email').value.trim()||null,
    street_line:document.getElementById('cf-street').value.trim()||null,
    suburb:document.getElementById('cf-suburb').value.trim()||null,
    state:document.getElementById('cf-state').value.trim()||null,
    postcode:document.getElementById('cf-postcode').value.trim()||null,
    payment_term:document.getElementById('cf-payment').value.trim()||'COD',
    price_level:document.getElementById('cf-price').value.trim()||null,
    notes:document.getElementById('cf-notes').value.trim()||null,
    requires_order_no:document.getElementById('cf-requires-order').checked,
    updated_at:new Date().toISOString()
  };
  try{
    let customerId=id;
    if(id){
      const {error}=await sb.from('desk_customers').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {data,error}=await sb.from('desk_customers').insert(payload).select();
      if(error)throw error;
      customerId=data[0].id;
      const vRego=document.getElementById('cf-veh-rego')?.value.trim();
      const vMake=document.getElementById('cf-veh-make')?.value.trim();
      const vModel=document.getElementById('cf-veh-model')?.value.trim();
      const vOdo=document.getElementById('cf-veh-odo')?.value;
      if(vRego||vMake||vModel||vOdo){
        const {error:vErr}=await sb.from('desk_vehicles').insert({
          customer_id:customerId,rego:vRego||null,make:vMake||null,model:vModel||null,
          odometer:vOdo?parseInt(vOdo,10):null
        });
        if(vErr)throw vErr;
      }
    }
    closeModal();
    showToast(id?'Customer updated':'Customer added');
    await loadCustomers();
    if(id){await renderCustomerDetail(id)}else{renderCustomerList()}
  }catch(e){showToast('Save failed')}
}

function openVehicleModal(id,customerId){
  const v=id?selectedCustomerVehicles.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${v?'Edit vehicle':'Add vehicle'}</div>
      <label class="form-label">Rego</label>
      <input class="form-input" id="vf-rego" value="${v?esc(v.rego||''):''}">
      <label class="form-label">Rego state</label>
      <input class="form-input" id="vf-rego-state" value="${v?esc(v.rego_state||'VIC'):'VIC'}">
      <label class="form-label">Make</label>
      <input class="form-input" id="vf-make" value="${v?esc(v.make||''):''}">
      <label class="form-label">Model</label>
      <input class="form-input" id="vf-model" value="${v?esc(v.model||''):''}">
      <label class="form-label">Odometer (km)</label>
      <input class="form-input" id="vf-odo" type="number" value="${v&&v.odometer!=null?v.odometer:''}">
      <label class="form-label">Next service note</label>
      <textarea class="form-textarea" id="vf-note">${v?esc(v.next_service_note||''):''}</textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveVehicleForm(${v?`'${v.id}'`:'null'},'${customerId}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveVehicleForm(id,customerId){
  const odoVal=document.getElementById('vf-odo').value;
  const payload={
    customer_id:customerId,
    rego:document.getElementById('vf-rego').value.trim()||null,
    rego_state:document.getElementById('vf-rego-state').value.trim()||'VIC',
    make:document.getElementById('vf-make').value.trim()||null,
    model:document.getElementById('vf-model').value.trim()||null,
    odometer:odoVal?parseInt(odoVal,10):null,
    next_service_note:document.getElementById('vf-note').value.trim()||null,
    updated_at:new Date().toISOString()
  };
  try{
    if(id){
      const {error}=await sb.from('desk_vehicles').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_vehicles').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Vehicle updated':'Vehicle added');
    await renderCustomerDetail(customerId);
  }catch(e){showToast('Save failed')}
}

// ── JOBS ──────────────────────────────────────────────────────
const JOB_STATUS_LABELS={booking:'Booking',in_progress:'In Progress',on_hold:'On Hold',finished:'Finished'};
const JOB_STATUS_ORDER=['booking','in_progress','on_hold','finished'];

let jobs=[];
let jobStatusFilter='active'; // 'active' | 'finished' | 'all' | 'deleted' | 'followups'
let followUps=[];
let jobSearchTerm='';
let selectedJobId=null;
// When set, a quote/invoice created or opened FROM a job renders inline on
// that job's detail page (see renderJobDetail) instead of navigating to the
// Invoices tab — the whole point being "see all the details on 1 page".
let jobInvoicePanelJobId=null;
let jobInvoicePanelInvoiceId=null;
let jobNotes=[];
let newJobCustomerId=null;
let newJobCustomerName='';
let newJobVehicleId=null;
let newJobVehicles=[];
let newJobShowNewVehicleFields=false;
let newJobPresetDate=null;
let allTags=[];
let jobTagsMap={}; // job_id -> [{id,name,color}]
let jobNotesMap={}; // job_id -> [notes], newest last (same order as the Job Card thread)
let diaryTagFilter=[]; // selected tag ids; empty = no filter

// ── INVOICES ──────────────────────────────────────────────────
const DOC_STATUS_LABELS={draft:'Draft',sent:'Sent',paid:'Paid',approved:'Approved',declined:'Declined'};
const INVOICE_STATUS_ORDER=['draft','sent','paid'];
const QUOTE_STATUS_ORDER=['draft','sent','approved','declined'];
// credit_note is a real payment method (an invoice settled by applying a
// credit note) but is only ever set programmatically by applyCreditToInvoice()
// — deliberately excluded from the manually-selectable Record Payment dropdowns.
const PAYMENT_METHOD_LABELS={cash:'Cash',eftpos:'EFTPOS',afterpay:'Afterpay (EFTPOS)',zippay:'Zip Pay (EFTPOS)',amex:'Amex (EFTPOS)',bank_transfer:'Bank Transfer',other:'Other',credit_note:'Credit Note'};
function selectablePaymentMethods(){return Object.keys(PAYMENT_METHOD_LABELS).filter(m=>m!=='credit_note')}
function docPrefix(docType){return docType==='quote'?'QUO':'INV'}
function docStatusOrder(docType){return docType==='quote'?QUOTE_STATUS_ORDER:INVOICE_STATUS_ORDER}
let invoices=[];
let invoicesSubView='invoices'; // 'invoices' | 'quotes' | 'payments'
let invoiceStatusFilter='all';
let invoiceSearchTerm='';
let selectedInvoiceId=null;
let invoiceItems=[];
let invoicePayments=[];
let newInvoiceCustomerId=null;
let newInvoiceCustomerName='';
let newInvoiceVehicles=[];
let newInvoiceDocType='invoice';
let invoiceCustomerPickerOpenFor=null; // invoice id currently showing the "change customer" search, else null
let invoiceTemplate='standard';
let workshopDetails={}; // name/abn/phone/address/website/email/invoice_footer/logo_url — see loadWorkshopDetailsSetting()
let allPayments=[];
let paymentsRangePreset='month'; // 'today' | 'week' | 'month' | 'all' | 'custom'
let paymentsFrom=null;
let paymentsTo=null;
let paymentsDrilldownDate=null;

// ── MESSAGES (real email/SMS send via Resend/Twilio, dispatched from
// Postgres over pg_net — see desk_send_email/desk_send_sms RPCs) ──
let allMessages=[];
let messageChannelFilter='all'; // 'all' | 'email' | 'sms'
let messagingStatus={email_configured:false,sms_configured:false};
let messagingSettings={send_booking_confirmation:true,send_booking_reminder:true};

async function loadMessages(){
  try{
    const {data,error}=await sb.from('desk_messages')
      .select('*,customer:desk_customers(name),job:desk_jobs(job_type),invoice:desk_invoices(invoice_no,doc_type)')
      .order('created_at',{ascending:false})
      .limit(200);
    if(error)throw error;
    allMessages=data||[];
  }catch(e){allMessages=[];showToast('Could not load messages')}
}

async function loadMessagingStatus(){
  try{
    const {data,error}=await sb.rpc('desk_messaging_status');
    if(error)throw error;
    messagingStatus=data||{email_configured:false,sms_configured:false};
  }catch(e){messagingStatus={email_configured:false,sms_configured:false}}
}

async function loadMessagingSettings(){
  try{
    const {data,error}=await sb.from('desk_settings').select('value').eq('key','messaging_settings').maybeSingle();
    if(error)throw error;
    messagingSettings=Object.assign({send_booking_confirmation:true,send_booking_reminder:true},parseSettingValue(data?.value)||{});
  }catch(e){messagingSettings={send_booking_confirmation:true,send_booking_reminder:true}}
}

async function saveMessagingSettings(){
  const settings={
    send_booking_confirmation:document.getElementById('msg-confirm').checked,
    send_booking_reminder:document.getElementById('msg-reminder').checked
  };
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'messaging_settings',value:settings,updated_at:new Date().toISOString()});
    if(error)throw error;
    messagingSettings=settings;
    showToast('Messaging settings saved');
  }catch(e){showToast('Could not save')}
}

function switchMessagesFilter(f){
  messageChannelFilter=f;
  renderMessagesPage();
}

async function renderMessagesView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await Promise.all([loadMessages(),loadMessagingStatus()]);
  renderMessagesPage();
}

function renderMessagesPage(){
  const main=document.getElementById('main');
  const rows=allMessages.filter(m=>messageChannelFilter==='all'||m.channel===messageChannelFilter);
  const bothMissing=!messagingStatus.email_configured&&!messagingStatus.sms_configured;
  const configBanner=(!messagingStatus.email_configured||!messagingStatus.sms_configured)?
    `<div class="message-config-banner warn">${bothMissing?'Email and SMS are':!messagingStatus.email_configured?'Email is':'SMS is'} not connected yet — finish setup in Settings → Messaging.</div>`:
    `<div class="message-config-banner ok">Email and SMS are connected</div>`;
  let h=`<div style="max-width:800px">
    <div class="panel-head" style="margin-bottom:var(--space-3)"><div class="panel-title">Messages</div></div>
    ${configBanner}
    <div class="status-tabs">
      <div class="status-tab ${messageChannelFilter==='all'?'active':''}" onclick="switchMessagesFilter('all')">All</div>
      <div class="status-tab ${messageChannelFilter==='email'?'active':''}" onclick="switchMessagesFilter('email')">Email</div>
      <div class="status-tab ${messageChannelFilter==='sms'?'active':''}" onclick="switchMessagesFilter('sms')">SMS</div>
    </div>
    <div class="list-card">
      ${rows.length?rows.map(m=>`
        <div class="list-row" style="cursor:default">
          <div class="message-row">
            <div class="message-channel-icon">${m.channel==='email'?'Email':'SMS'}</div>
            <div class="message-row-main">
              <div class="message-row-to">${esc(m.to_address)}${m.customer?.name?' · '+esc(m.customer.name):''}</div>
              ${m.subject?`<div class="message-row-subject">${esc(m.subject)}</div>`:''}
              <div class="message-row-preview">${esc((m.body||'').replace(/<[^>]+>/g,' '))}</div>
              ${(m.job||m.invoice)?`<div class="message-row-links">
                ${m.job?`<span class="btn-link" onclick="quickSearchGoJob('${m.job_id}')">${esc(m.job.job_type)}</span>`:''}
                ${m.invoice?`<span class="btn-link" onclick="openInvoiceFromJob('${m.invoice_id}','${m.invoice.doc_type||'invoice'}')">${docPrefix(m.invoice.doc_type)}-${m.invoice.invoice_no}</span>`:''}
              </div>`:''}
            </div>
            <div style="text-align:right">
              <span class="status-badge ${m.status}">${m.status.charAt(0).toUpperCase()+m.status.slice(1)}</span>
              <div class="message-row-time">${fmtDateTime(m.created_at)}</div>
            </div>
          </div>
        </div>`).join(''):'<div class="list-empty">No messages sent yet.</div>'}
    </div>
  </div>`;
  main.innerHTML=h;
}

// ── Compose modal (shared by Job Card & Invoice Email/SMS buttons) ──
let composeCtx=null; // {customerId,jobId,invoiceId,email,mobile,subject,body}

function openComposeModal(channel,ctx){
  composeCtx=ctx;
  const hasEmail=!!ctx.email,hasMobile=!!ctx.mobile;
  if(channel==='email'&&!hasEmail&&hasMobile)channel='sms';
  if(channel==='sms'&&!hasMobile&&hasEmail)channel='email';
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Send Message</div>
      <div class="compose-channel-toggle">
        <button class="${channel==='email'?'active':''}" ${hasEmail?'':'disabled'} onclick="switchComposeChannel('email')">Email</button>
        <button class="${channel==='sms'?'active':''}" ${hasMobile?'':'disabled'} onclick="switchComposeChannel('sms')">SMS</button>
      </div>
      <div id="compose-body-wrap"></div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" id="compose-send-btn" onclick="sendComposedMessage()">Send</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  renderComposeFields(channel);
}

function renderComposeFields(channel){
  const wrap=document.getElementById('compose-body-wrap');
  if(!wrap)return;
  wrap.dataset.channel=channel;
  const ctx=composeCtx;
  if(channel==='email'){
    wrap.innerHTML=`
      <label class="form-label">To</label>
      <input class="form-input" id="compose-to" value="${esc(ctx.email||'')}" placeholder="customer@email.com">
      <label class="form-label">Subject</label>
      <input class="form-input" id="compose-subject" value="${esc(ctx.subject||'')}">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="compose-body" style="min-height:140px">${esc(ctx.body||'')}</textarea>`;
  }else{
    wrap.innerHTML=`
      <label class="form-label">To</label>
      <input class="form-input" id="compose-to" value="${esc(ctx.mobile||'')}" placeholder="04xx xxx xxx">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="compose-body" style="min-height:100px" oninput="updateSmsCount(this.value)">${esc(ctx.smsBody||ctx.body||'')}</textarea>
      <div class="compose-sms-count" id="compose-sms-count"></div>`;
    updateSmsCount(document.getElementById('compose-body').value);
  }
}

function updateSmsCount(v){
  const el=document.getElementById('compose-sms-count');
  if(!el)return;
  const segs=Math.max(1,Math.ceil((v||'').length/160));
  el.textContent=`${(v||'').length} characters · ${segs} SMS segment${segs>1?'s':''}`;
}

function switchComposeChannel(channel){
  const card=document.querySelector('.modal-card');
  if(!card)return;
  const buttons=card.querySelectorAll('.compose-channel-toggle button');
  buttons.forEach((b,i)=>b.classList.toggle('active',(i===0&&channel==='email')||(i===1&&channel==='sms')));
  renderComposeFields(channel);
}

async function sendComposedMessage(){
  const wrap=document.getElementById('compose-body-wrap');
  const channel=wrap?.dataset.channel||'email';
  const to=document.getElementById('compose-to')?.value.trim();
  const body=document.getElementById('compose-body')?.value.trim();
  if(!to||!body){showToast('Fill in the To and Message fields');return}
  const btn=document.getElementById('compose-send-btn');
  if(btn){btn.disabled=true;btn.textContent='Sending…'}
  try{
    let msgId;
    if(channel==='email'){
      const subject=document.getElementById('compose-subject')?.value.trim()||'Message from DHF Tyres';
      const {data,error}=await sb.rpc('desk_send_email',{p_to:to,p_subject:subject,p_body:body.replace(/\n/g,'<br>'),p_customer_id:composeCtx.customerId||null,p_job_id:composeCtx.jobId||null,p_invoice_id:composeCtx.invoiceId||null,p_follow_up_id:composeCtx.followUpId||null});
      if(error)throw error;
      msgId=data;
    }else{
      const {data,error}=await sb.rpc('desk_send_sms',{p_to:to,p_body:body,p_customer_id:composeCtx.customerId||null,p_job_id:composeCtx.jobId||null,p_invoice_id:composeCtx.invoiceId||null,p_follow_up_id:composeCtx.followUpId||null});
      if(error)throw error;
      msgId=data;
    }
    const {data:msgRow}=await sb.from('desk_messages').select('status,error').eq('id',msgId).maybeSingle();
    closeModal();
    if(msgRow?.status==='failed'){
      showToast('Not sent — '+(msgRow.error||'unknown error'));
    }else{
      showToast(channel==='email'?'Email sent':'SMS sent');
    }
    if(composeCtx.followUpId&&jobStatusFilter==='followups'){await loadFollowUps();renderJobList()}
  }catch(e){
    showToast('Send failed — '+(e.message||''));
    if(btn){btn.disabled=false;btn.textContent='Send'}
  }
}

// ── POS (quick walk-in/counter sale) ──────────────────────────
// A POS sale is just a fast-path invoice: items get built up in memory
// (posCart) rather than persisted line-by-line like the Invoice detail
// screen, then "Park" saves it as a draft invoice (finish checkout later
// via the normal Invoice screen) or "Pay" saves it and immediately
// records a full payment, auto-marking it paid — same underlying
// desk_invoices/desk_invoice_items/desk_payments tables as everywhere
// else, just tagged is_pos_sale so this screen can find them again.
let posCart=[]; // [{description,qty,unit_price,stock_id}]
let posCustomerId=null;
let posNewCustomerName='';
let posNewCustomerMobile='';
let posNewCustomerPhone='';
let posNewCustomerEmail='';
let posDiscountType=null;
let posDiscountValue=0;
let posPaymentMethod='cash';
let posParkedSales=[];
let posClosedSales=[];
let walkInCustomerId=null;

// desk_invoices.customer_id is not-null, so a true anonymous walk-in sale
// still needs a customer row — reuses a single shared "Walk-in Customer"
// record (created once, found by name thereafter) rather than relaxing
// that constraint, which would ripple into every report/statement that
// assumes a real customer.
async function getOrCreateWalkInCustomer(){
  if(walkInCustomerId)return walkInCustomerId;
  try{
    const {data}=await sb.from('desk_customers').select('id').eq('name','Walk-in Customer').limit(1).maybeSingle();
    if(data){walkInCustomerId=data.id;return walkInCustomerId}
    const {data:created,error}=await sb.from('desk_customers').insert({name:'Walk-in Customer'}).select();
    if(error)throw error;
    walkInCustomerId=created[0].id;
    return walkInCustomerId;
  }catch(e){return null}
}

async function loadPosSales(){
  try{
    const {data,error}=await sb.from('desk_invoices')
      .select('id,invoice_no,customer:desk_customers(name),items:desk_invoice_items(qty,unit_price),created_at')
      .eq('is_pos_sale',true).eq('status','draft').order('created_at',{ascending:false});
    if(error)throw error;
    posParkedSales=data||[];
  }catch(e){posParkedSales=[]}
  try{
    const {data,error}=await sb.from('desk_invoices')
      .select('id,invoice_no,customer:desk_customers(name),items:desk_invoice_items(qty,unit_price),created_at')
      .eq('is_pos_sale',true).eq('status','paid').order('created_at',{ascending:false}).limit(10);
    if(error)throw error;
    posClosedSales=data||[];
  }catch(e){posClosedSales=[]}
}

async function renderPosView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  if(!customers.length)await loadCustomers();
  await loadStockItems();
  await loadPosSales();
  renderPosPage();
}

function posSaleTotal(sale){
  return (sale.items||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0);
}

function posCustomerAreaHtml(){
  if(posCustomerId){
    const c=customers.find(x=>x.id===posCustomerId);
    return `<label class="form-label">Customer</label><div class="selected-chip">${esc(c?.name||'')} <button onclick="clearPosCustomer()">✕</button></div>`;
  }
  if(posNewCustomerName){
    return `<label class="form-label">New customer</label>
      <div class="selected-chip">New: ${esc(posNewCustomerName)} <button onclick="clearPosCustomer()">✕</button></div>
      <input class="form-input" id="pos-new-cust-mobile" placeholder="Mobile" value="${esc(posNewCustomerMobile)}" oninput="posNewCustomerMobile=this.value">
      <input class="form-input" id="pos-new-cust-phone" placeholder="Phone" value="${esc(posNewCustomerPhone)}" oninput="posNewCustomerPhone=this.value">
      <input class="form-input" id="pos-new-cust-email" placeholder="Email" value="${esc(posNewCustomerEmail)}" oninput="posNewCustomerEmail=this.value">`;
  }
  return `<label class="form-label">Customer (optional)</label>
    <div class="autocomplete">
      <input class="form-input" id="pos-customer-search" placeholder="Search customer, or leave blank for walk-in…" autocomplete="off" oninput="onPosCustomerSearch(this.value)">
      <div id="pos-customer-results"></div>
    </div>`;
}

function renderPosPage(){
  const main=document.getElementById('main');
  const {gst,totalIncl}=calcInvoiceTotals(posCart,posDiscountType,posDiscountValue);
  let h=`<div class="detail-grid">
    <div class="panel">
      <div class="panel-title" style="margin-bottom:var(--space-3)">Point of Sale</div>
      <div id="pos-customer-area">${posCustomerAreaHtml()}</div>

      <label class="form-label">Add item</label>
      <div class="autocomplete">
        <input class="form-input" id="pos-item-search" placeholder="Search inventory…" oninput="onPosItemSearch(this.value)" autocomplete="off">
        <div id="pos-item-results"></div>
      </div>
      <button class="btn-link" style="margin:calc(var(--space-2) * -1) 0 var(--space-4);display:block" onclick="addPosBlankItem()">+ Add blank line item</button>

      <div class="invoice-items-wrap">
        <table class="invoice-items-table">
          <thead><tr><th>Description</th><th class="qty-col">Qty</th><th class="price-col">Price</th><th class="total-col">Total</th><th class="del-col"></th></tr></thead>
          <tbody>
            ${posCart.map((it,i)=>`<tr>
              <td><input value="${esc(it.description)}" onchange="updatePosItem(${i},'description',this.value)"></td>
              <td class="qty-col"><input type="number" step="1" min="1" value="${it.qty}" onchange="updatePosItem(${i},'qty',this.value)"></td>
              <td class="price-col"><input type="number" step="0.01" value="${it.unit_price}" onchange="updatePosItem(${i},'unit_price',this.value)"></td>
              <td class="total-col">$${(it.qty*it.unit_price).toFixed(2)}</td>
              <td class="del-col"><button class="btn-danger-link" onclick="removePosItem(${i})">✕</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${!posCart.length?'<div class="list-empty">No items yet — search inventory above.</div>':''}

      <div class="invoice-totals" style="margin-top:var(--space-4)">
        <div class="field-row"><span class="field-label">Discount %</span><span class="field-val"><input type="number" step="0.1" style="width:80px;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary)" value="${posDiscountType==='percent'?posDiscountValue:''}" onchange="setPosDiscount('percent',this.value)"></span></div>
        <div class="field-row"><span class="field-label">Discount $</span><span class="field-val"><input type="number" step="0.01" style="width:80px;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary)" value="${posDiscountType==='fixed'?posDiscountValue:''}" onchange="setPosDiscount('fixed',this.value)"></span></div>
        <div class="field-row"><span class="field-label">Subtotal (excl. GST)</span><span class="field-val">$${(totalIncl-gst).toFixed(2)}</span></div>
        <div class="field-row"><span class="field-label">GST</span><span class="field-val">$${gst.toFixed(2)}</span></div>
        <div class="field-row grand"><span class="field-label">Total</span><span class="field-val">$${totalIncl.toFixed(2)}</span></div>
      </div>

      <label class="form-label" style="margin-top:var(--space-3)">Payment method (for Pay)</label>
      <select class="form-select" id="pos-payment-method">
        ${selectablePaymentMethods().map(m=>`<option value="${m}" ${posPaymentMethod===m?'selected':''}>${PAYMENT_METHOD_LABELS[m]}</option>`).join('')}
      </select>

      <div class="form-actions" style="justify-content:flex-start;margin-top:var(--space-2)">
        <button class="btn-primary" onclick="posPay()" ${posCart.length?'':'disabled'}>Pay</button>
        <button class="btn-secondary" onclick="posPark()" ${posCart.length?'':'disabled'}>Park</button>
        <button class="btn-secondary" onclick="posClear()">Clear</button>
      </div>
    </div>
    <div>
      <div class="panel" style="margin-bottom:var(--space-4)">
        <div class="panel-title" style="margin-bottom:var(--space-3)">Parked Sales</div>
        <div class="list-card">
          ${posParkedSales.length?posParkedSales.map(s=>`<div class="list-row" onclick="openInvoiceFromJob('${s.id}','invoice')">
            <div class="job-row-main"><div class="job-row-type">INV-${s.invoice_no}</div><div class="job-row-sub">${esc(s.customer?.name||'Walk-in')}</div></div>
            <div class="list-row-sub">$${posSaleTotal(s).toFixed(2)}</div>
          </div>`).join(''):'<div class="list-empty">No parked sales.</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-title" style="margin-bottom:var(--space-3)">Closed Sales</div>
        <div class="list-card">
          ${posClosedSales.length?posClosedSales.map(s=>`<div class="list-row" onclick="openInvoiceFromJob('${s.id}','invoice')">
            <div class="job-row-main"><div class="job-row-type">INV-${s.invoice_no}</div><div class="job-row-sub">${esc(s.customer?.name||'Walk-in')}</div></div>
            <div class="list-row-sub">$${posSaleTotal(s).toFixed(2)}</div>
          </div>`).join(''):'<div class="list-empty">No closed sales yet.</div>'}
        </div>
      </div>
    </div>
  </div>`;
  main.innerHTML=h;
}

function onPosCustomerSearch(term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('pos-customer-results');
  if(!t){results.innerHTML='';return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(t)).slice(0,8);
  let h='<div class="autocomplete-list">';
  matches.forEach(c=>{h+=`<div class="autocomplete-item" onclick="selectPosCustomer('${c.id}')">${esc(c.name)}${c.mobile?' · '+esc(c.mobile):''}</div>`});
  h+=`<div class="autocomplete-item create-new" onclick="selectPosNewCustomer('${esc(term.trim()).replace(/'/g,"\\'")}')">+ Create new customer "${esc(term.trim())}"</div>`;
  h+='</div>';
  results.innerHTML=h;
}
function selectPosCustomer(id){
  posCustomerId=id;posNewCustomerName='';posNewCustomerMobile='';posNewCustomerPhone='';posNewCustomerEmail='';
  document.getElementById('pos-customer-area').innerHTML=posCustomerAreaHtml();
}
function selectPosNewCustomer(name){
  posCustomerId=null;posNewCustomerName=name;posNewCustomerMobile='';posNewCustomerPhone='';posNewCustomerEmail='';
  document.getElementById('pos-customer-area').innerHTML=posCustomerAreaHtml();
}
function clearPosCustomer(){
  posCustomerId=null;posNewCustomerName='';posNewCustomerMobile='';posNewCustomerPhone='';posNewCustomerEmail='';
  document.getElementById('pos-customer-area').innerHTML=posCustomerAreaHtml();
}

function onPosItemSearch(term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('pos-item-results');
  if(!t){results.innerHTML='';return}
  const matches=stockItems.filter(s=>s.is_active&&(s.name.toLowerCase().includes(t)||(s.sku||'').toLowerCase().includes(t))).slice(0,8);
  results.innerHTML=matches.length?matches.map(s=>`<div class="autocomplete-item" onclick="addPosStockItem('${s.id}')">${esc(s.name)}${s.sku?' ('+esc(s.sku)+')':''}${s.sell_price?' — $'+Number(s.sell_price).toFixed(2):''}</div>`).join(''):'<div class="autocomplete-item" style="color:var(--text-secondary)">No matches</div>';
}
function addPosStockItem(stockId){
  const s=stockItems.find(x=>x.id===stockId);
  if(!s)return;
  posCart.push({description:s.name,qty:1,unit_price:s.sell_price||0,stock_id:s.id});
  renderPosPage();
}
function addPosBlankItem(){
  posCart.push({description:'New item',qty:1,unit_price:0,stock_id:null});
  renderPosPage();
}
function updatePosItem(i,field,value){
  if(!posCart[i])return;
  posCart[i][field]=field==='description'?value:(parseFloat(value)||0);
  if(field==='qty')posCart[i].qty=Math.max(1,Math.round(posCart[i].qty));
  renderPosPage();
}
function removePosItem(i){posCart.splice(i,1);renderPosPage()}
function setPosDiscount(type,value){
  const v=parseFloat(value);
  if(!v){posDiscountType=null;posDiscountValue=0}
  else{posDiscountType=type;posDiscountValue=v}
  renderPosPage();
}
function posClear(){
  posCart=[];posCustomerId=null;posNewCustomerName='';posNewCustomerMobile='';posNewCustomerPhone='';posNewCustomerEmail='';posDiscountType=null;posDiscountValue=0;
  renderPosPage();
}

async function posCommit(finalize){
  if(!posCart.length){showToast('Add at least one item');return}
  const methodEl=document.getElementById('pos-payment-method');
  if(methodEl)posPaymentMethod=methodEl.value;
  try{
    let customerId=posCustomerId;
    if(!customerId&&posNewCustomerName.trim()){
      const {data,error}=await sb.from('desk_customers').insert({
        name:posNewCustomerName.trim(),
        mobile:posNewCustomerMobile.trim()||null,
        phone:posNewCustomerPhone.trim()||null,
        email:posNewCustomerEmail.trim()||null
      }).select();
      if(error)throw error;
      customerId=data[0].id;
      await loadCustomers();
    }
    if(!customerId)customerId=await getOrCreateWalkInCustomer();
    if(!customerId){showToast('Could not set up a customer for this sale');return}
    const {data,error}=await sb.from('desk_invoices').insert({customer_id:customerId,doc_type:'invoice',is_pos_sale:true,discount_type:posDiscountType,discount_value:posDiscountValue}).select();
    if(error)throw error;
    const invoiceId=data[0].id;
    const items=posCart.map((it,i)=>({invoice_id:invoiceId,description:it.description,qty:it.qty,unit_price:it.unit_price,stock_id:it.stock_id||null,sort_order:i}));
    const {error:itemsErr}=await sb.from('desk_invoice_items').insert(items);
    if(itemsErr)throw itemsErr;
    if(finalize){
      const {totalIncl}=calcInvoiceTotals(posCart,posDiscountType,posDiscountValue);
      const {error:payErr}=await sb.from('desk_payments').insert({invoice_id:invoiceId,amount:totalIncl,method:posPaymentMethod,paid_at:toDateInputValue(new Date()),notes:'POS sale'});
      if(payErr)throw payErr;
      await sb.from('desk_invoices').update({status:'paid'}).eq('id',invoiceId);
    }
    showToast(finalize?'Sale complete':'Sale parked');
    posClear();
    await loadPosSales();
    renderPosPage();
  }catch(e){showToast(''+(e.message||'Could not save sale'))}
}
function posPay(){posCommit(true)}
function posPark(){posCommit(false)}

// ── SALES PROJECTION (value of the booked-in pipeline — jobs that
// haven't finished yet, so it's forward-looking, unlike the Reports
// section which is all actuals off invoices) ──────────────────
let pipelineJobs=[];

async function loadPipelineJobs(){
  try{
    const {data,error}=await sb.from('desk_jobs')
      .select('id,job_type,booked_at,estimated_value,status,source_id,customer:desk_customers(name)')
      .eq('is_deleted',false)
      .neq('status','finished')
      .not('booked_at','is',null)
      .order('booked_at');
    if(error)throw error;
    pipelineJobs=data||[];
  }catch(e){pipelineJobs=[];showToast('Could not load pipeline')}
}

async function renderPipelineView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  if(!jobSources.length)await loadJobSources();
  await loadPipelineJobs();
  renderPipelinePage();
}

function pipelineSourceName(j){
  if(!j.source_id)return 'Not set';
  return jobSources.find(s=>s.id===j.source_id)?.name||'Not set';
}

function renderPipelinePage(){
  const main=document.getElementById('main');
  const valued=pipelineJobs.filter(j=>j.estimated_value!=null);
  const total=valued.reduce((s,j)=>s+Number(j.estimated_value),0);
  const missing=pipelineJobs.length-valued.length;

  const buckets={};
  valued.forEach(j=>{
    const wk=toDateInputValue(startOfWeek(new Date(j.booked_at)));
    buckets[wk]=(buckets[wk]||0)+Number(j.estimated_value);
  });
  const chartData=Object.keys(buckets).sort().map(wk=>({label:fmtDate(wk).replace(/ \d{4}/,''),value:buckets[wk]}));

  const srcBuckets={};
  valued.forEach(j=>{
    const name=pipelineSourceName(j);
    srcBuckets[name]=(srcBuckets[name]||0)+Number(j.estimated_value);
  });
  const srcEntries=Object.entries(srcBuckets).sort((a,b)=>b[1]-a[1]);

  let h=`<div style="max-width:1000px">
    <div class="panel-head" style="margin-bottom:var(--space-3)"><div class="panel-title">Sales Projection</div></div>
    <div class="detail-grid" style="grid-template-columns:1fr 1fr;margin-bottom:var(--space-4)">
      <div class="panel">
        <div class="field-label">Booked-in pipeline value</div>
        <div style="font-size:32px;font-weight:800;margin-top:var(--space-1)">$${total.toFixed(2)}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:var(--space-1)">${valued.length} job${valued.length===1?'':'s'} with a value set${missing?` · ${missing} job${missing===1?'':'s'} with no value yet`:''}</div>
      </div>
      <div class="panel">
        <canvas id="pipeline-bar-canvas" width="500" height="140" style="max-width:100%;height:auto"></canvas>
      </div>
    </div>
    <div style="margin-bottom:var(--space-4)">
      <div class="panel-title" style="margin-bottom:var(--space-3)">By Source</div>
      ${chartPanelHtml('pipeline-source-canvas',srcEntries,total)}
    </div>
    <div class="invoice-items-wrap">
      <table class="invoice-items-table">
        <thead><tr><th>Date</th><th>Customer</th><th>Job type</th><th>Source</th><th>Status</th><th style="text-align:right">Value</th></tr></thead>
        <tbody>
          ${pipelineJobs.length?pipelineJobs.map(j=>`<tr class="clickable-row" onclick="quickSearchGoJob('${j.id}')">
            <td>${fmtDateTime(j.booked_at)}</td>
            <td>${esc(j.customer?.name||'—')}</td>
            <td>${esc(j.job_type)}</td>
            <td>${esc(pipelineSourceName(j))}</td>
            <td><span class="status-badge ${j.status}">${JOB_STATUS_LABELS[j.status]}</span></td>
            <td style="text-align:right">${j.estimated_value!=null?'$'+Number(j.estimated_value).toFixed(2):'<span style="color:var(--text-secondary)">—</span>'}</td>
          </tr>`).join(''):'<tr><td colspan="6"><div class="list-empty">No booked jobs in the pipeline right now.</div></td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
  main.innerHTML=h;
  drawBarChart('pipeline-bar-canvas',chartData);
  drawPieChart('pipeline-source-canvas',srcEntries.map(([label,value])=>({label,value})));
}

// ── CUSTOMER CREDIT NOTES ───────────────────────────────────
const CREDIT_NOTE_STATUS_LABELS={draft:'Draft',issued:'Issued',void:'Void'};
const CREDIT_APPLICATION_METHOD_LABELS={applied_to_invoice:'Applied to Invoice',refund_cash:'Refunded — Cash',refund_eftpos:'Refunded — EFTPOS',refund_bank_transfer:'Refunded — Bank Transfer',write_off:'Written Off',other:'Other'};
let creditNotes=[];
let creditNoteStatusFilter='all';
let selectedCreditNoteId=null;
let creditNoteItems=[];
let creditApplications=[];
let newCreditNoteCustomerId=null;
let newCreditNoteInvoices=[]; // that customer's invoices, for the optional "originating invoice" link

// ── XERO PREP (schema/catalog only — no live connection yet) ───
let xeroAccounts=[];
let xeroPaymentAccountMap={cash:'',eftpos:'',afterpay:'',zippay:'',amex:'',bank_transfer:'',other:''};
const XERO_TAX_TYPES=['GST on Income','GST Free Income','BAS Excluded'];

// ── EMPLOYEES / TIMESHEETS ───────────────────────────────────
let employees=[];
let timesheets=[];
let timesheetsFrom=null;
let timesheetsTo=null;
let timesheetsRangePreset='week';
let timesheetsEmployeeFilter='all';

// ── BILLS (accounts payable) ────────────────────────────────
const BILL_STATUS_LABELS={draft:'Draft',awaiting_payment:'Awaiting Payment',paid:'Paid'};
let bills=[];
let billStatusFilter='all';
let selectedBillId=null;
let billPayments=[];

// ── PURCHASE ORDERS ──────────────────────────────────────────
const PO_STATUS_LABELS={open:'Open',received:'Received',cancelled:'Cancelled'};
let purchaseOrders=[];
let poStatusFilter='all';
let selectedPoId=null;
let poItems=[];

// ── INVENTORY ─────────────────────────────────────────────────
let stockItems=[];
let stockSearchTerm='';
let showInactiveStock=false;
let inventorySubView='stock'; // 'stock' | 'suppliers'
let suppliers=[];
let supplierSearchTerm='';
let stockCategories=[]; // flat list — MechanicDesk's own Category dropdown showed no nesting

async function loadStockItems(){
  try{
    const {data,error}=await sb.from('desk_stock').select('*,supplier:desk_suppliers(name),category:desk_stock_categories(id,name)').order('name');
    if(error)throw error;
    stockItems=data||[];
  }catch(e){stockItems=[];showToast('Could not load inventory')}
}

async function loadStockCategories(){
  try{
    const {data,error}=await sb.from('desk_stock_categories').select('*').order('name');
    if(error)throw error;
    stockCategories=data||[];
  }catch(e){stockCategories=[]}
}

async function loadSuppliers(){
  try{
    const {data,error}=await sb.from('desk_suppliers').select('*').order('name');
    if(error)throw error;
    suppliers=data||[];
  }catch(e){suppliers=[]}
}

async function renderInventoryView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  if(inventorySubView==='purchase-orders'){
    selectedPoId=null;
    poStatusFilter='all';
    await Promise.all([loadPurchaseOrders(),loadSuppliers(),loadStockItems()]);
    renderPoList();
    return;
  }
  await loadStockItems();
  await loadSuppliers();
  await loadStockCategories();
  if(inventorySubView==='suppliers'){renderSuppliersList()}else{renderStockList()}
}

function switchInventorySubView(v){
  inventorySubView=v;
  renderInventoryView();
}

function inventoryTabBar(){
  return `<div class="status-tabs">
    <button class="status-tab ${inventorySubView==='stock'?'active':''}" onclick="switchInventorySubView('stock')">Stock</button>
    <button class="status-tab ${inventorySubView==='suppliers'?'active':''}" onclick="switchInventorySubView('suppliers')">Suppliers</button>
    <button class="status-tab ${inventorySubView==='purchase-orders'?'active':''}" onclick="switchInventorySubView('purchase-orders')">Purchase Orders</button>
  </div>`;
}

function renderStockList(){
  const main=document.getElementById('main');
  const term=stockSearchTerm.toLowerCase();
  const filtered=stockItems.filter(s=>(showInactiveStock||s.is_active)&&(!term||[s.name,s.sku,s.stock_number,s.barcode].join(' ').toLowerCase().includes(term)));
  let h=inventoryTabBar();
  h+=`<div class="toolbar">
    <input class="search-input" id="stock-search" placeholder="Search inventory by name or SKU…" value="${esc(stockSearchTerm)}" oninput="onStockSearch(this.value)">
    <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;color:var(--text-secondary);white-space:nowrap"><input type="checkbox" id="show-inactive-stock" ${showInactiveStock?'checked':''} onchange="toggleShowInactiveStock(this.checked)"> Show inactive</label>
    <button class="btn-primary" onclick="openStockModal()">+ New Stock Item</button>
  </div>`;
  if(!filtered.length){
    h+=`<div class="list-card"><div class="list-empty">${stockItems.length?'No items match.':'No inventory yet — add your first item.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    filtered.forEach(s=>{
      // "Stock Alert" fields are otherwise write-only — captured in the form,
      // never surfaced anywhere — so the one place this app has an inventory
      // list is where the threshold actually needs to show up.
      const lowStock=s.is_physical&&s.qty_on_hand!=null&&(s.alert_quantity!=null||s.reorder_point!=null)
        &&s.qty_on_hand<=Math.max(s.alert_quantity||0,s.reorder_point||0);
      const stockSub=s.is_physical&&s.qty_on_hand!=null?s.qty_on_hand+' in stock':(s.is_physical?'':'Service');
      h+=`<div class="list-row" onclick="openStockModal('${s.id}')">
        <div class="list-row-name">${s.is_physical?'📦':'🔧'} ${esc(s.name)}${!s.is_active?' <span style="color:var(--text-secondary);font-weight:400">(inactive)</span>':''}${lowStock?' <span class="status-badge on_hold">Low stock</span>':''}</div>
        <div class="list-row-sub">${esc(s.sku||s.stock_number||'')}</div>
        <div class="list-row-sub">${esc(s.category?.name||'')}</div>
        <div class="list-row-sub">${esc(s.supplier?.name||'')}</div>
        <div class="list-row-sub">${stockSub}</div>
        <div class="list-row-sub" style="font-weight:700">$${Number(s.sell_price).toFixed(2)}</div>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function onStockSearch(v){
  stockSearchTerm=v;renderStockList();
  setTimeout(()=>{const i=document.getElementById('stock-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}
function toggleShowInactiveStock(v){showInactiveStock=v;renderStockList()}

// ── New/Edit Stock — MechanicDesk field parity (2026-07-27) ──────────
// Matches mdweb/workshops/stocks/new field-for-field, EXCEPT two things that
// are separate features wearing a field's disguise, left out on purpose:
//   - "Is Kit?" — bundling stock items into a kit that explodes into its
//     components on an invoice needs its own table + invoice-item logic.
//   - Purchase/Sale/Inventory Asset Account per item — Xero sync isn't
//     connected yet (see Settings → Xero Accounts), so live dropdowns here
//     would front a feature with nothing behind them.
//
// Buy price note: MechanicDesk's own field is "Buy Price EXCL. GST" with a
// read-only "Incl. GST" companion. Our existing `buy_price` column is
// INCL. GST and feeds COGS/margin reports and PO cost pre-fill elsewhere
// (grep `buy_price` in this file) — reinterpreting it would silently change
// every historical margin figure. So the column and those call sites are
// UNTOUCHED; only this form's presentation changes to match MechanicDesk:
// the input asks for excl.-GST cost (right label, right field), and the
// existing incl.-GST value is what's actually stored, computed at a flat
// 10% (same rate the rest of the app already assumes for GST). Existing
// items are shown correctly either way — see stockBuyPriceExclFromIncl().
const STOCK_GST_RATE=1.1;
function stockBuyPriceExclFromIncl(incl){return incl!=null?Math.round((incl/STOCK_GST_RATE)*100)/100:''}
function stockInclFromExcl(excl){return excl!==''&&excl!=null&&!isNaN(excl)?(Number(excl)*STOCK_GST_RATE).toFixed(2):''}

function stockGstPairInputsHtml(prefix,exclVal){
  return `<div class="form-row-2">
    <div><label class="form-label">${prefix==='sf-buy'?'Buy Price Excl. GST':'Custom And Duty'}</label>
      <input class="form-input" type="number" step="0.01" id="${prefix}-excl" value="${exclVal}" oninput="onStockGstPairInput('${prefix}')"></div>
    <div><label class="form-label">Incl. GST</label>
      <input class="form-input form-input-computed" id="${prefix}-incl" value="${stockInclFromExcl(exclVal)}" readonly tabindex="-1"></div>
  </div>`;
}
function onStockGstPairInput(prefix){
  const exclEl=document.getElementById(prefix+'-excl'),inclEl=document.getElementById(prefix+'-incl');
  if(exclEl&&inclEl)inclEl.value=stockInclFromExcl(exclEl.value);
}

function openStockModal(id){
  const s=id?stockItems.find(x=>x.id===id):null;
  const isPhysical=s?s.is_physical:true;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card" style="max-width:760px">
      <div class="modal-title">${s?'Edit stock item':'New stock item'}</div>
      <div class="detail-grid">
        <div>
          <div class="modal-section-title">Stock</div>
          <label class="form-label">Name *</label>
          <input class="form-input" id="sf-name" value="${s?esc(s.name):''}">
          <div class="form-row-2">
            <div><label class="form-label">Stock Number</label><input class="form-input" id="sf-stock-number" value="${s?esc(s.stock_number||''):''}"></div>
            <div><label class="form-label">SKU</label><input class="form-input" id="sf-sku" value="${s?esc(s.sku||''):''}"></div>
          </div>
          <label class="form-label">Category</label>
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
            <select class="form-select" id="sf-category" style="margin-bottom:0;flex:1">
              <option value="">— Select a category —</option>
              ${stockCategories.map(c=>`<option value="${c.id}" ${s&&s.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn-secondary" onclick="toggleStockCategoryQuickAdd()">+</button>
          </div>
          <div id="sf-category-quick-add"></div>
          <div class="form-row-2">
            <div><label class="form-label">Location</label><input class="form-input" id="sf-location" value="${s?esc(s.location||''):''}"></div>
            <div><label class="form-label">Bin</label><input class="form-input" id="sf-bin" value="${s?esc(s.bin||''):''}"></div>
          </div>
          <label class="form-label">Barcode</label>
          <input class="form-input" id="sf-barcode" value="${s?esc(s.barcode||''):''}" ${s&&s.barcode&&s.barcode.startsWith('DHF')?'disabled':''} style="margin-bottom:var(--space-2)">
          <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)">
            <input type="checkbox" id="sf-barcode-generate" ${s&&s.barcode&&s.barcode.startsWith('DHF')?'checked':''} onchange="onStockBarcodeGenerateChange()"> Generate
          </label>
          <label class="form-label">Type</label>
          <select class="form-select" id="sf-physical" onchange="onStockPhysicalChange(this.value)">
            <option value="true" ${isPhysical?'selected':''}>Physical item</option>
            <option value="false" ${!isPhysical?'selected':''}>Service / labour (no stock count)</option>
          </select>
          <div id="sf-qty-area"></div>
          <label class="form-label">Unit Of Measure</label>
          <input class="form-input" id="sf-uom" value="${s?esc(s.unit_of_measure||''):''}" placeholder="e.g. each, box, litre">
          <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)">
            <input type="checkbox" id="sf-gst-free" ${s&&s.gst_free?'checked':''}> GST Free?
          </label>

          <div class="modal-section-title">Prices</div>
          ${stockGstPairInputsHtml('sf-buy',s?stockBuyPriceExclFromIncl(s.buy_price):'')}
          ${stockGstPairInputsHtml('sf-cd',s&&s.custom_and_duty!=null?s.custom_and_duty:'')}
          <label class="form-label">Sell Price Incl. GST</label>
          <input class="form-input" type="number" step="0.01" id="sf-price" value="${s?s.sell_price:'0'}">
          ${[2,3,4,5,6,7].map(n=>`<label class="form-label">Price Lvl ${n} Incl. GST</label><input class="form-input" type="number" step="0.01" id="sf-price-lvl-${n}" value="${s&&s['price_lvl_'+n]!=null?s['price_lvl_'+n]:''}">`).join('')}
          <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-2)">
            <input type="checkbox" id="sf-hide-qty" ${s&&s.hide_qty_on_invoice?'checked':''}> Hide Quantity On Invoice
          </label>
          <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)">
            <input type="checkbox" id="sf-non-discount" ${s&&s.non_discount?'checked':''}> Non Discount (invoice % discount doesn't apply to this item)
          </label>
          <div class="form-row-2">
            <div><label class="form-label">Default Invoice Qty.</label><input class="form-input" type="number" step="0.01" id="sf-default-inv-qty" value="${s&&s.default_invoice_qty!=null?s.default_invoice_qty:''}"></div>
            <div><label class="form-label">Default Purchasing Qty.</label><input class="form-input" type="number" step="0.01" id="sf-default-po-qty" value="${s&&s.default_purchasing_qty!=null?s.default_purchasing_qty:''}"></div>
          </div>
          <label class="form-label">Invoice Description</label>
          <textarea class="form-textarea" id="sf-invoice-desc">${s?esc(s.invoice_description||''):''}</textarea>
        </div>
        <div>
          <div class="modal-section-title">Stock Alert</div>
          <label class="form-label">Alert Quantity</label>
          <input class="form-input" type="number" id="sf-alert-qty" value="${s&&s.alert_quantity!=null?s.alert_quantity:''}">
          <label class="form-label">Reorder Point</label>
          <input class="form-input" type="number" id="sf-reorder-point" value="${s&&s.reorder_point!=null?s.reorder_point:''}">
          <label class="form-label">Max Quantity</label>
          <input class="form-input" type="number" id="sf-max-qty" value="${s&&s.max_quantity!=null?s.max_quantity:''}">

          <div class="modal-section-title">Supplier</div>
          <label class="form-label">Supplier</label>
          <select class="form-select" id="sf-supplier">
            <option value="">— None —</option>
            ${suppliers.map(sup=>`<option value="${sup.id}" ${s&&s.supplier_id===sup.id?'selected':''}>${esc(sup.name)}</option>`).join('')}
          </select>
          <label class="form-label">Supplier Stock No#</label>
          <input class="form-input" id="sf-supplier-stock-no" value="${s?esc(s.supplier_stock_no||''):''}">
          <label class="form-label">Supplier SKU</label>
          <input class="form-input" id="sf-supplier-sku" value="${s?esc(s.supplier_sku||''):''}">

          <div class="modal-section-title">Specification</div>
          <div class="form-row-2">
            <div><label class="form-label">Brand</label><input class="form-input" id="sf-brand" value="${s?esc(s.brand||''):''}"></div>
            <div><label class="form-label">Model</label><input class="form-input" id="sf-model" value="${s?esc(s.model||''):''}"></div>
          </div>
          <div class="form-row-2">
            <div><label class="form-label">Size</label><input class="form-input" id="sf-size" value="${s?esc(s.size||''):''}"></div>
            <div><label class="form-label">Weight</label><input class="form-input" id="sf-weight" value="${s?esc(s.weight||''):''}"></div>
          </div>
          <label class="form-label">Specification/Note</label>
          <textarea class="form-textarea" id="sf-spec-note">${s?esc(s.specification_note||''):''}</textarea>
        </div>
      </div>
      ${s?`<label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)"><input type="checkbox" id="sf-active" ${s.is_active?'checked':''}> Active</label>`:''}
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveStockForm(${s?`'${s.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  renderStockQtyArea(isPhysical,s&&s.qty_on_hand!=null?s.qty_on_hand:'');
  document.getElementById('sf-name').focus();
}

function renderStockQtyArea(isPhysical,qtyVal){
  const area=document.getElementById('sf-qty-area');
  if(!area)return;
  area.innerHTML=isPhysical?`<label class="form-label">Quantity</label><input class="form-input" type="number" id="sf-qty" value="${qtyVal}">`:'';
}

function onStockPhysicalChange(v){
  renderStockQtyArea(v==='true','');
}

// "Generate" — MechanicDesk auto-fills a barcode rather than asking the user
// to type/scan one. No real EAN checksum needed for an internal-only label;
// this just needs to be short, unique, and obviously not a real UPC.
function onStockBarcodeGenerateChange(){
  const cb=document.getElementById('sf-barcode-generate'),input=document.getElementById('sf-barcode');
  if(!cb||!input)return;
  input.disabled=cb.checked;
  if(cb.checked){
    input.dataset.priorValue=input.value; // restore this if Generate gets unchecked again
    input.value='(generated on save)';
  }else{
    input.value=input.dataset.priorValue&&input.dataset.priorValue!=='(generated on save)'?input.dataset.priorValue:'';
  }
}
function generateStockBarcode(){
  return 'DHF'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();
}

// Category "+": an inline create row rather than a modal-on-modal (stacking
// two .modal-overlay backdrops reads as broken, not layered).
function toggleStockCategoryQuickAdd(){
  const area=document.getElementById('sf-category-quick-add');
  if(!area)return;
  if(area.innerHTML.trim()){area.innerHTML='';return}
  area.innerHTML=`<div class="tag-create-row" style="margin-bottom:var(--space-4)">
    <input type="text" id="sf-new-category-name" placeholder="New category name">
    <button type="button" class="btn-secondary" onclick="saveStockCategoryQuickAdd()">Add</button>
  </div>`;
  document.getElementById('sf-new-category-name').focus();
}
async function saveStockCategoryQuickAdd(){
  const name=document.getElementById('sf-new-category-name').value.trim();
  if(!name){showToast('Category name is required');return}
  try{
    const {data,error}=await sb.from('desk_stock_categories').insert({name}).select();
    if(error)throw error;
    await loadStockCategories();
    document.getElementById('sf-category-quick-add').innerHTML='';
    const sel=document.getElementById('sf-category');
    sel.innerHTML=`<option value="">— Select a category —</option>${stockCategories.map(c=>`<option value="${c.id}" ${c.id===data[0].id?'selected':''}>${esc(c.name)}</option>`).join('')}`;
    showToast('Category added');
  }catch(e){showToast(e.message&&e.message.includes('duplicate')?'That category already exists':'Could not add category')}
}

async function saveStockForm(id){
  const name=document.getElementById('sf-name').value.trim();
  if(!name){showToast('Name is required');return}
  const isPhysical=document.getElementById('sf-physical').value==='true';
  const qtyEl=document.getElementById('sf-qty');
  const qtyVal=qtyEl?qtyEl.value:'';
  const supplierVal=document.getElementById('sf-supplier').value;
  const categoryVal=document.getElementById('sf-category').value;
  const buyExcl=document.getElementById('sf-buy-excl').value;
  const cdExcl=document.getElementById('sf-cd-excl').value;
  const generateBarcode=document.getElementById('sf-barcode-generate').checked;
  const typedBarcode=document.getElementById('sf-barcode').value.trim();
  const num=elId=>{const v=document.getElementById(elId).value;return v!==''?parseFloat(v):null};
  const payload={
    name,
    sku:document.getElementById('sf-sku').value.trim()||null,
    stock_number:document.getElementById('sf-stock-number').value.trim()||null,
    category_id:categoryVal||null,
    location:document.getElementById('sf-location').value.trim()||null,
    bin:document.getElementById('sf-bin').value.trim()||null,
    barcode:generateBarcode?(id?(stockItems.find(x=>x.id===id)?.barcode||generateStockBarcode()):generateStockBarcode()):(typedBarcode||null),
    sell_price:parseFloat(document.getElementById('sf-price').value)||0,
    is_physical:isPhysical,
    qty_on_hand:isPhysical&&qtyVal?parseInt(qtyVal,10):null,
    // Stored incl.-GST, computed from the excl.-GST field the user actually
    // typed into — see the note above openStockModal().
    buy_price:buyExcl!==''?Number(stockInclFromExcl(buyExcl)):null,
    custom_and_duty:cdExcl!==''?parseFloat(cdExcl):null,
    supplier_id:supplierVal||null,
    unit_of_measure:document.getElementById('sf-uom').value.trim()||null,
    gst_free:document.getElementById('sf-gst-free').checked,
    price_lvl_2:num('sf-price-lvl-2'),
    price_lvl_3:num('sf-price-lvl-3'),
    price_lvl_4:num('sf-price-lvl-4'),
    price_lvl_5:num('sf-price-lvl-5'),
    price_lvl_6:num('sf-price-lvl-6'),
    price_lvl_7:num('sf-price-lvl-7'),
    hide_qty_on_invoice:document.getElementById('sf-hide-qty').checked,
    non_discount:document.getElementById('sf-non-discount').checked,
    default_invoice_qty:num('sf-default-inv-qty'),
    default_purchasing_qty:num('sf-default-po-qty'),
    invoice_description:document.getElementById('sf-invoice-desc').value.trim()||null,
    alert_quantity:num('sf-alert-qty'),
    reorder_point:num('sf-reorder-point'),
    max_quantity:num('sf-max-qty'),
    supplier_stock_no:document.getElementById('sf-supplier-stock-no').value.trim()||null,
    supplier_sku:document.getElementById('sf-supplier-sku').value.trim()||null,
    brand:document.getElementById('sf-brand').value.trim()||null,
    model:document.getElementById('sf-model').value.trim()||null,
    size:document.getElementById('sf-size').value.trim()||null,
    weight:document.getElementById('sf-weight').value.trim()||null,
    specification_note:document.getElementById('sf-spec-note').value.trim()||null,
    updated_at:new Date().toISOString()
  };
  const activeEl=document.getElementById('sf-active');
  if(activeEl)payload.is_active=activeEl.checked;
  try{
    if(id){
      const before=stockItems.find(s=>s.id===id);
      const {error}=await sb.from('desk_stock').update(payload).eq('id',id);
      if(error)throw error;
      const qtyBefore=before?Number(before.qty_on_hand)||0:null;
      const qtyAfter=payload.qty_on_hand!=null?Number(payload.qty_on_hand):null;
      if(qtyBefore!=null&&qtyAfter!=null&&qtyBefore!==qtyAfter){
        await sb.from('desk_stock_adjustments').insert({stock_id:id,qty_before:qtyBefore,qty_after:qtyAfter,reason:'Manual edit'});
      }
    }else{
      const {error}=await sb.from('desk_stock').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Stock item updated':'Stock item added');
    await loadStockItems();
    renderStockList();
  }catch(e){showToast('Save failed')}
}

// ── Suppliers (sub-tab of Inventory) ─────────────────────────
function renderSuppliersList(){
  const main=document.getElementById('main');
  const term=supplierSearchTerm.toLowerCase();
  const filtered=suppliers.filter(s=>!term||[s.name,s.contact_name,s.phone,s.email].join(' ').toLowerCase().includes(term));
  let h=inventoryTabBar();
  h+=`<div class="toolbar">
    <input class="search-input" id="supplier-search" placeholder="Search suppliers by name, contact, phone, email…" value="${esc(supplierSearchTerm)}" oninput="onSupplierSearch(this.value)">
    <button class="btn-primary" onclick="openSupplierModal()">+ New Supplier</button>
  </div>`;
  if(!filtered.length){
    h+=`<div class="list-card"><div class="list-empty">${suppliers.length?'No suppliers match.':'No suppliers yet — add your first one.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    filtered.forEach(s=>{
      h+=`<div class="list-row" onclick="openSupplierModal('${s.id}')">
        <div class="list-row-name">${esc(s.name)}${!s.is_active?' <span style="color:var(--text-secondary);font-weight:400">(inactive)</span>':''}</div>
        <div class="list-row-sub">${esc(s.contact_name||'')}</div>
        <div class="list-row-sub">${esc(s.phone||'')}</div>
        <div class="list-row-sub">${esc(s.email||'')}</div>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function onSupplierSearch(v){
  supplierSearchTerm=v;renderSuppliersList();
  setTimeout(()=>{const i=document.getElementById('supplier-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}

function openSupplierModal(id){
  const s=id?suppliers.find(x=>x.id===id):null;
  const buyingGroupOptions=suppliers.filter(x=>x.is_creditor_group&&x.id!==id);
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${s?'Edit supplier':'New supplier'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="sup-name" value="${s?esc(s.name):''}">
      <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)"><input type="checkbox" id="sup-creditor-group" ${s&&s.is_creditor_group?'checked':''}> Is Creditor/Buying Group (e.g. Capricorn)</label>
      <label class="form-label">Account Number</label>
      <input class="form-input" id="sup-account" value="${s?esc(s.account_number||''):''}">
      <label class="form-label">ABN</label>
      <input class="form-input" id="sup-abn" value="${s?esc(s.abn||''):''}">
      <label class="form-label">Phone</label>
      <input class="form-input" id="sup-phone" value="${s?esc(s.phone||''):''}">
      <label class="form-label">Mobile</label>
      <input class="form-input" id="sup-mobile" value="${s?esc(s.mobile||''):''}">
      <label class="form-label">Fax</label>
      <input class="form-input" id="sup-fax" value="${s?esc(s.fax||''):''}">
      <label class="form-label">Email</label>
      <input class="form-input" id="sup-email" value="${s?esc(s.email||''):''}">
      <label class="form-label">Website</label>
      <input class="form-input" id="sup-website" value="${s?esc(s.website||''):''}">
      <label class="form-label">Contact Person</label>
      <input class="form-input" id="sup-contact" value="${s?esc(s.contact_name||''):''}">
      <label class="form-label">Address</label>
      <input class="form-input" id="sup-address-search" placeholder="Start typing an address…" autocomplete="off">
      <input class="form-input" id="sup-street" placeholder="Street" value="${s?esc(s.street_line||''):''}">
      <input class="form-input" id="sup-suburb" placeholder="Suburb" value="${s?esc(s.suburb||''):''}">
      <input class="form-input" id="sup-state" placeholder="State" value="${s?esc(s.state||''):''}">
      <input class="form-input" id="sup-postcode" placeholder="Postcode" value="${s?esc(s.postcode||''):''}">
      <label class="form-label">Payment Term</label>
      <input class="form-input" id="sup-payment" value="${s?esc(s.payment_term||''):''}">
      <label class="form-label">Creditor/Buying Group</label>
      <select class="form-select" id="sup-buying-group">
        <option value="">— None —</option>
        ${buyingGroupOptions.map(g=>`<option value="${g.id}" ${s&&s.buying_group_id===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}
      </select>
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="sup-notes">${s?esc(s.notes||''):''}</textarea>
      ${s?`<label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-4)"><input type="checkbox" id="sup-active" ${s.is_active?'checked':''}> Active</label>`:''}
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveSupplierForm(${s?`'${s.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('sup-name').focus();
  initAddressAutocomplete('sup-address-search','sup');
}

async function saveSupplierForm(id){
  const name=document.getElementById('sup-name').value.trim();
  if(!name){showToast('Name is required');return}
  const buyingGroupVal=document.getElementById('sup-buying-group').value;
  const payload={
    name,
    is_creditor_group:document.getElementById('sup-creditor-group').checked,
    account_number:document.getElementById('sup-account').value.trim()||null,
    abn:document.getElementById('sup-abn').value.trim()||null,
    contact_name:document.getElementById('sup-contact').value.trim()||null,
    phone:document.getElementById('sup-phone').value.trim()||null,
    mobile:document.getElementById('sup-mobile').value.trim()||null,
    fax:document.getElementById('sup-fax').value.trim()||null,
    email:document.getElementById('sup-email').value.trim()||null,
    website:document.getElementById('sup-website').value.trim()||null,
    street_line:document.getElementById('sup-street').value.trim()||null,
    suburb:document.getElementById('sup-suburb').value.trim()||null,
    state:document.getElementById('sup-state').value.trim()||null,
    postcode:document.getElementById('sup-postcode').value.trim()||null,
    payment_term:document.getElementById('sup-payment').value.trim()||null,
    buying_group_id:buyingGroupVal||null,
    notes:document.getElementById('sup-notes').value.trim()||null,
    updated_at:new Date().toISOString()
  };
  const activeEl=document.getElementById('sup-active');
  if(activeEl)payload.is_active=activeEl.checked;
  try{
    if(id){
      const {error}=await sb.from('desk_suppliers').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_suppliers').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Supplier updated':'Supplier added');
    await loadSuppliers();
    renderSuppliersList();
  }catch(e){showToast('Save failed')}
}

// ── Purchase Orders (sub-tab of Inventory) ───────────────────
async function loadPurchaseOrders(){
  try{
    const {data,error}=await sb.from('desk_purchase_orders').select('*,supplier:desk_suppliers(name),items:desk_purchase_order_items(description,qty,unit_cost,stock_id)').order('order_date',{ascending:false});
    if(error)throw error;
    purchaseOrders=data||[];
  }catch(e){purchaseOrders=[];showToast('Could not load purchase orders')}
}

function poTotal(po){return (po.items||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_cost),0)}

function setPoFilter(f){poStatusFilter=f;renderPoList()}
function filteredPos(){return poStatusFilter==='all'?purchaseOrders:purchaseOrders.filter(p=>p.status===poStatusFilter)}

function renderPoList(){
  const main=document.getElementById('main');
  const list=filteredPos();
  let h=inventoryTabBar();
  h+=`<div class="status-tabs">
    ${['all',...Object.keys(PO_STATUS_LABELS)].map(s=>`<button class="status-tab ${poStatusFilter===s?'active':''}" onclick="setPoFilter('${s}')">${s==='all'?'All':PO_STATUS_LABELS[s]}</button>`).join('')}
  </div>
  <div class="toolbar"><button class="btn-primary" onclick="openNewPoModal()">+ New Purchase Order</button></div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${purchaseOrders.length?'No matches.':'No purchase orders yet.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(po=>{
      h+=`<div class="list-row" onclick="openPo('${po.id}')">
        <div class="list-row-name">PO-${po.po_no}</div>
        <div class="list-row-sub" style="flex:1">${esc(po.supplier?.name||'Unknown supplier')}</div>
        <div class="list-row-sub">${fmtDate(po.order_date)}</div>
        <div class="list-row-sub" style="font-weight:700">$${poTotal(po).toFixed(2)}</div>
        <span class="status-badge ${po.status==='received'?'finished':po.status==='cancelled'?'on_hold':'draft'}">${PO_STATUS_LABELS[po.status]}</span>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

async function openPo(id){selectedPoId=id;await renderPoDetail(id)}
function backFromPoDetail(){selectedPoId=null;renderPoList()}

function openNewPoModal(){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">New Purchase Order</div>
      <label class="form-label">Supplier *</label>
      <select class="form-select" id="pf-supplier">
        <option value="">— Select —</option>
        ${suppliers.filter(s=>s.is_active!==false).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select>
      <label class="form-label">Order date</label>
      <input class="form-input" type="date" id="pf-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Due date</label>
      <input class="form-input" type="date" id="pf-due">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="savePoForm()">Create</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function savePoForm(){
  const supplierId=document.getElementById('pf-supplier').value;
  if(!supplierId){showToast('Pick a supplier');return}
  const payload={
    supplier_id:supplierId,
    order_date:document.getElementById('pf-date').value,
    due_date:document.getElementById('pf-due').value||null
  };
  try{
    const {data,error}=await sb.from('desk_purchase_orders').insert(payload).select();
    if(error)throw error;
    closeModal();
    showToast('Purchase order created');
    await loadPurchaseOrders();
    selectedPoId=data[0].id;
    await renderPoDetail(data[0].id);
  }catch(e){showToast('Could not create')}
}

async function loadPoItems(poId){
  try{
    const {data,error}=await sb.from('desk_purchase_order_items').select('*').eq('po_id',poId).order('id');
    if(error)throw error;
    poItems=data||[];
  }catch(e){poItems=[]}
}

async function renderPoDetail(id){
  const main=document.getElementById('main');
  const po=purchaseOrders.find(x=>x.id===id);
  if(!po){selectedPoId=null;renderPoList();return}
  await loadPoItems(id);
  const total=poItems.reduce((s,it)=>s+Number(it.qty)*Number(it.unit_cost),0);
  let h=`<button class="back-link" onclick="backFromPoDetail()">← All purchase orders</button>
  <div class="panel" style="max-width:800px">
    <div class="panel-head">
      <div class="panel-title">PO-${po.po_no}</div>
      <span class="status-badge ${po.status==='received'?'finished':po.status==='cancelled'?'on_hold':'draft'}">${PO_STATUS_LABELS[po.status]}</span>
    </div>
    <div class="job-status-actions">
      ${Object.keys(PO_STATUS_LABELS).map(s=>`<button class="${s===po.status?'current':''}" ${s===po.status?'disabled':''} onclick="setPoStatus('${po.id}','${s}')">${PO_STATUS_LABELS[s]}</button>`).join('')}
    </div>
    <div class="field-row"><span class="field-label">Supplier</span><span class="field-val">${esc(po.supplier?.name||'—')}</span></div>
    <div class="field-row"><span class="field-label">Order date</span><span class="field-val">${fmtDate(po.order_date)}</span></div>
    <div class="field-row"><span class="field-label">Due date</span><span class="field-val">${po.due_date?fmtDate(po.due_date):'—'}</span></div>

    <div class="invoice-items-wrap">
    <table class="invoice-items-table">
      <thead><tr><th>Description</th><th class="qty-col">Qty</th><th class="price-col">Unit Cost</th><th class="total-col">Total</th><th class="del-col"></th></tr></thead>
      <tbody>
        ${poItems.map(it=>`<tr>
          <td><input value="${esc(it.description)}" onchange="updatePoItem('${it.id}','description',this.value)"></td>
          <td class="qty-col"><input type="number" step="1" min="1" value="${it.qty}" onchange="updatePoItem('${it.id}','qty',this.value)"></td>
          <td class="price-col"><input type="number" step="0.01" value="${it.unit_cost}" onchange="updatePoItem('${it.id}','unit_cost',this.value)"></td>
          <td class="total-col">$${(it.qty*it.unit_cost).toFixed(2)}</td>
          <td class="del-col"><button class="btn-danger-link" onclick="deletePoItem('${it.id}')">✕</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <button class="btn-link" onclick="togglePoItemPicker('${po.id}')">+ Add line item</button>
    <div id="po-item-picker-area"></div>
    <div class="invoice-totals" style="margin-top:var(--space-6)">
      <div class="field-row grand"><span class="field-label">Total</span><span class="field-val">$${total.toFixed(2)}</span></div>
    </div>
  </div>`;
  main.innerHTML=h;
}

function togglePoItemPicker(poId){
  const el=document.getElementById('po-item-picker-area');
  if(!el)return;
  if(el.innerHTML.trim()){el.innerHTML='';return}
  el.innerHTML=`<div class="tag-picker">
    <input type="text" class="form-input" id="po-item-search" placeholder="Search inventory…" oninput="onPoItemSearch('${poId}',this.value)" style="margin-bottom:var(--space-2)">
    <div id="po-item-search-results"></div>
    <div class="tag-create-row" style="border-top:none;padding-top:0">
      <button class="btn-link" onclick="addBlankPoItem('${poId}');togglePoItemPicker('${poId}')">+ Add blank line item instead</button>
    </div>
  </div>`;
  document.getElementById('po-item-search').focus();
}

function onPoItemSearch(poId,term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('po-item-search-results');
  if(!t){results.innerHTML='';return}
  const matches=stockItems.filter(s=>s.is_active&&s.is_physical&&(s.name.toLowerCase().includes(t)||(s.sku||'').toLowerCase().includes(t))).slice(0,8);
  results.innerHTML=matches.length?matches.map(s=>`<div class="autocomplete-item" onclick="addStockPoItem('${poId}','${s.id}')">${esc(s.name)}${s.sku?' ('+esc(s.sku)+')':''}${s.buy_price?' — $'+Number(s.buy_price).toFixed(2):''}</div>`).join(''):'<div class="autocomplete-item" style="color:var(--text-secondary)">No matches</div>';
}

async function addStockPoItem(poId,stockId){
  const s=stockItems.find(x=>x.id===stockId);
  if(!s)return;
  try{
    const {error}=await sb.from('desk_purchase_order_items').insert({po_id:poId,description:s.name,qty:1,unit_cost:s.buy_price||0,stock_id:s.id});
    if(error)throw error;
    await renderPoDetail(poId);
  }catch(e){showToast('Could not add item')}
}

async function addBlankPoItem(poId){
  try{
    const {error}=await sb.from('desk_purchase_order_items').insert({po_id:poId,description:'New item',qty:1,unit_cost:0});
    if(error)throw error;
    await renderPoDetail(poId);
  }catch(e){showToast('Could not add item')}
}

async function updatePoItem(itemId,field,value){
  const payload={[field]:field==='description'?(value||null):(parseFloat(value)||0)};
  try{
    const {error}=await sb.from('desk_purchase_order_items').update(payload).eq('id',itemId);
    if(error)throw error;
    await renderPoDetail(selectedPoId);
  }catch(e){showToast('Could not update item')}
}

async function deletePoItem(itemId){
  try{
    const {error}=await sb.from('desk_purchase_order_items').delete().eq('id',itemId);
    if(error)throw error;
    await renderPoDetail(selectedPoId);
  }catch(e){showToast('Could not delete item')}
}

// Marking a PO Received bumps qty_on_hand for every stock-linked line item
// and logs it — this is what feeds the Buyin Report.
async function setPoStatus(id,status){
  try{
    const po=purchaseOrders.find(x=>x.id===id);
    if(status==='received'&&po&&po.status!=='received'){
      await loadPoItems(id);
      for(const it of poItems){
        if(!it.stock_id)continue;
        const stock=stockItems.find(s=>s.id===it.stock_id);
        if(!stock)continue;
        const qtyBefore=Number(stock.qty_on_hand)||0;
        const qtyAfter=qtyBefore+Number(it.qty);
        await sb.from('desk_stock').update({qty_on_hand:qtyAfter,updated_at:new Date().toISOString()}).eq('id',it.stock_id);
        await sb.from('desk_stock_adjustments').insert({stock_id:it.stock_id,qty_before:qtyBefore,qty_after:qtyAfter,reason:'Received PO-'+po.po_no});
        stock.qty_on_hand=qtyAfter;
      }
    }
    const {error}=await sb.from('desk_purchase_orders').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    showToast(status==='received'?'Received — stock levels updated':'Status updated');
    await loadPurchaseOrders();
    await renderPoDetail(id);
  }catch(e){showToast('Could not update status')}
}

// GST-inclusive back-calculation: unit_price is already GST-inclusive
// (matches how MechanicDesk itself displays line items), so GST = total/11,
// not total*0.1 — that would double-count the tax already folded into price.
function calcInvoiceTotals(items,discountType,discountValue){
  const priced=(items||[]).filter(it=>!it.is_header);
  const rawTotal=priced.reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.unit_price)||0),0);
  let discountAmount=0;
  if(discountType==='percent'&&discountValue)discountAmount=rawTotal*(Number(discountValue)/100);
  else if(discountType==='fixed'&&discountValue)discountAmount=Number(discountValue);
  discountAmount=Math.min(Math.max(discountAmount,0),rawTotal);
  const totalIncl=rawTotal-discountAmount;
  const gst=totalIncl/11;
  const exclSubtotal=totalIncl-gst;
  return {rawTotal,discountAmount,totalIncl,gst,exclSubtotal};
}

async function loadInvoices(){
  try{
    const {data,error}=await sb.from('desk_invoices')
      .select('*,customer:desk_customers(name,email),vehicle:desk_vehicles(rego,make,model),items:desk_invoice_items(qty,unit_price)')
      .order('invoice_no',{ascending:false});
    if(error)throw error;
    invoices=data||[];
  }catch(e){invoices=[];showToast('Could not load invoices')}
}

async function renderInvoicesView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadInvoices();
  if(selectedInvoiceId){await renderInvoiceDetail(selectedInvoiceId)}else{renderInvoiceList()}
}

function switchInvoicesSubView(v){
  invoicesSubView=v;
  invoiceStatusFilter='all';
  selectedInvoiceId=null;
  if(v==='payments'){
    paymentsRangePreset='month';
    const r=paymentsPresetRange('month');
    paymentsFrom=r.from;paymentsTo=r.to;
    paymentsDrilldownDate=null;
    renderPaymentsListView();
  }else if(v==='bills'){
    billStatusFilter='all';
    selectedBillId=null;
    renderBillsView();
  }else if(v==='credit-notes'){
    creditNoteStatusFilter='all';
    selectedCreditNoteId=null;
    renderCreditNotesView();
  }else{renderInvoiceList()}
}

function invoicesTabBar(){
  return `<div class="status-tabs">
    <button class="status-tab ${invoicesSubView==='invoices'?'active':''}" onclick="switchInvoicesSubView('invoices')">Invoices</button>
    <button class="status-tab ${invoicesSubView==='quotes'?'active':''}" onclick="switchInvoicesSubView('quotes')">Quotes</button>
    <button class="status-tab ${invoicesSubView==='payments'?'active':''}" onclick="switchInvoicesSubView('payments')">Payments</button>
    <button class="status-tab ${invoicesSubView==='bills'?'active':''}" onclick="switchInvoicesSubView('bills')">Bills</button>
    <button class="status-tab ${invoicesSubView==='credit-notes'?'active':''}" onclick="switchInvoicesSubView('credit-notes')">Credit Notes</button>
  </div>`;
}

// ── Payments report (all invoices) — modeled on MechanicDesk's
// Reports → Payment Reports → Received Payments (date range, per-method
// breakdown, daily table with drill-down to that day's individual payments) ──
async function loadAllPayments(){
  try{
    const {data,error}=await sb.from('desk_payments')
      .select('*,invoice:desk_invoices(invoice_no,doc_type,customer:desk_customers(name))')
      .order('paid_at',{ascending:false});
    if(error)throw error;
    allPayments=data||[];
  }catch(e){allPayments=[];showToast('Could not load payments')}
}

async function renderPaymentsListView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadAllPayments();
  renderPaymentsList();
}

function paymentsPresetRange(preset){
  const today=new Date();
  if(preset==='today'){const t=toDateInputValue(today);return {from:t,to:t}}
  if(preset==='yesterday'){const y=new Date(today);y.setDate(y.getDate()-1);const t=toDateInputValue(y);return {from:t,to:t}}
  if(preset==='week')return {from:toDateInputValue(startOfWeek(today)),to:toDateInputValue(today)};
  if(preset==='month')return {from:toDateInputValue(new Date(today.getFullYear(),today.getMonth(),1)),to:toDateInputValue(today)};
  // Added for the Reports nav redesign (MechanicDesk-parity preset list) —
  // 'today'/'week'/'month'/'all' above are unchanged, still used by Payments.
  if(preset==='last2weeks'){const d=new Date(today);d.setDate(d.getDate()-14);return {from:toDateInputValue(d),to:toDateInputValue(today)}}
  if(preset==='monthback'){const d=new Date(today);d.setMonth(d.getMonth()-1);return {from:toDateInputValue(d),to:toDateInputValue(today)}}
  if(preset==='lastmonth'){
    const d=new Date(today.getFullYear(),today.getMonth()-1,1);
    const end=new Date(today.getFullYear(),today.getMonth(),0);
    return {from:toDateInputValue(d),to:toDateInputValue(end)};
  }
  return {from:null,to:null}; // 'all'
}

function setPaymentsRangePreset(preset){
  paymentsRangePreset=preset;
  paymentsDrilldownDate=null;
  const r=paymentsPresetRange(preset);
  paymentsFrom=r.from;paymentsTo=r.to;
  renderPaymentsList();
}

function setPaymentsCustomRange(){
  paymentsRangePreset='custom';
  paymentsFrom=document.getElementById('pay-range-from').value||null;
  paymentsTo=document.getElementById('pay-range-to').value||null;
  paymentsDrilldownDate=null;
  renderPaymentsList();
}

function filteredPayments(){
  return allPayments.filter(p=>{
    if(paymentsFrom&&p.paid_at<paymentsFrom)return false;
    if(paymentsTo&&p.paid_at>paymentsTo)return false;
    return true;
  });
}

function paymentsMethodTotals(list){
  const totals={};
  list.forEach(p=>{totals[p.method]=(totals[p.method]||0)+Number(p.amount)});
  return totals;
}

function paymentsDailyBreakdown(list){
  const byDate={};
  list.forEach(p=>{
    if(!byDate[p.paid_at])byDate[p.paid_at]={};
    byDate[p.paid_at][p.method]=(byDate[p.paid_at][p.method]||0)+Number(p.amount);
  });
  return Object.keys(byDate).sort((a,b)=>b.localeCompare(a)).map(date=>({
    date,methods:byDate[date],total:Object.values(byDate[date]).reduce((s,v)=>s+v,0)
  }));
}

function showPaymentsDrilldown(date){paymentsDrilldownDate=date;renderPaymentsList()}
function clearPaymentsDrilldown(){paymentsDrilldownDate=null;renderPaymentsList()}

function renderPaymentsList(){
  const main=document.getElementById('main');
  const list=filteredPayments();
  const grandTotal=list.reduce((s,p)=>s+Number(p.amount),0);
  const methodTotals=paymentsMethodTotals(list);
  const activeMethods=Object.keys(methodTotals).sort((a,b)=>methodTotals[b]-methodTotals[a]);
  const dailyRows=paymentsDailyBreakdown(list);

  let h=invoicesTabBar();
  h+=`<div class="toolbar" style="flex-wrap:wrap;gap:var(--space-3)">
    <div class="status-tabs" style="margin:0">
      <button class="status-tab ${paymentsRangePreset==='today'?'active':''}" onclick="setPaymentsRangePreset('today')">Today</button>
      <button class="status-tab ${paymentsRangePreset==='week'?'active':''}" onclick="setPaymentsRangePreset('week')">This Week</button>
      <button class="status-tab ${paymentsRangePreset==='month'?'active':''}" onclick="setPaymentsRangePreset('month')">This Month</button>
      <button class="status-tab ${paymentsRangePreset==='all'?'active':''}" onclick="setPaymentsRangePreset('all')">All Time</button>
    </div>
    <div style="display:flex;align-items:center;gap:var(--space-2)">
      <input type="date" class="form-input" style="width:150px" id="pay-range-from" value="${paymentsFrom||''}">
      <span style="color:var(--text-secondary);font-size:12px">to</span>
      <input type="date" class="form-input" style="width:150px" id="pay-range-to" value="${paymentsTo||''}">
      <button class="btn-secondary" onclick="setPaymentsCustomRange()">Apply</button>
    </div>
    <button class="btn-secondary" onclick="printPaymentsReport()" style="margin-left:auto">Print</button>
  </div>`;

  h+=`<div class="panel" style="margin-bottom:var(--space-4)">
    <div class="panel-head"><div class="panel-title">${list.length} payment${list.length===1?'':'s'} · $${grandTotal.toFixed(2)} total</div></div>
    ${activeMethods.length?activeMethods.map(m=>{
      const pct=grandTotal?Math.round(methodTotals[m]/grandTotal*100):0;
      return `<div class="payment-method-row">
        <span class="payment-method-label">${PAYMENT_METHOD_LABELS[m]}</span>
        <span class="payment-method-bar-wrap"><span class="payment-method-bar" style="width:${pct}%"></span></span>
        <span class="payment-method-amount">$${methodTotals[m].toFixed(2)}</span>
        <span class="payment-method-pct">${pct}%</span>
      </div>`;
    }).join(''):'<div class="list-empty">No payments in this range.</div>'}
  </div>`;

  if(!list.length){main.innerHTML=h;return}

  if(paymentsDrilldownDate){
    const dayList=list.filter(p=>p.paid_at===paymentsDrilldownDate);
    h+=`<div style="margin-bottom:var(--space-3);font-size:13px"><button class="btn-link" onclick="clearPaymentsDrilldown()">← All days</button> &nbsp;<strong>${fmtDate(paymentsDrilldownDate)}</strong></div>`;
    h+='<div class="list-card">';
    dayList.forEach(p=>{
      h+=`<div class="list-row" onclick="openInvoiceFromJob('${p.invoice_id}','${p.invoice?.doc_type||'invoice'}')">
        <div class="list-row-name" style="flex:1">${docPrefix(p.invoice?.doc_type)}-${p.invoice?.invoice_no||''} · ${esc(p.invoice?.customer?.name||'Unknown')}</div>
        <span class="status-badge draft">${PAYMENT_METHOD_LABELS[p.method]}</span>
        <div class="list-row-sub" style="font-weight:700">$${Number(p.amount).toFixed(2)}</div>
      </div>`;
    });
    h+='</div>';
  }else{
    h+='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th>'+
      activeMethods.map(m=>`<th style="text-align:right">${PAYMENT_METHOD_LABELS[m]}</th>`).join('')+
      '<th style="text-align:right">Total</th></tr></thead><tbody>';
    dailyRows.forEach(row=>{
      h+=`<tr class="clickable-row" onclick="showPaymentsDrilldown('${row.date}')"><td>${fmtDate(row.date)}</td>`;
      activeMethods.forEach(m=>{h+=`<td style="text-align:right">${row.methods[m]?'$'+row.methods[m].toFixed(2):'—'}</td>`});
      h+=`<td style="text-align:right;font-weight:700">$${row.total.toFixed(2)}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  main.innerHTML=h;
}

function printPaymentsReport(){
  const list=filteredPayments();
  const grandTotal=list.reduce((s,p)=>s+Number(p.amount),0);
  const methodTotals=paymentsMethodTotals(list);
  const activeMethods=Object.keys(methodTotals).sort((a,b)=>methodTotals[b]-methodTotals[a]);
  const dailyRows=paymentsDailyBreakdown(list);
  const rangeLabel=paymentsFrom&&paymentsTo?`${fmtDate(paymentsFrom)} – ${fmtDate(paymentsTo)}`:'All time';
  // PRINT PATH (window.open + print). <style> is fine here, but all values are
  // resolved literals from design-brief.md — no dependency on index.html :root.
  const html=`<!doctype html><html><head><meta charset="UTF-8"><title>Payments report</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       font-size:15px;line-height:1.55;color:#0A0A0A;background:#FFFFFF;
       padding:32px;max-width:800px;margin:0 auto;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
  .eyebrow{font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:#6B6B70}
  h1{font-family:'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
     font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.015em;color:#0A0A0A;margin:8px 0 0}
  .sub{font-size:15px;line-height:1.55;color:#6B6B70;margin:8px 0 0}
  h2{font-family:'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
     font-size:18px;line-height:1.25;font-weight:600;letter-spacing:-0.005em;color:#0A0A0A;margin:48px 0 0}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:#6B6B70;
     padding:0 8px 8px;border-bottom:1px solid #D1D1D6;text-align:right}
  td{padding:12px 8px;font-size:15px;line-height:1.55;color:#0A0A0A;border-bottom:1px solid #E4E4E7;text-align:right;white-space:nowrap}
  td:first-child,th:first-child{text-align:left;padding-left:0;white-space:normal}
  td:last-child,th:last-child{padding-right:0}
  tfoot td{font-weight:700;border-top:2px solid #0A0A0A;border-bottom:none}
  @media print{body{padding:0}h2{margin-top:32px}}
</style></head><body>
  <div class="eyebrow">DHF Tyres</div>
  <h1>Payments report</h1>
  <div class="sub">${rangeLabel} &middot; ${list.length} payment${list.length===1?'':'s'} &middot; $${grandTotal.toFixed(2)} total</div>
  <h2>By payment method</h2>
  <table><thead><tr><th>Method</th><th>Amount</th><th>Share</th></tr></thead><tbody>
    ${activeMethods.map(m=>`<tr><td>${PAYMENT_METHOD_LABELS[m]}</td><td>$${methodTotals[m].toFixed(2)}</td><td>${grandTotal?Math.round(methodTotals[m]/grandTotal*100):0}%</td></tr>`).join('')}
  </tbody></table>
  <h2>Daily breakdown</h2>
  <table><thead><tr><th>Date</th>${activeMethods.map(m=>`<th>${PAYMENT_METHOD_LABELS[m]}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${dailyRows.map(row=>`<tr><td>${fmtDate(row.date)}</td>${activeMethods.map(m=>`<td>${row.methods[m]?'$'+row.methods[m].toFixed(2):'—'}</td>`).join('')}<td>$${row.total.toFixed(2)}</td></tr>`).join('')}
  </tbody></table>
</body></html>`;
  const w=window.open('','_blank');
  if(!w){showToast('Pop-up blocked — allow pop-ups to print');return}
  w.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>Payments report</title>
<style>body{margin:0;font-family:system-ui,sans-serif}.print-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;background:#1A2233;color:#fff}.print-toolbar-title{font-size:14px;font-weight:700}.print-toolbar-btn{font-family:inherit;font-size:14px;font-weight:600;padding:8px 20px;border:none;border-radius:999px;cursor:pointer;background:#fff;color:#1A2233}.print-toolbar-btn:hover{opacity:.9}@media print{.print-toolbar{display:none}}</style></head><body>
<div class="print-toolbar"><span class="print-toolbar-title">Payments report — preview</span><button class="print-toolbar-btn" onclick="window.print()">Print</button></div>
${html}
</body></html>`);
  w.document.close();
  w.focus();
}

// ── Bills (accounts payable — sub-tab of Invoices) ──────────
async function loadBills(){
  try{
    const {data,error}=await sb.from('desk_bills').select('*,supplier:desk_suppliers(name)').order('bill_date',{ascending:false});
    if(error)throw error;
    bills=data||[];
  }catch(e){bills=[];showToast('Could not load bills')}
}

async function renderBillsView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await Promise.all([loadBills(),loadSuppliers(),loadXeroAccounts()]);
  if(selectedBillId){await renderBillDetail(selectedBillId)}else{renderBillList()}
}

function setBillFilter(f){billStatusFilter=f;renderBillList()}

function filteredBills(){
  if(billStatusFilter==='all')return bills;
  return bills.filter(b=>b.status===billStatusFilter);
}

function renderBillList(){
  const main=document.getElementById('main');
  const list=filteredBills();
  let h=invoicesTabBar();
  h+=`<div class="status-tabs">
    ${['all',...Object.keys(BILL_STATUS_LABELS)].map(s=>`<button class="status-tab ${billStatusFilter===s?'active':''}" onclick="setBillFilter('${s}')">${s==='all'?'All':BILL_STATUS_LABELS[s]}</button>`).join('')}
  </div>
  <div class="toolbar"><button class="btn-primary" onclick="openNewBillModal()">+ New Bill</button></div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${bills.length?'No matches.':'No bills yet — add one when a supplier invoices you.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(b=>{
      h+=`<div class="list-row" onclick="openBill('${b.id}')">
        <div class="list-row-name">${esc(b.supplier?.name||'Unknown supplier')}</div>
        <div class="list-row-sub" style="flex:1">${esc(b.reference||'—')}</div>
        <div class="list-row-sub">${fmtDate(b.bill_date)}</div>
        <div class="list-row-sub" style="font-weight:700">$${Number(b.amount).toFixed(2)}</div>
        <span class="status-badge ${b.status==='paid'?'finished':b.status==='awaiting_payment'?'in_progress':'draft'}">${BILL_STATUS_LABELS[b.status]}</span>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

async function openBill(id){selectedBillId=id;await renderBillDetail(id)}
function backFromBillDetail(){selectedBillId=null;renderBillList()}

function openNewBillModal(){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">New Bill</div>
      <label class="form-label">Supplier *</label>
      <select class="form-select" id="bf-supplier">
        <option value="">— Select —</option>
        ${suppliers.filter(s=>s.is_active!==false).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select>
      <label class="form-label">Reference</label>
      <input class="form-input" id="bf-reference">
      <label class="form-label">Bill date</label>
      <input class="form-input" type="date" id="bf-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Due date</label>
      <input class="form-input" type="date" id="bf-due">
      <label class="form-label">Amount *</label>
      <input class="form-input" type="number" step="0.01" id="bf-amount">
      <label class="form-label">Account</label>
      <select class="form-select" id="bf-account">
        <option value="">—</option>
        ${xeroAccounts.filter(a=>a.is_active&&a.account_type==='expense').map(a=>`<option value="${esc(a.code)}">${esc(a.code)} ${esc(a.name)}</option>`).join('')}
      </select>
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="bf-notes"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveBillForm()">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveBillForm(){
  const supplierId=document.getElementById('bf-supplier').value;
  const amount=parseFloat(document.getElementById('bf-amount').value);
  if(!supplierId){showToast('Pick a supplier');return}
  if(!amount){showToast('Enter an amount');return}
  const payload={
    supplier_id:supplierId,
    reference:document.getElementById('bf-reference').value.trim()||null,
    bill_date:document.getElementById('bf-date').value,
    due_date:document.getElementById('bf-due').value||null,
    amount,
    account_code:document.getElementById('bf-account').value||null,
    notes:document.getElementById('bf-notes').value.trim()||null
  };
  try{
    const {error}=await sb.from('desk_bills').insert(payload);
    if(error)throw error;
    closeModal();
    showToast('Bill added');
    await loadBills();
    renderBillList();
  }catch(e){showToast('Save failed')}
}

async function loadBillPayments(billId){
  try{
    const {data,error}=await sb.from('desk_bill_payments').select('*').eq('bill_id',billId).order('paid_at',{ascending:false});
    if(error)throw error;
    billPayments=data||[];
  }catch(e){billPayments=[]}
}

async function renderBillDetail(id){
  const main=document.getElementById('main');
  const b=bills.find(x=>x.id===id);
  if(!b){selectedBillId=null;renderBillList();return}
  await loadBillPayments(id);
  const paid=billPayments.reduce((s,p)=>s+Number(p.amount),0);
  const balance=Number(b.amount)-paid;
  let h=`<button class="back-link" onclick="backFromBillDetail()">← All bills</button>
  <div class="panel" style="max-width:700px">
    <div class="panel-head">
      <div class="panel-title">${esc(b.supplier?.name||'Unknown supplier')}</div>
      <span class="status-badge ${b.status==='paid'?'finished':b.status==='awaiting_payment'?'in_progress':'draft'}">${BILL_STATUS_LABELS[b.status]}</span>
    </div>
    <div class="job-status-actions">
      ${Object.keys(BILL_STATUS_LABELS).map(s=>`<button class="${s===b.status?'current':''}" ${s===b.status?'disabled':''} onclick="setBillStatus('${b.id}','${s}')">${BILL_STATUS_LABELS[s]}</button>`).join('')}
    </div>
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
      <button class="btn-primary" onclick="openRecordBillPaymentModal('${b.id}',${balance})">Record Payment</button>
    </div>
    <div class="field-row"><span class="field-label">Reference</span><span class="field-val">${esc(b.reference||'—')}</span></div>
    <div class="field-row"><span class="field-label">Bill date</span><span class="field-val">${fmtDate(b.bill_date)}</span></div>
    <div class="field-row"><span class="field-label">Due date</span><span class="field-val">${b.due_date?fmtDate(b.due_date):'—'}</span></div>
    <div class="field-row"><span class="field-label">Amount</span><span class="field-val">$${Number(b.amount).toFixed(2)}</span></div>
    <div class="field-row"><span class="field-label">Paid</span><span class="field-val">$${paid.toFixed(2)}</span></div>
    <div class="field-row grand"><span class="field-label">Balance</span><span class="field-val">$${balance.toFixed(2)}</span></div>
    ${b.notes?`<div class="field-row"><span class="field-label">Notes</span><span class="field-val">${esc(b.notes)}</span></div>`:''}
    <div class="panel-head" style="margin-top:var(--space-6)"><div class="panel-title" style="font-size:13px">Payments</div></div>
    ${billPayments.length?billPayments.map(p=>`
      <div class="field-row">
        <span class="field-label">${fmtDate(p.paid_at)} · ${PAYMENT_METHOD_LABELS[p.method]||p.method}${p.notes?' · '+esc(p.notes):''}</span>
        <span class="field-val">$${Number(p.amount).toFixed(2)} <button class="btn-danger-link" style="margin-left:var(--space-2)" onclick="deleteBillPayment('${p.id}','${b.id}')">✕</button></span>
      </div>`).join(''):'<div style="font-size:13px;color:var(--text-secondary);padding:var(--space-2) 0">No payments recorded yet.</div>'}
  </div>`;
  main.innerHTML=h;
}

async function setBillStatus(id,status){
  try{
    const {error}=await sb.from('desk_bills').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    await loadBills();
    await renderBillDetail(id);
  }catch(e){showToast('Could not update status')}
}

function openRecordBillPaymentModal(billId,balance){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Record Payment</div>
      <label class="form-label">Amount</label>
      <input class="form-input" type="number" step="0.01" id="bp-amount" value="${balance>0?balance.toFixed(2):''}">
      <label class="form-label">Method</label>
      <select class="form-select" id="bp-method">
        ${selectablePaymentMethods().map(m=>`<option value="${m}">${PAYMENT_METHOD_LABELS[m]}</option>`).join('')}
      </select>
      <label class="form-label">Date</label>
      <input class="form-input" type="date" id="bp-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Notes</label>
      <input class="form-input" id="bp-notes">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveBillPayment('${billId}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveBillPayment(billId){
  const amount=parseFloat(document.getElementById('bp-amount').value);
  if(!amount){showToast('Enter an amount');return}
  const payload={
    bill_id:billId,
    amount,
    method:document.getElementById('bp-method').value,
    paid_at:document.getElementById('bp-date').value,
    notes:document.getElementById('bp-notes').value.trim()||null
  };
  try{
    const {error}=await sb.from('desk_bill_payments').insert(payload);
    if(error)throw error;
    const b=bills.find(x=>x.id===billId);
    const newPaid=billPayments.reduce((s,p)=>s+Number(p.amount),0)+amount;
    if(b&&newPaid>=Number(b.amount)-0.01){
      await sb.from('desk_bills').update({status:'paid',updated_at:new Date().toISOString()}).eq('id',billId);
    }
    closeModal();
    showToast('Payment recorded');
    await loadBills();
    await renderBillDetail(billId);
  }catch(e){showToast('Could not save payment')}
}

async function deleteBillPayment(paymentId,billId){
  try{
    const {error}=await sb.from('desk_bill_payments').delete().eq('id',paymentId);
    if(error)throw error;
    await loadBills();
    await renderBillDetail(billId);
  }catch(e){showToast('Could not delete')}
}

// ── Credit Notes (sub-tab of Invoices) ───────────────────────
// Customer credit is a separate ledger from invoices/payments — a credit
// note is only ever created against an existing customer (no inline
// "create new customer" here, unlike Invoices/Jobs) since it's adjusting
// an account that has to already exist. The DB itself (not just this UI)
// refuses to let a credit note's value be applied to another customer's
// invoice, or applied beyond its own remaining balance — see the
// desk_credit_application_guard trigger.
async function loadCreditNotes(){
  try{
    const {data,error}=await sb.from('desk_credit_notes')
      .select('*,customer:desk_customers(name),invoice:desk_invoices(invoice_no,doc_type),items:desk_credit_note_items(qty,unit_price),applications:desk_credit_applications(amount)')
      .order('credit_note_no',{ascending:false});
    if(error)throw error;
    creditNotes=data||[];
  }catch(e){creditNotes=[];showToast('Could not load credit notes')}
}

function creditNoteTotal(cn){return (cn.items||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0)}
function creditNoteApplied(cn){return (cn.applications||[]).reduce((s,a)=>s+Number(a.amount),0)}
function creditNoteRemaining(cn){return cn.status==='issued'?Math.max(0,creditNoteTotal(cn)-creditNoteApplied(cn)):0}
function creditNoteBadgeClass(status){return status==='issued'?'finished':status==='void'?'on_hold':'draft'}

async function renderCreditNotesView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadCreditNotes();
  if(selectedCreditNoteId){await renderCreditNoteDetail(selectedCreditNoteId)}else{renderCreditNoteList()}
}

function setCreditNoteFilter(f){creditNoteStatusFilter=f;renderCreditNoteList()}
function filteredCreditNotes(){
  if(creditNoteStatusFilter==='all')return creditNotes;
  return creditNotes.filter(c=>c.status===creditNoteStatusFilter);
}

function renderCreditNoteList(){
  const main=document.getElementById('main');
  const list=filteredCreditNotes();
  let h=invoicesTabBar();
  h+=`<div class="status-tabs">
    ${['all',...Object.keys(CREDIT_NOTE_STATUS_LABELS)].map(s=>`<button class="status-tab ${creditNoteStatusFilter===s?'active':''}" onclick="setCreditNoteFilter('${s}')">${s==='all'?'All':CREDIT_NOTE_STATUS_LABELS[s]}</button>`).join('')}
  </div>
  <div class="toolbar"><button class="btn-primary" onclick="openNewCreditNoteModal()">+ New Credit Note</button></div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${creditNotes.length?'No matches.':'No credit notes yet.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(cn=>{
      const remaining=creditNoteRemaining(cn);
      h+=`<div class="list-row" onclick="openCreditNote('${cn.id}')">
        <div class="list-row-name">CN-${cn.credit_note_no}</div>
        <div class="list-row-sub" style="flex:1">${esc(cn.customer?.name||'Unknown customer')}</div>
        <div class="list-row-sub">${fmtDate(cn.issue_date)}</div>
        <div class="list-row-sub" style="font-weight:700">$${creditNoteTotal(cn).toFixed(2)}</div>
        <div class="list-row-sub" style="font-weight:700;color:${remaining>0?'var(--success)':'var(--text-secondary)'}">$${remaining.toFixed(2)} left</div>
        <span class="status-badge ${creditNoteBadgeClass(cn.status)}">${CREDIT_NOTE_STATUS_LABELS[cn.status]}</span>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

async function openCreditNote(id){selectedCreditNoteId=id;await renderCreditNoteDetail(id)}
function backFromCreditNoteDetail(){selectedCreditNoteId=null;renderCreditNoteList()}

async function openNewCreditNoteModal(){
  if(!customers.length)await loadCustomers();
  newCreditNoteCustomerId=null;
  newCreditNoteInvoices=[];
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">New Credit Note</div>
      <div id="new-cn-customer-area">
        <label class="form-label">Customer *</label>
        <div class="autocomplete">
          <input class="form-input" id="cn-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewCreditNoteCustomerSearch(this.value)">
          <div id="cn-customer-results"></div>
        </div>
        <div style="font-size:var(--text-micro);color:var(--text-secondary);margin-top:var(--space-1)">Must be an existing customer — credit notes adjust an account that already exists.</div>
      </div>
      <div id="new-cn-invoice-area"></div>
      <label class="form-label">Issue date</label>
      <input class="form-input" type="date" id="cn-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Reason</label>
      <textarea class="form-textarea" id="cn-reason" placeholder="e.g. returned tyres, overcharge, goodwill"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveNewCreditNote()">Create</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function onNewCreditNoteCustomerSearch(v){
  newCreditNoteCustomerId=null;
  const term=v.trim().toLowerCase();
  const results=document.getElementById('cn-customer-results');
  if(!term){results.innerHTML='';return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(term)).slice(0,8);
  results.innerHTML=matches.length?`<div class="autocomplete-list">${matches.map(c=>`<div class="autocomplete-item" onclick="selectNewCreditNoteCustomer('${c.id}')">${esc(c.name)}${c.mobile?' — '+esc(c.mobile):''}</div>`).join('')}</div>`:'<div class="autocomplete-list"><div class="autocomplete-item" style="color:var(--text-secondary)">No matching customer</div></div>';
}

async function selectNewCreditNoteCustomer(id){
  const c=customers.find(x=>x.id===id);
  if(!c)return;
  newCreditNoteCustomerId=id;
  document.getElementById('new-cn-customer-area').innerHTML=`<label class="form-label">Customer</label><div class="selected-chip">${esc(c.name)} <button onclick="resetNewCreditNoteCustomer()">✕</button></div>`;
  const invArea=document.getElementById('new-cn-invoice-area');
  invArea.innerHTML='<div style="font-size:12px;color:var(--text-secondary)">Loading invoices…</div>';
  try{
    const {data,error}=await sb.from('desk_invoices').select('id,invoice_no,doc_type').eq('customer_id',id).eq('doc_type','invoice').order('invoice_no',{ascending:false});
    if(error)throw error;
    newCreditNoteInvoices=data||[];
  }catch(e){newCreditNoteInvoices=[]}
  invArea.innerHTML=`<label class="form-label">Originating invoice (optional)</label>
    <select class="form-select" id="cn-invoice">
      <option value="">— None —</option>
      ${newCreditNoteInvoices.map(i=>`<option value="${i.id}">INV-${i.invoice_no}</option>`).join('')}
    </select>`;
}

function resetNewCreditNoteCustomer(){
  newCreditNoteCustomerId=null;
  newCreditNoteInvoices=[];
  document.getElementById('new-cn-customer-area').innerHTML=`<label class="form-label">Customer *</label>
    <div class="autocomplete">
      <input class="form-input" id="cn-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewCreditNoteCustomerSearch(this.value)">
      <div id="cn-customer-results"></div>
    </div>
    <div style="font-size:var(--text-micro);color:var(--text-secondary);margin-top:var(--space-1)">Must be an existing customer — credit notes adjust an account that already exists.</div>`;
  document.getElementById('new-cn-invoice-area').innerHTML='';
}

async function saveNewCreditNote(){
  if(!newCreditNoteCustomerId){showToast('Pick an existing customer');return}
  const invoiceEl=document.getElementById('cn-invoice');
  const payload={
    customer_id:newCreditNoteCustomerId,
    invoice_id:invoiceEl?(invoiceEl.value||null):null,
    issue_date:document.getElementById('cn-date').value||toDateInputValue(new Date()),
    reason:document.getElementById('cn-reason').value.trim()||null
  };
  try{
    const {data,error}=await sb.from('desk_credit_notes').insert(payload).select();
    if(error)throw error;
    closeModal();
    showToast('Credit note created');
    selectedCreditNoteId=data[0].id;
    await renderCreditNotesView();
  }catch(e){showToast('Could not create credit note')}
}

async function loadCreditNoteItems(creditNoteId){
  try{
    const {data,error}=await sb.from('desk_credit_note_items').select('*').eq('credit_note_id',creditNoteId).order('description');
    if(error)throw error;
    creditNoteItems=data||[];
  }catch(e){creditNoteItems=[]}
}

async function loadCreditApplications(creditNoteId){
  try{
    const {data,error}=await sb.from('desk_credit_applications').select('*,invoice:desk_invoices(invoice_no)').eq('credit_note_id',creditNoteId).order('applied_at',{ascending:false});
    if(error)throw error;
    creditApplications=data||[];
  }catch(e){creditApplications=[]}
}

async function renderCreditNoteDetail(id){
  const main=document.getElementById('main');
  await Promise.all([loadCreditNoteItems(id),loadCreditApplications(id),loadStockItems()]);
  const cn=creditNotes.find(x=>x.id===id);
  if(!cn){selectedCreditNoteId=null;renderCreditNoteList();return}
  const total=creditNoteItems.reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0);
  const applied=creditApplications.reduce((s,a)=>s+Number(a.amount),0);
  const remaining=cn.status==='issued'?Math.max(0,total-applied):0;
  let h=`<button class="back-link" onclick="backFromCreditNoteDetail()">← All credit notes</button>
  <div class="panel" style="max-width:800px">
    <div class="panel-head">
      <div class="panel-title">CN-${cn.credit_note_no} — ${esc(cn.customer?.name||'Unknown customer')}</div>
      <span class="status-badge ${creditNoteBadgeClass(cn.status)}">${CREDIT_NOTE_STATUS_LABELS[cn.status]}</span>
    </div>
    <div class="job-status-actions">
      ${Object.keys(CREDIT_NOTE_STATUS_LABELS).map(s=>`<button class="${s===cn.status?'current':''}" ${s===cn.status?'disabled':''} onclick="setCreditNoteStatus('${cn.id}','${s}')">${CREDIT_NOTE_STATUS_LABELS[s]}</button>`).join('')}
    </div>
    ${cn.status==='issued'?`<div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)"><button class="btn-primary" onclick="openApplyCreditModal('${cn.id}',${remaining})" ${remaining<=0?'disabled':''}>💳 Apply / Refund Credit</button></div>`:''}
    <div class="field-row"><span class="field-label">Customer</span><span class="field-val">${esc(cn.customer?.name||'—')}</span></div>
    <div class="field-row"><span class="field-label">Issue date</span><span class="field-val">${fmtDate(cn.issue_date)}</span></div>
    ${cn.invoice?`<div class="field-row"><span class="field-label">Originating invoice</span><span class="field-val">INV-${cn.invoice.invoice_no}</span></div>`:''}
    ${cn.reason?`<div class="field-row"><span class="field-label">Reason</span><span class="field-val">${esc(cn.reason)}</span></div>`:''}

    <div class="invoice-items-wrap">
    <table class="invoice-items-table">
      <thead><tr><th>Description</th><th class="qty-col">Qty</th><th class="price-col">Unit Price</th><th class="total-col">Total</th><th class="del-col"></th></tr></thead>
      <tbody>
        ${creditNoteItems.map(it=>`<tr>
          <td><input value="${esc(it.description||'')}" onchange="updateCreditNoteItem('${it.id}','description',this.value)">
            ${it.return_condition?`<div style="margin-top:var(--space-1)"><span class="status-badge ${it.return_condition==='resellable'?'finished':'on_hold'}">${it.return_condition==='resellable'?'♻ Resellable — restocked':'⚠ Damaged — not restocked'}</span></div>`:''}
          </td>
          <td class="qty-col"><input type="number" step="1" min="1" value="${it.qty}" onchange="updateCreditNoteItem('${it.id}','qty',this.value)"></td>
          <td class="price-col"><input type="number" step="0.01" value="${it.unit_price}" onchange="updateCreditNoteItem('${it.id}','unit_price',this.value)"></td>
          <td class="total-col">$${(it.qty*it.unit_price).toFixed(2)}</td>
          <td class="del-col"><button class="btn-danger-link" onclick="deleteCreditNoteItem('${it.id}')">✕</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <button class="btn-link" onclick="toggleCreditNoteItemPicker('${cn.id}')">+ Add line item</button>
    <div id="cn-item-picker-area"></div>

    <div class="invoice-totals" style="margin-top:var(--space-6)">
      <div class="field-row grand"><span class="field-label">Total (incl. GST)</span><span class="field-val">$${total.toFixed(2)}</span></div>
      <div class="field-row"><span class="field-label">Applied / Refunded</span><span class="field-val">$${applied.toFixed(2)}</span></div>
      <div class="field-row grand"><span class="field-label">Remaining balance</span><span class="field-val">$${remaining.toFixed(2)}</span></div>
    </div>

    <div class="panel-head" style="margin-top:var(--space-6)"><div class="panel-title" style="font-size:13px">History</div></div>
    ${creditApplications.length?creditApplications.map(a=>`
      <div class="field-row">
        <span class="field-label">${fmtDate(a.applied_at)} · ${CREDIT_APPLICATION_METHOD_LABELS[a.method]||a.method}${a.invoice?' · INV-'+a.invoice.invoice_no:''}${a.notes?' · '+esc(a.notes):''}</span>
        <span class="field-val">$${Number(a.amount).toFixed(2)} <button class="btn-danger-link" style="margin-left:var(--space-2)" onclick="deleteCreditApplication('${a.id}','${cn.id}')">✕</button></span>
      </div>`).join(''):'<div style="font-size:13px;color:var(--text-secondary);padding:var(--space-2) 0">Not applied or refunded yet.</div>'}
  </div>`;
  main.innerHTML=h;
}

async function setCreditNoteStatus(id,status){
  try{
    const {error}=await sb.from('desk_credit_notes').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    await loadCreditNotes();
    await renderCreditNoteDetail(id);
  }catch(e){showToast('Could not update status')}
}

function toggleCreditNoteItemPicker(creditNoteId){
  const el=document.getElementById('cn-item-picker-area');
  if(!el)return;
  if(el.innerHTML.trim()){el.innerHTML='';return}
  el.innerHTML=`<div class="tag-picker">
    <input type="text" class="form-input" id="cn-item-search" placeholder="Search inventory…" oninput="onCreditNoteItemSearch('${creditNoteId}',this.value)" style="margin-bottom:var(--space-2)">
    <div id="cn-item-search-results"></div>
    <div class="tag-create-row" style="border-top:none;padding-top:0">
      <button class="btn-link" onclick="addBlankCreditNoteItem('${creditNoteId}');toggleCreditNoteItemPicker('${creditNoteId}')">+ Add blank line item instead</button>
    </div>
  </div>`;
  document.getElementById('cn-item-search').focus();
}

function onCreditNoteItemSearch(creditNoteId,term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('cn-item-search-results');
  if(!t){results.innerHTML='';return}
  const matches=stockItems.filter(s=>s.is_active&&(s.name.toLowerCase().includes(t)||(s.sku||'').toLowerCase().includes(t))).slice(0,8);
  results.innerHTML=matches.length?matches.map(s=>`<div class="autocomplete-item" onclick="addStockCreditNoteItem('${creditNoteId}','${s.id}')">${esc(s.name)}${s.sku?' ('+esc(s.sku)+')':''}${s.sell_price?' — $'+Number(s.sell_price).toFixed(2):''}</div>`).join(''):'<div class="autocomplete-item" style="color:var(--text-secondary)">No matches</div>';
}

async function addStockCreditNoteItem(creditNoteId,stockId){
  const s=stockItems.find(x=>x.id===stockId);
  if(!s)return;
  try{
    const {error}=await sb.from('desk_credit_note_items').insert({credit_note_id:creditNoteId,description:s.name,qty:1,unit_price:s.sell_price||0,stock_id:s.id});
    if(error)throw error;
    await renderCreditNoteDetail(creditNoteId);
    await loadCreditNotes();
  }catch(e){showToast('Could not add item')}
}

async function addBlankCreditNoteItem(creditNoteId){
  try{
    const {error}=await sb.from('desk_credit_note_items').insert({credit_note_id:creditNoteId,description:'New item',qty:1,unit_price:0});
    if(error)throw error;
    await renderCreditNoteDetail(creditNoteId);
    await loadCreditNotes();
  }catch(e){showToast('Could not add item')}
}

async function updateCreditNoteItem(itemId,field,value){
  const payload={[field]:field==='description'?(value||null):(parseFloat(value)||0)};
  try{
    const {error}=await sb.from('desk_credit_note_items').update(payload).eq('id',itemId);
    if(error)throw error;
    await renderCreditNoteDetail(selectedCreditNoteId);
    await loadCreditNotes();
  }catch(e){showToast('Could not update item')}
}

async function deleteCreditNoteItem(itemId){
  try{
    const {error}=await sb.from('desk_credit_note_items').delete().eq('id',itemId);
    if(error)throw error;
    await renderCreditNoteDetail(selectedCreditNoteId);
    await loadCreditNotes();
  }catch(e){showToast('Could not delete item')}
}

// Applying credit to an invoice inserts a real desk_payments row (method
// 'credit_note') so the invoice's Paid/Balance Due — and every report that
// reads desk_payments — stays correct without touching those call sites.
// A refund just logs the application with no invoice/payment link.
async function loadCreditNoteEligibleInvoices(customerId){
  try{
    const {data,error}=await sb.from('desk_invoices').select('id,invoice_no,status,items:desk_invoice_items(qty,unit_price),payments:desk_payments(amount)').eq('customer_id',customerId).eq('doc_type','invoice').neq('status','paid').order('invoice_no',{ascending:false});
    if(error)throw error;
    return (data||[]).map(i=>{
      const total=(i.items||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0);
      const paid=(i.payments||[]).reduce((s,p)=>s+Number(p.amount),0);
      return {id:i.id,invoice_no:i.invoice_no,balance:total-paid};
    }).filter(i=>i.balance>0.01);
  }catch(e){return []}
}

async function openApplyCreditModal(creditNoteId,remaining){
  const cn=creditNotes.find(x=>x.id===creditNoteId);
  if(!cn)return;
  const eligibleInvoices=await loadCreditNoteEligibleInvoices(cn.customer_id);
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Apply / Refund Credit</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-3)">Remaining balance: $${remaining.toFixed(2)}</div>
      <label class="form-label">Action</label>
      <select class="form-select" id="ac-method" onchange="onApplyCreditMethodChange()">
        <option value="applied_to_invoice">Apply to an invoice (${esc(cn.customer?.name||'this customer')})</option>
        <option value="refund_cash">${CREDIT_APPLICATION_METHOD_LABELS.refund_cash}</option>
        <option value="refund_eftpos">${CREDIT_APPLICATION_METHOD_LABELS.refund_eftpos}</option>
        <option value="refund_bank_transfer">${CREDIT_APPLICATION_METHOD_LABELS.refund_bank_transfer}</option>
        <option value="write_off">${CREDIT_APPLICATION_METHOD_LABELS.write_off}</option>
        <option value="other">${CREDIT_APPLICATION_METHOD_LABELS.other}</option>
      </select>
      <div id="ac-invoice-area">
        <label class="form-label">Invoice</label>
        <select class="form-select" id="ac-invoice" onchange="onApplyCreditInvoiceChange(${remaining})">
          ${eligibleInvoices.length?eligibleInvoices.map(i=>`<option value="${i.id}" data-balance="${i.balance}">INV-${i.invoice_no} — $${i.balance.toFixed(2)} owing</option>`).join(''):'<option value="">— No unpaid invoices for this customer —</option>'}
        </select>
      </div>
      <label class="form-label">Amount *</label>
      <input class="form-input" type="number" step="0.01" id="ac-amount" value="${eligibleInvoices.length?Math.min(remaining,eligibleInvoices[0].balance).toFixed(2):remaining.toFixed(2)}">
      <label class="form-label">Date</label>
      <input class="form-input" type="date" id="ac-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Notes</label>
      <input class="form-input" id="ac-notes">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveApplyCredit('${creditNoteId}',${remaining})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function onApplyCreditMethodChange(){
  const method=document.getElementById('ac-method').value;
  document.getElementById('ac-invoice-area').style.display=method==='applied_to_invoice'?'':'none';
}

function onApplyCreditInvoiceChange(remaining){
  const sel=document.getElementById('ac-invoice');
  const opt=sel.options[sel.selectedIndex];
  const balance=opt?parseFloat(opt.dataset.balance||'0'):0;
  document.getElementById('ac-amount').value=Math.min(remaining,balance||remaining).toFixed(2);
}

async function saveApplyCredit(creditNoteId,remaining){
  const method=document.getElementById('ac-method').value;
  const amount=parseFloat(document.getElementById('ac-amount').value);
  if(!amount||amount<=0){showToast('Enter a valid amount');return}
  if(amount>remaining+0.01){showToast('Amount exceeds remaining credit balance');return}
  const invoiceEl=document.getElementById('ac-invoice');
  const invoiceId=method==='applied_to_invoice'?(invoiceEl?.value||null):null;
  if(method==='applied_to_invoice'&&!invoiceId){showToast('Pick an invoice, or choose a refund method instead');return}
  const appliedAt=document.getElementById('ac-date').value||toDateInputValue(new Date());
  const notes=document.getElementById('ac-notes').value.trim()||null;
  try{
    let paymentId=null;
    if(invoiceId){
      const {data,error}=await sb.from('desk_payments').insert({invoice_id:invoiceId,amount,method:'credit_note',paid_at:appliedAt,notes:notes||`CN-${creditNotes.find(x=>x.id===creditNoteId)?.credit_note_no||''}`}).select();
      if(error)throw error;
      paymentId=data[0].id;
      const {data:invItems}=await sb.from('desk_invoice_items').select('qty,unit_price').eq('invoice_id',invoiceId);
      const {data:invPayments}=await sb.from('desk_payments').select('amount').eq('invoice_id',invoiceId);
      const invTotal=(invItems||[]).reduce((s,it)=>s+Number(it.qty)*Number(it.unit_price),0);
      const invPaid=(invPayments||[]).reduce((s,p)=>s+Number(p.amount),0);
      if(invPaid>=invTotal-0.01){
        await sb.from('desk_invoices').update({status:'paid',updated_at:new Date().toISOString()}).eq('id',invoiceId);
      }
    }
    const {error:appErr}=await sb.from('desk_credit_applications').insert({credit_note_id:creditNoteId,invoice_id:invoiceId,payment_id:paymentId,amount,method,applied_at:appliedAt,notes});
    if(appErr)throw appErr;
    closeModal();
    showToast(invoiceId?'Credit applied to invoice':'Credit refund logged');
    await loadCreditNotes();
    await renderCreditNoteDetail(creditNoteId);
  }catch(e){showToast(''+(e.message||'Could not save — try again'))}
}

async function deleteCreditApplication(applicationId,creditNoteId){
  try{
    const app=creditApplications.find(a=>a.id===applicationId);
    const {error}=await sb.from('desk_credit_applications').delete().eq('id',applicationId);
    if(error)throw error;
    if(app?.payment_id){
      await sb.from('desk_payments').delete().eq('id',app.payment_id);
    }
    showToast('Removed');
    await loadCreditNotes();
    await renderCreditNoteDetail(creditNoteId);
  }catch(e){showToast('Could not remove')}
}

// ── Item Returns (from Invoice detail) ───────────────────────
// Picks specific line items off an already-loaded invoice, asks per
// stock-tracked item whether it's resellable (goes back into
// desk_stock.qty_on_hand) or damaged/unsellable (kept out of stock, just
// logged for the audit trail), then creates a draft credit note carrying
// the returned lines — reusing all the round-20 credit note machinery for
// the actual issue/apply/refund step rather than duplicating it here.
function openReturnItemModal(invoiceId){
  const inv=invoices.find(x=>x.id===invoiceId);
  if(!inv||!invoiceItems.length){showToast('No items on this invoice to return');return}
  const rows=invoiceItems.map(it=>{
    const stock=it.stock_id?stockItems.find(s=>s.id===it.stock_id):null;
    const isPhysical=!!(stock&&stock.is_physical);
    return `<div class="return-item-row" data-item-id="${it.id}" data-physical="${isPhysical}">
      <div class="return-item-desc">${esc(it.description)}<div style="font-size:var(--text-micro);color:var(--text-secondary)">Sold: ${it.qty} × $${Number(it.unit_price).toFixed(2)}</div></div>
      <input type="number" class="form-input return-item-qty" min="0" max="${it.qty}" step="1" placeholder="Qty">
      ${isPhysical?`<select class="form-select return-item-condition">
        <option value="resellable">Resellable</option>
        <option value="damaged">Damaged / unsellable</option>
      </select>`:'<span style="font-size:var(--text-micro);color:var(--text-secondary);align-self:center">Not stock-tracked</span>'}
    </div>`;
  }).join('');
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card" style="max-width:640px">
      <div class="modal-title">Return Item(s) — INV-${inv.invoice_no}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-3)">Enter the quantity being returned for each item. For stock-tracked items, say whether it can be resold — resellable items go straight back into inventory, damaged/unsellable ones are kept out of stock but still logged. This creates a draft credit note you can review before issuing.</div>
      <div class="return-item-list">${rows}</div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveReturnItems('${invoiceId}')">Create Credit Note</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveReturnItems(invoiceId){
  const inv=invoices.find(x=>x.id===invoiceId);
  if(!inv)return;
  const rows=[...document.querySelectorAll('.return-item-row')];
  const toReturn=[];
  for(const row of rows){
    const qtyVal=row.querySelector('.return-item-qty').value;
    const qty=qtyVal?parseInt(qtyVal,10):0;
    if(!qty||qty<=0)continue;
    const item=invoiceItems.find(it=>it.id===row.dataset.itemId);
    if(!item)continue;
    if(qty>Number(item.qty)){showToast(`Can't return more than the ${item.qty} sold for "${item.description}"`);return}
    const conditionEl=row.querySelector('.return-item-condition');
    toReturn.push({item,qty,condition:conditionEl?conditionEl.value:null});
  }
  if(!toReturn.length){showToast('Enter a quantity for at least one item');return}
  try{
    const {data:cnData,error:cnErr}=await sb.from('desk_credit_notes').insert({customer_id:inv.customer_id,vehicle_id:inv.vehicle_id||null,invoice_id:inv.id,reason:`Item return from INV-${inv.invoice_no}`}).select();
    if(cnErr)throw cnErr;
    const creditNoteId=cnData[0].id;
    const creditNoteNo=cnData[0].credit_note_no;
    for(const r of toReturn){
      const {error:itemErr}=await sb.from('desk_credit_note_items').insert({credit_note_id:creditNoteId,description:r.item.description,qty:r.qty,unit_price:r.item.unit_price,stock_id:r.item.stock_id||null,return_condition:r.condition});
      if(itemErr)throw itemErr;
      if(r.item.stock_id&&r.condition){
        const stock=stockItems.find(s=>s.id===r.item.stock_id);
        if(stock){
          const qtyBefore=Number(stock.qty_on_hand)||0;
          const qtyAfter=r.condition==='resellable'?qtyBefore+r.qty:qtyBefore;
          if(r.condition==='resellable'){
            await sb.from('desk_stock').update({qty_on_hand:qtyAfter,updated_at:new Date().toISOString()}).eq('id',r.item.stock_id);
          }
          await sb.from('desk_stock_adjustments').insert({stock_id:r.item.stock_id,qty_before:qtyBefore,qty_after:qtyAfter,reason:r.condition==='resellable'?`Customer return — resellable (CN-${creditNoteNo})`:`Customer return — damaged/unsellable, not restocked (CN-${creditNoteNo})`});
        }
      }
    }
    closeModal();
    showToast('Credit note created from return');
    activateNavView('invoices');
    invoicesSubView='credit-notes';
    creditNoteStatusFilter='all';
    selectedCreditNoteId=creditNoteId;
    await renderCreditNotesView();
  }catch(e){showToast('Could not process return')}
}

function filteredInvoices(){
  const wantType=invoicesSubView==='quotes'?'quote':'invoice';
  let list=invoices.filter(i=>(i.doc_type||'invoice')===wantType);
  if(invoiceStatusFilter!=='all')list=list.filter(i=>i.status===invoiceStatusFilter);
  const term=invoiceSearchTerm.toLowerCase();
  if(term)list=list.filter(i=>[String(i.invoice_no),i.customer?.name].join(' ').toLowerCase().includes(term));
  return list;
}

function renderInvoiceList(){
  const main=document.getElementById('main');
  const docType=invoicesSubView==='quotes'?'quote':'invoice';
  const statusOptions=['all',...docStatusOrder(docType)];
  const list=filteredInvoices();
  let h=invoicesTabBar();
  h+=`<div class="status-tabs">
    ${statusOptions.map(s=>`<button class="status-tab ${invoiceStatusFilter===s?'active':''}" onclick="setInvoiceFilter('${s}')">${s==='all'?'All':DOC_STATUS_LABELS[s]}</button>`).join('')}
  </div>
  <div class="toolbar">
    <input class="search-input" id="invoice-search" placeholder="Search by number or customer…" value="${esc(invoiceSearchTerm)}" oninput="onInvoiceSearch(this.value)">
    <button class="btn-primary" onclick="openNewInvoiceModal('${docType}')">+ New ${docType==='quote'?'Quote':'Invoice'}</button>
  </div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${invoices.length?'No matches.':`No ${docType}s yet — create one, or make one from a Job Card.`}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(inv=>{
      const {totalIncl}=calcInvoiceTotals(inv.items,inv.discount_type,inv.discount_value);
      h+=`<div class="list-row" onclick="openInvoice('${inv.id}')">
        <div class="list-row-name">${docPrefix(inv.doc_type)}-${inv.invoice_no}</div>
        <div class="list-row-sub" style="flex:1">${esc(inv.customer?.name||'Unknown')}</div>
        <div class="list-row-sub">${new Date(inv.issue_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</div>
        <div class="list-row-sub" style="font-weight:700">$${totalIncl.toFixed(2)}</div>
        <span class="status-badge ${inv.status}">${DOC_STATUS_LABELS[inv.status]}</span>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function setInvoiceFilter(f){invoiceStatusFilter=f;renderInvoiceList()}
function onInvoiceSearch(v){
  invoiceSearchTerm=v;renderInvoiceList();
  setTimeout(()=>{const i=document.getElementById('invoice-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}

async function openInvoice(id){selectedInvoiceId=id;invoiceCustomerPickerOpenFor=null;await renderInvoiceDetail(id)}
function backFromInvoiceDetail(){selectedInvoiceId=null;renderInvoiceList()}

// ── New Invoice (standalone — existing customer only; create a new
// customer under Customers & Vehicles first if they're not in the system
// yet, keeps this modal simple since most invoices tie back to a job anyway) ──
function openNewInvoiceModal(docType){
  newInvoiceCustomerId=null;
  newInvoiceCustomerName='';
  newInvoiceVehicles=[];
  newInvoiceDocType=docType||'invoice';
  const label=newInvoiceDocType==='quote'?'Quote':'Invoice';
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">New ${label}</div>
      <div id="new-invoice-customer-area">
        <label class="form-label">Customer *</label>
        <div class="autocomplete">
          <input class="form-input" id="niv-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewInvoiceCustomerSearch(this.value)">
          <div id="niv-customer-results"></div>
        </div>
      </div>
      <div id="new-invoice-vehicle-area"></div>
      <label class="form-label">Due date</label>
      <input class="form-input" type="date" id="niv-due">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveNewInvoice()">Create ${label}</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function onNewInvoiceCustomerSearch(v){
  newInvoiceCustomerName=v;
  newInvoiceCustomerId=null;
  const term=v.trim().toLowerCase();
  const results=document.getElementById('niv-customer-results');
  if(!term){results.innerHTML='';return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(term)).slice(0,8);
  let h='<div class="autocomplete-list">';
  matches.forEach(c=>{h+=`<div class="autocomplete-item" onclick="selectNewInvoiceCustomer('${c.id}')">${esc(c.name)}${c.mobile?' — '+esc(c.mobile):''}</div>`});
  h+=`<div class="autocomplete-item create-new" onclick="selectNewInvoiceCustomer(null)">+ Create new customer "${esc(v.trim())}"</div>`;
  h+='</div>';
  results.innerHTML=h;
}

async function selectNewInvoiceCustomer(id){
  document.getElementById('niv-customer-results').innerHTML='';
  if(id){
    const c=customers.find(x=>x.id===id);
    if(!c)return;
    newInvoiceCustomerId=id;
    newInvoiceCustomerName=c.name;
    document.getElementById('new-invoice-customer-area').innerHTML=`<label class="form-label">Customer</label><div class="selected-chip">${esc(c.name)} <button onclick="resetNewInvoiceCustomer()">✕</button></div>`;
    try{
      const {data,error}=await sb.from('desk_vehicles').select('*').eq('customer_id',id).order('created_at');
      if(error)throw error;
      newInvoiceVehicles=data||[];
    }catch(e){newInvoiceVehicles=[]}
  }else{
    newInvoiceCustomerId=null;
    newInvoiceVehicles=[];
    document.getElementById('new-invoice-customer-area').innerHTML=`<label class="form-label">New customer</label>
      <div class="selected-chip">New: ${esc(newInvoiceCustomerName)} <button onclick="resetNewInvoiceCustomer()">✕</button></div>
      <input class="form-input" id="niv-new-cust-mobile" placeholder="Mobile">
      <input class="form-input" id="niv-new-cust-phone" placeholder="Phone">
      <input class="form-input" id="niv-new-cust-email" placeholder="Email">`;
  }
  renderNewInvoiceVehicleArea();
}

function resetNewInvoiceCustomer(){
  newInvoiceCustomerId=null;newInvoiceCustomerName='';newInvoiceVehicles=[];
  document.getElementById('new-invoice-customer-area').innerHTML=`<label class="form-label">Customer *</label>
    <div class="autocomplete">
      <input class="form-input" id="niv-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewInvoiceCustomerSearch(this.value)">
      <div id="niv-customer-results"></div>
    </div>`;
  renderNewInvoiceVehicleArea();
}

function renderNewInvoiceVehicleArea(){
  const area=document.getElementById('new-invoice-vehicle-area');
  if(!area)return;
  if(!newInvoiceCustomerId){
    area.innerHTML=newInvoiceCustomerName?`
      <label class="form-label">Vehicle (optional)</label>
      <input class="form-input" id="niv-veh-rego" placeholder="Rego">
      <input class="form-input" id="niv-veh-make" placeholder="Make">
      <input class="form-input" id="niv-veh-model" placeholder="Model">
      <input class="form-input" id="niv-veh-odo" type="number" placeholder="Odometer (km)">`:'';
    return;
  }
  area.innerHTML=`<label class="form-label">Vehicle</label>
    <select class="form-select" id="niv-vehicle">
      <option value="">— None —</option>
      ${newInvoiceVehicles.map(v=>`<option value="${v.id}">${esc(v.make||'')} ${esc(v.model||'')}${v.rego?' ('+esc(v.rego)+')':''}</option>`).join('')}
    </select>`;
}

async function saveNewInvoice(){
  if(!newInvoiceCustomerId&&!newInvoiceCustomerName.trim()){showToast('Pick or create a customer');return}
  const vehicleEl=document.getElementById('niv-vehicle');
  const dueVal=document.getElementById('niv-due').value;
  try{
    let customerId=newInvoiceCustomerId;
    if(!customerId){
      const {data,error}=await sb.from('desk_customers').insert({
        name:newInvoiceCustomerName.trim(),
        mobile:document.getElementById('niv-new-cust-mobile')?.value.trim()||null,
        phone:document.getElementById('niv-new-cust-phone')?.value.trim()||null,
        email:document.getElementById('niv-new-cust-email')?.value.trim()||null
      }).select();
      if(error)throw error;
      customerId=data[0].id;
    }
    let vehicleId=vehicleEl?(vehicleEl.value||null):null;
    const vRegoEl=document.getElementById('niv-veh-rego');
    if(vRegoEl){
      const vRego=vRegoEl.value.trim();
      const vMake=document.getElementById('niv-veh-make').value.trim();
      const vModel=document.getElementById('niv-veh-model').value.trim();
      const vOdo=document.getElementById('niv-veh-odo').value;
      if(vRego||vMake||vModel||vOdo){
        const {data,error}=await sb.from('desk_vehicles').insert({customer_id:customerId,rego:vRego||null,make:vMake||null,model:vModel||null,odometer:vOdo?parseInt(vOdo,10):null}).select();
        if(error)throw error;
        vehicleId=data[0].id;
      }
    }
    const {data,error}=await sb.from('desk_invoices').insert({
      customer_id:customerId,
      vehicle_id:vehicleId,
      due_date:dueVal||null,
      doc_type:newInvoiceDocType
    }).select();
    if(error)throw error;
    closeModal();
    showToast((newInvoiceDocType==='quote'?'Quote':'Invoice')+' created');
    invoicesSubView=newInvoiceDocType==='quote'?'quotes':'invoices';
    selectedInvoiceId=data[0].id;
    await loadCustomers();
    await renderInvoicesView();
  }catch(e){showToast('Could not create')}
}

// ── Invoice detail ──────────────────────────────────────────
async function loadInvoiceItems(invoiceId){
  try{
    const {data,error}=await sb.from('desk_invoice_items').select('*').eq('invoice_id',invoiceId).order('sort_order').order('created_at');
    if(error)throw error;
    invoiceItems=data||[];
  }catch(e){invoiceItems=[]}
}

const XERO_SYNC_LABELS={not_synced:'Not synced',pending:'Pending',synced:'Synced',error:'Error'};

// Builds just the invoice/quote panel markup — no page wrapper, no
// back-link — so it can be dropped into either the standalone Invoices tab
// (renderInvoiceDetail below) or inline inside a Job Detail page
// (renderJobDetail's jobInvoicePanelJobId branch), from the exact same data
// load and template. Returns null if the invoice no longer exists.
async function buildInvoicePanelHtml(id){
  await loadInvoiceItems(id);
  await loadStockItems();
  const inv=invoices.find(x=>x.id===id);
  if(!inv)return null;
  const docType=inv.doc_type||'invoice';
  const isQuote=docType==='quote';
  const {rawTotal,discountAmount,totalIncl,gst,exclSubtotal}=calcInvoiceTotals(invoiceItems,inv.discount_type,inv.discount_value);
  // Walk items in sort_order: each header accumulates the total of the priced
  // items beneath it, up to the next header. Items before the first header
  // have no group and no subtotal shown. Used in the header row below.
  let curHeader=null; const hdrTotals={};
  invoiceItems.forEach(it=>{
    if(it.is_header){curHeader=it.id;hdrTotals[it.id]=0}
    else if(curHeader)hdrTotals[curHeader]=(hdrTotals[curHeader]||0)+(Number(it.qty)||0)*(Number(it.unit_price)||0);
  });
  const vehDesc=inv.vehicle?[inv.vehicle.make,inv.vehicle.model].filter(Boolean).join(' ')+(inv.vehicle.rego?' ('+inv.vehicle.rego+')':''):'';
  let amountPaid=0,balanceDue=totalIncl;
  if(!isQuote){
    await loadInvoicePayments(id);
    amountPaid=invoicePayments.reduce((s,p)=>s+Number(p.amount),0);
    balanceDue=totalIncl-amountPaid;
  }
  return `<div class="panel" style="max-width:800px">
    <div class="panel-head">
      <div class="panel-title">${isQuote?'Quote':'Invoice'} ${docPrefix(docType)}-${inv.invoice_no}</div>
      <span class="status-badge ${inv.status}">${DOC_STATUS_LABELS[inv.status]}</span>
    </div>
    <div class="job-status-actions">
      ${docStatusOrder(docType).map(s=>`<button class="${s===inv.status?'current':''}" ${s===inv.status?'disabled':''} onclick="setInvoiceStatus('${inv.id}','${s}')">${DOC_STATUS_LABELS[s]}</button>`).join('')}
    </div>
    ${isQuote?(inv.converted_invoice_id?`<div style="margin-bottom:var(--space-4)"><span class="tag-option" onclick="viewRelatedInvoice('${inv.converted_invoice_id}')">→ Converted to INV-${(invoices.find(x=>x.id===inv.converted_invoice_id)||{}).invoice_no||''}</span></div>`:`<div style="margin-bottom:var(--space-4)"><button class="btn-secondary" onclick="convertQuoteToInvoice('${inv.id}')">Convert to Invoice</button></div>`):''}
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);flex-wrap:wrap">
      <button class="btn-secondary" onclick="printInvoice('${inv.id}')">Print</button>
      <button class="btn-secondary" onclick="emailInvoice('${inv.id}')">Email</button>
      <button class="btn-secondary" onclick="smsInvoice('${inv.id}')">SMS</button>
      ${isQuote?'':`<button class="btn-primary" onclick="openRecordPaymentModal('${inv.id}',${balanceDue})">Record Payment</button>`}
      ${isQuote?'':`<button class="btn-secondary" onclick="openReturnItemModal('${inv.id}')">Return Item</button>`}
    </div>
    ${invoiceCustomerPickerOpenFor===inv.id?`
    <div class="field-row" style="align-items:flex-start">
      <span class="field-label" style="margin-top:var(--space-2)">Customer</span>
      <span class="field-val" style="text-align:left;flex:1">
        <div class="autocomplete">
          <input class="form-input" id="inv-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onInvoiceCustomerPickerSearch('${inv.id}',this.value)" style="margin-bottom:0">
          <div id="inv-customer-picker-results"></div>
        </div>
        <button class="btn-link" style="margin-top:var(--space-2)" onclick="closeInvoiceCustomerPicker('${inv.id}')">Cancel</button>
      </span>
    </div>`:`
    <div class="field-row"><span class="field-label">Customer</span><span class="field-val">${esc(inv.customer?.name||'—')} <button class="btn-link" style="margin-left:var(--space-2)" onclick="openInvoiceCustomerPicker('${inv.id}')">Change</button></span></div>`}
    <div class="field-row"><span class="field-label">Vehicle</span><span class="field-val">${esc(vehDesc||'—')}</span></div>
    <div class="field-row"><span class="field-label">Issue date</span><span class="field-val">${new Date(inv.issue_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</span></div>
    <div class="field-row"><span class="field-label">Due date</span><span class="field-val"><input type="date" style="padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);font-size:13px" value="${inv.due_date||''}" onchange="updateInvoiceField('${inv.id}','due_date',this.value)"></span></div>
    ${isQuote?'':`<div class="field-row"><span class="field-label">Xero</span><span class="field-val"><span class="status-badge ${inv.xero_sync_status==='synced'?'finished':inv.xero_sync_status==='error'?'on_hold':'draft'}">${XERO_SYNC_LABELS[inv.xero_sync_status||'not_synced']}</span></span></div>`}

    <div class="invoice-items-wrap">
    <table class="invoice-items-table">
      <thead><tr><th class="drag-col"></th><th>Description</th><th class="qty-col">Qty</th><th class="price-col">Unit Price</th><th class="total-col">Total</th><th class="tax-col">Tax</th><th class="del-col"></th></tr></thead>
      <tbody>
        ${invoiceItems.map(it=>it.is_header?`<tr class="invoice-header-row" draggable="true" data-item-id="${it.id}"
            ondragstart="onInvItemDragStart(event,'${it.id}')"
            ondragover="onInvItemDragOver(event)"
            ondragleave="onInvItemDragLeave(event)"
            ondrop="onInvItemDrop(event,'${it.id}','${inv.id}')"
            ondragend="onInvItemDragEnd(event)">
          <td class="drag-col"><span class="drag-handle" title="Drag to reorder">⋮⋮</span></td>
          <td colspan="5" class="invoice-header-cell">
            <input class="invoice-header-input" value="${esc(it.description)}" placeholder="Section header…" onchange="updateInvoiceItem('${it.id}','description',this.value)">
            <span class="header-subtotal">$${hdrTotals[it.id].toFixed(2)}</span>
          </td>
          <td class="del-col"><button class="btn-danger-link" onclick="deleteInvoiceItem('${it.id}')">✕</button></td>
        </tr>`:`<tr draggable="true" data-item-id="${it.id}"
            ondragstart="onInvItemDragStart(event,'${it.id}')"
            ondragover="onInvItemDragOver(event)"
            ondragleave="onInvItemDragLeave(event)"
            ondrop="onInvItemDrop(event,'${it.id}','${inv.id}')"
            ondragend="onInvItemDragEnd(event)">
          <td class="drag-col"><span class="drag-handle" title="Drag to reorder">⋮⋮</span></td>
          <td><input value="${esc(it.description)}" onchange="updateInvoiceItem('${it.id}','description',this.value)"></td>
          <td class="qty-col"><input type="number" step="1" min="1" value="${it.qty}" onchange="updateInvoiceItem('${it.id}','qty',this.value)"></td>
          <td class="price-col"><input type="number" step="0.01" value="${it.unit_price}" onchange="updateInvoiceItem('${it.id}','unit_price',this.value)"></td>
          <td class="total-col">$${(it.qty*it.unit_price).toFixed(2)}</td>
          <td class="tax-col"><select onchange="updateInvoiceItem('${it.id}','tax_type',this.value)">
            ${XERO_TAX_TYPES.map(t=>`<option value="${esc(t)}" ${(it.tax_type||'GST on Income')===t?'selected':''}>${esc(t)}</option>`).join('')}
          </select></td>
          <td class="del-col"><button class="btn-danger-link" onclick="deleteInvoiceItem('${it.id}')">✕</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2)">
      <button class="btn-link" onclick="toggleInvoiceItemPicker('${inv.id}')">+ Add line item</button>
      <button class="btn-link" onclick="addInvoiceHeader('${inv.id}')">+ Add header</button>
    </div>
    <div id="invoice-item-picker-area"></div>

    <div class="field-row" style="align-items:center">
      <span class="field-label">Discount</span>
      <span class="field-val" style="display:flex;gap:var(--space-2);align-items:center">
        <select id="inv-discount-type" style="padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);font-size:13px" onchange="updateInvoiceDiscount('${inv.id}')">
          <option value="" ${!inv.discount_type?'selected':''}>None</option>
          <option value="percent" ${inv.discount_type==='percent'?'selected':''}>%</option>
          <option value="fixed" ${inv.discount_type==='fixed'?'selected':''}>$</option>
        </select>
        <input type="number" step="0.01" id="inv-discount-value" value="${inv.discount_value||''}" style="width:80px;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);font-size:13px" onchange="updateInvoiceDiscount('${inv.id}')">
      </span>
    </div>
    <div class="invoice-totals" style="margin-top:var(--space-6)">
      ${discountAmount?`<div class="field-row"><span class="field-label">Subtotal before discount</span><span class="field-val">$${rawTotal.toFixed(2)}</span></div>
      <div class="field-row"><span class="field-label">Discount</span><span class="field-val">-$${discountAmount.toFixed(2)}</span></div>`:''}
      <div class="field-row"><span class="field-label">Subtotal (excl. GST)</span><span class="field-val">$${exclSubtotal.toFixed(2)}</span></div>
      <div class="field-row"><span class="field-label">GST (10%)</span><span class="field-val">$${gst.toFixed(2)}</span></div>
      <div class="field-row grand"><span class="field-label">Total (incl. GST)</span><span class="field-val">$${totalIncl.toFixed(2)}</span></div>
      ${isQuote?'':`
      <div class="field-row"><span class="field-label">Paid</span><span class="field-val">$${amountPaid.toFixed(2)}</span></div>
      <div class="field-row grand"><span class="field-label">Balance Due</span><span class="field-val">$${balanceDue.toFixed(2)}</span></div>`}
    </div>

    ${isQuote?'':`
    <div class="panel-head" style="margin-top:var(--space-6)"><div class="panel-title" style="font-size:13px">Payments</div></div>
    ${invoicePayments.length?invoicePayments.map(p=>`
      <div class="field-row">
        <span class="field-label">${new Date(p.paid_at).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})} · ${PAYMENT_METHOD_LABELS[p.method]}${p.notes?' · '+esc(p.notes):''}</span>
        <span class="field-val">$${Number(p.amount).toFixed(2)} <button class="btn-danger-link" style="margin-left:var(--space-2)" onclick="deletePayment('${p.id}','${inv.id}')">✕</button></span>
      </div>`).join(''):'<div style="font-size:13px;color:var(--text-secondary);padding:var(--space-2) 0">No payments recorded yet.</div>'}`}

    <label class="form-label" style="margin-top:var(--space-4)">Notes</label>
    <textarea class="form-textarea" onchange="updateInvoiceField('${inv.id}','notes',this.value)">${esc(inv.notes||'')}</textarea>
  </div>`;
}

// Every invoice-mutation handler in this file (add/edit/delete line items,
// record a payment, change status, etc.) calls this to refresh after a
// change. Routes to whichever surface the invoice is actually showing on —
// the standalone Invoices tab, or inline on a Job Detail page — so none of
// those call sites need to know or care which context they're in. When
// inline, this only touches the invoice panel's own content (not the whole
// job page) — routine edits shouldn't replay the open/close slide animation
// or reflow the job/notes cards, only actually opening/closing the panel does.
async function renderInvoiceDetail(id){
  if(jobInvoicePanelJobId){
    await refreshJobInvoicePanelContent(id);
    return;
  }
  const main=document.getElementById('main');
  const inv=invoices.find(x=>x.id===id);
  if(!inv){selectedInvoiceId=null;renderInvoiceList();return}
  const backLabel=(inv.doc_type==='quote')?'← All quotes':'← All invoices';
  const panelHtml=await buildInvoicePanelHtml(id);
  if(panelHtml===null){selectedInvoiceId=null;renderInvoiceList();return}
  main.innerHTML=`<button class="back-link" onclick="backFromInvoiceDetail()">${backLabel}</button>\n  ${panelHtml}`;
}

// Content-only refresh of an already-open inline invoice panel (line item
// edited, payment recorded, status changed, ...) — updates just
// #job-invoice-panel-content in place. Deliberately does NOT touch the
// .job-invoice-slot wrapper or its siblings, so the entrance animation and
// the job/notes cards' widths are undisturbed by routine edits; only
// openInvoiceInJob (opening) and closeJobInvoicePanel (closing) do that.
async function refreshJobInvoicePanelContent(invId){
  const content=document.getElementById('job-invoice-panel-content');
  if(!content){await renderJobDetail(jobInvoicePanelJobId);return}
  const panelHtml=await buildInvoicePanelHtml(invId);
  if(panelHtml===null){
    const jid=jobInvoicePanelJobId;
    jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;
    if(jid)await renderJobDetail(jid);
    return;
  }
  content.innerHTML=panelHtml;
}

// Opens a quote/invoice inline on the job it was created from, instead of
// navigating to the Invoices tab — the whole point being to see the job and
// its financial document on one page. Used by "Create Quote"/"Create
// Invoice" and the Quotes & Invoices chips on the Job Detail page.
//
// Inserts the panel as a new DOM node directly into the already-on-screen
// #job-detail-grid (rather than going through renderJobDetail's full
// innerHTML swap) specifically so the animation is real: the sibling job/
// notes cards need a PREVIOUS width to transition from, and a fresh
// full-page render recreates every node at once with nothing to animate.
async function openInvoiceInJob(invId,jobId){
  jobInvoicePanelJobId=jobId;
  jobInvoicePanelInvoiceId=invId;
  selectedInvoiceId=invId;
  invoiceCustomerPickerOpenFor=null;
  // buildInvoicePanelHtml reads from the in-memory `invoices` array, not a
  // fresh query — a just-created invoice (createDocFromJob) isn't in it yet,
  // same reason renderInvoicesView() always reloads before rendering detail.
  await loadInvoices();
  const grid=document.getElementById('job-detail-grid');
  if(!grid){await renderJobDetail(jobId);return}
  if(document.getElementById('job-invoice-slot')){
    // Panel's already open (e.g. converting a quote to its new invoice) —
    // just swap the content, no re-animation.
    await refreshJobInvoicePanelContent(invId);
    return;
  }
  const panelHtml=await buildInvoicePanelHtml(invId);
  if(panelHtml===null){jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;return}
  grid.insertAdjacentHTML('beforeend',jobInvoiceSlotHtml(panelHtml,jobId));
}

function closeJobInvoicePanel(jobId){
  const slot=document.getElementById('job-invoice-slot');
  if(!slot){
    jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;
    renderJobDetail(jobId);
    return;
  }
  let finished=false;
  const finish=()=>{
    if(finished)return;finished=true;
    jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;
    slot.remove();
  };
  slot.classList.add('exiting');
  slot.addEventListener('animationend',finish,{once:true});
  setTimeout(finish,400); // safety net if animationend doesn't fire
}

// Used by links INSIDE the shared invoice panel itself (e.g. "Converted to
// INV-####") that need to follow to a different invoice — stays inline if
// we're currently showing a job's panel, otherwise behaves like the normal
// Invoices-tab navigation.
async function viewRelatedInvoice(invId){
  if(jobInvoicePanelJobId){await openInvoiceInJob(invId,jobInvoicePanelJobId)}
  else{await openInvoiceFromJob(invId,'invoice')}
}

async function loadInvoicePayments(invoiceId){
  try{
    const {data,error}=await sb.from('desk_payments').select('*').eq('invoice_id',invoiceId).order('paid_at',{ascending:false});
    if(error)throw error;
    invoicePayments=data||[];
  }catch(e){invoicePayments=[]}
}

function openRecordPaymentModal(invoiceId,balanceDue){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Record Payment</div>
      <label class="form-label">Amount</label>
      <input class="form-input" type="number" step="0.01" id="pay-amount" value="${balanceDue>0?balanceDue.toFixed(2):''}">
      <label class="form-label">Method</label>
      <select class="form-select" id="pay-method">
        ${selectablePaymentMethods().map(m=>`<option value="${m}">${PAYMENT_METHOD_LABELS[m]}</option>`).join('')}
      </select>
      <label class="form-label">Date</label>
      <input class="form-input" type="date" id="pay-date" value="${new Date().toISOString().slice(0,10)}">
      <label class="form-label">Notes</label>
      <input class="form-input" id="pay-notes">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="savePayment('${invoiceId}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('pay-amount').focus();
}

async function savePayment(invoiceId){
  const amount=parseFloat(document.getElementById('pay-amount').value);
  if(!amount||amount<=0){showToast('Enter a valid amount');return}
  const method=document.getElementById('pay-method').value;
  const paidAt=document.getElementById('pay-date').value||new Date().toISOString().slice(0,10);
  const notes=document.getElementById('pay-notes').value.trim()||null;
  try{
    const {error}=await sb.from('desk_payments').insert({invoice_id:invoiceId,amount,method,paid_at:paidAt,notes});
    if(error)throw error;
    closeModal();
    showToast('Payment recorded');
    await loadInvoicePayments(invoiceId);
    const paidSum=invoicePayments.reduce((s,p)=>s+Number(p.amount),0);
    const invForTotal=invoices.find(x=>x.id===invoiceId);
    const {totalIncl}=calcInvoiceTotals(invoiceItems,invForTotal?.discount_type,invForTotal?.discount_value);
    if(paidSum>=totalIncl-0.01){
      await sb.from('desk_invoices').update({status:'paid',updated_at:new Date().toISOString()}).eq('id',invoiceId);
    }
    await loadInvoices();
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not record payment')}
}

async function deletePayment(paymentId,invoiceId){
  try{
    const {error}=await sb.from('desk_payments').delete().eq('id',paymentId);
    if(error)throw error;
    showToast('Payment removed');
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not remove payment')}
}

// Copies line items across rather than moving the quote itself — the quote
// stays as a record of what was originally proposed, the new invoice is a
// separate row linked back via converted_invoice_id.
async function convertQuoteToInvoice(quoteId){
  const q=invoices.find(x=>x.id===quoteId);
  if(!q)return;
  if(!confirm('Convert this quote to an invoice with the same line items?'))return;
  try{
    await loadInvoiceItems(quoteId);
    const itemsToCopy=invoiceItems;
    const {data,error}=await sb.from('desk_invoices').insert({
      customer_id:q.customer_id,vehicle_id:q.vehicle_id,job_id:q.job_id,doc_type:'invoice',notes:q.notes
    }).select();
    if(error)throw error;
    const newInvId=data[0].id;
    if(itemsToCopy.length){
      const rows=itemsToCopy.map(it=>({invoice_id:newInvId,description:it.description,qty:it.qty,unit_price:it.unit_price,stock_id:it.stock_id||null}));
      const {error:itemsErr}=await sb.from('desk_invoice_items').insert(rows);
      if(itemsErr)throw itemsErr;
    }
    const {error:updErr}=await sb.from('desk_invoices').update({converted_invoice_id:newInvId,status:'approved',updated_at:new Date().toISOString()}).eq('id',quoteId);
    if(updErr)throw updErr;
    showToast('Converted to invoice');
    if(jobInvoicePanelJobId){
      // Stay on the job page, just swap the inline panel's content to the
      // new invoice — the panel's already open, so this shouldn't re-animate.
      jobInvoicePanelInvoiceId=newInvId;
      selectedInvoiceId=newInvId;
      await refreshJobInvoicePanelContent(newInvId);
    }else{
      invoicesSubView='invoices';
      selectedInvoiceId=newInvId;
      await renderInvoicesView();
    }
  }catch(e){showToast('Could not convert')}
}

async function updateInvoiceItem(itemId,field,value){
  const stringFields=['description','account_code','tax_type'];
  let v;
  if(stringFields.includes(field))v=value||null;
  else if(field==='qty')v=Math.max(1,Math.round(parseFloat(value))||1);
  else v=parseFloat(value)||0;
  const payload={[field]:v};
  try{
    const {error}=await sb.from('desk_invoice_items').update(payload).eq('id',itemId);
    if(error)throw error;
    await renderInvoiceDetail(selectedInvoiceId);
  }catch(e){showToast('Could not update item')}
}

async function deleteInvoiceItem(itemId){
  try{
    const {error}=await sb.from('desk_invoice_items').delete().eq('id',itemId);
    if(error)throw error;
    await renderInvoiceDetail(selectedInvoiceId);
  }catch(e){showToast('Could not delete item')}
}

async function addBlankInvoiceItem(invoiceId){
  try{
    const nextOrder=invoiceItems.length;
    const {error}=await sb.from('desk_invoice_items').insert({invoice_id:invoiceId,description:'New item',qty:1,unit_price:0,sort_order:nextOrder});
    if(error)throw error;
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not add item')}
}

function toggleInvoiceItemPicker(invoiceId){
  const el=document.getElementById('invoice-item-picker-area');
  if(!el)return;
  if(el.innerHTML.trim()){el.innerHTML='';return}
  el.innerHTML=`<div class="tag-picker">
    <input type="text" class="form-input" id="inv-item-search" placeholder="Search inventory…" oninput="onInvoiceItemSearch('${invoiceId}',this.value)" style="margin-bottom:var(--space-2)">
    <div id="inv-item-search-results"></div>
    <div class="tag-create-row" style="border-top:none;padding-top:0">
      <button class="btn-link" onclick="addBlankInvoiceItem('${invoiceId}');toggleInvoiceItemPicker('${invoiceId}')">+ Add blank line item instead</button>
    </div>
  </div>`;
  document.getElementById('inv-item-search').focus();
}

function onInvoiceItemSearch(invoiceId,term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('inv-item-search-results');
  if(!t){results.innerHTML='';return}
  const matches=stockItems.filter(s=>s.is_active&&(s.name.toLowerCase().includes(t)||(s.sku||'').toLowerCase().includes(t))).slice(0,8);
  results.innerHTML=matches.length?matches.map(s=>`<div class="autocomplete-item" onclick="addStockInvoiceItem('${invoiceId}','${s.id}')">${s.is_physical?'📦':'🔧'} ${esc(s.name)}${s.sku?' ('+esc(s.sku)+')':''} — $${Number(s.sell_price).toFixed(2)}</div>`).join(''):'<div class="autocomplete-item" style="color:var(--text-secondary)">No matches</div>';
}

async function addStockInvoiceItem(invoiceId,stockId){
  const s=stockItems.find(x=>x.id===stockId);
  if(!s)return;
  try{
    const nextOrder=invoiceItems.length;
    const {error}=await sb.from('desk_invoice_items').insert({invoice_id:invoiceId,description:s.name,qty:1,unit_price:s.sell_price,stock_id:s.id,sort_order:nextOrder});
    if(error)throw error;
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not add item')}
}

// ── Invoice section headers & drag-and-drop reordering ──────────

async function addInvoiceHeader(invoiceId){
  try{
    const nextOrder=invoiceItems.length;
    const {error}=await sb.from('desk_invoice_items').insert({invoice_id:invoiceId,description:'New section',is_header:true,sort_order:nextOrder});
    if(error)throw error;
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not add header')}
}

let dragItemId=null;

function onInvItemDragStart(e,itemId){
  dragItemId=itemId;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',itemId);
  e.currentTarget.classList.add('dragging');
  // Let the browser draw its own ghost — no custom drag image needed.
}

function onInvItemDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  e.currentTarget.classList.add('drag-over');
}

function onInvItemDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}

async function onInvItemDrop(e,targetId,invoiceId){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(!dragItemId||dragItemId===targetId){dragItemId=null;return}
  await reorderInvoiceItems(invoiceId,dragItemId,targetId);
  dragItemId=null;
}

function onInvItemDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
  dragItemId=null;
}

// Reorders items by moving dragId to targetId's position, renumbering
// sort_order for everything between. Batch-updates only the changed rows.
async function reorderInvoiceItems(invoiceId,dragId,targetId){
  const items=[...invoiceItems];
  const dragIdx=items.findIndex(it=>it.id===dragId);
  const targetIdx=items.findIndex(it=>it.id===targetId);
  if(dragIdx===-1||targetIdx===-1)return;
  const [moved]=items.splice(dragIdx,1);
  const insertAt=dragIdx<targetIdx?targetIdx:(targetIdx);
  items.splice(insertAt,0,moved);
  // Re-number sort_order sequentially
  const updates=[];
  items.forEach((it,i)=>{if(it.sort_order!==i)updates.push({id:it.id,sort_order:i})});
  if(!updates.length)return;
  try{
    for(const u of updates){
      const {error}=await sb.from('desk_invoice_items').update({sort_order:u.sort_order}).eq('id',u.id);
      if(error)throw error;
    }
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not reorder')}
}

async function updateInvoiceField(invoiceId,field,value){
  try{
    const {error}=await sb.from('desk_invoices').update({[field]:value||null,updated_at:new Date().toISOString()}).eq('id',invoiceId);
    if(error)throw error;
    await loadInvoices();
  }catch(e){showToast('Could not update invoice')}
}

// ── Change customer on an existing invoice/quote ──────────────
// The "Bill To" area on the detail screen: click Change, search, pick a
// customer. Existing customers only — unlike New Invoice's picker, there's
// no "+ Create new customer" row, since the document already exists and
// needs a real customer to bill, not a name typed in passing.
async function openInvoiceCustomerPicker(invoiceId){
  invoiceCustomerPickerOpenFor=invoiceId;
  if(!customers.length)await loadCustomers();
  await renderInvoiceDetail(invoiceId);
  document.getElementById('inv-customer-search')?.focus();
}

function closeInvoiceCustomerPicker(invoiceId){
  invoiceCustomerPickerOpenFor=null;
  renderInvoiceDetail(invoiceId);
}

function onInvoiceCustomerPickerSearch(invoiceId,v){
  const results=document.getElementById('inv-customer-picker-results');
  if(!results)return;
  const term=v.trim().toLowerCase();
  if(!term){results.innerHTML='';return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(term)).slice(0,8);
  if(!matches.length){results.innerHTML='<div class="autocomplete-list"><div class="autocomplete-item" style="cursor:default;color:var(--text-secondary)">No matching customers</div></div>';return}
  let h='<div class="autocomplete-list">';
  matches.forEach(c=>{h+=`<div class="autocomplete-item" onclick="applyInvoiceCustomerChange('${invoiceId}','${c.id}')">${esc(c.name)}${c.mobile?' — '+esc(c.mobile):''}</div>`});
  h+='</div>';
  results.innerHTML=h;
}

async function applyInvoiceCustomerChange(invoiceId,customerId){
  const inv=invoices.find(x=>x.id===invoiceId);
  const c=customers.find(x=>x.id===customerId);
  if(!inv||!c)return;
  if(customerId===inv.customer_id){closeInvoiceCustomerPicker(invoiceId);return}
  // Any vehicle already on the document belonged to the OLD customer — the
  // only way a vehicle_id ever gets set here is via a picker scoped to
  // whichever customer was selected at the time (New Invoice modal, or
  // createDocFromJob copying the job's own vehicle). Once the customer
  // changes, that vehicle can no longer be right, so it's cleared rather
  // than left pointing at another customer's car. There's no vehicle-reselect
  // UI on this screen (read-only elsewhere in this view) — reselecting one is
  // a separate follow-up if it's needed.
  const hadVehicle=!!inv.vehicle_id;
  try{
    const {error}=await sb.from('desk_invoices').update({
      customer_id:customerId,
      vehicle_id:null,
      updated_at:new Date().toISOString()
    }).eq('id',invoiceId);
    if(error)throw error;
    invoiceCustomerPickerOpenFor=null;
    await loadInvoices();
    showToast(hadVehicle?`Billed to ${c.name} — vehicle cleared (belonged to the previous customer)`:`Billed to ${c.name}`);
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not change customer')}
}

async function updateInvoiceDiscount(invoiceId){
  const type=document.getElementById('inv-discount-type').value||null;
  const valueRaw=document.getElementById('inv-discount-value').value;
  const value=type&&valueRaw?parseFloat(valueRaw):null;
  try{
    const {error}=await sb.from('desk_invoices').update({discount_type:type,discount_value:value,updated_at:new Date().toISOString()}).eq('id',invoiceId);
    if(error)throw error;
    await loadInvoices();
    await renderInvoiceDetail(invoiceId);
  }catch(e){showToast('Could not update discount')}
}

async function setInvoiceStatus(id,status){
  try{
    const {error}=await sb.from('desk_invoices').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    showToast('Status updated');
    await loadInvoices();
    await renderInvoiceDetail(id);
  }catch(e){showToast('Could not update status')}
}

// ── Create Invoice from a Job Card ──────────────────────────
async function loadJobInvoices(jobId){
  try{
    const {data,error}=await sb.from('desk_invoices').select('id,invoice_no,status,doc_type').eq('job_id',jobId).order('invoice_no',{ascending:false});
    if(error)throw error;
    return data||[];
  }catch(e){return []}
}

async function openInvoiceFromJob(invId,docType){
  activateNavView('invoices');
  invoicesSubView=docType==='quote'?'quotes':'invoices';
  selectedInvoiceId=invId;
  invoiceCustomerPickerOpenFor=null;
  await renderInvoicesView();
}

async function viewCreditNotesFromCustomer(){
  activateNavView('invoices');
  invoicesSubView='credit-notes';
  creditNoteStatusFilter='all';
  selectedCreditNoteId=null;
  await renderCreditNotesView();
}

async function createDocFromJob(jobId,docType){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  try{
    // order_no is COPIED onto the document rather than read back through
    // job_id: the invoice is a record of what was sent, so editing the job
    // afterwards must not silently change an invoice the customer already has.
    const {data,error}=await sb.from('desk_invoices').insert({customer_id:j.customer_id,vehicle_id:j.vehicle_id||null,job_id:j.id,doc_type:docType,order_no:j.order_no||null}).select();
    if(error)throw error;
    const invId=data[0].id;
    await sb.from('desk_invoice_items').insert({invoice_id:invId,description:j.job_type,qty:1,unit_price:0});
    showToast((docType==='quote'?'Quote':'Invoice')+' created');
    await openInvoiceInJob(invId,jobId);
  }catch(e){showToast('Could not create')}
}

// ── Print / Email (uses whichever invoiceItems are currently loaded,
// which is always the invoice being viewed since these buttons only
// appear in the detail panel) ────────────────────────────────
// EMAIL-SAFE OUTPUT. This document is what the customer receives, so every
// style is inlined as a resolved hex literal from the design tokens — email
// clients strip <style> blocks and custom properties. Do not reintroduce
// var(--token) or a :root block here. Token values are mirrored from
// design-brief.md; if the accent is rebranded, update ACCENT below.
function buildInvoiceHtml(inv,items,template){
  const {rawTotal,discountAmount,totalIncl,gst,exclSubtotal}=calcInvoiceTotals(items,inv.discount_type,inv.discount_value);
  // Compute per-header subtotals for section headers in the print template.
  let curHdr=null; const hdrTotals={};
  items.forEach(it=>{
    if(it.is_header){curHdr=it.id;hdrTotals[it.id]=0}
    else if(curHdr)hdrTotals[curHdr]=(hdrTotals[curHdr]||0)+(Number(it.qty)||0)*(Number(it.unit_price)||0);
  });
  const docLabel=inv.doc_type==='quote'?'Quote':'Invoice';
  const docRef=`${docPrefix(inv.doc_type)}-${inv.invoice_no}`;
  const vehDesc=inv.vehicle?[inv.vehicle.make,inv.vehicle.model].filter(Boolean).join(' ')+(inv.vehicle.rego?' ('+inv.vehicle.rego+')':''):'';
  // Resolved design tokens (no CSS variables — see note above).
  const INK='#0A0A0A',MUTED='#6B6B70',BORDER='#E4E4E7',BORDER_STRONG='#D1D1D6',ACCENT='#1D4ED8',ON_ACCENT='#FFFFFF';
  const FD="'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const FB="'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const NUM='font-variant-numeric:tabular-nums;white-space:nowrap';
  const label=`font-family:${FB};font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:${MUTED}`;

  // Workshop branding — set via Settings → Workshop Details. Falls back to
  // "DHF Tyres" with no contact line if nothing's been entered yet, so
  // printing/emailing still works before Settings is ever visited.
  const bizName=workshopDetails.name||'DHF Tyres';
  const contactParts=[workshopDetails.address,workshopDetails.abn?'ABN '+workshopDetails.abn:'',workshopDetails.phone,workshopDetails.email,workshopDetails.website].filter(Boolean);
  const footerHtml=(contactParts.length||workshopDetails.invoice_footer)?`<div style="margin-top:32px;border-top:1px solid ${BORDER};padding-top:14px">
      ${contactParts.length?`<div style="font-size:12px;line-height:1.6;color:${MUTED}">${contactParts.map(esc).join(' &middot; ')}</div>`:''}
      ${workshopDetails.invoice_footer?`<div style="font-size:12px;line-height:1.6;color:${MUTED};margin-top:${contactParts.length?'8':'0'}px;white-space:pre-line">${esc(workshopDetails.invoice_footer)}</div>`:''}
    </div>`:'';

  if(template==='aurora'){
    const GRAD='linear-gradient(135deg,rgba(10,16,48,.22) 0%,rgba(10,16,48,.06) 100%),linear-gradient(135deg,#1F90F7 0%,#2C5FF5 45%,#6D5FFF 100%)';
    const FJ="'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
    const rowsA=items.map(it=>it.is_header?`<tr><td colspan="4" style="padding:16px 0 8px 0;border-bottom:1px solid rgba(26,34,51,.09)"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6B7280">${esc(it.description)}</span><span style="font-size:14px;font-weight:700;color:#1A2233;${NUM}">$${hdrTotals[it.id].toFixed(2)}</span></div></td></tr>`:`<tr>
      <td style="padding:13px 8px 13px 0;border-bottom:1px solid rgba(26,34,51,.06);font-size:14px;color:#1A2233;vertical-align:top">${esc(it.description)}</td>
      <td style="padding:13px 8px;border-bottom:1px solid rgba(26,34,51,.06);font-size:14px;color:#1A2233;text-align:right;vertical-align:top;${NUM}">${it.qty}</td>
      <td style="padding:13px 8px;border-bottom:1px solid rgba(26,34,51,.06);font-size:14px;color:#1A2233;text-align:right;vertical-align:top;${NUM}">$${Number(it.unit_price).toFixed(2)}</td>
      <td style="padding:13px 0 13px 8px;border-bottom:1px solid rgba(26,34,51,.06);font-size:14px;color:#1A2233;text-align:right;vertical-align:top;font-weight:700;${NUM}">$${(it.qty*it.unit_price).toFixed(2)}</td>
    </tr>`).join('');
    const totRowA=(l,v)=>`<tr><td style="padding:4px 0;font-size:13px;color:#6B7280">${l}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#1A2233;${NUM}">${v}</td></tr>`;
    const labelA='font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B7280';
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${docLabel} ${docRef}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"></head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:${FJ};font-size:14px;line-height:1.55;color:#1A2233;-webkit-font-smoothing:antialiased">
  <div style="max-width:700px;margin:0 auto;box-shadow:0 24px 64px rgba(26,34,51,.16)">
    <div style="background-image:${GRAD};padding:36px 40px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
        <div>
          ${workshopDetails.logo_url?`<img src="${esc(workshopDetails.logo_url)}" alt="${esc(bizName)}" style="max-height:44px;max-width:220px;object-fit:contain;display:block;margin-bottom:10px">`:`<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.85)">${esc(bizName)}</div>`}
          <div style="font-family:${FJ};font-size:30px;font-weight:800;letter-spacing:-.02em;color:#FFFFFF;margin-top:6px">${docLabel}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.75)">Reference</div>
          <div style="font-size:17px;font-weight:700;color:#FFFFFF;margin-top:3px;${NUM}">${docRef}</div>
        </div>
      </div>
    </div>
    <div style="padding:32px 40px 40px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:170px;background:#F4F5F7;border-radius:12px;padding:14px 16px">
          <div style="${labelA}">Billed to</div>
          <div style="font-size:15px;font-weight:700;color:#1A2233;margin-top:5px">${esc(inv.customer?.name||'')}</div>
          ${vehDesc?`<div style="font-size:13px;color:#6B7280;margin-top:2px">${esc(vehDesc)}</div>`:''}
        </div>
        <div style="flex:1;min-width:170px;background:#F4F5F7;border-radius:12px;padding:14px 16px">
          <div style="${labelA}">Issued / Due</div>
          <div style="font-size:15px;font-weight:700;color:#1A2233;margin-top:5px;${NUM}">${new Date(inv.issue_date).toLocaleDateString('en-AU')}</div>
          ${inv.due_date?`<div style="font-size:13px;color:#6B7280;margin-top:2px;${NUM}">Due ${new Date(inv.due_date).toLocaleDateString('en-AU')}</div>`:''}
        </div>
        ${inv.order_no?`<div style="flex:1;min-width:170px;background:#F4F5F7;border-radius:12px;padding:14px 16px">
          <div style="${labelA}">Order No</div>
          <div style="font-size:15px;font-weight:700;color:#1A2233;margin-top:5px">${esc(inv.order_no)}</div>
        </div>`:''}
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:28px">
        <thead><tr>
          <th style="${labelA};text-align:left;padding:0 8px 10px 0;border-bottom:1px solid rgba(26,34,51,.09)">Description</th>
          <th style="${labelA};text-align:right;padding:0 8px 10px;border-bottom:1px solid rgba(26,34,51,.09)">Qty</th>
          <th style="${labelA};text-align:right;padding:0 8px 10px;border-bottom:1px solid rgba(26,34,51,.09)">Unit price</th>
          <th style="${labelA};text-align:right;padding:0 0 10px 8px;border-bottom:1px solid rgba(26,34,51,.09)">Total</th>
        </tr></thead>
        <tbody>${rowsA}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:20px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="min-width:220px;border-collapse:collapse">
          ${discountAmount?totRowA('Subtotal before discount','$'+rawTotal.toFixed(2))+totRowA('Discount','-$'+discountAmount.toFixed(2)):''}
          ${totRowA('Subtotal (excl. GST)','$'+exclSubtotal.toFixed(2))}
          ${totRowA('GST (10%)','$'+gst.toFixed(2))}
        </table>
      </div>
      <div style="margin-top:16px;background-image:${GRAD};border-radius:16px;padding:18px 22px;box-shadow:0 12px 32px rgba(44,95,245,.18);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:rgba(255,255,255,.85)">Total due</span>
        <span style="font-size:26px;font-weight:800;letter-spacing:-.01em;color:#FFFFFF;${NUM}">$${totalIncl.toFixed(2)}</span>
      </div>
      ${inv.notes?`<div style="margin-top:32px">
        <div style="${labelA}">Notes</div>
        <div style="font-size:14px;line-height:1.55;color:#1A2233;margin-top:8px">${esc(inv.notes)}</div>
      </div>`:''}
      ${(contactParts.length||workshopDetails.invoice_footer)?`<div style="margin-top:32px;border-top:1px solid rgba(26,34,51,.09);padding-top:14px">
        ${contactParts.length?`<div style="font-size:12px;line-height:1.6;color:#6B7280">${contactParts.map(esc).join(' &middot; ')}</div>`:''}
        ${workshopDetails.invoice_footer?`<div style="font-size:12px;line-height:1.6;color:#6B7280;margin-top:${contactParts.length?'8':'0'}px;white-space:pre-line">${esc(workshopDetails.invoice_footer)}</div>`:''}
      </div>`:''}
    </div>
  </div>
</body></html>`;
  }

  if(template==='compact'){
    const rowsC=items.map(it=>it.is_header?`<tr><td colspan="4" style="padding:14px 0 6px 0;border-bottom:1px solid ${BORDER_STRONG}"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${esc(it.description)}</span><span style="font-size:14px;font-weight:700;color:${INK};${NUM}">$${hdrTotals[it.id].toFixed(2)}</span></div></td></tr>`:`<tr>
      <td style="padding:8px 8px 8px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:1.5;color:${INK};vertical-align:top">${esc(it.description)}</td>
      <td style="padding:8px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};text-align:right;${NUM}">${it.qty}</td>
      <td style="padding:8px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};text-align:right;${NUM}">$${Number(it.unit_price).toFixed(2)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${BORDER};font-size:13px;color:${INK};text-align:right;font-weight:600;${NUM}">$${(it.qty*it.unit_price).toFixed(2)}</td>
    </tr>`).join('');
    const totRow=(l,v,strong)=>`<tr>
      <td style="padding:${strong?'12px 0 0':'4px 0'};font-family:${FB};font-size:${strong?'17px':'13px'};line-height:1.5;font-weight:${strong?'700':'400'};color:${strong?INK:MUTED};${strong?`border-top:2px solid ${INK}`:''}">${l}</td>
      <td style="padding:${strong?'12px 0 0':'4px 0'};font-family:${FB};font-size:${strong?'17px':'13px'};line-height:1.5;font-weight:${strong?'700':'400'};color:${INK};text-align:right;${NUM};${strong?`border-top:2px solid ${INK}`:''}">${v}</td>
    </tr>`;
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${docLabel} ${docRef}</title></head>
<body style="margin:0;padding:24px;background:#FFFFFF;font-family:${FB};font-size:13px;line-height:1.5;color:${INK};-webkit-font-smoothing:antialiased">
  <div style="max-width:600px;margin:0 auto">
    <div style="${label};margin-bottom:4px">${esc(bizName)}</div>
    <div style="font-family:${FD};font-size:24px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;color:${INK}">${docLabel} ${docRef}</div>
    <div style="font-size:13px;line-height:1.5;color:${MUTED};margin-top:8px">${esc(inv.customer?.name||'')}${vehDesc?' &middot; '+esc(vehDesc):''} &middot; ${new Date(inv.issue_date).toLocaleDateString('en-AU')}</div>
    ${inv.order_no?`<div style="font-size:13px;line-height:1.5;color:${INK};margin-top:4px;font-weight:600">Order No: ${esc(inv.order_no)}</div>`:''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:24px 0 0">
      <thead><tr>
        <th style="${label};text-align:left;padding:0 8px 8px 0;border-bottom:1px solid ${BORDER_STRONG}">Item</th>
        <th style="${label};text-align:right;padding:0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Qty</th>
        <th style="${label};text-align:right;padding:0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Price</th>
        <th style="${label};text-align:right;padding:0 0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Total</th>
      </tr></thead>
      <tbody>${rowsC}</tbody>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0 0 auto;min-width:260px">
      ${discountAmount?totRow('Subtotal before discount','$'+rawTotal.toFixed(2))+totRow('Discount','-$'+discountAmount.toFixed(2)):''}
      ${totRow('Subtotal (excl. GST)','$'+exclSubtotal.toFixed(2))}
      ${totRow('GST (10%)','$'+gst.toFixed(2))}
      ${totRow('Total (incl. GST)','$'+totalIncl.toFixed(2),true)}
    </table>
    ${footerHtml}
  </div>
</body></html>`;
  }

  const rows=items.map(it=>it.is_header?`<tr><td colspan="4" style="padding:16px 0 8px 0;border-bottom:1px solid ${BORDER_STRONG}"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${esc(it.description)}</span><span style="font-size:14px;font-weight:700;color:${INK};${NUM}">$${hdrTotals[it.id].toFixed(2)}</span></div></td></tr>`:`<tr>
    <td style="padding:12px 8px 12px 0;border-bottom:1px solid ${BORDER};font-size:15px;line-height:1.55;color:${INK};vertical-align:top">${esc(it.description)}</td>
    <td style="padding:12px 8px;border-bottom:1px solid ${BORDER};font-size:15px;color:${INK};text-align:right;vertical-align:top;${NUM}">${it.qty}</td>
    <td style="padding:12px 8px;border-bottom:1px solid ${BORDER};font-size:15px;color:${INK};text-align:right;vertical-align:top;${NUM}">$${Number(it.unit_price).toFixed(2)}</td>
    <td style="padding:12px 0 12px 8px;border-bottom:1px solid ${BORDER};font-size:15px;color:${INK};text-align:right;vertical-align:top;font-weight:600;${NUM}">$${(it.qty*it.unit_price).toFixed(2)}</td>
  </tr>`).join('');
  const totalRow=(l,v,strong)=>`<tr>
    <td style="padding:${strong?'16px 0 0':'6px 0'};font-family:${FB};font-size:${strong?'17px':'15px'};line-height:1.5;font-weight:${strong?'700':'400'};color:${strong?INK:MUTED};${strong?`border-top:2px solid ${INK}`:''}">${l}</td>
    <td style="padding:${strong?'16px 0 0 32px':'6px 0 6px 32px'};font-family:${FB};font-size:${strong?'17px':'15px'};line-height:1.5;font-weight:${strong?'700':'400'};color:${INK};text-align:right;${NUM};${strong?`border-top:2px solid ${INK}`:''}">${v}</td>
  </tr>`;
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${docLabel} ${docRef}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:${FB};font-size:15px;line-height:1.55;color:${INK};-webkit-font-smoothing:antialiased">
  <div style="background:${ACCENT};color:${ON_ACCENT};padding:32px">
    <div style="max-width:700px;margin:0 auto">
      <div style="font-family:${FB};font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:${ON_ACCENT}">${esc(bizName)}</div>
      <div style="font-family:${FD};font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.015em;color:${ON_ACCENT};margin-top:8px">${docLabel} ${docRef}</div>
    </div>
  </div>
  <div style="max-width:700px;margin:0 auto;padding:32px">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
      <tr>
        <td style="vertical-align:top;padding:0 24px 0 0">
          <div style="${label}">Billed to</div>
          <div style="font-size:17px;line-height:1.5;font-weight:600;color:${INK};margin-top:4px">${esc(inv.customer?.name||'')}</div>
          ${vehDesc?`<div style="font-size:15px;line-height:1.55;color:${MUTED};margin-top:4px">${esc(vehDesc)}</div>`:''}
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap">
          <div style="${label}">Issued</div>
          <div style="font-size:15px;line-height:1.55;color:${INK};margin-top:4px;${NUM}">${new Date(inv.issue_date).toLocaleDateString('en-AU')}</div>
          ${inv.due_date?`<div style="${label};margin-top:12px">Due</div>
          <div style="font-size:15px;line-height:1.55;color:${INK};margin-top:4px;${NUM}">${new Date(inv.due_date).toLocaleDateString('en-AU')}</div>`:''}
          ${inv.order_no?`<div style="${label};margin-top:12px">Order No</div>
          <div style="font-size:15px;line-height:1.55;color:${INK};margin-top:4px;font-weight:600">${esc(inv.order_no)}</div>`:''}
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:32px 0 0">
      <thead><tr>
        <th style="${label};text-align:left;padding:0 8px 8px 0;border-bottom:1px solid ${BORDER_STRONG}">Description</th>
        <th style="${label};text-align:right;padding:0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Qty</th>
        <th style="${label};text-align:right;padding:0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Unit price</th>
        <th style="${label};text-align:right;padding:0 0 8px 8px;border-bottom:1px solid ${BORDER_STRONG}">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0 0 auto;min-width:280px">
      ${discountAmount?totalRow('Subtotal before discount','$'+rawTotal.toFixed(2))+totalRow('Discount','-$'+discountAmount.toFixed(2)):''}
      ${totalRow('Subtotal (excl. GST)','$'+exclSubtotal.toFixed(2))}
      ${totalRow('GST (10%)','$'+gst.toFixed(2))}
      ${totalRow('Total (incl. GST)','$'+totalIncl.toFixed(2),true)}
    </table>
    ${inv.notes?`<div style="margin-top:48px;border-top:1px solid ${BORDER};padding-top:16px">
      <div style="${label}">Notes</div>
      <div style="font-size:15px;line-height:1.55;color:${INK};margin-top:8px">${esc(inv.notes)}</div>
    </div>`:''}
    ${footerHtml}
  </div>
</body></html>`;
}

function printInvoice(id){
  const inv=invoices.find(x=>x.id===id);
  if(!inv)return;
  const html=buildInvoiceHtml(inv,invoiceItems,invoiceTemplate);
  const w=window.open('','_blank');
  if(!w){showToast('Pop-up blocked — allow pop-ups to print');return}
  const docLabel=inv.doc_type==='quote'?'Quote':'Invoice';
  const docRef=`${docPrefix(inv.doc_type)}-${inv.invoice_no}`;
  w.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>${docLabel} ${docRef}</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif}
  .print-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;background:#1A2233;color:#fff}
  .print-toolbar-title{font-size:14px;font-weight:700}
  .print-toolbar-btn{font-family:inherit;font-size:14px;font-weight:600;padding:8px 20px;border:none;border-radius:999px;cursor:pointer;background:#fff;color:#1A2233}
  .print-toolbar-btn:hover{opacity:.9}
  @media print{.print-toolbar{display:none}}
</style></head><body>
<div class="print-toolbar">
  <span class="print-toolbar-title">${docLabel} ${docRef} — preview</span>
  <button class="print-toolbar-btn" onclick="window.print()">Print</button>
</div>
${html}
</body></html>`);
  w.document.close();
  w.focus();
}

function emailInvoice(id){
  const inv=invoices.find(x=>x.id===id);
  if(!inv)return;
  const isQuote=inv.doc_type==='quote';
  const {totalIncl}=calcInvoiceTotals(invoiceItems,inv.discount_type,inv.discount_value);
  const docLabel=isQuote?'Quote':'Invoice';
  const docRef=`${docPrefix(inv.doc_type)}-${inv.invoice_no}`;
  const subject=`${docLabel} ${docRef} — DHF Tyres`;
  let body=`Hi ${inv.customer?.name||'there'},\n\nPlease find your ${docLabel.toLowerCase()} ${docRef}${!isQuote&&inv.due_date?' which is due on '+fmtDate(inv.due_date):''} below.\n\n`;
  invoiceItems.forEach(it=>{body+=`- ${it.description} x${it.qty} @ $${Number(it.unit_price).toFixed(2)} = $${(it.qty*it.unit_price).toFixed(2)}\n`});
  body+=`\nTotal: $${totalIncl.toFixed(2)} (incl. GST)\n\nIf you have any questions, just let us know.`;
  openComposeModal('email',{customerId:inv.customer_id,invoiceId:inv.id,email:inv.customer?.email,mobile:inv.customer?.mobile,subject,body});
}

function smsInvoice(id){
  const inv=invoices.find(x=>x.id===id);
  if(!inv)return;
  const isQuote=inv.doc_type==='quote';
  const docLabel=isQuote?'Quote':'Invoice';
  const docRef=`${docPrefix(inv.doc_type)}-${inv.invoice_no}`;
  const {totalIncl}=calcInvoiceTotals(invoiceItems,inv.discount_type,inv.discount_value);
  const smsBody=`Hi ${inv.customer?.name||'there'}, this is DHF Tyres. Your ${docLabel.toLowerCase()} ${docRef} for $${totalIncl.toFixed(2)} is ready. Let us know if you have any questions.`;
  openComposeModal('sms',{customerId:inv.customer_id,invoiceId:inv.id,email:inv.customer?.email,mobile:inv.customer?.mobile,smsBody});
}

// ── SERVICE SCHEDULE ────────────────────────────────────────
let serviceTypes=[];
let serviceScheduleRows=[];
let serviceScheduleFilter='overdue'; // 'overdue' | 'upcoming' | 'all'

function addMonths(date,months){
  const d=new Date(date);
  d.setMonth(d.getMonth()+months);
  return d;
}
function toDateInputValue(d){return d.toISOString().slice(0,10)}
function fmtDate(dstr){
  return dstr?new Date(dstr+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):null;
}
function daysUntil(dstr){
  if(!dstr)return null;
  const ms=new Date(dstr+'T00:00:00')-new Date(new Date().toDateString());
  return Math.round(ms/86400000);
}

async function loadServiceTypes(){
  try{
    const {data,error}=await sb.from('desk_service_types').select('*').order('name');
    if(error)throw error;
    serviceTypes=data||[];
  }catch(e){serviceTypes=[];showToast('Could not load service types')}
}

function serviceIntervalLabel(st){
  const parts=[];
  if(st.interval_months)parts.push(st.interval_months+' months');
  if(st.interval_km)parts.push(st.interval_km.toLocaleString()+' km');
  return parts.length?parts.join(' / '):'No interval set';
}

// ── Finish-job reminder prompt ──────────────────────────────
async function updateJobField(id,field,value){
  try{
    const {error}=await sb.from('desk_jobs').update({[field]:value,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    await loadJobs();
  }catch(e){showToast('Could not update job')}
}

async function setJobStatus(id,status){
  if(status==='finished'){
    const j=jobs.find(x=>x.id===id);
    if(j&&j.vehicle_id){
      if(!serviceTypes.length)await loadServiceTypes();
      if(!jobTypes.length)await loadJobTypes();
      openServiceReminderModal(id);
      return;
    }
  }
  await applyJobStatus(id,status);
}

async function applyJobStatus(id,status,jobExtra,vehiclePayload){
  const payload={status,updated_at:new Date().toISOString(),...(jobExtra||{})};
  if(status==='finished') payload.finished_at=new Date().toISOString();
  try{
    const {error}=await sb.from('desk_jobs').update(payload).eq('id',id);
    if(error)throw error;
    if(vehiclePayload){
      const j=jobs.find(x=>x.id===id);
      if(j&&j.vehicle_id){
        const {error:vErr}=await sb.from('desk_vehicles').update(vehiclePayload).eq('id',j.vehicle_id);
        if(vErr)throw vErr;
      }
    }
    showToast('Status updated');
    await loadJobs();
    await renderJobDetail(id);
  }catch(e){showToast('Could not update status')}
}

function openServiceReminderModal(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const vehLabel=j.vehicle?[j.vehicle.make,j.vehicle.model].filter(Boolean).join(' ')+(j.vehicle.rego?' ('+j.vehicle.rego+')':''):'this vehicle';
  const activeTypes=serviceTypes.filter(t=>t.is_active);
  const jt=jobTypes.find(t=>t.name===j.job_type);
  const jtHasInterval=jt&&(jt.interval_months||jt.interval_km);
  const defaultDate=toDateInputValue(addMonths(new Date(),jtHasInterval&&jt.interval_months?jt.interval_months:6));
  const defaultOdo=jtHasInterval&&jt.interval_km&&j.odometer_in?j.odometer_in+jt.interval_km:'';
  const html=`<div class="modal-overlay" onclick="if(event.target===this)skipServiceReminder('${jobId}')">
    <div class="modal-card">
      <div class="modal-title">Set next service reminder?</div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-4)">Job finished for <strong>${esc(vehLabel)}</strong>. Set a reminder so we know when to contact ${esc(j.customer?.name||'the customer')} about their next service.${jtHasInterval?` Suggested from the <strong>${esc(j.job_type)}</strong> job type's interval (${serviceIntervalLabel(jt)}).`:''}</div>
      <label class="form-label">Service type <span style="font-weight:400;color:var(--text-secondary)">(optional — for reporting)</span></label>
      <select class="form-input" id="svc-type" onchange="onServiceTypeChange()">
        <option value="">— No service type / custom date only —</option>
        ${activeTypes.map(t=>`<option value="${t.id}">${esc(t.name)} (${serviceIntervalLabel(t)})</option>`).join('')}
      </select>
      ${!activeTypes.length?`<div style="font-size:12px;color:var(--text-secondary);margin:calc(var(--space-2) * -1) 0 var(--space-3)">No service types yet — add some in Settings to auto-fill intervals here.</div>`:''}
      <label class="form-label">Next service due date</label>
      <input class="form-input" type="date" id="svc-due-date" value="${defaultDate}">
      <label class="form-label">Next service due odometer (km)</label>
      <input class="form-input" type="number" id="svc-due-odo" value="${defaultOdo}" placeholder="${j.odometer_in?'Auto-filled from odometer + interval if left blank':'Odometer not recorded on this job'}">
      <div class="form-actions">
        <button class="btn-secondary" onclick="skipServiceReminder('${jobId}')">Skip</button>
        <button class="btn-primary" onclick="saveServiceReminder('${jobId}')">Save &amp; Finish Job</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function onServiceTypeChange(){
  const sel=document.getElementById('svc-type');
  const st=serviceTypes.find(t=>t.id===sel.value);
  if(!st||!st.interval_months)return;
  document.getElementById('svc-due-date').value=toDateInputValue(addMonths(new Date(),st.interval_months));
}

async function saveServiceReminder(jobId){
  const j=jobs.find(x=>x.id===jobId);
  const typeId=document.getElementById('svc-type').value||null;
  const dueDate=document.getElementById('svc-due-date').value||null;
  const dueOdoRaw=document.getElementById('svc-due-odo').value;
  let dueOdo=dueOdoRaw?parseInt(dueOdoRaw,10):null;
  if(!dueOdo&&typeId){
    const st=serviceTypes.find(t=>t.id===typeId);
    if(st&&st.interval_km&&j.odometer_in)dueOdo=j.odometer_in+st.interval_km;
  }
  closeModal();
  await applyJobStatus(jobId,'finished',
    {service_type_id:typeId},
    {
      next_service_due_date:dueDate,
      next_service_due_odometer:dueOdo,
      last_service_type_id:typeId,
      last_service_job_id:jobId,
      last_serviced_at:new Date().toISOString().slice(0,10),
      reminder_sent_at:null,
      updated_at:new Date().toISOString()
    }
  );
}

async function skipServiceReminder(jobId){
  closeModal();
  await applyJobStatus(jobId,'finished');
}

// ── Service Schedule view ───────────────────────────────────
async function loadServiceScheduleRows(){
  try{
    const {data,error}=await sb.from('desk_vehicles')
      .select('*,customer:desk_customers(id,name,mobile,phone,email)')
      .not('next_service_due_date','is',null)
      .order('next_service_due_date',{ascending:true});
    if(error)throw error;
    serviceScheduleRows=data||[];
  }catch(e){serviceScheduleRows=[];showToast('Could not load service schedule')}
}

function switchServiceScheduleFilter(v){
  serviceScheduleFilter=v;
  renderServiceScheduleList();
}

function filteredServiceScheduleRows(){
  return serviceScheduleRows.filter(v=>{
    const days=daysUntil(v.next_service_due_date);
    if(serviceScheduleFilter==='overdue')return days!==null&&days<0;
    if(serviceScheduleFilter==='upcoming')return days!==null&&days>=0;
    return true;
  });
}

async function renderServiceScheduleView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadServiceScheduleRows();
  renderServiceScheduleList();
}

function serviceDueBadge(days){
  if(days<0)return `<span class="status-badge on_hold">Overdue</span>`;
  if(days<=30)return `<span class="status-badge in_progress">Due soon</span>`;
  return `<span class="status-badge finished">Upcoming</span>`;
}

function renderServiceScheduleList(){
  const main=document.getElementById('main');
  const list=filteredServiceScheduleRows();
  const overdueCount=serviceScheduleRows.filter(v=>daysUntil(v.next_service_due_date)<0).length;
  const upcomingCount=serviceScheduleRows.filter(v=>daysUntil(v.next_service_due_date)>=0).length;
  let h=`<div class="status-tabs">
    <button class="status-tab ${serviceScheduleFilter==='overdue'?'active':''}" onclick="switchServiceScheduleFilter('overdue')">Overdue (${overdueCount})</button>
    <button class="status-tab ${serviceScheduleFilter==='upcoming'?'active':''}" onclick="switchServiceScheduleFilter('upcoming')">Upcoming (${upcomingCount})</button>
    <button class="status-tab ${serviceScheduleFilter==='all'?'active':''}" onclick="switchServiceScheduleFilter('all')">All (${serviceScheduleRows.length})</button>
  </div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${serviceScheduleRows.length?'No vehicles in this filter.':'No service reminders yet — they get set when you finish a job and add a next-service reminder.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(v=>{
      const days=daysUntil(v.next_service_due_date);
      const vehLabel=[v.make,v.model].filter(Boolean).join(' ')+(v.rego?' ('+v.rego+')':'');
      h+=`<div class="list-row" style="cursor:default">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);flex-wrap:wrap">
          <div>
            <div class="list-row-name">${esc(vehLabel||'Vehicle')} ${serviceDueBadge(days)}</div>
            <div class="list-row-sub">${esc(v.customer?.name||'Unknown owner')} · ${esc(v.customer?.mobile||v.customer?.phone||'No contact number')}</div>
            <div class="list-row-sub">Due ${fmtDate(v.next_service_due_date)}${v.next_service_due_odometer?' · '+v.next_service_due_odometer.toLocaleString()+' km':''}${v.reminder_sent_at?' · Reminded '+fmtDate(v.reminder_sent_at.slice(0,10)):''}</div>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
            ${v.customer?.email?`<button class="btn-secondary" onclick="emailServiceReminder('${v.id}')">Email</button>`:''}
            ${(v.customer?.mobile||v.customer?.phone)?`<a class="btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center" href="tel:${esc(v.customer.mobile||v.customer.phone)}">📞 Call</a>`:''}
            <button class="btn-secondary" onclick="markReminderSent('${v.id}')">✓ Mark reminded</button>
            <button class="btn-secondary" onclick="clearServiceReminder('${v.id}')">✕ Clear</button>
          </div>
        </div>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function emailServiceReminder(vehicleId){
  const v=serviceScheduleRows.find(x=>x.id===vehicleId);
  if(!v)return;
  const vehLabel=[v.make,v.model].filter(Boolean).join(' ')+(v.rego?' ('+v.rego+')':'');
  const subject=`Your ${vehLabel||'vehicle'} is due for a service — DHF Tyres`;
  const body=`Hi ${v.customer?.name||''},\n\nOur records show your ${vehLabel||'vehicle'} is due for a service around ${fmtDate(v.next_service_due_date)}${v.next_service_due_odometer?' (or ~'+v.next_service_due_odometer.toLocaleString()+' km)':''}.\n\nGive us a call or reply to this email to book it in.\n\nThanks,\nDHF Tyres`;
  window.location.href=`mailto:${encodeURIComponent(v.customer?.email||'')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function markReminderSent(vehicleId){
  try{
    const {error}=await sb.from('desk_vehicles').update({reminder_sent_at:new Date().toISOString()}).eq('id',vehicleId);
    if(error)throw error;
    showToast('Marked as reminded');
    await loadServiceScheduleRows();
    renderServiceScheduleList();
  }catch(e){showToast('Could not update')}
}

async function clearServiceReminder(vehicleId){
  try{
    const {error}=await sb.from('desk_vehicles').update({next_service_due_date:null,next_service_due_odometer:null,reminder_sent_at:null}).eq('id',vehicleId);
    if(error)throw error;
    showToast('Reminder cleared');
    await loadServiceScheduleRows();
    renderServiceScheduleList();
  }catch(e){showToast('Could not update')}
}

// ── Supplier Stock view ─────────────────────────────────────
// Reads desk_supplier_stock, populated by an external scraper (Playwright,
// runs via cron on Dinuka's own machine — not part of this app) that logs
// into wholesaler portals (Tempe Tyres, Newbee Tyre — both COSTAR-platform)
// and pulls size/brand/price/stock per configured tyre size. This view is
// read-only — the app never writes to this table, only the scraper does
// (via its own service-role key, bypassing RLS).
let supplierStockRows=[];
let supplierStockSearchTerm='';
let supplierStockSupplierFilter='all';
const SUPPLIER_STOCK_LABELS={tempe:'Tempe Tyres',newbee:'Newbee Tyre'};

async function loadSupplierStockRows(){
  // PostgREST caps a single request at 1000 rows regardless of .limit() —
  // this table already exceeds that (40 tracked sizes × ~75 results ×
  // suppliers), so page through with .range() until a page comes back short.
  try{
    let all=[],from=0;
    const pageSize=1000;
    while(true){
      const {data,error}=await sb.from('desk_supplier_stock').select('*')
        .order('stripped_size').order('available_qty',{ascending:false,nullsFirst:false}).order('cost_price')
        .range(from,from+pageSize-1);
      if(error)throw error;
      all=all.concat(data||[]);
      if(!data||data.length<pageSize)break;
      from+=pageSize;
    }
    supplierStockRows=all;
  }catch(e){supplierStockRows=[];showToast('Could not load supplier stock')}
}

function supplierStockBranchLabel(branchStock){
  if(!Array.isArray(branchStock)||!branchStock.length)return'—';
  // Branch names come back as e.g. "Newbee Tyre Sydney" / "Tempe Tyres Sydney"
  // — strip the supplier name prefix so the column reads as a plain
  // city/state list ("Sydney: 12+, Melbourne: 12+"), not repeated branding.
  return branchStock.map(b=>{
    const city=(b.branch||'').replace(/^(Newbee Tyre|Tempe Tyres)\s*/i,'').trim()||b.branch||'—';
    const qty=b.qty!=null?(b.is_greater_than_display?b.qty+'+':b.qty):'—';
    return `${esc(city)}: ${qty}`;
  }).join(', ');
}

function supplierStockAgeLabel(iso){
  if(!iso)return'—';
  const hours=(Date.now()-new Date(iso).getTime())/3600000;
  if(hours<1)return'Just now';
  if(hours<24)return Math.round(hours)+'h ago';
  return Math.round(hours/24)+'d ago';
}

function filteredSupplierStockRows(){
  const term=supplierStockSearchTerm.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  return supplierStockRows.filter(r=>{
    if(supplierStockSupplierFilter!=='all'&&r.supplier!==supplierStockSupplierFilter)return false;
    if(!term)return true;
    const hay=[r.stripped_size,r.size,r.brand,r.model,r.sku,r.description].join(' ').toLowerCase().replace(/[^a-z0-9 ]/g,'');
    return hay.includes(term);
  });
}

async function renderSupplierStockView(){
  const main=document.getElementById('main');
  main.classList.add('full-width');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadSupplierStockRows();
  renderSupplierStockList();
}

function switchSupplierStockFilter(v){
  supplierStockSupplierFilter=v;
  renderSupplierStockList();
}

let supplierStockSearchDebounce=null;
function onSupplierStockSearch(v){
  supplierStockSearchTerm=v;
  clearTimeout(supplierStockSearchDebounce);
  supplierStockSearchDebounce=setTimeout(()=>{
    renderSupplierStockList();
    const i=document.getElementById('supplier-stock-search');
    if(i){i.focus();i.setSelectionRange(v.length,v.length)}
  },200);
}

function renderSupplierStockList(){
  const main=document.getElementById('main');
  const list=filteredSupplierStockRows();
  const suppliersPresent=[...new Set(supplierStockRows.map(r=>r.supplier))];
  const mostRecent=supplierStockRows.reduce((max,r)=>r.scraped_at>max?r.scraped_at:max,'');
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3);margin-bottom:var(--space-3)">
    <div class="status-tabs" style="margin-bottom:0">
      <button class="status-tab ${supplierStockSupplierFilter==='all'?'active':''}" onclick="switchSupplierStockFilter('all')">All (${supplierStockRows.length})</button>
      ${suppliersPresent.map(s=>`<button class="status-tab ${supplierStockSupplierFilter===s?'active':''}" onclick="switchSupplierStockFilter('${s}')">${esc(SUPPLIER_STOCK_LABELS[s]||s)} (${supplierStockRows.filter(r=>r.supplier===s).length})</button>`).join('')}
    </div>
    <input class="form-input" id="supplier-stock-search" style="max-width:280px" placeholder="Search size, brand, model, SKU…" value="${esc(supplierStockSearchTerm)}" oninput="onSupplierStockSearch(this.value)">
  </div>
  ${mostRecent?`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-2)">Last updated ${supplierStockAgeLabel(mostRecent)} · prices/stock refresh once daily</div>`:''}`;

  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${supplierStockRows.length?'No matches for this search/filter.':'No supplier stock data yet — the daily scraper hasn\'t run or hasn\'t synced any results yet.'}</div></div>`;
  }else{
    h+=`<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Size</th><th>Brand</th><th>Model</th><th>SKU</th><th>Supplier</th><th style="text-align:right">Cost</th><th style="text-align:right">Qty</th><th>Location</th><th>Flags</th><th>Updated</th></tr></thead><tbody>`;
    list.forEach(r=>{
      const flags=[r.is_discontinued?'<span class="status-badge on_hold">Discontinued</span>':'',r.is_on_sale?'<span class="status-badge finished">On sale</span>':''].filter(Boolean).join(' ');
      h+=`<tr><td>${esc(r.size||r.stripped_size||'—')}</td><td>${esc(r.brand||'—')}</td><td>${esc(r.model||'—')}</td><td>${esc(r.sku||'—')}</td><td>${esc(SUPPLIER_STOCK_LABELS[r.supplier]||r.supplier)}</td><td style="text-align:right">${r.cost_price!=null?'$'+Number(r.cost_price).toFixed(2):'—'}</td><td style="text-align:right">${r.available_qty!=null?r.available_qty:'—'}</td><td style="font-size:12px">${supplierStockBranchLabel(r.branch_stock)}</td><td>${flags||'—'}</td><td style="font-size:12px;color:var(--text-secondary)">${supplierStockAgeLabel(r.scraped_at)}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  main.innerHTML=h;
}

// ── TIMESHEETS ───────────────────────────────────────────────
// Simple manual hours-per-job entry (not live clock in/out) — feeds the
// Commission/Productivity/Efficiency reports and the Job Report's
// estimate-vs-actual columns.
async function loadTimesheets(){
  try{
    const {data,error}=await sb.from('desk_timesheets')
      .select('*,employee:desk_employees(name),job:desk_jobs(job_type,customer:desk_customers(name))')
      .order('work_date',{ascending:false});
    if(error)throw error;
    timesheets=data||[];
  }catch(e){timesheets=[];showToast('Could not load timesheets')}
}

async function renderTimesheetsView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  timesheetsRangePreset='week';
  const r=paymentsPresetRange('week');
  timesheetsFrom=r.from;timesheetsTo=r.to;
  timesheetsEmployeeFilter='all';
  await Promise.all([loadTimesheets(),loadEmployees(),loadJobs()]);
  renderTimesheetsList();
}

function filteredTimesheets(){
  return timesheets.filter(t=>{
    if(timesheetsFrom&&t.work_date<timesheetsFrom)return false;
    if(timesheetsTo&&t.work_date>timesheetsTo)return false;
    if(timesheetsEmployeeFilter!=='all'&&t.employee_id!==timesheetsEmployeeFilter)return false;
    return true;
  });
}

function setTimesheetsRange(preset){
  timesheetsRangePreset=preset;
  const r=paymentsPresetRange(preset);
  timesheetsFrom=r.from;timesheetsTo=r.to;
  renderTimesheetsList();
}
function setTimesheetsEmployeeFilter(v){timesheetsEmployeeFilter=v;renderTimesheetsList()}

function renderTimesheetsList(){
  const main=document.getElementById('main');
  const list=filteredTimesheets();
  const totalHrs=list.reduce((s,t)=>s+Number(t.hours),0);
  let h=`<div class="toolbar" style="flex-wrap:wrap;gap:var(--space-3)">
    <div class="status-tabs" style="margin:0">
      <button class="status-tab ${timesheetsRangePreset==='today'?'active':''}" onclick="setTimesheetsRange('today')">Today</button>
      <button class="status-tab ${timesheetsRangePreset==='week'?'active':''}" onclick="setTimesheetsRange('week')">This Week</button>
      <button class="status-tab ${timesheetsRangePreset==='month'?'active':''}" onclick="setTimesheetsRange('month')">This Month</button>
      <button class="status-tab ${timesheetsRangePreset==='all'?'active':''}" onclick="setTimesheetsRange('all')">All Time</button>
    </div>
    <select class="form-select" style="width:180px" onchange="setTimesheetsEmployeeFilter(this.value)">
      <option value="all">All employees</option>
      ${employees.map(e=>`<option value="${e.id}" ${timesheetsEmployeeFilter===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}
    </select>
    <button class="btn-primary" style="margin-left:auto" onclick="openTimesheetModal()">+ Log Time</button>
  </div>
  <div style="font-size:13px;color:var(--text-secondary);margin:var(--space-2) 0">${list.length} entr${list.length===1?'y':'ies'} · ${totalHrs.toFixed(2)}h total</div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">No timesheet entries in this range.</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(t=>{
      h+=`<div class="list-row" style="cursor:default">
        <div class="list-row-sub">${fmtDate(t.work_date)}</div>
        <div class="list-row-name" style="flex:1">${esc(t.employee?.name||'—')} — ${t.job?esc(t.job.job_type)+' ('+esc(t.job.customer?.name||'—')+')':'No job'}</div>
        <span class="status-badge ${t.status==='approved'?'finished':t.status==='submitted'?'in_progress':'draft'}">${t.status}</span>
        <div class="list-row-sub" style="font-weight:700">${Number(t.hours).toFixed(2)}h</div>
        <button class="btn-danger-link" onclick="deleteTimesheet('${t.id}')">✕</button>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

function openTimesheetModal(){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Log Time</div>
      <label class="form-label">Employee *</label>
      <select class="form-select" id="tf-employee">
        <option value="">— Select —</option>
        ${employees.filter(e=>e.is_active!==false).map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      </select>
      <label class="form-label">Job (optional)</label>
      <select class="form-select" id="tf-job">
        <option value="">— No job (admin/other) —</option>
        ${jobs.filter(j=>!j.is_deleted).map(j=>`<option value="${j.id}">${esc(j.job_type)} — ${esc(j.customer?.name||'—')}</option>`).join('')}
      </select>
      <label class="form-label">Date</label>
      <input class="form-input" type="date" id="tf-date" value="${toDateInputValue(new Date())}">
      <label class="form-label">Hours *</label>
      <input class="form-input" type="number" step="0.25" id="tf-hours" placeholder="e.g. 2.5">
      <label class="form-label">Notes</label>
      <input class="form-input" id="tf-notes">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveTimesheet()">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveTimesheet(){
  const employeeId=document.getElementById('tf-employee').value;
  const hours=parseFloat(document.getElementById('tf-hours').value);
  if(!employeeId){showToast('Pick an employee');return}
  if(!hours||hours<=0){showToast('Enter hours');return}
  const payload={
    employee_id:employeeId,
    job_id:document.getElementById('tf-job').value||null,
    work_date:document.getElementById('tf-date').value,
    hours,
    notes:document.getElementById('tf-notes').value.trim()||null
  };
  try{
    const {error}=await sb.from('desk_timesheets').insert(payload);
    if(error)throw error;
    closeModal();
    showToast('Time logged');
    await loadTimesheets();
    renderTimesheetsList();
  }catch(e){showToast('Could not save')}
}

async function deleteTimesheet(id){
  try{
    const {error}=await sb.from('desk_timesheets').delete().eq('id',id);
    if(error)throw error;
    await loadTimesheets();
    renderTimesheetsList();
  }catch(e){showToast('Could not delete')}
}

// ── REPORTS ──────────────────────────────────────────────────
// Modeled on MechanicDesk's Reports section (surveyed live). Only reports
// buildable from data DHF Desk actually tracks are included — no Bills/PO/
// AP (no expense subsystem), no Employee Commission/Productivity/Efficiency
// (no timesheets), no Lead Report (leads live in the separate CRM), no
// Review Report (no review system), no Buyin/Stock-Adjustment reports (no
// purchase-order or stock-adjustment audit trail).
const REPORT_CATEGORIES={
  payment:{label:'Payment',reports:{'daily-sales-cash':'Daily Sales & Cash'}},
  income:{label:'Income',reports:{
    'job-type':'Income By Job Type',
    'paid-unpaid':'Income Paid/Unpaid',
    'by-customer':'Income By Customer',
    'by-vehicle':'Income By Vehicle Make',
    'invoice-report':'Invoice Report',
    'sales-report':'Sales Report',
    'customer-statements':'Customer Statements (Aging)',
    'discount-report':'Discount Report'
  }},
  expense:{label:'Expense',reports:{
    'bills-report':'Bills Report',
    'purchases-report':'Purchases Report',
    'supplier-spending':'Supplier Spending'
  }},
  work:{label:'Work',reports:{
    'job-report':'Job Report',
    'wip-jobs':'Work In Progress Jobs',
    'wip-invoices':'Work In Progress Invoices',
    'quote-conversion':'Quote Conversion',
    'quote-report':'Quote Report',
    'workshop-efficiency':'Workshop Efficiency',
    'review-report':'Review Report'
  }},
  employee:{label:'Employee',reports:{
    'commission-report':'Commission Report',
    'productivity-report':'Productivity Report',
    'efficiency-report':'Efficiency Report'
  }},
  marketing:{label:'Marketing',reports:{'lead-report':'Lead Report (from CRM)'}},
  inventory:{label:'Inventory',reports:{
    'stock-value':'Stock Value',
    'buyin-report':'Buyin Report',
    'stock-adjustments':'Stock Manual Adjustments'
  }}
};
let reportsCategory='income';
let reportsActive='by-customer';
let reportsRangePreset='month';
let reportsFrom=null;
let reportsTo=null;
let reportInvoices=[];
let stockAdjustments=[];
let reviews=[];

async function loadStockAdjustments(){
  try{
    const {data,error}=await sb.from('desk_stock_adjustments').select('*,stock:desk_stock(name,sku)').order('adjusted_at',{ascending:false});
    if(error)throw error;
    stockAdjustments=data||[];
  }catch(e){stockAdjustments=[]}
}

async function loadReviews(){
  try{
    const {data,error}=await sb.from('desk_reviews').select('*,customer:desk_customers(name),job:desk_jobs(job_type)').order('created_at',{ascending:false});
    if(error)throw error;
    reviews=data||[];
  }catch(e){reviews=[]}
}

function cssVar(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()}
// Chart series: a dedicated fixed-order categorical palette (--chart-1..8 in
// index.html), NOT the semantic token spine.
// The previous version drew accent + the three status colors + four neutrals.
// That failed on two counts: it spent slots on --success/--warning/--danger,
// which must stay reserved for state, and its neutrals were three near-
// identical grays — worst adjacent pair OKLab ΔE 5.2, i.e. indistinguishable
// even with full color vision, let alone with a CVD. It also referenced --ink,
// undefined since v3, and --text-tertiary; cssVar() returns '' for those and
// assigning '' to ctx.fillStyle is a silent no-op, so slices 6 and 8 inherited
// the previous slice's color and their legend swatches rendered transparent.
// The replacement is validated, not eyeballed: worst adjacent CVD ΔE 9.1
// (target >=8), worst adjacent normal-vision ΔE 19.6 (floor 15).
// Order is FIXED — never cycle or reorder it, or a series changes color when
// the filtered set changes size.
function reportColorPalette(){return [cssVar('--chart-1'),cssVar('--chart-2'),cssVar('--chart-3'),cssVar('--chart-4'),cssVar('--chart-5'),cssVar('--chart-6'),cssVar('--chart-7'),cssVar('--chart-8')]}

async function loadReportInvoices(){
  try{
    const {data,error}=await sb.from('desk_invoices')
      .select('*,customer:desk_customers(id,name),vehicle:desk_vehicles(id,make,model),items:desk_invoice_items(id,description,qty,unit_price,stock_id,stock:desk_stock(buy_price,is_physical))')
      .order('issue_date',{ascending:false});
    if(error)throw error;
    reportInvoices=data||[];
  }catch(e){reportInvoices=[];showToast('Could not load report data')}
}

function paymentsByInvoiceMap(){
  const m={};
  allPayments.forEach(p=>{m[p.invoice_id]=(m[p.invoice_id]||0)+Number(p.amount)});
  return m;
}

function invoiceCogsProfit(inv){
  const {totalIncl,exclSubtotal}=calcInvoiceTotals(inv.items,inv.discount_type,inv.discount_value);
  let cogs=0;
  (inv.items||[]).forEach(it=>{
    if(it.stock&&it.stock.is_physical&&it.stock.buy_price)cogs+=Number(it.stock.buy_price)*Number(it.qty);
  });
  const profit=exclSubtotal-cogs;
  const margin=exclSubtotal?Math.round(profit/exclSubtotal*100):0;
  return {totalIncl,exclSubtotal,cogs,profit,margin};
}

function filteredReportInvoices(docType){
  return reportInvoices.filter(i=>{
    if((i.doc_type||'invoice')!==docType)return false;
    if(reportsFrom&&i.issue_date<reportsFrom)return false;
    if(reportsTo&&i.issue_date>reportsTo)return false;
    return true;
  });
}

function reportFilteredPayments(){
  return allPayments.filter(p=>{
    if(reportsFrom&&p.paid_at<reportsFrom)return false;
    if(reportsTo&&p.paid_at>reportsTo)return false;
    return true;
  });
}

async function renderReportsView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  reportsRangePreset='month';
  const r=paymentsPresetRange('month');
  reportsFrom=r.from;reportsTo=r.to;
  await Promise.all([
    loadReportInvoices(),loadAllPayments(),loadJobs(),loadStockItems(),
    loadBills(),loadPurchaseOrders(),loadEmployees(),loadTimesheets(),
    loadStockAdjustments(),loadReviews(),loadSuppliers()
  ]);
  renderReportsList();
}

// ── Reports nav (2026-07-27 redesign) ──────────────────────────────
// selectReport() replaces switchReportsCategory()+switchReportsActive():
// the old pair existed because category and report were picked in two
// separate pill rows: pick a category, THEN pick a report from what that
// revealed. The sidebar names both in one click, so one function sets both.
function selectReport(cat,key){
  reportsCategory=cat;
  reportsActive=key;
  renderReportsList();
}

// Presets fill the date fields but do NOT re-render — matching MechanicDesk
// itself (mdweb/workshops/reports/daily-sales-and-cash): picking a preset
// there only stages a range, "Show Report" commits it. Kept deliberately
// separate from filling the fields and applying them, so the explicit click
// is the ONE thing that changes what's on screen — not the preset dropdown,
// not the raw date inputs. Switching reports in the sidebar is instant
// (selectReport, above) — only the date range needs the extra step.
function onReportsPresetSelect(preset){
  if(!preset)return;
  const r=paymentsPresetRange(preset);
  document.getElementById('rpt-range-from').value=r.from||'';
  document.getElementById('rpt-range-to').value=r.to||'';
}
function showReportsRange(){
  reportsRangePreset='custom';
  reportsFrom=document.getElementById('rpt-range-from').value||null;
  reportsTo=document.getElementById('rpt-range-to').value||null;
  renderActiveReport(); // only the body needs to change — nav/toolbar don't
}
// Print — MechanicDesk's own reports carry a Print button; ours had none.
// The @media print rules (index.html) hide the nav/toolbar/header so only
// the title and report body land on paper.
function printActiveReport(){window.print()}

const REPORTS_NO_RANGE=['customer-statements','wip-jobs','wip-invoices','stock-value'];

function reportsNavHtml(){
  return Object.entries(REPORT_CATEGORIES).map(([catKey,cat])=>`
    <div class="reports-nav-group">
      <div class="reports-nav-group-title">${esc(cat.label)}</div>
      ${Object.entries(cat.reports).map(([key,label])=>
        `<button class="reports-nav-link ${reportsCategory===catKey&&reportsActive===key?'active':''}" onclick="selectReport('${catKey}','${key}')">${esc(label)}</button>`
      ).join('')}
    </div>`).join('');
}

function renderReportsList(){
  const main=document.getElementById('main');
  const activeLabel=REPORT_CATEGORIES[reportsCategory].reports[reportsActive]||'';
  let h=`<div class="reports-shell">
    <nav class="reports-nav">${reportsNavHtml()}</nav>
    <div class="reports-content">
      <div class="reports-content-title">${esc(activeLabel)}</div>`;
  if(!REPORTS_NO_RANGE.includes(reportsActive)){
    h+=`<div class="reports-toolbar">
      <select class="form-select" onchange="onReportsPresetSelect(this.value)">
        <option value="">Select a period…</option>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">Week To Date</option>
        <option value="month">Month To Date</option>
        <option value="last2weeks">Last 2 Weeks</option>
        <option value="monthback">1 Month Back</option>
        <option value="lastmonth">Last Month</option>
        <option value="all">All Time</option>
      </select>
      <span style="font-size:13px;color:var(--text-muted)">Reporting period:</span>
      <input type="date" class="form-input" id="rpt-range-from" value="${reportsFrom||''}">
      <span style="font-size:13px;color:var(--text-muted)">to</span>
      <input type="date" class="form-input" id="rpt-range-to" value="${reportsTo||''}">
      <button class="btn-primary" onclick="showReportsRange()">Show Report</button>
      <button class="btn-secondary" onclick="printActiveReport()">Print</button>
    </div>`;
  }else{
    h+=`<div class="reports-no-range-note">This report is always as-of-today, not filtered by date range.</div>
    <div class="reports-toolbar" style="margin-top:calc(var(--space-4) * -1)">
      <button class="btn-secondary" onclick="printActiveReport()">Print</button>
    </div>`;
  }
  h+='<div id="report-body"></div></div></div>';
  main.innerHTML=h;
  renderActiveReport();
}

function chartPanelHtml(canvasId,entries,grand){
  const palette=reportColorPalette();
  return `<div class="panel">
    <div style="display:flex;gap:var(--space-8);flex-wrap:wrap;align-items:center">
      <canvas id="${canvasId}" width="300" height="300" style="max-width:100%;height:auto"></canvas>
      <div style="flex:1;min-width:220px">
        ${entries.length?entries.map(([label,value],i)=>{
          const pct=grand?Math.round(value/grand*100):0;
          return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0;font-size:13px">
            <span style="width:10px;height:10px;border-radius:var(--radius-none);background:${palette[i%palette.length]};flex-shrink:0"></span>
            <span style="flex:1">${esc(label)}</span>
            <span style="font-weight:700">$${value.toFixed(2)}</span>
            <span style="color:var(--text-secondary);width:40px;text-align:right">${pct}%</span>
          </div>`;
        }).join(''):'<div class="list-empty">No data in this range.</div>'}
      </div>
    </div>
  </div>`;
}

function drawPieChart(canvasId,data){
  const canvas=document.getElementById(canvasId);
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const total=data.reduce((s,d)=>s+d.value,0);
  if(!total)return;
  const palette=reportColorPalette();
  const cx=w/2,cy=h/2,r=Math.min(w,h)/2-6;
  let start=-Math.PI/2;
  data.forEach((d,i)=>{
    const angle=d.value/total*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,start+angle);
    ctx.closePath();
    ctx.fillStyle=palette[i%palette.length];
    ctx.fill();
    start+=angle;
  });
}

function drawBarChart(canvasId,data){
  const canvas=document.getElementById(canvasId);
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(!data.length)return;
  const max=Math.max(...data.map(d=>d.value),1);
  const padL=10,padB=34,padT=26;
  const chartW=w-padL-10,chartH=h-padB-padT;
  const slot=chartW/data.length;
  const barW=Math.min(slot*0.6,60);
  ctx.strokeStyle=cssVar('--border');
  ctx.beginPath();ctx.moveTo(padL,padT+chartH);ctx.lineTo(w-10,padT+chartH);ctx.stroke();
  data.forEach((d,i)=>{
    const x=padL+i*slot+(slot-barW)/2;
    const barH=Math.max(1,d.value/max*chartH);
    const y=padT+chartH-barH;
    ctx.fillStyle=cssVar('--accent');
    ctx.fillRect(x,y,barW,barH);
    ctx.fillStyle=cssVar('--text-primary');
    ctx.font='11px sans-serif';
    ctx.textAlign='center';
    ctx.fillText('$'+Math.round(d.value).toLocaleString(),x+barW/2,y-6);
    ctx.fillStyle=cssVar('--text-secondary');
    ctx.fillText(d.label,x+barW/2,padT+chartH+16);
  });
}

function renderActiveReport(){
  const fns={
    'daily-sales-cash':renderReportDailySalesCash,
    'job-type':renderReportIncomeByJobType,
    'paid-unpaid':renderReportIncomePaidUnpaid,
    'by-customer':renderReportIncomeByCustomer,
    'by-vehicle':renderReportIncomeByVehicle,
    'invoice-report':renderReportInvoiceReport,
    'sales-report':renderReportSalesReport,
    'customer-statements':renderReportCustomerStatements,
    'job-report':renderReportJobReport,
    'wip-jobs':renderReportWipJobs,
    'wip-invoices':renderReportWipInvoices,
    'quote-conversion':renderReportQuoteConversion,
    'quote-report':renderReportQuoteReport,
    'stock-value':renderReportStockValue,
    'discount-report':renderReportDiscount,
    'bills-report':renderReportBills,
    'purchases-report':renderReportPurchases,
    'supplier-spending':renderReportSupplierSpending,
    'workshop-efficiency':renderReportWorkshopEfficiency,
    'review-report':renderReportReviews,
    'commission-report':renderReportCommission,
    'productivity-report':renderReportProductivity,
    'efficiency-report':renderReportEmployeeEfficiency,
    'lead-report':renderReportLeads,
    'buyin-report':renderReportBuyin,
    'stock-adjustments':renderReportStockAdjustments
  };
  const fn=fns[reportsActive];
  if(fn)fn();
}

function renderReportDailySalesCash(){
  const invs=filteredReportInvoices('invoice');
  const salesTotal=invs.reduce((s,i)=>s+calcInvoiceTotals(i.items,i.discount_type,i.discount_value).totalIncl,0);
  const pays=reportFilteredPayments();
  const paymentTotal=pays.reduce((s,p)=>s+Number(p.amount),0);
  const methodTotals=paymentsMethodTotals(pays);
  const activeMethods=Object.keys(methodTotals).sort((a,b)=>methodTotals[b]-methodTotals[a]);
  let h=`<div class="panel" style="max-width:600px">
    <div class="panel-title" style="margin-bottom:var(--space-3)">Sales Total</div>
    <div class="field-row"><span class="field-label">Invoices issued this period</span><span class="field-val">$${salesTotal.toFixed(2)}</span></div>
    <div class="field-row grand"><span class="field-label">Sales Total</span><span class="field-val">$${salesTotal.toFixed(2)}</span></div>
  </div>
  <div class="panel" style="max-width:600px;margin-top:var(--space-4)">
    <div class="panel-title" style="margin-bottom:var(--space-3)">Payment Total (cash basis — includes payments for invoices from other periods)</div>
    ${activeMethods.length?activeMethods.map(m=>`<div class="field-row"><span class="field-label">${PAYMENT_METHOD_LABELS[m]}</span><span class="field-val">$${methodTotals[m].toFixed(2)}</span></div>`).join(''):'<div class="list-empty">No payments in this range.</div>'}
    <div class="field-row grand"><span class="field-label">Payment Total</span><span class="field-val">$${paymentTotal.toFixed(2)}</span></div>
  </div>`;
  document.getElementById('report-body').innerHTML=h;
}

function renderReportIncomeByJobType(){
  const invs=filteredReportInvoices('invoice');
  const totals={};
  invs.forEach(i=>{
    const key=i.job_id?(jobs.find(j=>j.id===i.job_id)?.job_type||'No job type'):'No job (standalone invoice)';
    totals[key]=(totals[key]||0)+calcInvoiceTotals(i.items,i.discount_type,i.discount_value).totalIncl;
  });
  const entries=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const grand=entries.reduce((s,[,v])=>s+v,0);
  document.getElementById('report-body').innerHTML=chartPanelHtml('report-canvas-1',entries,grand);
  drawPieChart('report-canvas-1',entries.map(([label,value])=>({label,value})));
}

function renderReportIncomePaidUnpaid(){
  const invs=filteredReportInvoices('invoice');
  const paidMap=paymentsByInvoiceMap();
  let paid=0,unpaid=0;
  invs.forEach(i=>{
    const {totalIncl}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
    const p=Math.min(paidMap[i.id]||0,totalIncl);
    paid+=p;unpaid+=(totalIncl-p);
  });
  const entries=[['Paid',paid],['Unpaid',unpaid]].filter(([,v])=>v>0.001);
  const grand=paid+unpaid;
  document.getElementById('report-body').innerHTML=chartPanelHtml('report-canvas-1',entries,grand);
  drawPieChart('report-canvas-1',entries.map(([label,value])=>({label,value})));
}

function groupedIncomeTable(invs,keyFn,labelHeader){
  const groups={};
  const paidMap=paymentsByInvoiceMap();
  invs.forEach(i=>{
    const key=keyFn(i);
    if(!groups[key])groups[key]={count:0,total:0,paid:0};
    const {totalIncl}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
    groups[key].count++;
    groups[key].total+=totalIncl;
    groups[key].paid+=Math.min(paidMap[i.id]||0,totalIncl);
  });
  const rows=Object.entries(groups).map(([name,g])=>({name,...g,unpaid:g.total-g.paid})).sort((a,b)=>b.total-a.total);
  if(!rows.length)return '<div class="list-card"><div class="list-empty">No data in this range.</div></div>';
  let h=`<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>${esc(labelHeader)}</th><th style="text-align:right">Invoices</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Unpaid</th></tr></thead><tbody>`;
  rows.forEach(r=>{
    h+=`<tr><td>${esc(r.name)}</td><td style="text-align:right">${r.count}</td><td style="text-align:right">$${r.total.toFixed(2)}</td><td style="text-align:right">$${r.paid.toFixed(2)}</td><td style="text-align:right">$${r.unpaid.toFixed(2)}</td></tr>`;
  });
  const t=rows.reduce((s,r)=>({count:s.count+r.count,total:s.total+r.total,paid:s.paid+r.paid,unpaid:s.unpaid+r.unpaid}),{count:0,total:0,paid:0,unpaid:0});
  h+=`<tr style="font-weight:700"><td>Total</td><td style="text-align:right">${t.count}</td><td style="text-align:right">$${t.total.toFixed(2)}</td><td style="text-align:right">$${t.paid.toFixed(2)}</td><td style="text-align:right">$${t.unpaid.toFixed(2)}</td></tr>`;
  h+='</tbody></table></div>';
  return h;
}

function renderReportIncomeByCustomer(){
  const invs=filteredReportInvoices('invoice');
  document.getElementById('report-body').innerHTML=groupedIncomeTable(invs,i=>i.customer?.name||'Unknown','Customer');
}

function renderReportIncomeByVehicle(){
  const invs=filteredReportInvoices('invoice').filter(i=>i.vehicle);
  document.getElementById('report-body').innerHTML=groupedIncomeTable(invs,i=>i.vehicle?.make||'Unknown','Make');
}

function renderReportInvoiceReport(){
  const invs=filteredReportInvoices('invoice').sort((a,b)=>a.issue_date.localeCompare(b.issue_date));
  const buckets={};
  invs.forEach(i=>{
    const wk=toDateInputValue(startOfWeek(new Date(i.issue_date+'T00:00:00')));
    buckets[wk]=(buckets[wk]||0)+calcInvoiceTotals(i.items,i.discount_type,i.discount_value).totalIncl;
  });
  const chartData=Object.keys(buckets).sort().map(wk=>({label:fmtDate(wk).replace(/ \d{4}/,''),value:buckets[wk]}));
  let h=`<div class="panel"><canvas id="report-bar-canvas" width="900" height="260" style="max-width:100%;height:auto"></canvas></div>`;
  if(!invs.length){
    h+='<div class="list-card" style="margin-top:var(--space-4)"><div class="list-empty">No invoices in this range.</div></div>';
  }else{
    h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Inv#</th><th>Customer</th><th style="text-align:right">Total</th><th style="text-align:right">COGS</th><th style="text-align:right">Profit</th><th style="text-align:right">Margin</th><th style="text-align:right">Paid</th><th style="text-align:right">Remaining</th></tr></thead><tbody>';
    const paidMap=paymentsByInvoiceMap();
    invs.forEach(i=>{
      const {totalIncl,cogs,profit,margin}=invoiceCogsProfit(i);
      const paid=Math.min(paidMap[i.id]||0,totalIncl);
      h+=`<tr class="clickable-row" onclick="openInvoiceFromJob('${i.id}','invoice')"><td>${fmtDate(i.issue_date)}</td><td>${docPrefix(i.doc_type)}-${i.invoice_no}</td><td>${esc(i.customer?.name||'—')}</td><td style="text-align:right">$${totalIncl.toFixed(2)}</td><td style="text-align:right">$${cogs.toFixed(2)}</td><td style="text-align:right">$${profit.toFixed(2)}</td><td style="text-align:right">${margin}%</td><td style="text-align:right">$${paid.toFixed(2)}</td><td style="text-align:right">$${(totalIncl-paid).toFixed(2)}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  document.getElementById('report-body').innerHTML=h;
  drawBarChart('report-bar-canvas',chartData);
}

function renderReportSalesReport(){
  const invs=filteredReportInvoices('invoice');
  const groups={};
  invs.forEach(inv=>{
    (inv.items||[]).forEach(it=>{
      const key=it.stock_id?('stock:'+it.stock_id):('desc:'+it.description);
      if(!groups[key])groups[key]={name:it.description,qty:0,subtotal:0,cogs:0};
      const lineTotal=Number(it.qty)*Number(it.unit_price);
      const lineExcl=lineTotal-lineTotal/11;
      groups[key].qty+=Number(it.qty);
      groups[key].subtotal+=lineExcl;
      if(it.stock&&it.stock.is_physical&&it.stock.buy_price)groups[key].cogs+=Number(it.stock.buy_price)*Number(it.qty);
    });
  });
  const rows=Object.values(groups).map(g=>({...g,profit:g.subtotal-g.cogs,margin:g.subtotal?Math.round((g.subtotal-g.cogs)/g.subtotal*100):0})).sort((a,b)=>b.subtotal-a.subtotal);
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No sales in this range.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Subtotal</th><th style="text-align:right">COGS</th><th style="text-align:right">Profit</th><th style="text-align:right">Margin</th></tr></thead><tbody>';
  rows.forEach(r=>{
    h+=`<tr><td>${esc(r.name)}</td><td style="text-align:right">${r.qty}</td><td style="text-align:right">$${r.subtotal.toFixed(2)}</td><td style="text-align:right">$${r.cogs.toFixed(2)}</td><td style="text-align:right">$${r.profit.toFixed(2)}</td><td style="text-align:right">${r.margin}%</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportCustomerStatements(){
  const invs=reportInvoices.filter(i=>(i.doc_type||'invoice')==='invoice');
  const paidMap=paymentsByInvoiceMap();
  const today=new Date();
  const groups={};
  invs.forEach(i=>{
    const {totalIncl}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
    const paid=Math.min(paidMap[i.id]||0,totalIncl);
    const bal=totalIncl-paid;
    if(bal<=0.001)return;
    const name=i.customer?.name||'Unknown';
    if(!groups[name])groups[name]={current:0,m1:0,m2:0,m3:0,balance:0};
    const dueDate=new Date((i.due_date||i.issue_date)+'T00:00:00');
    const daysOverdue=Math.floor((today-dueDate)/86400000);
    if(daysOverdue<=0)groups[name].current+=bal;
    else if(daysOverdue<=30)groups[name].m1+=bal;
    else if(daysOverdue<=60)groups[name].m2+=bal;
    else groups[name].m3+=bal;
    groups[name].balance+=bal;
  });
  const rows=Object.entries(groups).map(([name,g])=>({name,...g})).sort((a,b)=>b.balance-a.balance);
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No outstanding balances. 🎉</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Customer</th><th style="text-align:right">Current</th><th style="text-align:right">1 Month</th><th style="text-align:right">2 Month</th><th style="text-align:right">3+ Month</th><th style="text-align:right">Balance</th></tr></thead><tbody>';
  rows.forEach(r=>{
    h+=`<tr><td>${esc(r.name)}</td><td style="text-align:right">$${r.current.toFixed(2)}</td><td style="text-align:right">$${r.m1.toFixed(2)}</td><td style="text-align:right">$${r.m2.toFixed(2)}</td><td style="text-align:right">$${r.m3.toFixed(2)}</td><td style="text-align:right;font-weight:700">$${r.balance.toFixed(2)}</td></tr>`;
  });
  const t=rows.reduce((s,r)=>({current:s.current+r.current,m1:s.m1+r.m1,m2:s.m2+r.m2,m3:s.m3+r.m3,balance:s.balance+r.balance}),{current:0,m1:0,m2:0,m3:0,balance:0});
  h+=`<tr style="font-weight:700"><td>Total</td><td style="text-align:right">$${t.current.toFixed(2)}</td><td style="text-align:right">$${t.m1.toFixed(2)}</td><td style="text-align:right">$${t.m2.toFixed(2)}</td><td style="text-align:right">$${t.m3.toFixed(2)}</td><td style="text-align:right">$${t.balance.toFixed(2)}</td></tr>`;
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportJobReport(){
  const list=jobs.filter(j=>{
    if(!j.booked_at)return !reportsFrom&&!reportsTo;
    const d=j.booked_at.slice(0,10);
    if(reportsFrom&&d<reportsFrom)return false;
    if(reportsTo&&d>reportsTo)return false;
    return true;
  });
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No jobs in this range.</div></div>';
    return;
  }
  const paidMap=paymentsByInvoiceMap();
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Job #</th><th>Customer</th><th>Vehicle</th><th>Job Type</th><th>Mechanic</th><th>Status</th><th style="text-align:right">Invoice Total</th><th style="text-align:right">Paid</th></tr></thead><tbody>';
  list.forEach(j=>{
    const linkedInvs=reportInvoices.filter(i=>i.job_id===j.id&&(i.doc_type||'invoice')==='invoice');
    let total=0,paid=0;
    linkedInvs.forEach(i=>{
      const {totalIncl}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
      total+=totalIncl;
      paid+=Math.min(paidMap[i.id]||0,totalIncl);
    });
    h+=`<tr class="clickable-row" onclick="quickSearchGoJob('${j.id}')"><td>${j.booked_at?fmtDateTime(j.booked_at):'—'}</td><td>${jobShortRef(j.id)}</td><td>${esc(j.customer?.name||'—')}</td><td>${esc([j.vehicle?.make,j.vehicle?.model].filter(Boolean).join(' ')||'—')}</td><td>${esc(j.job_type)}</td><td>${esc(j.assigned_mechanic||'—')}</td><td><span class="status-badge ${j.status}">${JOB_STATUS_LABELS[j.status]}</span></td><td style="text-align:right">$${total.toFixed(2)}</td><td style="text-align:right">$${paid.toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportWipJobs(){
  const list=jobs.filter(j=>j.status!=='finished');
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No jobs in progress. 🎉</div></div>';
    return;
  }
  const today=new Date();
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Job #</th><th>Booked</th><th>Customer</th><th>Vehicle</th><th>Status</th><th style="text-align:right">Days Open</th></tr></thead><tbody>';
  list.forEach(j=>{
    const days=j.created_at?Math.floor((today-new Date(j.created_at))/86400000):'—';
    h+=`<tr class="clickable-row" onclick="quickSearchGoJob('${j.id}')"><td>${jobShortRef(j.id)}</td><td>${j.booked_at?fmtDateTime(j.booked_at):'—'}</td><td>${esc(j.customer?.name||'—')}</td><td>${esc([j.vehicle?.make,j.vehicle?.model].filter(Boolean).join(' ')||'—')}</td><td><span class="status-badge ${j.status}">${JOB_STATUS_LABELS[j.status]}</span></td><td style="text-align:right">${days}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportWipInvoices(){
  const invs=reportInvoices.filter(i=>(i.doc_type||'invoice')==='invoice'&&i.status!=='paid');
  if(!invs.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No unpaid invoices. 🎉</div></div>';
    return;
  }
  const paidMap=paymentsByInvoiceMap();
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Inv#</th><th>Date</th><th>Customer</th><th>Status</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Remaining</th></tr></thead><tbody>';
  invs.forEach(i=>{
    const {totalIncl}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
    const paid=Math.min(paidMap[i.id]||0,totalIncl);
    h+=`<tr class="clickable-row" onclick="openInvoiceFromJob('${i.id}','invoice')"><td>${docPrefix(i.doc_type)}-${i.invoice_no}</td><td>${fmtDate(i.issue_date)}</td><td>${esc(i.customer?.name||'—')}</td><td><span class="status-badge ${i.status}">${DOC_STATUS_LABELS[i.status]}</span></td><td style="text-align:right">$${totalIncl.toFixed(2)}</td><td style="text-align:right">$${paid.toFixed(2)}</td><td style="text-align:right">$${(totalIncl-paid).toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportQuoteConversion(){
  const quotes=filteredReportInvoices('quote');
  let activeVal=0,successVal=0,declinedVal=0;
  quotes.forEach(q=>{
    const {totalIncl}=calcInvoiceTotals(q.items,q.discount_type,q.discount_value);
    if(q.converted_invoice_id)successVal+=totalIncl;
    else if(q.status==='declined')declinedVal+=totalIncl;
    else activeVal+=totalIncl;
  });
  const entries=[['Active',activeVal],['Successful',successVal],['Declined',declinedVal]].filter(([,v])=>v>0.001);
  const grand=activeVal+successVal+declinedVal;
  let h=chartPanelHtml('report-canvas-1',entries,grand);
  if(quotes.length){
    h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Quote#</th><th>Customer</th><th style="text-align:right">Total</th><th>Status</th></tr></thead><tbody>';
    quotes.forEach(q=>{
      const {totalIncl}=calcInvoiceTotals(q.items,q.discount_type,q.discount_value);
      const label=q.converted_invoice_id?'Converted':DOC_STATUS_LABELS[q.status];
      h+=`<tr class="clickable-row" onclick="openInvoiceFromJob('${q.id}','quote')"><td>${fmtDate(q.issue_date)}</td><td>QUO-${q.invoice_no}</td><td>${esc(q.customer?.name||'—')}</td><td style="text-align:right">$${totalIncl.toFixed(2)}</td><td>${esc(label)}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  document.getElementById('report-body').innerHTML=h;
  drawPieChart('report-canvas-1',entries.map(([label,value])=>({label,value})));
}

function renderReportQuoteReport(){
  const quotes=filteredReportInvoices('quote').sort((a,b)=>a.issue_date.localeCompare(b.issue_date));
  const buckets={};
  quotes.forEach(q=>{
    const wk=toDateInputValue(startOfWeek(new Date(q.issue_date+'T00:00:00')));
    buckets[wk]=(buckets[wk]||0)+calcInvoiceTotals(q.items,q.discount_type,q.discount_value).totalIncl;
  });
  const chartData=Object.keys(buckets).sort().map(wk=>({label:fmtDate(wk).replace(/ \d{4}/,''),value:buckets[wk]}));
  let h=`<div class="panel"><canvas id="report-bar-canvas" width="900" height="260" style="max-width:100%;height:auto"></canvas></div>`;
  if(!quotes.length){
    h+='<div class="list-card" style="margin-top:var(--space-4)"><div class="list-empty">No quotes in this range.</div></div>';
  }else{
    h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Quote#</th><th>Customer</th><th style="text-align:right">Total</th><th style="text-align:right">COGS</th><th style="text-align:right">Profit</th><th style="text-align:right">Margin</th></tr></thead><tbody>';
    quotes.forEach(q=>{
      const {totalIncl,cogs,profit,margin}=invoiceCogsProfit(q);
      h+=`<tr class="clickable-row" onclick="openInvoiceFromJob('${q.id}','quote')"><td>${fmtDate(q.issue_date)}</td><td>QUO-${q.invoice_no}</td><td>${esc(q.customer?.name||'—')}</td><td style="text-align:right">$${totalIncl.toFixed(2)}</td><td style="text-align:right">$${cogs.toFixed(2)}</td><td style="text-align:right">$${profit.toFixed(2)}</td><td style="text-align:right">${margin}%</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  document.getElementById('report-body').innerHTML=h;
  drawBarChart('report-bar-canvas',chartData);
}

function renderReportStockValue(){
  const physical=stockItems.filter(s=>s.is_physical);
  const sellValue=physical.reduce((s,x)=>s+(Number(x.qty_on_hand)||0)*Number(x.sell_price),0);
  const costValue=physical.reduce((s,x)=>s+(Number(x.qty_on_hand)||0)*(Number(x.buy_price)||0),0);
  let h=`<div class="panel" style="max-width:500px">
    <div class="field-row"><span class="field-label">Total stock value (sell price)</span><span class="field-val">$${sellValue.toFixed(2)}</span></div>
    <div class="field-row"><span class="field-label">Total stock value (cost price)</span><span class="field-val">$${costValue.toFixed(2)}</span></div>
    <div class="field-row grand"><span class="field-label">Potential gross profit</span><span class="field-val">$${(sellValue-costValue).toFixed(2)}</span></div>
  </div>`;
  const rows=physical.filter(s=>s.qty_on_hand).sort((a,b)=>(b.qty_on_hand*b.sell_price)-(a.qty_on_hand*a.sell_price));
  if(rows.length){
    h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Cost Value</th><th style="text-align:right">Sell Value</th></tr></thead><tbody>';
    rows.forEach(s=>{
      h+=`<tr><td>${esc(s.name)}${s.sku?' ('+esc(s.sku)+')':''}</td><td style="text-align:right">${s.qty_on_hand}</td><td style="text-align:right">$${((s.qty_on_hand||0)*(s.buy_price||0)).toFixed(2)}</td><td style="text-align:right">$${((s.qty_on_hand||0)*s.sell_price).toFixed(2)}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }
  document.getElementById('report-body').innerHTML=h;
}

// ── Discount Report (Income) ─────────────────────────────────
function renderReportDiscount(){
  const invs=filteredReportInvoices('invoice').filter(i=>i.discount_type&&i.discount_value);
  if(!invs.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No discounts given in this range.</div></div>';
    return;
  }
  let totalDiscount=0;
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Inv#</th><th>Customer</th><th>Discount</th><th style="text-align:right">Discount Amount</th><th style="text-align:right">Total</th></tr></thead><tbody>';
  invs.forEach(i=>{
    const {totalIncl,discountAmount}=calcInvoiceTotals(i.items,i.discount_type,i.discount_value);
    totalDiscount+=discountAmount;
    const discLabel=i.discount_type==='percent'?i.discount_value+'%':'$'+Number(i.discount_value).toFixed(2);
    h+=`<tr class="clickable-row" onclick="openInvoiceFromJob('${i.id}','invoice')"><td>${fmtDate(i.issue_date)}</td><td>${docPrefix(i.doc_type)}-${i.invoice_no}</td><td>${esc(i.customer?.name||'—')}</td><td>${discLabel}</td><td style="text-align:right">$${discountAmount.toFixed(2)}</td><td style="text-align:right">$${totalIncl.toFixed(2)}</td></tr>`;
  });
  h+=`<tr style="font-weight:700"><td colspan="4">Total</td><td style="text-align:right">$${totalDiscount.toFixed(2)}</td><td></td></tr>`;
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

// ── Bills / Purchases / Supplier Spending (Expense) ─────────
function filteredReportBills(){
  return bills.filter(b=>{
    if(reportsFrom&&b.bill_date<reportsFrom)return false;
    if(reportsTo&&b.bill_date>reportsTo)return false;
    return true;
  });
}

function renderReportBills(){
  const list=filteredReportBills();
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No bills in this range.</div></div>';
    return;
  }
  const total=list.reduce((s,b)=>s+Number(b.amount),0);
  let h=`<div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-3)">${list.length} bill${list.length===1?'':'s'} · $${total.toFixed(2)} total</div>`;
  h+='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Supplier</th><th>Reference</th><th>Status</th><th style="text-align:right">Amount</th></tr></thead><tbody>';
  list.forEach(b=>{
    h+=`<tr class="clickable-row" onclick="switchInvoicesSubView('bills');openBill('${b.id}')"><td>${fmtDate(b.bill_date)}</td><td>${esc(b.supplier?.name||'—')}</td><td>${esc(b.reference||'—')}</td><td><span class="status-badge ${b.status==='paid'?'finished':b.status==='awaiting_payment'?'in_progress':'draft'}">${BILL_STATUS_LABELS[b.status]}</span></td><td style="text-align:right">$${Number(b.amount).toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportPurchases(){
  const list=filteredReportBills().sort((a,b)=>a.bill_date.localeCompare(b.bill_date));
  const buckets={};
  list.forEach(b=>{
    const wk=toDateInputValue(startOfWeek(new Date(b.bill_date+'T00:00:00')));
    buckets[wk]=(buckets[wk]||0)+Number(b.amount);
  });
  const chartData=Object.keys(buckets).sort().map(wk=>({label:fmtDate(wk).replace(/ \d{4}/,''),value:buckets[wk]}));
  let h=`<div class="panel"><canvas id="report-bar-canvas" width="900" height="260" style="max-width:100%;height:auto"></canvas></div>`;
  document.getElementById('report-body').innerHTML=h;
  drawBarChart('report-bar-canvas',chartData);
}

function renderReportSupplierSpending(){
  const list=filteredReportBills();
  const groups={};
  list.forEach(b=>{
    const name=b.supplier?.name||'Unknown';
    groups[name]=(groups[name]||0)+Number(b.amount);
  });
  const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]);
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No bills in this range.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Supplier</th><th style="text-align:right">Spend</th></tr></thead><tbody>';
  rows.forEach(([name,total])=>{h+=`<tr><td>${esc(name)}</td><td style="text-align:right">$${total.toFixed(2)}</td></tr>`});
  const grand=rows.reduce((s,[,v])=>s+v,0);
  h+=`<tr style="font-weight:700"><td>Total</td><td style="text-align:right">$${grand.toFixed(2)}</td></tr>`;
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

// ── Workshop Efficiency + Review Report (Work) ──────────────
function renderReportWorkshopEfficiency(){
  const list=jobs.filter(j=>{
    if(!j.estimate_hours)return false;
    if(!j.booked_at)return false;
    const d=j.booked_at.slice(0,10);
    if(reportsFrom&&d<reportsFrom)return false;
    if(reportsTo&&d>reportsTo)return false;
    return true;
  });
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No jobs with an estimate in this range — Efficiency needs both an estimate and logged timesheet hours to compare.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Job #</th><th>Customer</th><th>Job Type</th><th style="text-align:right">Estimate</th><th style="text-align:right">Actual</th><th style="text-align:right">Efficiency</th></tr></thead><tbody>';
  list.forEach(j=>{
    const actual=timesheets.filter(t=>t.job_id===j.id).reduce((s,t)=>s+Number(t.hours),0);
    const eff=actual?Math.round(Number(j.estimate_hours)/actual*100):null;
    h+=`<tr class="clickable-row" onclick="quickSearchGoJob('${j.id}')"><td>${jobShortRef(j.id)}</td><td>${esc(j.customer?.name||'—')}</td><td>${esc(j.job_type)}</td><td style="text-align:right">${Number(j.estimate_hours).toFixed(2)}h</td><td style="text-align:right">${actual?actual.toFixed(2)+'h':'—'}</td><td style="text-align:right">${eff!=null?eff+'%':'—'}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function filteredReviews(){
  return reviews.filter(r=>{
    const d=r.created_at.slice(0,10);
    if(reportsFrom&&d<reportsFrom)return false;
    if(reportsTo&&d>reportsTo)return false;
    return true;
  });
}

function renderReportReviews(){
  const list=filteredReviews();
  const avg=list.length?(list.reduce((s,r)=>s+r.rating,0)/list.length).toFixed(1):'0';
  let h=`<div class="panel" style="max-width:300px"><div class="field-row grand"><span class="field-label">Average Rating</span><span class="field-val">${avg} / 5</span></div></div>`;
  if(list.length){
    h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Job</th><th>Customer</th><th>Rating</th><th>Comment</th></tr></thead><tbody>';
    list.forEach(r=>{
      h+=`<tr><td>${fmtDate(r.created_at.slice(0,10))}</td><td>${esc(r.job?.job_type||'—')}</td><td>${esc(r.customer?.name||'—')}</td><td>${r.rating} / 5</td><td>${esc(r.comment||'')}</td></tr>`;
    });
    h+='</tbody></table></div>';
  }else{
    h+='<div class="list-card" style="margin-top:var(--space-4)"><div class="list-empty">No reviews logged in this range — log one from a finished Job Card.</div></div>';
  }
  document.getElementById('report-body').innerHTML=h;
}

// ── Commission / Productivity / Efficiency (Employee) ───────
function filteredTimesheetsForReports(){
  return timesheets.filter(t=>{
    if(reportsFrom&&t.work_date<reportsFrom)return false;
    if(reportsTo&&t.work_date>reportsTo)return false;
    return true;
  });
}

function renderReportCommission(){
  const list=filteredTimesheetsForReports();
  if(!list.length||!employees.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No timesheet entries in this range — log time under Timesheets first.</div></div>';
    return;
  }
  const byEmployee={};
  list.forEach(t=>{
    if(!byEmployee[t.employee_id])byEmployee[t.employee_id]={hours:0};
    byEmployee[t.employee_id].hours+=Number(t.hours);
  });
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Employee</th><th style="text-align:right">Hours</th><th style="text-align:right">Charge-out Value</th><th style="text-align:right">Commission %</th><th style="text-align:right">Est. Commission</th></tr></thead><tbody>';
  Object.entries(byEmployee).forEach(([empId,d])=>{
    const emp=employees.find(e=>e.id===empId);
    if(!emp)return;
    const value=d.hours*(Number(emp.charge_out_rate)||0);
    const commission=value*(Number(emp.commission_rate)||0)/100;
    h+=`<tr><td>${esc(emp.name)}</td><td style="text-align:right">${d.hours.toFixed(2)}h</td><td style="text-align:right">$${value.toFixed(2)}</td><td style="text-align:right">${emp.commission_rate||0}%</td><td style="text-align:right">$${commission.toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  h+='<div style="font-size:12px;color:var(--text-secondary);margin-top:var(--space-3)">Estimated from hours logged × charge-out rate × commission rate set per employee in Settings — not a precise split when multiple people worked the same job.</div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportProductivity(){
  const list=filteredTimesheetsForReports();
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No timesheet entries in this range.</div></div>';
    return;
  }
  const byEmployee={};
  list.forEach(t=>{
    if(!byEmployee[t.employee_id])byEmployee[t.employee_id]={hours:0,entries:0};
    byEmployee[t.employee_id].hours+=Number(t.hours);
    byEmployee[t.employee_id].entries++;
  });
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Employee</th><th style="text-align:right">Entries</th><th style="text-align:right">Total Hours</th><th style="text-align:right">$ Value</th></tr></thead><tbody>';
  Object.entries(byEmployee).sort((a,b)=>b[1].hours-a[1].hours).forEach(([empId,d])=>{
    const emp=employees.find(e=>e.id===empId);
    const value=d.hours*(Number(emp?.charge_out_rate)||0);
    h+=`<tr><td>${esc(emp?.name||'Unknown')}</td><td style="text-align:right">${d.entries}</td><td style="text-align:right">${d.hours.toFixed(2)}h</td><td style="text-align:right">$${value.toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportEmployeeEfficiency(){
  const list=filteredTimesheetsForReports().filter(t=>t.job_id);
  if(!list.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No job-linked timesheet entries in this range.</div></div>';
    return;
  }
  const byEmployee={};
  list.forEach(t=>{
    const job=jobs.find(j=>j.id===t.job_id);
    if(!job||!job.estimate_hours)return;
    if(!byEmployee[t.employee_id])byEmployee[t.employee_id]={estimate:0,actual:0,jobIds:new Set()};
    byEmployee[t.employee_id].actual+=Number(t.hours);
    if(!byEmployee[t.employee_id].jobIds.has(job.id)){
      byEmployee[t.employee_id].jobIds.add(job.id);
      byEmployee[t.employee_id].estimate+=Number(job.estimate_hours);
    }
  });
  const rows=Object.entries(byEmployee);
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No jobs with both an estimate and logged time in this range.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Employee</th><th style="text-align:right">Est. Hours (jobs worked)</th><th style="text-align:right">Actual Hours</th><th style="text-align:right">Efficiency</th></tr></thead><tbody>';
  rows.forEach(([empId,d])=>{
    const emp=employees.find(e=>e.id===empId);
    const eff=d.actual?Math.round(d.estimate/d.actual*100):0;
    h+=`<tr><td>${esc(emp?.name||'Unknown')}</td><td style="text-align:right">${d.estimate.toFixed(2)}h</td><td style="text-align:right">${d.actual.toFixed(2)}h</td><td style="text-align:right">${eff}%</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

// ── Lead Report (Marketing) — pulled live from the CRM's own
// `leads` table, same Supabase project, read-only. Not duplicated
// into Desk's own tables. ────────────────────────────────────
async function renderReportLeads(){
  document.getElementById('report-body').innerHTML='<div class="empty-state">Loading…</div>';
  let leadsData=[];
  try{
    let q=sb.from('leads').select('id,name,source,stage,value,division,won_date,close_reason,created_at');
    if(reportsFrom)q=q.gte('created_at',reportsFrom);
    if(reportsTo)q=q.lte('created_at',reportsTo+'T23:59:59');
    const {data,error}=await q.order('created_at',{ascending:false});
    if(error)throw error;
    leadsData=data||[];
  }catch(e){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">Could not load leads from CRM.</div></div>';
    return;
  }
  if(!leadsData.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No leads in this range.</div></div>';
    return;
  }
  const won=leadsData.filter(l=>l.stage==='Won').length;
  const stageGroups={};
  leadsData.forEach(l=>{stageGroups[l.stage||'Unknown']=(stageGroups[l.stage||'Unknown']||0)+1});
  const stageEntries=Object.entries(stageGroups).sort((a,b)=>b[1]-a[1]);
  const sourceGroups={};
  leadsData.forEach(l=>{sourceGroups[l.source||'Unknown']=(sourceGroups[l.source||'Unknown']||0)+1});
  const sourceRows=Object.entries(sourceGroups).sort((a,b)=>b[1]-a[1]);
  let h=`<div class="panel" style="max-width:400px;margin-bottom:var(--space-4)">
    <div class="field-row"><span class="field-label">Total leads</span><span class="field-val">${leadsData.length}</span></div>
    <div class="field-row"><span class="field-label">Won</span><span class="field-val">${won}</span></div>
    <div class="field-row grand"><span class="field-label">Win rate</span><span class="field-val">${leadsData.length?Math.round(won/leadsData.length*100):0}%</span></div>
  </div>`;
  h+=chartPanelHtml('report-canvas-1',stageEntries,leadsData.length);
  h+='<div class="invoice-items-wrap" style="margin-top:var(--space-4)"><table class="invoice-items-table"><thead><tr><th>Source</th><th style="text-align:right">Leads</th></tr></thead><tbody>';
  sourceRows.forEach(([name,count])=>{h+=`<tr><td>${esc(name)}</td><td style="text-align:right">${count}</td></tr>`});
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
  drawPieChart('report-canvas-1',stageEntries.map(([label,value])=>({label,value})));
}

// ── Buyin + Stock Manual Adjustments (Inventory) ─────────────
function filteredStockAdjustments(){
  return stockAdjustments.filter(a=>{
    const d=a.adjusted_at.slice(0,10);
    if(reportsFrom&&d<reportsFrom)return false;
    if(reportsTo&&d>reportsTo)return false;
    return true;
  });
}

function renderReportBuyin(){
  const rows=filteredStockAdjustments().filter(a=>a.reason.startsWith('Received PO-'));
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No stock received against purchase orders in this range.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th style="text-align:right">Qty Received</th></tr></thead><tbody>';
  rows.forEach(a=>{
    h+=`<tr><td>${fmtDate(a.adjusted_at.slice(0,10))}</td><td>${esc(a.stock?.name||'—')}</td><td>${esc(a.reason)}</td><td style="text-align:right">${(a.qty_after-a.qty_before).toFixed(2)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

function renderReportStockAdjustments(){
  const rows=filteredStockAdjustments().filter(a=>!a.reason.startsWith('Received PO-'));
  if(!rows.length){
    document.getElementById('report-body').innerHTML='<div class="list-card"><div class="list-empty">No manual stock adjustments in this range.</div></div>';
    return;
  }
  let h='<div class="invoice-items-wrap"><table class="invoice-items-table"><thead><tr><th>Date</th><th>Item</th><th style="text-align:right">Before</th><th style="text-align:right">After</th><th style="text-align:right">Change</th><th>Reason</th></tr></thead><tbody>';
  rows.forEach(a=>{
    const delta=a.qty_after-a.qty_before;
    h+=`<tr><td>${fmtDate(a.adjusted_at.slice(0,10))}</td><td>${esc(a.stock?.name||'—')}</td><td style="text-align:right">${a.qty_before}</td><td style="text-align:right">${a.qty_after}</td><td style="text-align:right">${delta>0?'+':''}${delta}</td><td>${esc(a.reason)}</td></tr>`;
  });
  h+='</tbody></table></div>';
  document.getElementById('report-body').innerHTML=h;
}

// ── Settings ─────────────────────────────────────────────────
async function loadInvoiceTemplateSetting(){
  try{
    const {data,error}=await sb.from('desk_settings').select('value').eq('key','invoice_template').maybeSingle();
    if(error)throw error;
    invoiceTemplate=data?.value||'standard';
  }catch(e){invoiceTemplate='standard'}
}

const WORKSHOP_DETAILS_DEFAULTS={name:'',abn:'',phone:'',address:'',website:'',email:'',invoice_footer:'',logo_url:''};
async function loadWorkshopDetailsSetting(){
  try{
    const {data,error}=await sb.from('desk_settings').select('value').eq('key','workshop_details').maybeSingle();
    if(error)throw error;
    workshopDetails={...WORKSHOP_DETAILS_DEFAULTS,...(parseSettingValue(data?.value)||{})};
  }catch(e){workshopDetails={...WORKSHOP_DETAILS_DEFAULTS}}
}

async function saveWorkshopDetails(){
  const next={
    name:document.getElementById('wd-name').value.trim(),
    abn:document.getElementById('wd-abn').value.trim(),
    phone:document.getElementById('wd-phone').value.trim(),
    address:document.getElementById('wd-address').value.trim(),
    website:document.getElementById('wd-website').value.trim(),
    email:document.getElementById('wd-email').value.trim(),
    invoice_footer:document.getElementById('wd-footer').value.trim(),
    logo_url:workshopDetails.logo_url||''
  };
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'workshop_details',value:JSON.stringify(next),updated_at:new Date().toISOString()});
    if(error)throw error;
    workshopDetails=next;
    showToast('Workshop details saved');
  }catch(e){showToast('Could not save workshop details')}
}

async function onWorkshopLogoChange(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  if(!file.type.startsWith('image/')){showToast('Logo must be an image file');input.value='';return}
  if(file.size>2*1024*1024){showToast('Logo must be under 2MB');input.value='';return}
  const ext=(file.name.split('.').pop()||'png').toLowerCase();
  const path='logo.'+ext;
  try{
    const {error}=await sb.storage.from('workshop-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(error)throw error;
    const {data}=sb.storage.from('workshop-assets').getPublicUrl(path);
    // Cache-bust baked into the stored URL itself — logos are re-uploaded
    // rarely, so a static query param at upload time is simpler than
    // tracking a separate version counter just to bust the CDN/browser cache.
    workshopDetails.logo_url=data.publicUrl+'?t='+Date.now();
    const {error:saveErr}=await sb.from('desk_settings').upsert({key:'workshop_details',value:JSON.stringify({...workshopDetails}),updated_at:new Date().toISOString()});
    if(saveErr)throw saveErr;
    showToast('Logo uploaded');
    renderSettingsPage();
  }catch(e){showToast('Could not upload logo')}
}

async function removeWorkshopLogo(){
  workshopDetails.logo_url='';
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'workshop_details',value:JSON.stringify({...workshopDetails}),updated_at:new Date().toISOString()});
    if(error)throw error;
    showToast('Logo removed');
    renderSettingsPage();
  }catch(e){showToast('Could not remove logo')}
}

async function renderSettingsView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadInvoiceTemplateSetting();
  await loadWorkshopDetailsSetting();
  await loadServiceTypes();
  await loadJobTypes();
  await loadTrackedTyreSizes();
  await loadJobSources();
  await loadDiaryHoursSetting();
  await loadXeroAccounts();
  await loadXeroPaymentAccountMap();
  await loadEmployees();
  await loadMessagingStatus();
  await loadMessagingSettings();
  renderSettingsPage();
}

function renderSettingsPage(){
  const main=document.getElementById('main');
  const templates=[
    {id:'aurora',name:'Aurora',desc:"DHF Desk's own look — gradient header, rounded cards, your logo front and centre. Recommended."},
    {id:'standard',name:'Standard',desc:'Full-width header band, roomy line items — good default for printing/emailing to customers.'},
    {id:'compact',name:'Compact',desc:'Denser layout, minimal styling — quick to print, less paper/ink.'}
  ];
  let h=`<div class="panel" style="max-width:700px">
    <div class="panel-title" style="margin-bottom:var(--space-1)">Workshop Details</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-3)">Your logo and business details — shown on every printed/emailed invoice and quote.</div>
    <div style="display:flex;gap:var(--space-4);align-items:flex-start;margin-bottom:var(--space-4);flex-wrap:wrap">
      <div style="width:120px;height:120px;border-radius:var(--radius-sm);background:var(--bg-alt);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
        ${workshopDetails.logo_url?`<img src="${esc(workshopDetails.logo_url)}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`:`<span style="font-size:12px;color:var(--text-secondary)">No logo</span>`}
      </div>
      <div style="flex:1;min-width:200px">
        <label class="btn-secondary" style="display:inline-block;cursor:pointer">
          Upload logo
          <input type="file" accept="image/*" style="display:none" onchange="onWorkshopLogoChange(this)">
        </label>
        ${workshopDetails.logo_url?`<button class="btn-link" style="margin-left:var(--space-3)" onclick="removeWorkshopLogo()">Remove</button>`:''}
        <div style="font-size:12px;color:var(--text-secondary);margin-top:var(--space-2)">PNG or JPG, under 2MB. Shows in the header of the Aurora invoice template.</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div><label class="form-label">Business name</label><input class="form-input" id="wd-name" value="${esc(workshopDetails.name)}" placeholder="DHF Tyres"></div>
      <div><label class="form-label">ABN</label><input class="form-input" id="wd-abn" value="${esc(workshopDetails.abn)}" placeholder="33 623 054 722"></div>
      <div><label class="form-label">Phone</label><input class="form-input" id="wd-phone" value="${esc(workshopDetails.phone)}" placeholder="03 9796 4950"></div>
      <div><label class="form-label">Email</label><input class="form-input" id="wd-email" value="${esc(workshopDetails.email)}" placeholder="info@dhftyres.com.au"></div>
      <div><label class="form-label">Website</label><input class="form-input" id="wd-website" value="${esc(workshopDetails.website)}" placeholder="www.dhftyres.com.au"></div>
      <div><label class="form-label">Address</label><input class="form-input" id="wd-address" value="${esc(workshopDetails.address)}" placeholder="Factory 1, 42-46 Hallam South Road, Hallam VIC 3803"></div>
    </div>
    <label class="form-label" style="margin-top:var(--space-3);display:block">Invoice footer</label>
    <textarea class="form-input" id="wd-footer" rows="3" placeholder="Bank details, payment terms, or a thank-you note — shown at the bottom of every invoice.">${esc(workshopDetails.invoice_footer)}</textarea>
    <div class="form-actions" style="justify-content:flex-start;margin-top:var(--space-3)">
      <button class="btn-primary" onclick="saveWorkshopDetails()">Save workshop details</button>
    </div>
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-title" style="margin-bottom:var(--space-1)">Invoice Template</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">Choose the default layout used when printing or emailing invoices.</div>
    <div class="template-grid">
      ${templates.map(t=>`
        <div class="template-option-card ${invoiceTemplate===t.id?'selected':''}" onclick="selectInvoiceTemplate('${t.id}')">
          <div class="template-preview ${t.id==='compact'?'compact':''}"><div class="band" style="background:${t.id==='aurora'?'linear-gradient(135deg,#1F90F7 0%,#2C5FF5 45%,#6D5FFF 100%)':t.id==='standard'?'var(--accent)':'#ddd'}"></div><div class="lines"><div></div><div></div><div style="width:60%"></div></div></div>
          <div style="font-weight:700;font-size:var(--text-compact)">${t.name}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:var(--space-1)">${t.desc}</div>
        </div>`).join('')}
    </div>
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Service Types</div><button class="btn-secondary" onclick="openServiceTypeModal()">+ Add service type</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">These drive the reminder options offered when a job is marked Finished. Add as many as you need — intervals can be time-based, distance-based, or both.</div>
    ${serviceTypes.length?serviceTypes.map(st=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(st.name)}${st.is_active?'':' <span class="status-badge draft">Inactive</span>'}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <span style="font-size:12px;color:var(--text-secondary)">${serviceIntervalLabel(st)}</span>
          <button class="btn-link" onclick="openServiceTypeModal('${st.id}')">Edit</button>
          <button class="btn-link" onclick="toggleServiceTypeActive('${st.id}',${!st.is_active})">${st.is_active?'Deactivate':'Activate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No service types yet — add your first one (e.g. "Standard Service", "Tyre Rotation").</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Job Types</div><button class="btn-secondary" onclick="openJobTypeModal()">+ Add job type</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">These populate the Job Type dropdown when creating a New Job. Deactivate ones you no longer use instead of deleting — existing jobs keep their type either way. Set a service interval to auto-suggest a next-service date when a job of this type is finished.</div>
    ${jobTypes.length?jobTypes.map(t=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(t.name)}${t.is_active?'':' <span class="status-badge draft">Inactive</span>'}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <span style="font-size:12px;color:var(--text-secondary)">${serviceIntervalLabel(t)}</span>
          <button class="btn-link" onclick="openJobTypeModal('${t.id}')">Edit</button>
          <button class="btn-link" onclick="toggleJobTypeActive('${t.id}',${!t.is_active})">${t.is_active?'Deactivate':'Activate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No job types yet — add your first one (e.g. "Tyre Fitting", "Wheel Alignment").</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Tracked Tyre Sizes</div><button class="btn-secondary" onclick="openTrackedTyreSizeModal()">+ Add size</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">Sizes the daily supplier-stock scraper checks (Settings here, not code — add a size and it's picked up on the next run, no need to ask for it). Deactivate ones you no longer stock instead of deleting.</div>
    ${trackedTyreSizes.length?trackedTyreSizes.slice().sort((a,b)=>(a.label||a.size_code).localeCompare(b.label||b.size_code)).map(s=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(s.label||s.size_code)}${s.is_active?'':' <span class="status-badge draft">Inactive</span>'}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn-link" onclick="openTrackedTyreSizeModal('${s.id}')">Edit</button>
          <button class="btn-link" onclick="toggleTrackedTyreSizeActive('${s.id}',${!s.is_active})">${s.is_active?'Deactivate':'Activate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No tracked sizes yet — add your first one.</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Job Sources</div><button class="btn-secondary" onclick="openJobSourceModal()">+ Add source</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">Where a job came from (Meta Ads, Walk-in, Referral, Repeat Customer…). Populates the Source dropdown on New Job and breaks the Sales Projection down by source.</div>
    ${jobSources.length?jobSources.map(s=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(s.name)}${s.is_active?'':' <span class="status-badge draft">Inactive</span>'}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn-link" onclick="openJobSourceModal('${s.id}')">Edit</button>
          <button class="btn-link" onclick="toggleJobSourceActive('${s.id}',${!s.is_active})">${s.is_active?'Deactivate':'Activate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No sources yet — add your first one (e.g. "Walk-in", "Referral").</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-title" style="margin-bottom:var(--space-1)">Diary Hours</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-3)">The time range shown on the Diary's Hoist Day view.</div>
    <label class="form-label">Opens</label>
    <input class="form-input" type="time" id="dh-start" value="${hoursToHhmm(DAY_VIEW_START_HOUR)}" style="margin-bottom:var(--space-3)">
    <label class="form-label">Closes</label>
    <input class="form-input" type="time" id="dh-end" value="${hoursToHhmm(DAY_VIEW_END_HOUR)}">
    <div class="form-actions" style="justify-content:flex-start;margin-top:var(--space-3)">
      <button class="btn-primary" onclick="saveDiaryHours()">Save</button>
    </div>
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Xero Accounts</div><button class="btn-secondary" onclick="openXeroAccountModal()">+ Add account</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">Not connected to Xero yet — this is just the chart-of-accounts catalog we'll use once the live sync is built, so invoices are already coded correctly by then. Copy the codes/names straight from Xero → Accounting → Chart of Accounts.</div>
    ${xeroAccounts.length?xeroAccounts.map(a=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(a.code)} — ${esc(a.name)}${a.is_active?'':' <span class="status-badge draft">Inactive</span>'}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <span style="font-size:12px;color:var(--text-secondary);text-transform:capitalize">${esc(a.account_type)}</span>
          <button class="btn-link" onclick="openXeroAccountModal('${a.id}')">Edit</button>
          <button class="btn-link" onclick="toggleXeroAccountActive('${a.id}',${!a.is_active})">${a.is_active?'Deactivate':'Activate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No accounts yet — add the ones you invoice against most (e.g. "200 — Sales", "260 — Labour").</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-title" style="margin-bottom:var(--space-1)">Xero Payment Method Mapping</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-3)">When payments sync to Xero, each one needs to land in a bank account. Map each payment method to the matching Xero bank account (add bank-type accounts above first).</div>
    ${selectablePaymentMethods().map(m=>`
      <label class="form-label">${PAYMENT_METHOD_LABELS[m]}</label>
      <select class="form-select" id="xpam-${m}" style="margin-bottom:var(--space-3)">
        <option value="">— Not mapped —</option>
        ${xeroAccounts.filter(a=>a.account_type==='bank').map(a=>`<option value="${esc(a.code)}" ${xeroPaymentAccountMap[m]===a.code?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}
      </select>`).join('')}
    <div class="form-actions" style="justify-content:flex-start;margin-top:var(--space-1)">
      <button class="btn-primary" onclick="savePaymentAccountMap()">Save mapping</button>
    </div>
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-head"><div class="panel-title">Employees</div><button class="btn-secondary" onclick="openEmployeeModal()">+ Add employee</button></div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-2)">Used for Timesheets and the Commission/Productivity/Efficiency reports. Rates are optional but needed for those reports to show $ figures.</div>
    ${employees.length?employees.map(e=>`
      <div class="field-row" style="align-items:center">
        <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:600">${esc(e.name)}${e.is_active===false?' <span class="status-badge draft">Inactive</span>':''}</span>
        <span style="display:flex;align-items:center;gap:var(--space-3)">
          <span style="font-size:12px;color:var(--text-secondary)">${esc(e.role||'—')}${e.charge_out_rate?' · $'+e.charge_out_rate+'/hr':''}</span>
          <button class="btn-link" onclick="openEmployeeModal('${e.id}')">Edit</button>
          <button class="btn-link" onclick="toggleEmployeeActive('${e.id}',${e.is_active===false})">${e.is_active===false?'Activate':'Deactivate'}</button>
        </span>
      </div>`).join(''):'<div class="list-empty">No employees yet — add your mechanics/staff to start logging timesheets against them.</div>'}
  </div>
  <div class="panel" style="max-width:700px;margin-top:var(--space-4)">
    <div class="panel-title" style="margin-bottom:var(--space-1)">Messaging</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:var(--space-3)">Real email (via Resend) and SMS (via Twilio) sent from Jobs, Invoices, and the Messages tab, plus automated booking confirmations/reminders.</div>
    <div class="field-row"><span class="field-label">Email</span><span class="field-val">${messagingStatus.email_configured?'✅ Connected':'⚠ Not connected'}</span></div>
    <div class="field-row"><span class="field-label">SMS</span><span class="field-val">${messagingStatus.sms_configured?'✅ Connected':'⚠ Not connected'}</span></div>
    ${(!messagingStatus.email_configured||!messagingStatus.sms_configured)?`<div style="font-size:12px;color:var(--text-secondary);margin:var(--space-2) 0">Connecting a provider needs an API key added in Supabase — that's a one-time setup step, ask to have it finished once you have your Resend/Twilio credentials.</div>`:''}
    <div style="margin-top:var(--space-4)">
      <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;font-weight:600;margin-bottom:var(--space-2)"><input type="checkbox" id="msg-confirm" ${messagingSettings.send_booking_confirmation?'checked':''}> Send booking confirmation email when a job is booked</label>
      <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;font-weight:600"><input type="checkbox" id="msg-reminder" ${messagingSettings.send_booking_reminder?'checked':''}> Send a reminder email the day before a booking</label>
    </div>
    <div class="form-actions" style="justify-content:flex-start;margin-top:var(--space-3)">
      <button class="btn-primary" onclick="saveMessagingSettings()">Save</button>
    </div>
  </div>`;
  main.innerHTML=h;
}

async function loadXeroAccounts(){
  try{
    const {data,error}=await sb.from('desk_xero_accounts').select('*').order('code');
    if(error)throw error;
    xeroAccounts=data||[];
  }catch(e){xeroAccounts=[];showToast('Could not load Xero accounts')}
}

function openXeroAccountModal(id){
  const a=id?xeroAccounts.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${a?'Edit Xero account':'New Xero account'}</div>
      <label class="form-label">Code *</label>
      <input class="form-input" id="xa-code" value="${a?esc(a.code):''}" placeholder="e.g. 200">
      <label class="form-label">Name *</label>
      <input class="form-input" id="xa-name" value="${a?esc(a.name):''}" placeholder="e.g. Sales">
      <label class="form-label">Type</label>
      <select class="form-select" id="xa-type">
        <option value="income" ${a&&a.account_type==='income'?'selected':''}>Income (used on invoice lines)</option>
        <option value="expense" ${a&&a.account_type==='expense'?'selected':''}>Expense</option>
        <option value="bank" ${a&&a.account_type==='bank'?'selected':''}>Bank (used for payment mapping)</option>
      </select>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveXeroAccount(${a?`'${a.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('xa-code').focus();
}

async function saveXeroAccount(id){
  const code=document.getElementById('xa-code').value.trim();
  const name=document.getElementById('xa-name').value.trim();
  if(!code||!name){showToast('Code and name are required');return}
  const payload={code,name,account_type:document.getElementById('xa-type').value};
  try{
    if(id){
      const {error}=await sb.from('desk_xero_accounts').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_xero_accounts').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Account updated':'Account added');
    await loadXeroAccounts();
    renderSettingsPage();
  }catch(e){showToast(e.code==='23505'?'⚠ That code already exists':'⚠ Save failed')}
}

async function toggleXeroAccountActive(id,active){
  try{
    const {error}=await sb.from('desk_xero_accounts').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadXeroAccounts();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

// desk_settings.value is a text column, not jsonb — object values come
// back as a raw JSON string and need parsing (plain-string values like
// invoice_template don't hit this, they round-trip as-is).
function parseSettingValue(v){
  if(typeof v!=='string')return v;
  try{return JSON.parse(v)}catch(e){return v}
}

async function loadXeroPaymentAccountMap(){
  try{
    const {data,error}=await sb.from('desk_settings').select('value').eq('key','xero_payment_accounts').maybeSingle();
    if(error)throw error;
    xeroPaymentAccountMap=parseSettingValue(data?.value)||{cash:'',eftpos:'',afterpay:'',zippay:'',amex:'',bank_transfer:'',other:''};
  }catch(e){xeroPaymentAccountMap={cash:'',eftpos:'',afterpay:'',zippay:'',amex:'',bank_transfer:'',other:''}}
}

async function saveDiaryHours(){
  const start=document.getElementById('dh-start').value;
  const end=document.getElementById('dh-end').value;
  if(!start||!end){showToast('Set both times');return}
  if(hhmmToHours(end)<=hhmmToHours(start)){showToast('Closing time must be after opening time');return}
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'diary_hours',value:{start,end},updated_at:new Date().toISOString()});
    if(error)throw error;
    DAY_VIEW_START_HOUR=hhmmToHours(start);
    DAY_VIEW_END_HOUR=hhmmToHours(end);
    showToast('Diary hours saved');
  }catch(e){showToast('Could not save')}
}

async function savePaymentAccountMap(){
  const map={};
  selectablePaymentMethods().forEach(m=>{map[m]=document.getElementById('xpam-'+m).value||''});
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'xero_payment_accounts',value:map,updated_at:new Date().toISOString()});
    if(error)throw error;
    xeroPaymentAccountMap=map;
    showToast('Mapping saved');
  }catch(e){showToast('Could not save mapping')}
}

function openServiceTypeModal(id){
  const st=id?serviceTypes.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${st?'Edit service type':'New service type'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="st-name" value="${st?esc(st.name):''}" placeholder="e.g. Standard Service">
      <label class="form-label">Interval (months)</label>
      <input class="form-input" type="number" id="st-months" value="${st&&st.interval_months?st.interval_months:''}" placeholder="e.g. 6">
      <label class="form-label">Interval (km)</label>
      <input class="form-input" type="number" id="st-km" value="${st&&st.interval_km?st.interval_km:''}" placeholder="e.g. 10000">
      <div style="font-size:12px;color:var(--text-secondary);margin:calc(var(--space-1) * -1) 0 var(--space-3)">Set either, or both — whichever gets set here auto-fills the reminder date/odometer when a job is finished.</div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveServiceType(${st?`'${st.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('st-name').focus();
}

async function saveServiceType(id){
  const name=document.getElementById('st-name').value.trim();
  if(!name){showToast('Name is required');return}
  const monthsRaw=document.getElementById('st-months').value;
  const kmRaw=document.getElementById('st-km').value;
  const payload={
    name,
    interval_months:monthsRaw?parseInt(monthsRaw,10):null,
    interval_km:kmRaw?parseInt(kmRaw,10):null
  };
  try{
    if(id){
      const {error}=await sb.from('desk_service_types').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_service_types').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Service type updated':'Service type added');
    await loadServiceTypes();
    renderSettingsPage();
  }catch(e){showToast('Save failed')}
}

async function toggleServiceTypeActive(id,active){
  try{
    const {error}=await sb.from('desk_service_types').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadServiceTypes();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

function openJobTypeModal(id){
  const t=id?jobTypes.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${t?'Edit job type':'New job type'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="jt-name" value="${t?esc(t.name):''}" placeholder="e.g. Tyre Fitting">
      <label class="form-label">Service interval (months)</label>
      <input class="form-input" type="number" id="jt-months" value="${t&&t.interval_months?t.interval_months:''}" placeholder="e.g. 6">
      <label class="form-label">Service interval (km)</label>
      <input class="form-input" type="number" id="jt-km" value="${t&&t.interval_km?t.interval_km:''}" placeholder="e.g. 10000">
      <div style="font-size:12px;color:var(--text-secondary);margin:calc(var(--space-1) * -1) 0 var(--space-3)">Set either, or both — jobs of this type will suggest this interval when finished, and land on the Service due tab.</div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveJobType(${t?`'${t.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('jt-name').focus();
}

async function saveJobType(id){
  const name=document.getElementById('jt-name').value.trim();
  if(!name){showToast('Name is required');return}
  const monthsRaw=document.getElementById('jt-months').value;
  const kmRaw=document.getElementById('jt-km').value;
  const payload={
    name,
    interval_months:monthsRaw?parseInt(monthsRaw,10):null,
    interval_km:kmRaw?parseInt(kmRaw,10):null
  };
  try{
    if(id){
      const {error}=await sb.from('desk_job_types').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_job_types').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Job type updated':'Job type added');
    await loadJobTypes();
    renderSettingsPage();
  }catch(e){showToast('Save failed — name may already exist')}
}

async function toggleJobTypeActive(id,active){
  try{
    const {error}=await sb.from('desk_job_types').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadJobTypes();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

// ── Tracked Tyre Sizes (Supplier Stock scraper config) ───────
let trackedTyreSizes=[];
async function loadTrackedTyreSizes(){
  try{
    const {data,error}=await sb.from('desk_tracked_tyre_sizes').select('*');
    if(error)throw error;
    trackedTyreSizes=data||[];
  }catch(e){trackedTyreSizes=[];showToast('Could not load tracked tyre sizes')}
}

function openTrackedTyreSizeModal(id){
  const s=id?trackedTyreSizes.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${s?'Edit tracked size':'New tracked size'}</div>
      <label class="form-label">Size code <span style="font-weight:400;color:var(--text-secondary);text-transform:none;letter-spacing:0">— digits only, as typed into a supplier search, e.g. 2055516</span></label>
      <input class="form-input" id="tts-code" value="${s?esc(s.size_code):''}" placeholder="2055516">
      <label class="form-label">Label <span style="font-weight:400;color:var(--text-secondary);text-transform:none;letter-spacing:0">— shown in DHF Desk, e.g. 205/55R16</span></label>
      <input class="form-input" id="tts-label" value="${s?esc(s.label||''):''}" placeholder="205/55R16">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveTrackedTyreSize(${s?`'${s.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('tts-code').focus();
}

async function saveTrackedTyreSize(id){
  const size_code=document.getElementById('tts-code').value.trim().replace(/[^0-9]/g,'');
  const label=document.getElementById('tts-label').value.trim()||null;
  if(!size_code){showToast('Size code is required');return}
  try{
    if(id){
      const {error}=await sb.from('desk_tracked_tyre_sizes').update({size_code,label}).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_tracked_tyre_sizes').insert({size_code,label});
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Size updated':'Size added');
    await loadTrackedTyreSizes();
    renderSettingsPage();
  }catch(e){showToast('Save failed — size code may already exist')}
}

async function toggleTrackedTyreSizeActive(id,active){
  try{
    const {error}=await sb.from('desk_tracked_tyre_sizes').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadTrackedTyreSizes();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

function openJobSourceModal(id){
  const s=id?jobSources.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${s?'Edit source':'New source'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="js-name" value="${s?esc(s.name):''}" placeholder="e.g. Meta Ads">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveJobSource(${s?`'${s.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('js-name').focus();
}

async function saveJobSource(id){
  const name=document.getElementById('js-name').value.trim();
  if(!name){showToast('Name is required');return}
  try{
    if(id){
      const {error}=await sb.from('desk_job_sources').update({name}).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_job_sources').insert({name});
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Source updated':'Source added');
    await loadJobSources();
    renderSettingsPage();
  }catch(e){showToast('Save failed — name may already exist')}
}

async function toggleJobSourceActive(id,active){
  try{
    const {error}=await sb.from('desk_job_sources').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadJobSources();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

// ── Employees (Settings panel + used by Timesheets/Reports) ──
async function loadEmployees(){
  try{
    const {data,error}=await sb.from('desk_employees').select('*').order('name');
    if(error)throw error;
    employees=data||[];
  }catch(e){employees=[];showToast('Could not load employees')}
}

function openEmployeeModal(id){
  const e=id?employees.find(x=>x.id===id):null;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${e?'Edit employee':'New employee'}</div>
      <label class="form-label">Name *</label>
      <input class="form-input" id="ef-name" value="${e?esc(e.name):''}">
      <label class="form-label">Email</label>
      <input class="form-input" id="ef-email" value="${e?esc(e.email||''):''}">
      <label class="form-label">Mobile</label>
      <input class="form-input" id="ef-mobile" value="${e?esc(e.mobile||''):''}">
      <label class="form-label">Role</label>
      <input class="form-input" id="ef-role" value="${e?esc(e.role||''):''}" placeholder="e.g. Mechanic, Tyre Fitter">
      <label class="form-label">Hourly cost (what they cost you)</label>
      <input class="form-input" type="number" step="0.01" id="ef-cost" value="${e&&e.hourly_cost?e.hourly_cost:''}">
      <label class="form-label">Charge-out rate (what you bill at)</label>
      <input class="form-input" type="number" step="0.01" id="ef-rate" value="${e&&e.charge_out_rate?e.charge_out_rate:''}">
      <label class="form-label">Commission rate (%)</label>
      <input class="form-input" type="number" step="0.01" id="ef-comm" value="${e&&e.commission_rate?e.commission_rate:''}">
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveEmployee(${e?`'${e.id}'`:'null'})">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('ef-name').focus();
}

async function saveEmployee(id){
  const name=document.getElementById('ef-name').value.trim();
  if(!name){showToast('Name is required');return}
  const num=v=>v?parseFloat(v):null;
  const payload={
    name,
    email:document.getElementById('ef-email').value.trim()||null,
    mobile:document.getElementById('ef-mobile').value.trim()||null,
    role:document.getElementById('ef-role').value.trim()||null,
    hourly_cost:num(document.getElementById('ef-cost').value),
    charge_out_rate:num(document.getElementById('ef-rate').value),
    commission_rate:num(document.getElementById('ef-comm').value)
  };
  try{
    if(id){
      const {error}=await sb.from('desk_employees').update(payload).eq('id',id);
      if(error)throw error;
    }else{
      const {error}=await sb.from('desk_employees').insert(payload);
      if(error)throw error;
    }
    closeModal();
    showToast(id?'Employee updated':'Employee added');
    await loadEmployees();
    renderSettingsPage();
  }catch(e){showToast('Save failed')}
}

async function toggleEmployeeActive(id,active){
  try{
    const {error}=await sb.from('desk_employees').update({is_active:active}).eq('id',id);
    if(error)throw error;
    await loadEmployees();
    renderSettingsPage();
  }catch(e){showToast('Could not update')}
}

async function selectInvoiceTemplate(t){
  invoiceTemplate=t;
  renderSettingsPage();
  try{
    const {error}=await sb.from('desk_settings').upsert({key:'invoice_template',value:t,updated_at:new Date().toISOString()});
    if(error)throw error;
    showToast('Template saved');
  }catch(e){showToast('Could not save template')}
}

async function loadJobs(){
  try{
    const {data,error}=await sb.from('desk_jobs')
      .select('*,customer:desk_customers(name,mobile,phone),vehicle:desk_vehicles(rego,make,model)')
      .eq('is_deleted',false)
      .order('booked_at',{ascending:true,nullsFirst:false});
    if(error)throw error;
    jobs=data||[];
  }catch(e){jobs=[];showToast('Could not load jobs')}
  await loadTags();
  await loadJobTagsMap();
  await loadJobNotesMap();
}

async function loadTags(){
  try{
    const {data,error}=await sb.from('desk_tags').select('*').order('name');
    if(error)throw error;
    allTags=data||[];
  }catch(e){allTags=[]}
}

async function loadJobTagsMap(){
  jobTagsMap={};
  try{
    const {data,error}=await sb.from('desk_job_tags').select('job_id,tag:desk_tags(id,name,color)');
    if(error)throw error;
    (data||[]).forEach(row=>{
      if(!row.tag)return;
      if(!jobTagsMap[row.job_id])jobTagsMap[row.job_id]=[];
      jobTagsMap[row.job_id].push(row.tag);
    });
  }catch(e){}
}

// Bulk-loaded so the Diary can show a note preview (e.g. tyre size/brand)
// right on the card — office-only notes included, since Diary is staff-only.
async function loadJobNotesMap(){
  jobNotesMap={};
  try{
    const {data,error}=await sb.from('desk_job_notes').select('job_id,body,created_at,is_office_only').order('created_at');
    if(error)throw error;
    (data||[]).forEach(row=>{
      if(!jobNotesMap[row.job_id])jobNotesMap[row.job_id]=[];
      jobNotesMap[row.job_id].push(row);
    });
  }catch(e){}
}

async function addJobTag(jobId,tagId){
  try{
    const {error}=await sb.from('desk_job_tags').insert({job_id:jobId,tag_id:tagId});
    if(error)throw error;
    await loadJobTagsMap();
    await renderJobDetail(jobId);
  }catch(e){showToast('Could not add tag')}
}

async function removeJobTag(jobId,tagId){
  try{
    const {error}=await sb.from('desk_job_tags').delete().eq('job_id',jobId).eq('tag_id',tagId);
    if(error)throw error;
    await loadJobTagsMap();
    await renderJobDetail(jobId);
  }catch(e){showToast('Could not remove tag')}
}

async function createAndAddTag(jobId){
  const nameEl=document.getElementById('tag-new-name');
  const colorEl=document.getElementById('tag-new-color');
  const name=nameEl.value.trim();
  if(!name){showToast('Tag name is required');return}
  const color=colorEl.value;
  try{
    let tagId;
    const {data,error}=await sb.from('desk_tags').insert({name,color}).select();
    if(error){
      if(error.code==='23505'){ // already exists — reuse it
        const {data:existing}=await sb.from('desk_tags').select('id').eq('name',name).single();
        if(!existing)throw error;
        tagId=existing.id;
      }else throw error;
    }else{
      tagId=data[0].id;
    }
    await loadTags();
    await addJobTag(jobId,tagId);
    toggleTagPicker(jobId,true);
  }catch(e){showToast('Could not create tag')}
}

function toggleTagPicker(jobId,forceClose){
  const el=document.getElementById('tag-picker-area');
  if(!el)return;
  if(forceClose||el.innerHTML.trim()){el.innerHTML='';return}
  const current=(jobTagsMap[jobId]||[]).map(t=>t.id);
  const available=allTags.filter(t=>!current.includes(t.id));
  el.innerHTML=`<div class="tag-picker">
    ${available.length?`<div class="tag-picker-existing">${available.map(t=>`<div class="tag-option" onclick="addJobTag('${jobId}','${t.id}')"><span class="tag-dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</div>`).join('')}</div>`:''}
    <div class="tag-create-row">
      <input type="text" id="tag-new-name" placeholder="New tag name">
      <input type="color" id="tag-new-color" value="#1877f2">
      <button class="btn-primary" onclick="createAndAddTag('${jobId}')">Add</button>
    </div>
  </div>`;
}

function renderTagsSection(jobId){
  const tags=jobTagsMap[jobId]||[];
  return `<div class="tag-section">
    <div class="panel-head"><div class="panel-title" style="font-size:13px">Tags</div><button class="btn-link" onclick="toggleTagPicker('${jobId}')">+ Add tag</button></div>
    <div class="tag-list">${tags.length?tags.map(t=>`<span class="tag-chip" style="background:${esc(t.color)}">${esc(t.name)}<button onclick="removeJobTag('${jobId}','${t.id}')">✕</button></span>`).join(''):'<span style="font-size:12px;color:var(--text-secondary)">No tags yet</span>'}</div>
    <div id="tag-picker-area"></div>
  </div>`;
}

async function renderJobsView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  if(!customers.length) await loadCustomers();
  await loadJobs();
  if(selectedJobId){await renderJobDetail(selectedJobId)}else{renderJobList()}
}

function filteredJobs(){
  let list=jobs;
  if(jobStatusFilter==='active') list=list.filter(j=>j.status!=='finished');
  else if(jobStatusFilter==='finished') list=list.filter(j=>j.status==='finished');
  const term=jobSearchTerm.toLowerCase();
  if(term) list=list.filter(j=>[j.job_type,j.customer?.name,j.vehicle?.rego,j.vehicle?.make,j.vehicle?.model].join(' ').toLowerCase().includes(term));
  return list;
}

function fmtDateTime(iso){
  return iso?new Date(iso).toLocaleString('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):null;
}

function renderJobList(){
  const main=document.getElementById('main');
  main.classList.remove('full-width');
  let h=`<div class="status-tabs">
    <button class="status-tab ${jobStatusFilter==='active'?'active':''}" onclick="setJobFilter('active')">Active</button>
    <button class="status-tab ${jobStatusFilter==='finished'?'active':''}" onclick="setJobFilter('finished')">Finished</button>
    <button class="status-tab ${jobStatusFilter==='all'?'active':''}" onclick="setJobFilter('all')">All</button>
    <button class="status-tab ${jobStatusFilter==='deleted'?'active':''}" onclick="setJobFilter('deleted')">Deleted</button>
    <button class="status-tab ${jobStatusFilter==='followups'?'active':''}" onclick="setJobFilter('followups')">Follow Ups</button>
  </div>`;

  if(jobStatusFilter==='followups'){
    h+=followUpsPageHtml();
    main.innerHTML=h;
    return;
  }

  if(jobStatusFilter==='deleted'){
    h+='<div class="list-card">';
    if(!deletedJobs.length){
      h+='<div class="list-empty">No deleted jobs.</div>';
    }else{
      deletedJobs.forEach(j=>{
        h+=`<div class="list-row" style="cursor:default">
          <div class="job-row-main">
            <div class="job-row-type">${esc(j.job_type)}</div>
            <div class="job-row-sub">${esc(j.customer?.name||'Unknown customer')}${j.vehicle?.rego?' · '+esc(j.vehicle.rego):''}</div>
            <div class="job-row-sub" style="color:var(--danger)">Reason: ${esc(j.delete_reason||'—')}</div>
          </div>
          <div class="list-row-sub">${j.deleted_at?fmtDateTime(j.deleted_at):'—'}${j.deleted_by?' · '+esc(j.deleted_by):''}</div>
        </div>`;
      });
    }
    h+='</div>';
    main.innerHTML=h;
    return;
  }

  const list=filteredJobs();
  h+=`<div class="toolbar">
    <input class="search-input" id="job-search" placeholder="Search jobs by type, customer, rego…" value="${esc(jobSearchTerm)}" oninput="onJobSearch(this.value)">
    <button class="btn-primary" onclick="openNewJobModal()">+ New Job</button>
  </div>`;
  if(!list.length){
    h+=`<div class="list-card"><div class="list-empty">${jobs.length?'No jobs match.':'No jobs yet — create your first one.'}</div></div>`;
  }else{
    h+='<div class="list-card">';
    list.forEach(j=>{
      const when=fmtDateTime(j.booked_at)||'No time set';
      h+=`<div class="list-row job-row" onclick="openJob('${j.id}')">
        <div class="job-row-main">
          <div class="job-row-type">${esc(j.job_type)}</div>
          <div class="job-row-sub">${esc(j.customer?.name||'Unknown customer')}${j.vehicle?.rego?' · '+esc(j.vehicle.rego):''}${divisionBayTag(j)?' · '+esc(divisionBayTag(j)):''}</div>
        </div>
        <div class="list-row-sub">${when}</div>
        <span class="status-badge ${j.status}">${JOB_STATUS_LABELS[j.status]}</span>
      </div>`;
    });
    h+='</div>';
  }
  main.innerHTML=h;
}

let deletedJobs=[];
async function loadDeletedJobs(){
  try{
    const {data,error}=await sb.from('desk_jobs').select('*,customer:desk_customers(name),vehicle:desk_vehicles(rego,make,model)').eq('is_deleted',true).order('deleted_at',{ascending:false});
    if(error)throw error;
    deletedJobs=data||[];
  }catch(e){deletedJobs=[];showToast('Could not load deleted jobs')}
}

async function setJobFilter(f){
  jobStatusFilter=f;
  if(f==='deleted')await loadDeletedJobs();
  if(f==='followups')await loadFollowUps();
  renderJobList();
}

// ── Follow Ups (manual per-job/customer scheduled callback queue,
// distinct from the automatic service-due reminders) ──────────
async function loadFollowUps(){
  try{
    const {data,error}=await sb.from('desk_follow_ups')
      .select('*,customer:desk_customers(name,mobile,phone,email),job:desk_jobs(job_type),messages:desk_messages(id,channel,status)')
      .order('due_date',{ascending:true,nullsFirst:false})
      .order('created_at',{ascending:false});
    if(error)throw error;
    followUps=data||[];
  }catch(e){followUps=[];showToast('Could not load follow ups')}
}

function followUpsPageHtml(){
  const scheduled=followUps.filter(f=>f.status==='scheduled');
  const processed=followUps.filter(f=>f.status==='processed');
  const row=(f,isScheduled)=>{
    const sent=(f.messages||[]).filter(m=>m.status==='sent');
    const msgBadge=sent.length?`<span class="status-badge finished" title="${sent.length} message(s) sent">Sent</span>`:((f.messages||[]).length?`<span class="status-badge failed" title="Send attempted but failed">Not delivered</span>`:'');
    return `
    <div class="list-row" style="cursor:default;align-items:flex-start">
      <div class="job-row-main">
        <div class="job-row-type">${esc(f.customer?.name||'Unknown customer')} ${msgBadge}</div>
        <div class="job-row-sub">${f.due_date?fmtDate(f.due_date):'No due date'}${f.job?' · '+esc(f.job.job_type):''}</div>
        <div style="font-size:13px;margin-top:var(--space-1)">${esc(f.note)}</div>
        ${!isScheduled&&f.processed_at?`<div class="job-row-sub" style="margin-top:var(--space-1)">Processed ${fmtDateTime(f.processed_at)}${f.processed_by?' · '+esc(f.processed_by):''}</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);align-items:flex-end">
        ${f.job_id?`<span class="btn-link" onclick="quickSearchGoJob('${f.job_id}')">Open job</span>`:''}
        ${f.customer?.email?`<span class="btn-link" onclick="emailFollowUp('${f.id}')">Email</span>`:''}
        ${f.customer?.mobile?`<span class="btn-link" onclick="smsFollowUp('${f.id}')">SMS</span>`:''}
        <span class="btn-link" onclick="openReviewModal('${f.job_id||''}','${f.customer_id}')">Log Review</span>
        ${isScheduled?`<span class="btn-link" onclick="markFollowUpProcessed('${f.id}')">Mark processed</span>`:''}
        <span class="btn-danger-link" onclick="deleteFollowUp('${f.id}')">Delete</span>
      </div>
    </div>`;
  };
  return `<div class="toolbar">
      <div style="flex:1"></div>
      <button class="btn-primary" onclick="openFollowUpModal()">+ Add Follow Up</button>
    </div>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-title" style="margin-bottom:var(--space-3)">Scheduled Follow Ups</div>
        <div class="list-card">${scheduled.length?scheduled.map(f=>row(f,true)).join(''):'<div class="list-empty">Nothing scheduled.</div>'}</div>
      </div>
      <div class="panel">
        <div class="panel-title" style="margin-bottom:var(--space-3)">Processed Follow Ups</div>
        <div class="list-card">${processed.length?processed.map(f=>row(f,false)).join(''):'<div class="list-empty">None processed yet.</div>'}</div>
      </div>
    </div>`;
}

function openFollowUpModal(prefill){
  prefill=prefill||{};
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Add Follow Up</div>
      <div class="autocomplete">
        <label class="form-label">Customer *</label>
        <input class="form-input" id="fu-customer-search" placeholder="Search customer…" value="${prefill.customerName?esc(prefill.customerName):''}" oninput="onFollowUpCustomerSearch(this.value)" autocomplete="off">
        <div id="fu-customer-results"></div>
      </div>
      <label class="form-label">Due date</label>
      <input class="form-input" type="date" id="fu-due-date" value="${prefill.dueDate||''}">
      <label class="form-label">Note *</label>
      <textarea class="form-textarea" id="fu-note" placeholder="e.g. Call back about the wheel bearing quote">${prefill.note?esc(prefill.note):''}</textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveFollowUp('${prefill.jobId||''}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  followUpCustomerId=prefill.customerId||null;
  if(prefill.customerId)document.getElementById('fu-customer-search').disabled=true;
  else document.getElementById('fu-customer-search').focus();
}

let followUpCustomerId=null;
function onFollowUpCustomerSearch(term){
  const t=term.trim().toLowerCase();
  const results=document.getElementById('fu-customer-results');
  followUpCustomerId=null;
  if(!t){results.innerHTML='';return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(t)).slice(0,8);
  results.innerHTML=matches.length?matches.map(c=>`<div class="autocomplete-item" onclick="selectFollowUpCustomer('${c.id}','${esc(c.name).replace(/'/g,"\\'")}')">${esc(c.name)}${c.mobile?' · '+esc(c.mobile):''}</div>`).join(''):'<div class="autocomplete-item" style="color:var(--text-secondary)">No matching customer</div>';
}
function selectFollowUpCustomer(id,name){
  followUpCustomerId=id;
  document.getElementById('fu-customer-search').value=name;
  document.getElementById('fu-customer-results').innerHTML='';
}

async function saveFollowUp(jobId){
  const note=document.getElementById('fu-note').value.trim();
  const dueDate=document.getElementById('fu-due-date').value||null;
  if(!followUpCustomerId){showToast('Pick a customer');return}
  if(!note){showToast('Enter a note');return}
  try{
    const {error}=await sb.from('desk_follow_ups').insert({customer_id:followUpCustomerId,job_id:jobId||null,note,due_date:dueDate,created_by:currentUser?.email||null});
    if(error)throw error;
    closeModal();
    showToast('Follow up added');
    if(jobStatusFilter==='followups'){await loadFollowUps();renderJobList()}
  }catch(e){showToast('Could not save')}
}

async function markFollowUpProcessed(id){
  try{
    const {error}=await sb.from('desk_follow_ups').update({status:'processed',processed_at:new Date().toISOString(),processed_by:currentUser?.email||null}).eq('id',id);
    if(error)throw error;
    await loadFollowUps();
    renderJobList();
  }catch(e){showToast('Could not update')}
}

async function deleteFollowUp(id){
  try{
    const {error}=await sb.from('desk_follow_ups').delete().eq('id',id);
    if(error)throw error;
    await loadFollowUps();
    renderJobList();
  }catch(e){showToast('Could not delete')}
}

function emailFollowUp(id){
  const f=followUps.find(x=>x.id===id);
  if(!f)return;
  const subject=`Following up — DHF Tyres`;
  const body=`Hi ${f.customer?.name||'there'},\n\n${f.note}\n\nLet us know if you have any questions.`;
  openComposeModal('email',{customerId:f.customer_id,jobId:f.job_id,followUpId:f.id,email:f.customer?.email,mobile:f.customer?.mobile,subject,body});
}

function smsFollowUp(id){
  const f=followUps.find(x=>x.id===id);
  if(!f)return;
  const smsBody=`Hi ${f.customer?.name||'there'}, this is DHF Tyres. ${f.note}`;
  openComposeModal('sms',{customerId:f.customer_id,jobId:f.job_id,followUpId:f.id,email:f.customer?.email,mobile:f.customer?.mobile,smsBody});
}

function onJobSearch(v){
  jobSearchTerm=v;renderJobList();
  setTimeout(()=>{const i=document.getElementById('job-search');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},0);
}

let jobDetailReturnView='jobs';
async function openJob(id){selectedJobId=id;jobDetailReturnView='jobs';jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;await renderJobDetail(id)}
async function openJobFromDiary(id){selectedJobId=id;jobDetailReturnView='diary';jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;await renderJobDetail(id)}
function backFromJobDetail(){
  selectedJobId=null;
  jobInvoicePanelJobId=null;
  jobInvoicePanelInvoiceId=null;
  if(jobDetailReturnView==='diary'){renderDiaryView()}else{renderJobList()}
}

async function loadJobNotes(jobId){
  try{
    const {data,error}=await sb.from('desk_job_notes').select('*').eq('job_id',jobId).order('created_at');
    if(error)throw error;
    jobNotes=data||[];
  }catch(e){jobNotes=[]}
}

// The inline quote/invoice card — a THIRD column in .detail-grid, not a
// block stacked underneath. Deliberately NOT wrapped in another .panel:
// buildInvoicePanelHtml already returns one (shared with the standalone
// Invoices tab), and nesting .panel inside .panel doubles the border/shadow
// (same class of bug as list-card-inside-panel, see redesign-checklist
// history). The .job-invoice-slot / #job-invoice-panel-content ids are what
// openInvoiceInJob/closeJobInvoicePanel/refreshJobInvoicePanelContent target
// for surgical (non-full-page-swap) updates — see those functions for why.
function jobInvoiceSlotHtml(panelHtml,jobId){
  return `<div class="job-invoice-slot" id="job-invoice-slot">
    <button class="back-link" style="margin-bottom:var(--space-3)" onclick="closeJobInvoicePanel('${jobId}')">✕ Close</button>
    <div id="job-invoice-panel-content">${panelHtml}</div>
  </div>`;
}

async function renderJobDetail(id){
  const main=document.getElementById('main');
  if(!Object.keys(jobLegsMap).length)await loadJobLegsMap();
  if(!jobSources.length)await loadJobSources();
  await loadJobNotes(id);
  const relatedInvoices=await loadJobInvoices(id);
  const j=jobs.find(x=>x.id===id);
  if(!j){selectedJobId=null;renderJobList();return}
  // Full-page (re)render always reflects current state correctly, including
  // the invoice panel if one's open (e.g. the user edited an unrelated job
  // field while it was showing) — but the animated, non-flickering slide-in
  // only happens via the surgical path in openInvoiceInJob, since a fresh
  // innerHTML swap recreates every node at once with nothing to transition
  // from. This path is the static/settled-state fallback, not the interaction.
  let inlineInvoicePanel='';
  if(jobInvoicePanelJobId===id&&jobInvoicePanelInvoiceId){
    const panelHtml=await buildInvoicePanelHtml(jobInvoicePanelInvoiceId);
    if(panelHtml===null){
      jobInvoicePanelJobId=null;jobInvoicePanelInvoiceId=null;
    }else{
      inlineInvoicePanel=jobInvoiceSlotHtml(panelHtml,j.id);
    }
  }
  const backLabel=jobDetailReturnView==='diary'?'← Diary':'← All jobs';
  const when=fmtDateTime(j.booked_at)||'Not set';
  const pickup=fmtDateTime(j.pickup_at)||'Not set';
  let h=`<button class="back-link" onclick="backFromJobDetail()">${backLabel}</button>
  <div class="detail-grid" id="job-detail-grid">
    <div class="panel">
      <div class="panel-head"><div class="panel-title">${esc(j.job_type)}</div><span class="status-badge ${j.status}">${JOB_STATUS_LABELS[j.status]}</span></div>
      <div class="job-status-actions">
        ${JOB_STATUS_ORDER.map(s=>`<button class="${s===j.status?'current':''}" ${s===j.status?'disabled':''} onclick="setJobStatus('${j.id}','${s}')">${JOB_STATUS_LABELS[s]}</button>`).join('')}
      </div>
      <label class="form-label">Customer status note <span style="font-weight:400;color:var(--text-secondary);text-transform:none;letter-spacing:0">— shown to the customer in the tracking portal, e.g. why a job is on hold</span></label>
      <input class="form-input" value="${esc(j.customer_status_note||'')}" placeholder="e.g. Waiting on brake pads — ETA Thursday" onchange="updateJobField('${j.id}','customer_status_note',this.value.trim()||null)">
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);flex-wrap:wrap">
        <button class="btn-secondary" onclick="printJobCard('${j.id}')">Print Job Card</button>
        <button class="btn-secondary" onclick="emailJobCard('${j.id}')">Email Job Card</button>
        <button class="btn-secondary" onclick="smsJobCard('${j.id}')">SMS</button>
        <button class="btn-secondary" onclick='openFollowUpModal({customerId:"${j.customer_id}",customerName:"${esc(j.customer?.name||"").replace(/"/g,"&quot;")}",jobId:"${j.id}"})'>Add Follow Up</button>
        <button class="btn-secondary" onclick="createDocFromJob('${j.id}','quote')">Create Quote</button>
        <button class="btn-secondary" onclick="createDocFromJob('${j.id}','invoice')">Create Invoice</button>
      </div>
      ${relatedInvoices.length?`<div style="margin-bottom:var(--space-4)"><div class="field-label" style="margin-bottom:var(--space-1)">Quotes &amp; Invoices</div>${relatedInvoices.map(inv=>`<span class="tag-option" style="margin-right:var(--space-2)" onclick="openInvoiceInJob('${inv.id}','${j.id}')">${docPrefix(inv.doc_type)}-${inv.invoice_no} <span class="status-badge ${inv.status}" style="margin-left:var(--space-1)">${DOC_STATUS_LABELS[inv.status]}</span></span>`).join('')}</div>`:''}
      <div class="field-row"><span class="field-label">Customer</span><span class="field-val">${esc(j.customer?.name||'—')}</span></div>
      <div class="field-row"><span class="field-label">Vehicle</span><span class="field-val">${j.vehicle?(esc(j.vehicle.make||'')+' '+esc(j.vehicle.model||'')+(j.vehicle.rego?' ('+esc(j.vehicle.rego)+')':'')):'Not set'}</span></div>
      <div class="field-row"><span class="field-label">Division</span><span class="field-val">${divisionLabel(j.division)||'—'}</span></div>
      <div class="field-row"><span class="field-label">Bay / Hoist</span><span class="field-val">${esc(j.bay||'—')}</span></div>
      ${(jobLegsMap[j.id]&&jobLegsMap[j.id].length>1)?`<div class="field-row"><span class="field-label">Hoist stops</span><span class="field-val">${getJobOccupations(j).map((o,i)=>`${i+1}. ${esc(divisionLabel(o.division))} · ${esc(o.bay)} (${o.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}–${o.end.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})})`).join('<br>')}</span></div>`:''}
      <div class="field-row"><span class="field-label">Booked</span><span class="field-val">${when}</span></div>
      <div class="field-row"><span class="field-label">Pickup</span><span class="field-val">${pickup}</span></div>
      <div class="field-row"><span class="field-label">Estimate</span><span class="field-val">${j.estimate_hours?j.estimate_hours+'h':'—'}</span></div>
      <div class="field-row"><span class="field-label">Odometer in</span><span class="field-val">${j.odometer_in?j.odometer_in.toLocaleString()+' km':'—'}</span></div>
      <div class="field-row"><span class="field-label">Mechanic</span><span class="field-val">${esc(j.assigned_mechanic||'—')}</span></div>
      <div class="field-row"><span class="field-label">Order no.${j.customer_id&&customers.find(c=>c.id===j.customer_id)?.requires_order_no?' <span style="color:var(--accent)">*</span>':''}</span><span class="field-val"><input style="width:140px;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary);text-align:right" value="${esc(j.order_no||'')}" placeholder="—" onchange="updateJobField('${j.id}','order_no',this.value.trim()||null)"></span></div>
      <div class="field-row"><span class="field-label">Estimated value</span><span class="field-val"><input type="number" step="0.01" style="width:100px;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary);text-align:right" value="${j.estimated_value!=null?j.estimated_value:''}" placeholder="$" onchange="updateJobField('${j.id}','estimated_value',this.value?parseFloat(this.value):null)"></span></div>
      <div class="field-row"><span class="field-label">Source</span><span class="field-val"><select style="padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary)" onchange="updateJobField('${j.id}','source_id',this.value||null)">
        <option value="">— Not set —</option>
        ${jobSources.map(s=>`<option value="${s.id}" ${j.source_id===s.id?'selected':''}>${esc(s.name)}${s.is_active?'':' (inactive)'}</option>`).join('')}
      </select></span></div>
      ${renderTagsSection(j.id)}
      <div style="margin-top:var(--space-4)"><button class="btn-danger-link" onclick="deleteJob('${j.id}')">Delete job</button></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Notes</div></div>
      <div class="notes-thread">
        ${jobNotes.length?jobNotes.map(n=>`
          <div class="note-item">
            <div class="note-meta">${n.author_type==='customer'?'<span class="note-customer-badge">Customer</span>':esc(n.author_email)} · ${fmtDateTime(n.created_at)}${n.is_office_only?' <span class="note-office-badge">Office only</span>':''}</div>
            <div>${esc(n.body)}</div>
          </div>`).join(''):'<div class="list-empty">No notes yet.</div>'}
      </div>
      <div class="note-checkbox-row"><input type="checkbox" id="note-office-only"><label for="note-office-only">Office only</label></div>
      <div class="note-input-row">
        <textarea class="form-textarea" id="note-body" placeholder="Add a note…" style="margin-bottom:0"></textarea>
        <button class="btn-primary" onclick="addJobNote('${j.id}')">Add</button>
      </div>
    </div>
    ${inlineInvoicePanel}
  </div>`;
  main.classList.add('full-width');
  main.innerHTML=h;
}

function jobShortRef(id){return id.slice(0,8).toUpperCase()}

// Office-only notes are internal by design — never include them in
// anything that leaves the building (print or email).
function buildJobCardHtml(j,notes,tags){
  const customerNotes=notes.filter(n=>!n.is_office_only);
  const vehDesc=j.vehicle?[j.vehicle.make,j.vehicle.model].filter(Boolean).join(' ')+(j.vehicle.rego?' ('+j.vehicle.rego+')':''):'';
  // PRINT PATH (window.open + print). A <style> block is fine here, but all
  // values are resolved literals from design-brief.md — this document must not
  // depend on index.html's :root.
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Job Card #${jobShortRef(j.id)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       font-size:15px;line-height:1.55;color:#0A0A0A;background:#FFFFFF;
       padding:32px;max-width:700px;margin:0 auto;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
  .eyebrow{font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;color:#6B6B70}
  h1{font-family:'Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
     font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.015em;color:#0A0A0A;margin:8px 0 0}
  .sub{font-size:15px;line-height:1.55;color:#6B6B70;margin:8px 0 32px}
  table{width:100%;border-collapse:collapse;margin-bottom:32px}
  td{padding:12px 0;font-size:15px;line-height:1.55;border-bottom:1px solid #E4E4E7;vertical-align:top}
  td.label{font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;
           color:#6B6B70;width:160px;padding-right:24px}
  .tag{display:inline-block;padding:2px 8px;border-radius:2px;color:#FFFFFF;font-size:12px;
       line-height:1.4;font-weight:500;letter-spacing:0.02em;margin-right:4px}
  .notes-head{font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0.02em;text-transform:uppercase;
              color:#6B6B70;border-bottom:1px solid #D1D1D6;padding-bottom:8px}
  .note{padding:12px 0;border-bottom:1px solid #E4E4E7;font-size:15px;line-height:1.55;color:#0A0A0A}
  .note-meta{font-size:13px;line-height:1.5;color:#6B6B70;margin-bottom:4px}
  .empty{font-size:15px;line-height:1.55;color:#6B6B70;padding:12px 0}
  @media print{body{padding:0}}
</style></head><body>
  <div class="eyebrow">DHF Tyres</div>
  <h1>Job card</h1>
  <div class="sub">Job #${jobShortRef(j.id)} &middot; ${new Date().toLocaleDateString('en-AU')}</div>
  <table>
    <tr><td class="label">Customer</td><td>${esc(j.customer?.name||'—')}</td></tr>
    <tr><td class="label">Contact</td><td>${esc(j.customer?.mobile||j.customer?.phone||'—')}</td></tr>
    <tr><td class="label">Vehicle</td><td>${esc(vehDesc||'—')}</td></tr>
    <tr><td class="label">Job type</td><td>${esc(j.job_type)}</td></tr>
    <tr><td class="label">Status</td><td>${JOB_STATUS_LABELS[j.status]}</td></tr>
    <tr><td class="label">Booked</td><td>${j.booked_at?fmtDateTime(j.booked_at):'—'}</td></tr>
    <tr><td class="label">Estimate</td><td>${j.estimate_hours?j.estimate_hours+'h':'—'}</td></tr>
    <tr><td class="label">Division</td><td>${esc(divisionLabel(j.division)||'—')}${j.bay?' &middot; '+esc(j.bay):''}</td></tr>
    <tr><td class="label">Mechanic</td><td>${esc(j.assigned_mechanic||'—')}</td></tr>
    ${tags.length?`<tr><td class="label">Tags</td><td>${tags.map(t=>`<span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}</td></tr>`:''}
  </table>
  <div class="notes-head">Notes</div>
  ${customerNotes.length?customerNotes.map(n=>`<div class="note"><div class="note-meta">${esc(n.author_email)} &middot; ${fmtDateTime(n.created_at)}</div>${esc(n.body)}</div>`).join(''):'<div class="empty">No notes recorded for this job.</div>'}
</body></html>`;
}

function printJobCard(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const tags=jobTagsMap[jobId]||[];
  const html=buildJobCardHtml(j,jobNotes,tags);
  const w=window.open('','_blank');
  if(!w){showToast('Pop-up blocked — allow pop-ups to print');return}
  w.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>Job card</title>
<style>body{margin:0;font-family:system-ui,sans-serif}.print-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;background:#1A2233;color:#fff}.print-toolbar-title{font-size:14px;font-weight:700}.print-toolbar-btn{font-family:inherit;font-size:14px;font-weight:600;padding:8px 20px;border:none;border-radius:999px;cursor:pointer;background:#fff;color:#1A2233}.print-toolbar-btn:hover{opacity:.9}@media print{.print-toolbar{display:none}}</style></head><body>
<div class="print-toolbar"><span class="print-toolbar-title">Job card — preview</span><button class="print-toolbar-btn" onclick="window.print()">Print</button></div>
${html}
</body></html>`);
  w.document.close();
  w.focus();
}

function emailJobCard(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const customerNotes=jobNotes.filter(n=>!n.is_office_only);
  const vehDesc=j.vehicle?[j.vehicle.make,j.vehicle.model].filter(Boolean).join(' ')+(j.vehicle.rego?' ('+j.vehicle.rego+')':''):'';
  const subject=`Job Card #${jobShortRef(j.id)} — ${j.job_type} — DHF Tyres`;
  let body=`Hi ${j.customer?.name||'there'},\n\nHere are the details for your job at DHF Tyres:\n\n`;
  if(vehDesc)body+=`Vehicle: ${vehDesc}\n`;
  body+=`Job Type: ${j.job_type}\n`;
  body+=`Status: ${JOB_STATUS_LABELS[j.status]}\n`;
  if(j.booked_at)body+=`Booked: ${fmtDateTime(j.booked_at)}\n`;
  if(customerNotes.length){
    body+='\nNotes:\n';
    customerNotes.forEach(n=>{body+='- '+n.body+'\n'});
  }
  body+=`\nIf you have any questions, just let us know.`;
  openComposeModal('email',{customerId:j.customer_id,jobId:j.id,email:j.customer?.email,mobile:j.customer?.mobile,subject,body});
}

function smsJobCard(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const smsBody=`Hi ${j.customer?.name||'there'}, this is DHF Tyres regarding your ${j.job_type} job${j.booked_at?' booked for '+fmtDateTime(j.booked_at):''}.`;
  openComposeModal('sms',{customerId:j.customer_id,jobId:j.id,email:j.customer?.email,mobile:j.customer?.mobile,smsBody});
}

async function addJobNote(jobId){
  const bodyEl=document.getElementById('note-body');
  const body=bodyEl.value.trim();
  if(!body)return;
  const isOffice=document.getElementById('note-office-only').checked;
  try{
    const {error}=await sb.from('desk_job_notes').insert({job_id:jobId,body,is_office_only:isOffice});
    if(error)throw error;
    await renderJobDetail(jobId);
  }catch(e){showToast('Could not add note')}
}

function deleteJob(id){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Delete Job</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-3)">This hides the job — it isn't permanently removed, and the reason is kept on record under Jobs → Deleted.</div>
      <label class="form-label">Reason *</label>
      <textarea class="form-textarea" id="dj-reason" placeholder="e.g. duplicate booking, customer cancelled, entered in error"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="confirmDeleteJob('${id}')">Delete Job</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('dj-reason').focus();
}

async function confirmDeleteJob(id){
  const reason=document.getElementById('dj-reason').value.trim();
  if(!reason){showToast('Enter a reason');return}
  try{
    const {error}=await sb.from('desk_jobs').update({is_deleted:true,delete_reason:reason,deleted_at:new Date().toISOString(),deleted_by:currentUser?.email||null,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
    closeModal();
    showToast('Job deleted');
    selectedJobId=null;
    await loadJobs();
    renderJobList();
  }catch(e){showToast('Could not delete job')}
}

// ── Reviews (logged manually — no live Google/FB pull, that would need
// its own OAuth integration like Xero, out of scope for now) ─────────
function openReviewModal(jobId,customerId){
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Log review</div>
      <label class="form-label">Rating</label>
      <select class="form-select" id="rv-rating">
        <option value="5">5 — Excellent</option>
        <option value="4">4 — Good</option>
        <option value="3">3 — Okay</option>
        <option value="2">2 — Poor</option>
        <option value="1">1 — Bad</option>
      </select>
      <label class="form-label">Comment</label>
      <textarea class="form-textarea" id="rv-comment"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveReview('${jobId}','${customerId||''}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveReview(jobId,customerId){
  const payload={
    job_id:jobId,
    customer_id:customerId||null,
    rating:parseInt(document.getElementById('rv-rating').value,10),
    comment:document.getElementById('rv-comment').value.trim()||null
  };
  try{
    const {error}=await sb.from('desk_reviews').insert(payload);
    if(error)throw error;
    closeModal();
    showToast('Review logged');
  }catch(e){showToast('Could not save review')}
}

// ── NEW JOB (inline pick-or-create customer/vehicle) ──────────
let jobTypes=[];
async function loadJobTypes(){
  try{
    const {data,error}=await sb.from('desk_job_types').select('*').order('name');
    if(error)throw error;
    jobTypes=data||[];
  }catch(e){jobTypes=[];showToast('Could not load job types')}
}

let jobSources=[];
async function loadJobSources(){
  try{
    const {data,error}=await sb.from('desk_job_sources').select('*').order('name');
    if(error)throw error;
    jobSources=data||[];
  }catch(e){jobSources=[];showToast('Could not load job sources')}
}

// job_id -> ordered array of desk_job_hoist_legs rows, for multi-stop jobs.
let jobLegsMap={};
async function loadJobLegsMap(){
  try{
    const {data,error}=await sb.from('desk_job_hoist_legs').select('*').order('sequence');
    if(error)throw error;
    const map={};
    (data||[]).forEach(l=>{(map[l.job_id]=map[l.job_id]||[]).push(l)});
    jobLegsMap=map;
  }catch(e){jobLegsMap={}}
}

function divisionLabel(d){return d==='tyre_shop'?'Tyre Shop':d==='workshop'?'Workshop':''}
function divisionBayTag(j){
  const dl=divisionLabel(j.division);
  return [dl,j.bay].filter(Boolean).join(' · ');
}

// ── Hoist scheduling (shared by New Job modal + Diary hoist day view) ──
const HOISTS=[
  {division:'tyre_shop',bay:'4 Post',label:'4 Post'},
  {division:'tyre_shop',bay:'2 Post',label:'2 Post'},
  {division:'tyre_shop',bay:'Belly',label:'Belly'},
  {division:'workshop',bay:'1',label:'Bay 1'},
  {division:'workshop',bay:'2',label:'Bay 2'},
  {division:'workshop',bay:'3',label:'Bay 3'},
  {division:'workshop',bay:'4',label:'Bay 4'}
];
// Jobs without an estimate still occupy the hoist for some minimum time —
// treat as 30 minutes so conflict-checking has something to work with.
function jobDurationHours(j){return j.estimate_hours?Number(j.estimate_hours):0.5}

// A job normally occupies one hoist for its whole duration, but a job with
// rows in desk_job_hoist_legs (multi-stop — e.g. tyres on 2 Post then
// alignment on 4 Post) occupies a *sequence* of hoists. Legs chain back-to-
// back from the job's booked_at by default; a leg with start_offset_hours
// set (from being dragged independently in the Hoist Day view) uses that
// explicit offset instead. Returns [] for jobs with no usable hoist slot.
function getJobOccupations(job){
  if(!job.booked_at)return [];
  const legs=jobLegsMap[job.id];
  if(legs&&legs.length){
    const bookedStart=new Date(job.booked_at);
    let cursor=new Date(bookedStart);
    return legs.map(l=>{
      const dur=Number(l.duration_hours)||0.5;
      const start=l.start_offset_hours!=null?new Date(bookedStart.getTime()+Number(l.start_offset_hours)*3600000):new Date(cursor);
      const end=new Date(start.getTime()+dur*3600000);
      cursor=end;
      return {leg:l,division:l.division,bay:l.bay,start,end};
    }).filter(o=>o.division&&o.bay);
  }
  if(!job.division||!job.bay)return [];
  const start=new Date(job.booked_at);
  return [{leg:null,division:job.division,bay:job.bay,start,end:new Date(start.getTime()+jobDurationHours(job)*3600000)}];
}

// exclude: {jobId} skips a whole (simple, no-leg) job — used when dragging
// it; {legId} skips just one stop of a multi-leg job, leaving that job's
// other stops still checked — used when dragging a single stop.
function findHoistConflict(division,bay,startDate,durationHours,exclude){
  if(!division||!bay||!startDate)return null;
  exclude=exclude||{};
  const start=startDate.getTime();
  const end=start+durationHours*3600000;
  for(const j of jobs){
    if(j.is_deleted||j.status==='finished')continue;
    if(exclude.jobId&&j.id===exclude.jobId)continue;
    for(const o of getJobOccupations(j)){
      if(exclude.legId&&o.leg&&o.leg.id===exclude.legId)continue;
      if(o.division!==division||o.bay!==bay)continue;
      const oStart=o.start.getTime(),oEnd=o.end.getTime();
      if(start<oEnd&&oStart<end)return {job:j,start:o.start,end:o.end,leg:o.leg};
    }
  }
  return null;
}

let newJobExtraLegs=[]; // additional hoist stops beyond stop 1 (nj-division/nj-bay/nj-estimate)

async function openNewJobModal(presetDateStr){
  if(!jobTypes.length)await loadJobTypes();
  if(!jobSources.length)await loadJobSources();
  if(!jobs.length)await loadJobs();
  if(!Object.keys(jobLegsMap).length)await loadJobLegsMap();
  if(!employees.length)await loadEmployees();
  newJobCustomerId=null;
  newJobCustomerName='';
  newJobVehicleId=null;
  newJobVehicles=[];
  newJobShowNewVehicleFields=false;
  newJobExtraLegs=[];
  newJobPresetDate=presetDateStr||null;
  const dateFieldHtml=newJobPresetDate?`
      <label class="form-label">Date</label>
      <div class="selected-chip" style="margin-bottom:var(--space-4)">${new Date(newJobPresetDate+'T00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'short',year:'numeric'})}</div>
      <label class="form-label">Time *</label>
      <input class="form-input" type="time" id="nj-time" value="09:00" onchange="onNewJobScheduleChange()">`:`
      <label class="form-label">Booked date/time</label>
      <input class="form-input" type="datetime-local" id="nj-booked" onchange="onNewJobScheduleChange()">`;
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card" id="new-job-modal">
      <div class="modal-title">New Job</div>
      <div id="new-job-customer-area">
        <label class="form-label">Customer *</label>
        <div class="autocomplete">
          <input class="form-input" id="nj-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewJobCustomerSearch(this.value)">
          <div id="nj-customer-results"></div>
        </div>
      </div>
      <div id="new-job-vehicle-area"></div>
      <div id="nj-order-area"></div>
      <label class="form-label">Division</label>
      <select class="form-select" id="nj-division" onchange="onNewJobDivisionChange(this.value)">
        <option value="">— Select —</option>
        <option value="tyre_shop">Tyre Shop</option>
        <option value="workshop">Workshop</option>
      </select>
      <div id="nj-bay-area"></div>
      <label class="form-label">Job type *</label>
      <select class="form-select" id="nj-type">
        <option value="">— Select —</option>
        ${jobTypes.filter(t=>t.is_active!==false).map(t=>`<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
      </select>
      <label class="form-label">Source</label>
      <select class="form-select" id="nj-source">
        <option value="">— Not set —</option>
        ${jobSources.filter(s=>s.is_active!==false).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select>
      ${dateFieldHtml}
      <label class="form-label">Estimate (hours)</label>
      <input class="form-input" type="number" step="0.25" id="nj-estimate" onchange="onNewJobScheduleChange()">
      <div id="nj-extra-legs"></div>
      <button type="button" class="btn-link" onclick="addNewJobLeg()">+ Add another hoist stop</button>
      <div style="font-size:var(--text-micro);color:var(--text-secondary);margin:var(--space-1) 0 var(--space-3)">If the car needs to move hoists partway through (e.g. tyres on 2 Post, then alignment on 4 Post), add each stop here — they're booked back-to-back starting from the time above.</div>
      <div id="nj-conflict-warning"></div>
      <label class="form-label">Assigned mechanic</label>
      <select class="form-select" id="nj-mechanic">
        <option value="">— Not set —</option>
        ${employees.filter(e=>e.is_active!==false).map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      </select>
      <label class="form-label">Estimated value ($)</label>
      <input class="form-input" type="number" step="0.01" id="nj-value" placeholder="e.g. 450">
      <div style="font-size:var(--text-micro);color:var(--text-secondary);margin:calc(var(--space-3) * -1) 0 var(--space-3)">Feeds the Sales Projection tab so the booked-in pipeline shows a real dollar figure — doesn't have to be exact, update it later if the quote changes.</div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveNewJob()">Create Job</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  renderNewJobOrderArea();
}

function onNewJobDivisionChange(v){
  const area=document.getElementById('nj-bay-area');
  if(v==='tyre_shop'){
    area.innerHTML=`<label class="form-label">Hoist</label><select class="form-select" id="nj-bay" onchange="onNewJobScheduleChange()"><option value="">— Select —</option><option>4 Post</option><option>2 Post</option><option>Belly</option></select>`;
  }else if(v==='workshop'){
    area.innerHTML=`<label class="form-label">Bay</label><select class="form-select" id="nj-bay" onchange="onNewJobScheduleChange()"><option value="">— Select —</option><option>1</option><option>2</option><option>3</option><option>4</option></select>`;
  }else{
    area.innerHTML='';
  }
  onNewJobScheduleChange();
}

// Computes the currently-entered booked start Date from whichever date/time
// fields are showing (preset-date + time, or a single datetime-local).
function newJobComputeStart(){
  if(newJobPresetDate){
    const t=document.getElementById('nj-time')?.value;
    return t?new Date(newJobPresetDate+'T'+t):null;
  }
  const v=document.getElementById('nj-booked')?.value;
  return v?new Date(v):null;
}

// Stop 1 is always nj-division/nj-bay/nj-estimate (unchanged from before
// multi-stop existed); newJobExtraLegs holds any additional stops, in
// order. Incomplete extra rows (still mid-edit) are skipped for the live
// warning — saveNewJob() does the hard validation.
function getNewJobPlannedLegs(){
  const division=document.getElementById('nj-division')?.value||'';
  const bay=document.getElementById('nj-bay')?.value||'';
  const estimateVal=document.getElementById('nj-estimate')?.value;
  const legs=[{division,bay,duration:estimateVal?parseFloat(estimateVal):0.5}];
  newJobExtraLegs.forEach(l=>{if(l.division&&l.bay)legs.push({division:l.division,bay:l.bay,duration:l.duration?parseFloat(l.duration):0.5})});
  return legs;
}

function addNewJobLeg(){
  newJobExtraLegs.push({division:'',bay:'',duration:''});
  renderNewJobExtraLegs();
  onNewJobScheduleChange();
}
function removeNewJobLeg(i){
  newJobExtraLegs.splice(i,1);
  renderNewJobExtraLegs();
  onNewJobScheduleChange();
}
function updateNewJobLeg(i,field,value){
  newJobExtraLegs[i][field]=value;
  if(field==='division')newJobExtraLegs[i].bay='';
  renderNewJobExtraLegs();
  onNewJobScheduleChange();
}
function renderNewJobExtraLegs(){
  const el=document.getElementById('nj-extra-legs');
  if(!el)return;
  el.innerHTML=newJobExtraLegs.map((leg,i)=>{
    const bayOptions=leg.division==='tyre_shop'?['4 Post','2 Post','Belly']:leg.division==='workshop'?['1','2','3','4']:[];
    return `<div class="nj-leg-row">
      <select class="form-select" onchange="updateNewJobLeg(${i},'division',this.value)">
        <option value="">Division…</option>
        <option value="tyre_shop" ${leg.division==='tyre_shop'?'selected':''}>Tyre Shop</option>
        <option value="workshop" ${leg.division==='workshop'?'selected':''}>Workshop</option>
      </select>
      <select class="form-select" onchange="updateNewJobLeg(${i},'bay',this.value)" ${!leg.division?'disabled':''}>
        <option value="">Bay…</option>
        ${bayOptions.map(b=>`<option value="${esc(b)}" ${leg.bay===b?'selected':''}>${esc(b)}</option>`).join('')}
      </select>
      <input class="form-input" type="number" step="0.25" placeholder="Hrs" value="${leg.duration||''}" onchange="updateNewJobLeg(${i},'duration',this.value)">
      <button type="button" class="btn-danger-link" onclick="removeNewJobLeg(${i})">✕</button>
    </div>`;
  }).join('');
}

// Live hoist-conflict warning — re-checked whenever division/bay/date/time/
// estimate/extra-stops change, so a double-booking is obvious before Create
// is clicked. Checks every planned stop, chained sequentially from the
// booked start time.
function onNewJobScheduleChange(){
  const warnEl=document.getElementById('nj-conflict-warning');
  if(!warnEl)return;
  const start=newJobComputeStart();
  const division=document.getElementById('nj-division')?.value;
  const bay=document.getElementById('nj-bay')?.value;
  if(!start||!division||!bay){warnEl.innerHTML='';return}
  const legs=getNewJobPlannedLegs();
  let cursor=new Date(start);
  const warnings=[];
  legs.forEach((leg,i)=>{
    const conflict=findHoistConflict(leg.division,leg.bay,cursor,leg.duration,{});
    if(conflict){
      const timeRange=conflict.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})+'–'+conflict.end.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
      warnings.push(`⚠ Stop ${i+1} — ${esc(divisionLabel(leg.division))} · ${esc(leg.bay)} is already booked ${timeRange} for ${esc(conflict.job.job_type)} (${esc(conflict.job.customer?.name||'—')})`);
    }
    cursor=new Date(cursor.getTime()+leg.duration*3600000);
  });
  warnEl.innerHTML=warnings.map(w=>`<div class="field-warning">${w}</div>`).join('');
}

function onNewJobCustomerSearch(v){
  newJobCustomerName=v;
  newJobCustomerId=null;
  const term=v.trim().toLowerCase();
  const results=document.getElementById('nj-customer-results');
  if(!term){results.innerHTML='';renderNewJobVehicleArea();return}
  const matches=customers.filter(c=>c.name.toLowerCase().includes(term)||(c.mobile||'').includes(term)).slice(0,8);
  let h='<div class="autocomplete-list">';
  matches.forEach(c=>{h+=`<div class="autocomplete-item" onclick="selectNewJobCustomer('${c.id}')">${esc(c.name)}${c.mobile?' — '+esc(c.mobile):''}</div>`});
  h+=`<div class="autocomplete-item create-new" onclick="selectNewJobCustomer(null)">+ Create new customer "${esc(v.trim())}"</div>`;
  h+='</div>';
  results.innerHTML=h;
  renderNewJobVehicleArea();
}

// ── Order no. on the New Job modal ───────────────────────────
// Whether the field is mandatory depends on the customer, which is chosen
// AFTER the modal is built — so this area re-renders on every customer change
// rather than being baked into the modal HTML. The typed value is carried
// across re-renders by hand: the element is destroyed each time, so anything
// already entered would otherwise be lost when the customer is swapped.
function newJobCustomerRequiresOrderNo(){
  if(!newJobCustomerId)return false;              // brand-new customers can't be flagged yet
  const c=customers.find(x=>x.id===newJobCustomerId);
  return !!(c&&c.requires_order_no);
}

function renderNewJobOrderArea(){
  const area=document.getElementById('nj-order-area');
  if(!area)return;
  const prev=document.getElementById('nj-order-no')?.value||'';
  const required=newJobCustomerRequiresOrderNo();
  area.innerHTML=`<label class="form-label">Order no.${required?' *':''}</label>
    <input class="form-input" id="nj-order-no" value="${esc(prev)}" placeholder="${required?'Required for this customer':'Optional'}"${required?' style="border-color:var(--accent)"':''}>
    ${required?`<div style="font-size:12px;color:var(--accent);font-weight:600;margin:calc(var(--space-2) * -1) 0 var(--space-4)">This customer requires an order no. before a job can be booked.</div>`:''}`;
}

async function selectNewJobCustomer(id){
  document.getElementById('nj-customer-results').innerHTML='';
  if(id){
    const c=customers.find(x=>x.id===id);
    newJobCustomerId=id;
    newJobCustomerName=c.name;
    document.getElementById('new-job-customer-area').innerHTML=`<label class="form-label">Customer</label><div class="selected-chip">${esc(c.name)} <button onclick="resetNewJobCustomer()">✕</button></div>`;
    renderNewJobOrderArea();
    await loadVehiclesForNewJob(id);
  }else{
    newJobCustomerId=null;
    document.getElementById('new-job-customer-area').innerHTML=`<label class="form-label">New customer</label>
      <div class="selected-chip">New: ${esc(newJobCustomerName)} <button onclick="resetNewJobCustomer()">✕</button></div>
      <input class="form-input" id="nj-new-cust-mobile" placeholder="Mobile">
      <input class="form-input" id="nj-new-cust-phone" placeholder="Phone">
      <input class="form-input" id="nj-new-cust-email" placeholder="Email">`;
    renderNewJobOrderArea();
    newJobVehicles=[];
    renderNewJobVehicleArea();
  }
}

function resetNewJobCustomer(){
  newJobCustomerId=null;newJobCustomerName='';newJobVehicles=[];
  document.getElementById('new-job-customer-area').innerHTML=`<label class="form-label">Customer *</label>
    <div class="autocomplete">
      <input class="form-input" id="nj-customer-search" placeholder="Type a name…" autocomplete="off" oninput="onNewJobCustomerSearch(this.value)">
      <div id="nj-customer-results"></div>
    </div>`;
  renderNewJobOrderArea();
  renderNewJobVehicleArea();
}

async function loadVehiclesForNewJob(customerId){
  try{
    const {data,error}=await sb.from('desk_vehicles').select('*').eq('customer_id',customerId).order('created_at');
    if(error)throw error;
    newJobVehicles=data||[];
  }catch(e){newJobVehicles=[]}
  renderNewJobVehicleArea();
}

// Brand-new customers get the vehicle fields inline (nothing to pick from
// yet); existing customers get a dropdown of their vehicles plus the same
// inline fields behind a "+ Add new vehicle" option — both paths share the
// same #nj-veh-* input ids since only one is ever rendered at a time, which
// keeps saveNewJob()'s read-back logic uniform regardless of which path ran.
function renderNewJobVehicleArea(){
  const area=document.getElementById('new-job-vehicle-area');
  if(!area)return;
  if(!newJobCustomerId){
    area.innerHTML=newJobCustomerName?`
      <label class="form-label">Vehicle (optional)</label>
      <input class="form-input" id="nj-veh-rego" placeholder="Rego">
      <input class="form-input" id="nj-veh-make" placeholder="Make">
      <input class="form-input" id="nj-veh-model" placeholder="Model">
      <input class="form-input" id="nj-veh-odo" type="number" placeholder="Odometer (km)">`:'';
    return;
  }
  let h='<label class="form-label">Vehicle</label>';
  h+=`<select class="form-select" id="nj-vehicle" onchange="onNewJobVehicleChange(this.value)">
    <option value="">— None yet —</option>
    ${newJobVehicles.map(v=>`<option value="${v.id}">${esc(v.make||'')} ${esc(v.model||'')}${v.rego?' ('+esc(v.rego)+')':''}</option>`).join('')}
    <option value="__new__">+ Add new vehicle</option>
  </select>`;
  h+='<div id="nj-new-vehicle-fields"></div>';
  area.innerHTML=h;
}

function onNewJobVehicleChange(v){
  newJobVehicleId=v&&v!=='__new__'?v:null;
  newJobShowNewVehicleFields=v==='__new__';
  const fields=document.getElementById('nj-new-vehicle-fields');
  fields.innerHTML=newJobShowNewVehicleFields?`
    <input class="form-input" id="nj-veh-rego" placeholder="Rego">
    <input class="form-input" id="nj-veh-make" placeholder="Make">
    <input class="form-input" id="nj-veh-model" placeholder="Model">
    <input class="form-input" id="nj-veh-odo" type="number" placeholder="Odometer (km)">`:'';
}

async function saveNewJob(){
  const jobType=document.getElementById('nj-type').value.trim();
  if(!newJobCustomerId&&!newJobCustomerName.trim()){showToast('Pick or create a customer');return}
  if(!jobType){showToast('Job type is required');return}
  const orderNo=document.getElementById('nj-order-no')?.value.trim()||'';
  if(newJobCustomerRequiresOrderNo()&&!orderNo){
    const c=customers.find(x=>x.id===newJobCustomerId);
    showToast(`${c?c.name:'This customer'} requires an order no. — enter it to book the job`);
    document.getElementById('nj-order-no')?.focus();
    return;
  }
  let bookedIso=null;
  if(newJobPresetDate){
    const timeVal=document.getElementById('nj-time').value;
    if(!timeVal){showToast('Time is required');return}
    bookedIso=new Date(newJobPresetDate+'T'+timeVal).toISOString();
  }else{
    const bookedVal=document.getElementById('nj-booked').value;
    bookedIso=bookedVal?new Date(bookedVal).toISOString():null;
  }
  const estimateVal=document.getElementById('nj-estimate').value;
  const division=document.getElementById('nj-division').value||null;
  const bayEl=document.getElementById('nj-bay');
  const bay=bayEl?(bayEl.value||null):null;

  if(newJobExtraLegs.length&&(!division||!bay)){
    showToast('Set the hoist for stop 1 before adding more stops');
    return;
  }
  for(let i=0;i<newJobExtraLegs.length;i++){
    const l=newJobExtraLegs[i];
    if(!l.division||!l.bay||!l.duration){
      showToast(`Fill in hoist, bay and hours for stop ${i+2}, or remove it`);
      return;
    }
  }
  const legs=[{division,bay,duration:estimateVal?parseFloat(estimateVal):0.5}];
  newJobExtraLegs.forEach(l=>legs.push({division:l.division,bay:l.bay,duration:parseFloat(l.duration)}));

  if(division&&bay&&bookedIso){
    let cursor=new Date(bookedIso);
    for(let i=0;i<legs.length;i++){
      const leg=legs[i];
      const conflict=findHoistConflict(leg.division,leg.bay,cursor,leg.duration,{});
      if(conflict){
        const timeRange=conflict.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})+'–'+conflict.end.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
        showToast(`Stop ${i+1} — ${leg.bay} is already booked ${timeRange} for ${conflict.job.job_type} — pick a different hoist or time`);
        return;
      }
      cursor=new Date(cursor.getTime()+leg.duration*3600000);
    }
  }
  try{
    let customerId=newJobCustomerId;
    if(!customerId){
      const {data,error}=await sb.from('desk_customers').insert({
        name:newJobCustomerName.trim(),
        mobile:document.getElementById('nj-new-cust-mobile')?.value.trim()||null,
        phone:document.getElementById('nj-new-cust-phone')?.value.trim()||null,
        email:document.getElementById('nj-new-cust-email')?.value.trim()||null
      }).select();
      if(error)throw error;
      customerId=data[0].id;
    }
    let vehicleId=newJobVehicleId;
    const vRegoEl=document.getElementById('nj-veh-rego');
    if(vRegoEl){
      const vRego=vRegoEl.value.trim();
      const vMake=document.getElementById('nj-veh-make').value.trim();
      const vModel=document.getElementById('nj-veh-model').value.trim();
      const vOdo=document.getElementById('nj-veh-odo').value;
      if(vRego||vMake||vModel||vOdo){
        const {data,error}=await sb.from('desk_vehicles').insert({customer_id:customerId,rego:vRego||null,make:vMake||null,model:vModel||null,odometer:vOdo?parseInt(vOdo,10):null}).select();
        if(error)throw error;
        vehicleId=data[0].id;
      }
    }
    const totalEstimate=legs.length>1?legs.reduce((s,l)=>s+l.duration,0):(estimateVal?parseFloat(estimateVal):null);
    // assigned_mechanic (free text) is mirrored from the selected employee so
    // the print job card and every existing report — which still read that
    // column — keep working unchanged. assigned_employee_id is the real link
    // the staff app's "My Jobs" filters on; see migration-staff-app.sql.
    const mechanicEmployeeId=document.getElementById('nj-mechanic').value||null;
    const mechanicEmployee=mechanicEmployeeId?employees.find(e=>e.id===mechanicEmployeeId):null;
    const payload={
      customer_id:customerId,
      vehicle_id:vehicleId||null,
      job_type:jobType,
      division,
      bay,
      booked_at:bookedIso,
      estimate_hours:totalEstimate,
      assigned_employee_id:mechanicEmployeeId,
      assigned_mechanic:mechanicEmployee?mechanicEmployee.name:null,
      estimated_value:document.getElementById('nj-value').value?parseFloat(document.getElementById('nj-value').value):null,
      source_id:document.getElementById('nj-source').value||null,
      order_no:orderNo||null
    };
    const {data:jobData,error}=await sb.from('desk_jobs').insert(payload).select();
    if(error)throw error;
    if(legs.length>1){
      const legRows=legs.map((l,i)=>({job_id:jobData[0].id,division:l.division,bay:l.bay,duration_hours:l.duration,sequence:i}));
      const {error:legErr}=await sb.from('desk_job_hoist_legs').insert(legRows);
      if(legErr)throw legErr;
    }
    closeModal();
    showToast('Job created');
    await loadCustomers();
    await renderJobsView();
  }catch(e){showToast('Could not create job')}
}

// ── DIARY ─────────────────────────────────────────────────────
let diaryWeekStart=startOfWeek(new Date());
let diarySubView='week'; // 'week' | 'day' (hoist day-planning view)
let diaryDayDate=new Date();
let draggingItem=null; // {jobId, legId} — legId is null when dragging a whole (single-hoist) job
let expandedDiaryCards=new Set(); // job ids currently expanded in the weekly Diary view
function toggleDiaryCardExpand(e,jobId){
  e.stopPropagation();
  if(expandedDiaryCards.has(jobId)){expandedDiaryCards.delete(jobId);delete diaryCardLegsWorking[jobId]}else expandedDiaryCards.add(jobId);
  // Refresh only the ONE day column the job is booked on — see the note on
  // diaryDayBodyContentHtml(). Falls back to a full re-render if that column
  // isn't on screen for any reason (e.g. the Hoist Day view, or the job's
  // booked_at changed since this render), so expand/collapse never silently
  // does nothing.
  const j=jobs.find(x=>x.id===jobId);
  const bookedDate=j&&j.booked_at?new Date(j.booked_at):null;
  const dateStr=bookedDate?isoDateOnly(bookedDate):null;
  const body=(diarySubView==='week'&&dateStr)?document.getElementById('diary-day-body-'+dateStr):null;
  if(body)body.innerHTML=diaryDayBodyContentHtml(bookedDate,dateStr);
  else renderDiaryGrid();
}

// ── Inline booking edit (weekly Diary card) — covers both single-hoist
// jobs (bookingEditFieldsHtml) and multi-stop jobs (diaryCardMultiLegEditHtml
// further down, which edits each desk_job_hoist_legs row directly) so every
// job type is editable straight from the Diary, not just simple ones.
// Dragging a job/stop in the Hoist Day view remains available too. ────────
// One style string behind every inline diary/hoist edit field, so the whole
// set stays on the token spine (squared to --radius-input, spacing off the
// --space-* scale) from a single place.
const DCE_INPUT_STYLE='width:100%;padding:var(--space-1) var(--space-2);border:var(--border-width) solid var(--border);border-radius:var(--radius-input);background:var(--surface);color:var(--text-primary);font-size:12px;margin-bottom:var(--space-2);font-family:inherit';

function toDatetimeLocalValue(iso){
  if(!iso)return '';
  const d=new Date(iso);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function diaryCardBayOptionsHtml(division,currentBay){
  if(division==='tyre_shop')return ['4 Post','2 Post','Belly'].map(b=>`<option ${currentBay===b?'selected':''}>${b}</option>`).join('');
  if(division==='workshop')return ['1','2','3','4'].map(b=>`<option ${currentBay===b?'selected':''}>${b}</option>`).join('');
  return '';
}

function diaryCardBayAreaHtml(jobId,division,currentBay){
  if(!division)return '';
  return `<label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">${division==='tyre_shop'?'Hoist':'Bay'}</label>
    <select id="dce-bay-${jobId}" style="${DCE_INPUT_STYLE}"><option value="">— Select —</option>${diaryCardBayOptionsHtml(division,currentBay)}</select>`;
}

function onDiaryCardDivisionChange(jobId){
  const v=document.getElementById('dce-division-'+jobId).value;
  document.getElementById('dce-bay-area-'+jobId).innerHTML=diaryCardBayAreaHtml(jobId,v,null);
}

// Shared field markup — used by both the weekly Diary card's inline
// expand and the Hoist Day view's quick-edit modal, so the two stay
// in sync automatically rather than drifting as separate copies.
function bookingBookedFieldHtml(j){
  return `
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Booked date/time</label>
    <input type="datetime-local" id="dce-booked-${j.id}" value="${toDatetimeLocalValue(j.booked_at)}" style="${DCE_INPUT_STYLE}">`;
}
function bookingTailFieldsHtml(j){
  return `
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Pickup</label>
    <input type="datetime-local" id="dce-pickup-${j.id}" value="${toDatetimeLocalValue(j.pickup_at)}" style="${DCE_INPUT_STYLE}">
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Odometer in (km)</label>
    <input type="number" id="dce-odo-${j.id}" value="${j.odometer_in||''}" style="${DCE_INPUT_STYLE}">
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Mechanic</label>
    <select id="dce-mechanic-${j.id}" style="${DCE_INPUT_STYLE}">
      <option value="">— Not set —</option>
      ${employees.filter(e=>e.is_active!==false).map(e=>`<option value="${e.id}" ${j.assigned_employee_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}
    </select>
    <div id="dce-warning-${j.id}"></div>`;
}
function bookingEditFieldsHtml(j){
  return `
    ${bookingBookedFieldHtml(j)}
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Division</label>
    <select id="dce-division-${j.id}" onchange="onDiaryCardDivisionChange('${j.id}')" style="${DCE_INPUT_STYLE}">
      <option value="">— Unassigned —</option>
      <option value="tyre_shop" ${j.division==='tyre_shop'?'selected':''}>Tyre Shop</option>
      <option value="workshop" ${j.division==='workshop'?'selected':''}>Workshop</option>
    </select>
    <div id="dce-bay-area-${j.id}">${diaryCardBayAreaHtml(j.id,j.division,j.bay)}</div>
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Estimate (hours)</label>
    <input type="number" step="0.25" id="dce-estimate-${j.id}" value="${j.estimate_hours||''}" style="${DCE_INPUT_STYLE}">
    ${bookingTailFieldsHtml(j)}`;
}

// ── Multi-stop inline editing (weekly Diary card / Hoist block edit) ──────
// Working copy of a multi-leg job's stops while its card is expanded, keyed
// by job id so several multi-stop cards can be open/edited at once without
// clobbering each other. Seeded from desk_job_hoist_legs the first time a
// card expands; cleared after a successful save (or on collapse) so the next
// expand re-seeds from the freshly-loaded data.
let diaryCardLegsWorking={};
function ensureDiaryCardLegsWorking(jobId){
  if(!diaryCardLegsWorking[jobId]){
    const legs=jobLegsMap[jobId]||[];
    diaryCardLegsWorking[jobId]=legs.map(l=>({legId:l.id,division:l.division,bay:l.bay,duration:l.duration_hours}));
  }
  return diaryCardLegsWorking[jobId];
}
function diaryCardLegRowsHtml(jobId){
  const legs=ensureDiaryCardLegsWorking(jobId);
  return legs.map((l,i)=>`<div class="nj-leg-row" style="margin-bottom:var(--space-2)">
      <select class="form-select" onchange="updateDiaryCardLeg('${jobId}',${i},'division',this.value)">
        <option value="">Division…</option>
        <option value="tyre_shop" ${l.division==='tyre_shop'?'selected':''}>Tyre Shop</option>
        <option value="workshop" ${l.division==='workshop'?'selected':''}>Workshop</option>
      </select>
      <select class="form-select" onchange="updateDiaryCardLeg('${jobId}',${i},'bay',this.value)" ${!l.division?'disabled':''}>
        <option value="">Bay…</option>
        ${diaryCardBayOptionsHtml(l.division,l.bay)}
      </select>
      <input class="form-input" type="number" step="0.25" placeholder="Hrs" value="${l.duration||''}" onchange="updateDiaryCardLeg('${jobId}',${i},'duration',this.value)">
      ${legs.length>1?`<button type="button" class="btn-danger-link" onclick="removeDiaryCardLeg('${jobId}',${i})">✕</button>`:''}
    </div>`).join('');
}
function refreshDiaryCardLegRows(jobId){
  const el=document.getElementById('dce-legs-'+jobId);
  if(el)el.innerHTML=diaryCardLegRowsHtml(jobId);
}
function updateDiaryCardLeg(jobId,i,field,value){
  const legs=ensureDiaryCardLegsWorking(jobId);
  legs[i][field]=value;
  if(field==='division')legs[i].bay='';
  refreshDiaryCardLegRows(jobId);
}
function addDiaryCardLeg(jobId){
  ensureDiaryCardLegsWorking(jobId).push({division:'',bay:'',duration:''});
  refreshDiaryCardLegRows(jobId);
}
function removeDiaryCardLeg(jobId,i){
  const legs=ensureDiaryCardLegsWorking(jobId);
  if(legs.length<=1)return;
  legs.splice(i,1);
  refreshDiaryCardLegRows(jobId);
}
function diaryCardMultiLegEditHtml(j){
  return `
    ${bookingBookedFieldHtml(j)}
    <label class="form-label" style="font-size:var(--text-micro);margin-bottom:var(--space-1)">Hoist stops</label>
    <div id="dce-legs-${j.id}">${diaryCardLegRowsHtml(j.id)}</div>
    <button type="button" class="btn-link" style="margin-bottom:var(--space-2)" onclick="addDiaryCardLeg('${j.id}')">+ Add stop</button>
    ${bookingTailFieldsHtml(j)}`;
}

async function saveDiaryCardEditMultiLeg(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const warnEl=document.getElementById('dce-warning-'+jobId);
  if(warnEl)warnEl.innerHTML='';
  const bookedVal=document.getElementById('dce-booked-'+jobId).value;
  if(!bookedVal){showToast('Booking date/time is required');return}
  const bookedDate=new Date(bookedVal);
  const legsWorking=ensureDiaryCardLegsWorking(jobId);
  for(let i=0;i<legsWorking.length;i++){
    if(!legsWorking[i].division||!legsWorking[i].bay){showToast(`Stop ${i+1} needs a division and bay`);return}
  }
  const pickupVal=document.getElementById('dce-pickup-'+jobId).value;
  const odoVal=document.getElementById('dce-odo-'+jobId).value;
  const mechanicEmployeeId=document.getElementById('dce-mechanic-'+jobId).value||null;
  const mechanicEmployee=mechanicEmployeeId?employees.find(e=>e.id===mechanicEmployeeId):null;

  let cursor=new Date(bookedDate);
  for(let i=0;i<legsWorking.length;i++){
    const l=legsWorking[i];
    const duration=l.duration?parseFloat(l.duration):0.5;
    const exclude=l.legId?{legId:l.legId}:{jobId};
    const conflict=findHoistConflict(l.division,l.bay,cursor,duration,exclude);
    if(conflict){
      const timeRange=conflict.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})+'–'+conflict.end.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
      if(warnEl)warnEl.innerHTML=`<div class="field-warning">Stop ${i+1} — ${esc(l.bay)} is already booked ${timeRange} for ${esc(conflict.job.job_type)} — pick a different hoist or time</div>`;
      return;
    }
    cursor=new Date(cursor.getTime()+duration*3600000);
  }

  const totalHours=legsWorking.reduce((s,l)=>s+(l.duration?parseFloat(l.duration):0.5),0);
  try{
    const {error:jobErr}=await sb.from('desk_jobs').update({
      booked_at:bookedDate.toISOString(),
      division:legsWorking[0].division,
      bay:legsWorking[0].bay,
      estimate_hours:totalHours,
      pickup_at:pickupVal?new Date(pickupVal).toISOString():null,
      odometer_in:odoVal?parseInt(odoVal,10):null,
      assigned_employee_id:mechanicEmployeeId,
      assigned_mechanic:mechanicEmployee?mechanicEmployee.name:null,
      updated_at:new Date().toISOString()
    }).eq('id',jobId);
    if(jobErr)throw jobErr;

    let offsetCursor=0;
    const keptIds=[];
    for(let i=0;i<legsWorking.length;i++){
      const l=legsWorking[i];
      const duration=l.duration?parseFloat(l.duration):0.5;
      if(l.legId){
        keptIds.push(l.legId);
        const {error}=await sb.from('desk_job_hoist_legs').update({division:l.division,bay:l.bay,duration_hours:duration,sequence:i,start_offset_hours:offsetCursor}).eq('id',l.legId);
        if(error)throw error;
      }else{
        const {data,error}=await sb.from('desk_job_hoist_legs').insert({job_id:jobId,division:l.division,bay:l.bay,duration_hours:duration,sequence:i,start_offset_hours:offsetCursor}).select().single();
        if(error)throw error;
        keptIds.push(data.id);
      }
      offsetCursor+=duration;
    }
    const removedIds=(jobLegsMap[jobId]||[]).map(l=>l.id).filter(id=>!keptIds.includes(id));
    if(removedIds.length){
      const {error}=await sb.from('desk_job_hoist_legs').delete().in('id',removedIds);
      if(error)throw error;
    }

    showToast('Booking updated');
    delete diaryCardLegsWorking[jobId];
    expandedDiaryCards.delete(jobId);
    await loadJobs();
    if(diarySubView==='day'){closeModal();renderHoistDayView()}else{renderDiaryGrid()}
  }catch(e){showToast('Could not save changes')}
}

// Hoist Day view's quick-edit modal (single-hoist jobs only — a
// multi-stop job's individual legs still open the full job, same as
// the weekly Diary card's scoping decision) — modal rather than
// expand-in-place because hoist blocks are absolutely positioned and
// often very short, so growing one in place would overlap its
// neighbours instead of pushing them down.
function openHoistBlockEditModal(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  closeModal();
  const jNotes=jobNotesMap[jobId]||[];
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">${esc(j.job_type)}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-3)">${esc(j.customer?.name||'Unknown customer')}${j.customer?.mobile?' · '+esc(j.customer.mobile):''}</div>
      ${bookingEditFieldsHtml(j)}
      <button class="btn-primary" style="width:100%;margin-top:var(--space-1)" onclick="saveDiaryCardEdit('${j.id}')">Save Changes</button>
      ${jNotes.length?`<div class="diary-card-expanded-notes-title" style="margin-top:var(--space-4)">Notes</div>${jNotes.map(n=>`<div class="diary-card-expanded-note">${n.is_office_only?'<span class="note-office-badge">Office only</span> ':''}${esc(n.body)}</div>`).join('')}`:''}
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn-link" onclick="closeModal();openJobFromDiary('${j.id}')">Open full job →</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

async function saveDiaryCardEdit(jobId){
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const warnEl=document.getElementById('dce-warning-'+jobId);
  if(warnEl)warnEl.innerHTML='';
  const bookedVal=document.getElementById('dce-booked-'+jobId).value;
  if(!bookedVal){showToast('Booking date/time is required');return}
  const bookedDate=new Date(bookedVal);
  const division=document.getElementById('dce-division-'+jobId).value||null;
  const bayEl=document.getElementById('dce-bay-'+jobId);
  const bay=bayEl?(bayEl.value||null):null;
  const estimateVal=document.getElementById('dce-estimate-'+jobId).value;
  const estimateHours=estimateVal?parseFloat(estimateVal):null;
  const pickupVal=document.getElementById('dce-pickup-'+jobId).value;
  const odoVal=document.getElementById('dce-odo-'+jobId).value;
  // assigned_mechanic mirrored from the selected employee — see the note in
  // saveNewJob() for why this stays a real column rather than being dropped.
  const mechanicEmployeeId=document.getElementById('dce-mechanic-'+jobId).value||null;
  const mechanicEmployee=mechanicEmployeeId?employees.find(e=>e.id===mechanicEmployeeId):null;

  if(division&&bay){
    const conflict=findHoistConflict(division,bay,bookedDate,estimateHours||0.5,{jobId});
    if(conflict){
      const timeRange=conflict.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})+'–'+conflict.end.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'});
      if(warnEl)warnEl.innerHTML=`<div class="field-warning">${esc(bay)} is already booked ${timeRange} for ${esc(conflict.job.job_type)} — pick a different hoist or time</div>`;
      return;
    }
  }
  try{
    const {error}=await sb.from('desk_jobs').update({
      booked_at:bookedDate.toISOString(),
      division,bay,
      estimate_hours:estimateHours,
      pickup_at:pickupVal?new Date(pickupVal).toISOString():null,
      odometer_in:odoVal?parseInt(odoVal,10):null,
      assigned_employee_id:mechanicEmployeeId,
      assigned_mechanic:mechanicEmployee?mechanicEmployee.name:null,
      updated_at:new Date().toISOString()
    }).eq('id',jobId);
    if(error)throw error;
    showToast('Booking updated');
    expandedDiaryCards.delete(jobId);
    await loadJobs();
    if(diarySubView==='day'){closeModal();renderHoistDayView()}else{renderDiaryGrid()}
  }catch(e){showToast('Could not save changes')}
}

let dayNotes=[];
let fullDays=[];
let hoistDayClockInterval=null; // redraws the Hoist Day view every 60s so the "now" line travels

// Hoist Day view business hours — Settings-configurable (desk_settings key
// 'diary_hours'), defaults to 7am–7pm if never set.
let DAY_VIEW_START_HOUR=7;
let DAY_VIEW_END_HOUR=19;
async function loadDiaryHoursSetting(){
  try{
    const {data,error}=await sb.from('desk_settings').select('value').eq('key','diary_hours').maybeSingle();
    if(error)throw error;
    const val=parseSettingValue(data?.value);
    if(val?.start!=null)DAY_VIEW_START_HOUR=hhmmToHours(val.start);
    if(val?.end!=null)DAY_VIEW_END_HOUR=hhmmToHours(val.end);
  }catch(e){}
}
function hhmmToHours(v){
  const [h,m]=String(v).split(':').map(Number);
  return h+(m||0)/60;
}
function hoursToHhmm(h){
  const hh=Math.floor(h);
  const mm=Math.round((h-hh)*60);
  return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
}

function startOfWeek(d){
  const x=new Date(d);
  x.setHours(0,0,0,0);
  x.setDate(x.getDate()-x.getDay());
  return x;
}
function sameLocalDate(a,b){
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}
function isoDateOnly(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

async function renderDiaryView(){
  const main=document.getElementById('main');
  main.innerHTML=`<div class="empty-state">Loading…</div>`;
  await loadJobs();
  await loadJobLegsMap();
  await loadDayNotes();
  await loadFullDays();
  await loadDiaryHoursSetting();
  if(!employees.length)await loadEmployees();
  renderDiaryGrid();
}

async function loadDayNotes(){
  try{
    const {data,error}=await sb.from('desk_day_notes').select('*').order('note_date');
    if(error)throw error;
    dayNotes=data||[];
  }catch(e){dayNotes=[]}
}

async function loadFullDays(){
  try{
    const {data,error}=await sb.from('desk_full_days').select('note_date');
    if(error)throw error;
    fullDays=(data||[]).map(r=>r.note_date);
  }catch(e){fullDays=[]}
}

// ── Day context menu (add job / add note / mark full) ─────────
function onDayBodyClick(e,dateStr){
  if(e.target.closest('.diary-card')||e.target.closest('.day-note-card'))return;
  showDayContextMenu(e.pageX,e.pageY,dateStr);
}

function showDayContextMenu(x,y,dateStr){
  closeDayContextMenu();
  const isFull=fullDays.includes(dateStr);
  const menuWidth=210,menuHeight=150;
  if(x+menuWidth>window.innerWidth)x=window.innerWidth-menuWidth-10;
  if(y+menuHeight>window.innerHeight)y=window.innerHeight-menuHeight-10;
  const html=`<div class="day-context-backdrop" onclick="closeDayContextMenu()"></div>
    <div class="day-context-menu" style="left:${x}px;top:${y}px">
      ${isFull?'<div class="locked-note">This day is marked full</div>':`<button onclick="closeDayContextMenu();openNewJobModal('${dateStr}')">+ Add Job</button>`}
      <button onclick="closeDayContextMenu();openDayNoteForm('${dateStr}')">+ Add Note</button>
      <button class="${isFull?'':'danger'}" onclick="toggleDayFull('${dateStr}')">${isFull?'Unmark day as full':'Mark day as full'}</button>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function closeDayContextMenu(){
  document.querySelectorAll('.day-context-menu,.day-context-backdrop').forEach(el=>el.remove());
}

function openDayNoteForm(dateStr){
  const label=new Date(dateStr+'T00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'short'});
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <div class="modal-title">Add note — ${label}</div>
      <textarea class="form-textarea" id="day-note-body" placeholder="Note…" style="min-height:100px"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveDayNote('${dateStr}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('day-note-body').focus();
}

async function saveDayNote(dateStr){
  const body=document.getElementById('day-note-body').value.trim();
  if(!body)return;
  try{
    const {error}=await sb.from('desk_day_notes').insert({note_date:dateStr,body});
    if(error)throw error;
    closeModal();
    showToast('Note added');
    await loadDayNotes();
    renderDiaryGrid();
  }catch(e){showToast('Could not add note')}
}

async function deleteDayNote(id){
  try{
    const {error}=await sb.from('desk_day_notes').delete().eq('id',id);
    if(error)throw error;
    await loadDayNotes();
    renderDiaryGrid();
  }catch(e){showToast('Could not delete note')}
}

async function toggleDayFull(dateStr){
  closeDayContextMenu();
  const isFull=fullDays.includes(dateStr);
  try{
    if(isFull){
      const {error}=await sb.from('desk_full_days').delete().eq('note_date',dateStr);
      if(error)throw error;
      showToast('Day unlocked');
    }else{
      const {error}=await sb.from('desk_full_days').insert({note_date:dateStr});
      if(error)throw error;
      showToast('Day marked full — bookings locked');
    }
    await loadFullDays();
    renderDiaryGrid();
  }catch(e){showToast('Could not update day status')}
}

function diaryPrevWeek(){
  if(diarySubView==='day'){diaryDayDate.setDate(diaryDayDate.getDate()-1)}else{diaryWeekStart.setDate(diaryWeekStart.getDate()-7)}
  renderDiaryGrid();
}
function diaryNextWeek(){
  if(diarySubView==='day'){diaryDayDate.setDate(diaryDayDate.getDate()+1)}else{diaryWeekStart.setDate(diaryWeekStart.getDate()+7)}
  renderDiaryGrid();
}
function diaryToday(){diaryWeekStart=startOfWeek(new Date());diaryDayDate=new Date();renderDiaryGrid()}
function setDiarySubView(v){diarySubView=v;renderDiaryGrid()}

function toggleDiaryTagFilter(tagId){
  const i=diaryTagFilter.indexOf(tagId);
  if(i>-1){diaryTagFilter.splice(i,1)}else{diaryTagFilter.push(tagId)}
  renderDiaryGrid();
}

function jobMatchesTagFilter(j){
  if(!diaryTagFilter.length)return true;
  const tags=(jobTagsMap[j.id]||[]).map(t=>t.id);
  return diaryTagFilter.some(t=>tags.includes(t));
}

// Shared Week/Hoist-Day toggle, used in both diary nav bars.
function diaryViewToggleHtml(){
  return `<div class="diary-view-toggle">
    <button class="${diarySubView==='week'?'active':''}" onclick="setDiarySubView('week')">Week</button>
    <button class="${diarySubView==='day'?'active':''}" onclick="setDiarySubView('day')">🛠 Hoist Day</button>
  </div>`;
}

function renderDiaryGrid(){
  if(diarySubView==='day'){renderHoistDayView();return}
  renderDiaryWeekGrid();
}

function renderDiaryWeekGrid(){
  clearInterval(hoistDayClockInterval);
  const main=document.getElementById('main');
  const days=[];
  for(let i=0;i<7;i++){const d=new Date(diaryWeekStart);d.setDate(d.getDate()+i);days.push(d)}
  const rangeLabel=days[0].toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' – '+days[6].toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
  const today=new Date();

  let h=`<div class="diary-nav">
    <div class="diary-nav-label">${rangeLabel}</div>
    <button class="btn-secondary" onclick="diaryPrevWeek()">← Prev</button>
    <button class="btn-secondary" onclick="diaryToday()">Today</button>
    <button class="btn-secondary" onclick="diaryNextWeek()">Next →</button>
    ${diaryViewToggleHtml()}
    <button class="btn-primary" onclick="openNewJobModal()">+ New Job</button>
  </div>`;

  if(allTags.length){
    h+=`<div class="diary-tag-filter"><span class="diary-tag-filter-label">Filter by tag:</span>
      ${allTags.map(t=>{
        const active=diaryTagFilter.includes(t.id);
        return `<div class="tag-option" style="${active?`background:${esc(t.color)};color:#fff;border-color:${esc(t.color)}`:''}" onclick="toggleDiaryTagFilter('${t.id}')"><span class="tag-dot" style="background:${active?'#fff':esc(t.color)}"></span>${esc(t.name)}</div>`;
      }).join('')}
      ${diaryTagFilter.length?`<button class="btn-link" onclick="diaryTagFilter=[];renderDiaryGrid()">Clear</button>`:''}
    </div>`;
  }

  h+='<div class="diary-grid">';

  days.forEach(d=>{
    const dateStr=isoDateOnly(d);
    const isToday=sameLocalDate(d,today);
    const isFull=fullDays.includes(dateStr);
    h+=`<div class="diary-day">
      <div class="diary-day-header${isToday?' today':''}">${d.toLocaleDateString('en-AU',{weekday:'short'})}<br>${d.toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</div>
      ${isFull?'<div class="day-full-badge">FULL — LOCKED</div>':''}
      <div class="diary-day-body${isFull?' day-full':''}" id="diary-day-body-${dateStr}" onclick="onDayBodyClick(event,'${dateStr}')" ondragover="onDiaryDragOver(event)" ondragleave="onDiaryDragLeave(event)" ondrop="onDiaryDrop(event,'${dateStr}')">
        ${diaryDayBodyContentHtml(d,dateStr)}
      </div>
    </div>`;
  });
  h+='</div>';
  main.innerHTML=h;
}

// Content of a single day's .diary-day-body — notes + job cards + empty
// state. Pulled out of renderDiaryWeekGrid() so a single day can be
// refreshed on its own (see toggleDiaryCardExpand): each .diary-day-body
// carries a stable id keyed by date, and re-rendering just one day's
// innerHTML leaves the other 6 columns' DOM untouched, so their entrance
// animation (.diary-grid>.diary-day, staggered by column) doesn't replay.
// Re-rendering the WHOLE grid on every card expand was exactly why opening a
// booking looked like the diary reloading — every column faded back in.
function diaryDayBodyContentHtml(d,dateStr){
  const dayJobs=jobs.filter(j=>j.booked_at&&sameLocalDate(new Date(j.booked_at),d)&&jobMatchesTagFilter(j))
    .sort((a,b)=>new Date(a.booked_at)-new Date(b.booked_at));
  const notesForDay=dayNotes.filter(n=>n.note_date===dateStr);
  return `
    ${notesForDay.map(n=>`<div class="day-note-card" onclick="event.stopPropagation()"><button class="note-del" onclick="event.stopPropagation();deleteDayNote('${n.id}')">✕</button>${esc(n.body)}</div>`).join('')}
    ${dayJobs.map(j=>{
      const contact=j.customer?.mobile||j.customer?.phone||'';
      const vehDesc=j.vehicle?([j.vehicle.make,j.vehicle.model].filter(Boolean).join(' ')+(j.vehicle.rego?' ('+j.vehicle.rego+')':'')):'';
      const tags=jobTagsMap[j.id]||[];
      const jNotes=jobNotesMap[j.id]||[];
      const latestNote=jNotes.length?jNotes[jNotes.length-1].body:'';
      const isExpanded=expandedDiaryCards.has(j.id);
      const legsForJob=jobLegsMap[j.id];
      return `
      <div class="diary-card ${j.status}" draggable="true" ondragstart="onDiaryDragStart(event,'${j.id}')" ondragend="onDiaryDragEnd(event)" onclick="toggleDiaryCardExpand(event,'${j.id}')">
        <div class="diary-card-time">${new Date(j.booked_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</div>
        <div class="diary-card-type">${esc(j.job_type)}</div>
        <div class="diary-card-sub"><strong>${esc(j.customer?.name||'Unknown customer')}</strong>${contact?' · '+esc(contact):''}</div>
        ${vehDesc?`<div class="diary-card-sub">${esc(vehDesc)}</div>`:''}
        ${divisionBayTag(j)?`<div class="diary-card-sub">${esc(divisionBayTag(j))}</div>`:''}
        ${(!isExpanded&&latestNote)?`<div class="diary-card-note" title="${esc(latestNote)}">${esc(truncate(latestNote,90))}</div>`:''}
        ${tags.length?`<div class="diary-card-tags">${tags.map(t=>`<span class="tag-chip" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}</div>`:''}
        ${isExpanded?`
        <div class="diary-card-expanded" onclick="event.stopPropagation()">
          <div class="diary-card-expanded-row"><span>Status</span><span>${JOB_STATUS_LABELS[j.status]}</span></div>
          ${legsForJob&&legsForJob.length>1?`
          <div style="margin-top:var(--space-2)">
            ${diaryCardMultiLegEditHtml(j)}
            <button class="btn-primary" style="width:100%;margin-top:var(--space-1)" onclick="saveDiaryCardEditMultiLeg('${j.id}')">Save Changes</button>
          </div>
          `:`
          <div style="margin-top:var(--space-2)">
            ${bookingEditFieldsHtml(j)}
            <button class="btn-primary" style="width:100%;margin-top:var(--space-1)" onclick="saveDiaryCardEdit('${j.id}')">Save Changes</button>
          </div>
          `}
          <div class="diary-card-expanded-notes-title">Notes</div>
          ${jNotes.length?jNotes.map(n=>`<div class="diary-card-expanded-note">${n.is_office_only?'<span class="note-office-badge">Office only</span> ':''}${esc(n.body)}</div>`).join(''):'<div class="diary-card-expanded-empty">No notes yet.</div>'}
          <button class="btn-secondary diary-card-open-btn" onclick="event.stopPropagation();openJobFromDiary('${j.id}')">Open full job →</button>
        </div>`:''}
      </div>`;
    }).join('')}
    ${(!dayJobs.length&&!notesForDay.length)?'<div class="diary-day-empty">—</div>':''}
  `;
}

function onDiaryDragStart(e,jobId,legId){
  draggingItem={jobId,legId:legId||null};
  e.dataTransfer.effectAllowed='move';
  try{e.dataTransfer.setData('text/plain',jobId)}catch(err){}
}
function onDiaryDragEnd(){draggingItem=null}
function onDiaryDragOver(e){e.preventDefault();e.currentTarget.classList.add('drag-over')}
function onDiaryDragLeave(e){e.currentTarget.classList.remove('drag-over')}

async function onDiaryDrop(e,dateStr){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const jobId=draggingItem?.jobId;
  draggingItem=null;
  if(!jobId)return;
  if(fullDays.includes(dateStr)){showToast('That day is locked — unmark it as full first');return}
  const j=jobs.find(x=>x.id===jobId);
  if(!j)return;
  const prevDate=j.booked_at?new Date(j.booked_at):null;
  const [y,m,dd]=dateStr.split('-').map(Number);
  const newDate=new Date(y,m-1,dd,prevDate?prevDate.getHours():9,prevDate?prevDate.getMinutes():0);
  if(prevDate&&sameLocalDate(prevDate,newDate))return;
  const newIso=newDate.toISOString();
  const oldIso=j.booked_at;
  j.booked_at=newIso; // optimistic
  renderDiaryGrid();
  try{
    const {error}=await sb.from('desk_jobs').update({booked_at:newIso,updated_at:new Date().toISOString()}).eq('id',jobId);
    if(error)throw error;
    showToast('Job moved');
  }catch(err){
    j.booked_at=oldIso;
    renderDiaryGrid();
    showToast('Could not move job');
  }
}

// ── Hoist Day view — one day, hoists as columns, jobs positioned/sized
// by booked_at + estimate_hours, so the whole day's hoist flow is visible
// and pre-plannable at a glance. Drag a card to a different hoist/time to
// reschedule it (same conflict check as the New Job modal).
const HOIST_PX_PER_HOUR=60;

function formatHourLabel(hr){
  const h12=hr%12===0?12:hr%12;
  return h12+(hr<12?' am':' pm');
}

function renderHoistDayView(){
  const main=document.getElementById('main');
  const d=diaryDayDate;
  const dateStr=isoDateOnly(d);
  const isToday=sameLocalDate(d,new Date());
  const isFull=fullDays.includes(dateStr);
  const label=d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  let h=`<div class="diary-nav">
    <div class="diary-nav-label">${esc(label)}${isToday?' <span class="today-tag">Today</span>':''}</div>
    <button class="btn-secondary" onclick="diaryPrevWeek()">← Prev</button>
    <button class="btn-secondary" onclick="diaryToday()">Today</button>
    <button class="btn-secondary" onclick="diaryNextWeek()">Next →</button>
    ${diaryViewToggleHtml()}
    <button class="btn-primary" onclick="openNewJobModal('${dateStr}')">+ New Job</button>
  </div>`;

  if(isFull){h+='<div class="day-full-badge" style="margin-bottom:var(--space-3)">FULL — LOCKED</div>'}

  if(allTags.length){
    h+=`<div class="diary-tag-filter"><span class="diary-tag-filter-label">Filter by tag:</span>
      ${allTags.map(t=>{
        const active=diaryTagFilter.includes(t.id);
        return `<div class="tag-option" style="${active?`background:${esc(t.color)};color:#fff;border-color:${esc(t.color)}`:''}" onclick="toggleDiaryTagFilter('${t.id}')"><span class="tag-dot" style="background:${active?'#fff':esc(t.color)}"></span>${esc(t.name)}</div>`;
      }).join('')}
      ${diaryTagFilter.length?`<button class="btn-link" onclick="diaryTagFilter=[];renderDiaryGrid()">Clear</button>`:''}
    </div>`;
  }

  const dayJobs=jobs.filter(j=>!j.is_deleted&&j.booked_at&&sameLocalDate(new Date(j.booked_at),d)&&jobMatchesTagFilter(j));
  // Flatten every job into its hoist "occupations" — 1 for a simple job,
  // N for a multi-stop job — so each stop renders as its own block.
  const occupations=[];
  dayJobs.forEach(j=>{getJobOccupations(j).forEach(o=>occupations.push({job:j,...o}))});
  const unassigned=dayJobs.filter(j=>!getJobOccupations(j).length).sort((a,b)=>new Date(a.booked_at)-new Date(b.booked_at));
  const totalHours=DAY_VIEW_END_HOUR-DAY_VIEW_START_HOUR;
  const gridHeight=totalHours*HOIST_PX_PER_HOUR;
  const labelStart=Math.ceil(DAY_VIEW_START_HOUR),labelEnd=Math.floor(DAY_VIEW_END_HOUR);

  // "Now" line — only meaningful when looking at today, and only within the
  // configured business hours. Re-rendered every 60s (see the interval at
  // the bottom of this function) so it actually travels down the page
  // without needing a manual refresh.
  const now=new Date();
  const nowHour=now.getHours()+now.getMinutes()/60;
  const showNowLine=isToday&&nowHour>=DAY_VIEW_START_HOUR&&nowHour<=DAY_VIEW_END_HOUR;
  const nowTop=(nowHour-DAY_VIEW_START_HOUR)*HOIST_PX_PER_HOUR;
  const nowLineHtml=showNowLine?`<div class="hoist-now-line" style="top:${nowTop}px"></div>`:'';

  // Hour grid. Same lines, same positions as the old repeating-linear-gradient
  // (a rule on the last pixel of every hour band) — but drawn as real 1px
  // hairlines on --border rather than a gradient fill.
  const hourRulesHtml=Array.from(
    {length:Math.max(0,Math.ceil(gridHeight/HOIST_PX_PER_HOUR)-1)},
    (_,i)=>`<div class="hoist-hour-rule" style="top:${(i+1)*HOIST_PX_PER_HOUR-1}px"></div>`
  ).join('');

  h+='<div class="hoist-day-wrap">';
  h+=`<div class="hoist-time-col">
    <div class="hoist-group-label">&nbsp;</div>
    <div class="hoist-col-header">&nbsp;</div>
    <div class="hoist-time-labels" style="height:${gridHeight}px">
      ${Array.from({length:Math.max(0,labelEnd-labelStart+1)},(_,i)=>labelStart+i).map(hr=>`<div class="hoist-time-label" style="top:${(hr-DAY_VIEW_START_HOUR)*HOIST_PX_PER_HOUR}px">${formatHourLabel(hr)}</div>`).join('')}
      ${showNowLine?`<div class="hoist-now-label" style="top:${nowTop}px">${now.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</div>`:''}
    </div>
  </div>`;

  ['tyre_shop','workshop'].forEach(div=>{
    h+=`<div class="hoist-group"><div class="hoist-group-label">${esc(divisionLabel(div))}</div><div class="hoist-group-cols">`;
    HOISTS.filter(hh=>hh.division===div).forEach(hh=>{
      const occHere=occupations.filter(o=>o.division===div&&o.bay===hh.bay).sort((a,b)=>a.start-b.start);
      h+=`<div class="hoist-col">
        <div class="hoist-col-header">${esc(hh.label)}</div>
        <div class="hoist-lane" style="height:${gridHeight}px" ondragover="onDiaryDragOver(event)" ondragleave="onDiaryDragLeave(event)" ondrop="onHoistDrop(event,'${div}','${hh.bay}','${dateStr}')">
          ${hourRulesHtml}
          ${occHere.map(o=>{
            const j=o.job;
            const startHour=o.start.getHours()+o.start.getMinutes()/60;
            const top=Math.max(0,(startHour-DAY_VIEW_START_HOUR)*HOIST_PX_PER_HOUR);
            const durHours=(o.end-o.start)/3600000;
            const height=Math.max(24,durHours*HOIST_PX_PER_HOUR-2);
            const contact=j.customer?.mobile||j.customer?.phone||'';
            const legsForJob=jobLegsMap[j.id];
            const stopTag=legsForJob&&legsForJob.length>1?`<span class="hoist-stop-tag">Stop ${(o.leg?.sequence??0)+1}/${legsForJob.length}</span>`:'';
            const legIdArg=o.leg?`,'${o.leg.id}'`:'';
            const isNow=isToday&&now>=o.start&&now<o.end;
            const blockClickHandler=(legsForJob&&legsForJob.length>1)?`openJobFromDiary('${j.id}')`:`openHoistBlockEditModal('${j.id}')`;
            return `<div class="hoist-block ${j.status}${isNow?' current-now':''}" draggable="true" style="top:${top}px;height:${height}px" ondragstart="onDiaryDragStart(event,'${j.id}'${legIdArg})" ondragend="onDiaryDragEnd(event)" onclick="event.stopPropagation();${blockClickHandler}">
              <div class="hoist-block-time">${isNow?'<span class="hoist-now-badge">NOW</span> ':''}${o.start.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}${stopTag}</div>
              <div class="hoist-block-type">${esc(j.job_type)}</div>
              <div class="hoist-block-sub">${esc(j.customer?.name||'—')}${contact?' · '+esc(contact):''}</div>
            </div>`;
          }).join('')}
          ${nowLineHtml}
        </div>
      </div>`;
    });
    h+='</div></div>';
  });

  h+=`<div class="hoist-unassigned">
    <div class="hoist-group-label">&nbsp;</div>
    <div class="hoist-col-header">Unassigned</div>
    <div class="hoist-unassigned-body" ondragover="onDiaryDragOver(event)" ondragleave="onDiaryDragLeave(event)" ondrop="onHoistUnassignDrop(event,'${dateStr}')">
      ${unassigned.length?unassigned.map(j=>{
        const contact=j.customer?.mobile||j.customer?.phone||'';
        return `<div class="hoist-unassigned-card" draggable="true" ondragstart="onDiaryDragStart(event,'${j.id}')" ondragend="onDiaryDragEnd(event)" onclick="openHoistBlockEditModal('${j.id}')">
          <strong>${new Date(j.booked_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</strong> ${esc(j.job_type)}<br>${esc(j.customer?.name||'—')}${contact?' · '+esc(contact):''}
        </div>`;
      }).join(''):'<div class="list-empty" style="padding:var(--space-4) var(--space-2)">No unassigned jobs today.</div>'}
    </div>
  </div>`;

  h+='</div>'; // hoist-day-wrap
  main.innerHTML=h;

  // renderHoistDayView() is a pure re-render over already-loaded state (no
  // network calls), so the cheapest way to make the "now" line actually
  // travel is to just redraw the whole view once a minute while it's the
  // active tab — re-check diarySubView inside the callback so this stops
  // rescheduling itself the moment the user switches away.
  clearInterval(hoistDayClockInterval);
  hoistDayClockInterval=setInterval(()=>{if(diarySubView==='day')renderHoistDayView()},60000);
}

// Dropping a block onto a hoist lane snaps it to the vertical drop position
// (nearest 15 minutes), blocked by the same conflict check used in the New
// Job modal. A simple job's division/bay/booked_at move as before; one stop
// of a multi-stop job gets its own division/bay/start_offset_hours instead,
// leaving the job's other stops untouched.
async function onHoistDrop(e,division,bay,dateStr){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const item=draggingItem;
  draggingItem=null;
  if(!item)return;
  if(fullDays.includes(dateStr)){showToast('That day is locked — unmark it as full first');return}
  const j=jobs.find(x=>x.id===item.jobId);
  if(!j)return;
  const rect=e.currentTarget.getBoundingClientRect();
  const offsetY=e.clientY-rect.top;
  const rawHour=DAY_VIEW_START_HOUR+offsetY/HOIST_PX_PER_HOUR;
  const snapped=Math.max(DAY_VIEW_START_HOUR,Math.round(rawHour*4)/4);
  const hh=Math.floor(snapped);
  const mm=Math.round((snapped-hh)*60);
  const [y,m,dd]=dateStr.split('-').map(Number);
  const newDate=new Date(y,m-1,dd,hh,mm);

  if(item.legId){
    const legs=jobLegsMap[j.id]||[];
    const leg=legs.find(l=>l.id===item.legId);
    if(!leg)return;
    const duration=Number(leg.duration_hours)||0.5;
    const conflict=findHoistConflict(division,bay,newDate,duration,{legId:leg.id});
    if(conflict){showToast(`${bay} is already booked then for ${conflict.job.job_type} (${conflict.job.customer?.name||'—'})`);return}
    const offsetHours=(newDate.getTime()-new Date(j.booked_at).getTime())/3600000;
    const old={division:leg.division,bay:leg.bay,start_offset_hours:leg.start_offset_hours};
    leg.division=division;leg.bay=bay;leg.start_offset_hours=offsetHours;
    renderDiaryGrid();
    try{
      const {error}=await sb.from('desk_job_hoist_legs').update({division,bay,start_offset_hours:offsetHours}).eq('id',leg.id);
      if(error)throw error;
      showToast('Stop rescheduled');
    }catch(err){
      Object.assign(leg,old);
      renderDiaryGrid();
      showToast('Could not reschedule stop');
    }
    return;
  }

  const duration=jobDurationHours(j);
  const conflict=findHoistConflict(division,bay,newDate,duration,{jobId:j.id});
  if(conflict){
    showToast(`${bay} is already booked then for ${conflict.job.job_type} (${conflict.job.customer?.name||'—'})`);
    return;
  }
  const old={division:j.division,bay:j.bay,booked_at:j.booked_at};
  j.division=division;j.bay=bay;j.booked_at=newDate.toISOString();
  renderDiaryGrid();
  try{
    const {error}=await sb.from('desk_jobs').update({division,bay,booked_at:j.booked_at,updated_at:new Date().toISOString()}).eq('id',j.id);
    if(error)throw error;
    showToast('Job rescheduled');
  }catch(err){
    Object.assign(j,old);
    renderDiaryGrid();
    showToast('Could not reschedule job');
  }
}

// Dropping onto the Unassigned column frees up whatever hoist a *simple*
// job had (keeps its booked time). Individual stops of a multi-stop job
// aren't unassignable this way yet — drag them to a different hoist lane
// instead.
async function onHoistUnassignDrop(e,dateStr){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const item=draggingItem;
  draggingItem=null;
  if(!item)return;
  if(item.legId){showToast('Drag this stop to a different hoist instead — per-stop removal isn’t supported yet');return}
  if(fullDays.includes(dateStr)){showToast('That day is locked — unmark it as full first');return}
  const j=jobs.find(x=>x.id===item.jobId);
  if(!j||(!j.division&&!j.bay))return;
  const old={division:j.division,bay:j.bay};
  j.division=null;j.bay=null;
  renderDiaryGrid();
  try{
    const {error}=await sb.from('desk_jobs').update({division:null,bay:null,updated_at:new Date().toISOString()}).eq('id',j.id);
    if(error)throw error;
    showToast('Removed from hoist');
  }catch(err){
    Object.assign(j,old);
    renderDiaryGrid();
    showToast('Could not update');
  }
}

// On reload, ask Supabase for the current verified session rather than
// trusting anything held client-side — same pattern as the Hub.
window.onload=async()=>{
  checkHubToken();
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user) await enterSession(session.user);
};

const ROLE_NAMES = { admin: "المخزن الرئيسي / الإدارة", branch: "مدير فرع", auditor: "مراقب إقليمي" };
const NAVIGATION = {
  admin: [["overview", "نظرة عامة", "⌂"], ["orders", "طلبات الفروع", "▤"], ["stock", "مخزون المخزن", "▣"], ["transfers", "تحويلات الفروع", "⇄"], ["waste", "الهالك والتست", "♲"], ["reports", "حركة المخزون", "▥"], ["users", "إدارة المستخدمين", "♙"], ["branches", "الفروع", "⌖"], ["products", "الأصناف", "▦"]],
  branch: [["overview", "الرئيسية", "⌂"], ["orders", "طلباتي", "▤"], ["transfers", "تحويلات الفروع", "⇄"], ["waste", "الهالك والتست", "♲"], ["stock", "مخزون الفرع", "▣"], ["reports", "وارد الفرع", "▥"], ["products", "الأصناف", "▦"]],
  auditor: [["overview", "الرئيسية", "⌂"], ["waste", "مراجعة الهالك والتست", "♲"], ["transfers", "مراجعة التحويلات", "⇄"], ["orders", "طلبات الفروع", "▤"], ["branches", "الفروع التابعة", "⌖"], ["reports", "حركة المخزون", "▥"]]
};
const PAGE_TITLES = {
  overview: "نظرة عامة", orders: "طلبات التوريد", stock: "المخزون", transfers: "تحويلات الفروع",
  waste: "الهالك والتست", reports: "حركة المخزون", users: "إدارة المستخدمين", branches: "الفروع", products: "الأصناف"
};
const STATUS_AR = {
  pending: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض", shipped: "تم الشحن",
  received: "تم الاستلام"
};
const MOVEMENT_AR = {
  warehouse_receipt: "توريد للمخزن", order_shipment: "صرف طلبية لفرع", order_receipt: "استلام طلبية",
  transfer_out: "تحويل صادر", transfer_in: "تحويل وارد", waste_approved: "هالك معتمد",
  waste_rejected_deficit: "عجز من هالك مرفوض", test_approved: "تست يومي معتمد"
};
let currentUser = null;
let csrfToken = "";
let databaseType = "sqlite";
let branches = [];
let products = [];
let orderCart = new Map();
let orderNote = "";
let orderImportUnmatched = [];
let stockBranchFilter = "";
let activePage = "overview";
let reportFilters = null;
let productCategory = "الكل";
let ordersRefreshTimer = null;
let reviewRefreshTimer = null;
let notificationRefreshTimer = null;
let pageLoadController = null;
let pageLoadId = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const statusName = (status) => STATUS_AR[status] || status;
const categoryName = (type) => type === "waste" ? "هالك" : "تست يومي";

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const signal = options.signal || ((options.method || "GET") === "GET" ? pageLoadController?.signal : undefined);
  const response = await fetch(path, { ...options, headers, signal, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && currentUser) {
      currentUser = null;
      csrfToken = "";
      renderAuth("login", "انتهت الجلسة. سجّل الدخول مرة أخرى.");
    }
    throw new Error(data?.error || "تعذر تنفيذ الطلب. حاول مرة أخرى.");
  }
  return data;
}
const jsonRequest = (method, body) => ({ method, body: JSON.stringify(body) });

function renderAuth(mode, message = "", setupTokenRequired = false) {
  $("#app-shell").hidden = true;
  const setup = mode === "setup";
  $("#auth-root").innerHTML = `<main class="auth-page"><section class="auth-card">
    <a class="brand auth-brand" href="#"><img class="brand-logo" src="logo.png" alt="شعار كوفتا" /><span class="brand-copy"><small>إدارة الفروع والمخزون</small></span></a>
    <div class="auth-kicker">${setup ? "إعداد أول مسؤول" : "نظام إدارة الفروع"}</div>
    <h1>${setup ? "تجهيز النظام" : "تسجيل الدخول"}</h1>
    <p>${setup ? "أنشئ حساب الإدارة الأول. لا يوجد اسم مستخدم أو كلمة مرور افتراضية." : "أدخل بيانات حسابك للوصول إلى لوحة العمل."}</p>
    ${message ? `<div class="form-message">${escapeHTML(message)}</div>` : ""}
    <form id="${setup ? "setup-form" : "login-form"}">
      ${setup ? `<label class="field"><span>الاسم الظاهر</span><input name="display_name" autocomplete="name" required maxlength="80" placeholder="اسم مسؤول النظام" /></label>` : ""}
      ${setup && setupTokenRequired ? `<label class="field"><span>مفتاح الإعداد الآمن</span><input name="setup_token" type="password" autocomplete="off" required maxlength="256" /></label>` : ""}
      <label class="field"><span>اسم المستخدم</span><input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._\\-]+" placeholder="مثال: kufta.admin" /></label>
      <label class="field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required ${setup ? "minlength=\"12\"" : ""} placeholder="${setup ? "12 حرفًا على الأقل" : "كلمة المرور"}" /></label>
      <button class="button button-primary auth-submit" type="submit">${setup ? "إنشاء حساب الإدارة" : "دخول آمن"}</button>
    </form>
    <div class="auth-footnote"><span class="secure-mark">●</span> اتصال محمي بالجلسات والصلاحيات</div>
  </section></main>`;
}

async function start() {
  try {
    const bootstrap = await api("/api/bootstrap");
    databaseType = bootstrap.database_type || "sqlite";
    if (bootstrap.setup_required) {
      renderAuth("setup", "", bootstrap.setup_token_required);
      return;
    }
    try {
      const session = await api("/api/me");
      await acceptSession(session);
    } catch (error) {
      if (error.message.includes("سجّل الدخول") || error.message.includes("انتهت الجلسة")) renderAuth("login");
      else throw error;
    }
  } catch (error) {
    renderAuth("login", `${error.message} تأكد من تشغيل خادم النظام.`);
  }
}
async function acceptSession(session) {
  currentUser = session.user;
  csrfToken = session.csrf_token;
  $("#auth-root").innerHTML = "";
  $("#app-shell").hidden = false;
  $("#user-name").textContent = currentUser.display_name;
  $("#user-subtitle").textContent = currentUser.username;
  $("#role-label").textContent = ROLE_NAMES[currentUser.role];
  $("#user-initial").textContent = currentUser.display_name.slice(0, 1);
  $("#top-avatar").textContent = currentUser.display_name.slice(0, 1);
  $("#password-button").hidden = currentUser.role !== "admin";
  activePage = "overview";
  await refreshBranches();
  await refreshNotifications();
  clearInterval(notificationRefreshTimer);
  notificationRefreshTimer = window.setInterval(() => {
    if (currentUser) void refreshNotifications();
  }, 60000);
  renderNav();
  loadPage(activePage);
}
async function refreshBranches() {
  try { branches = await api("/api/branches"); }
  catch (error) { console.error("تعذر تحميل الفروع المصرح بها", error); }
}
async function refreshNotifications() {
  try {
    const data = await api("/api/notifications");
    const badge = $("#notification-count");
    badge.textContent = data.unread ? String(data.unread) : "";
    badge.hidden = !data.unread;
  } catch (error) { console.error("تعذر تحميل الإشعارات", error); }
}
function renderNav() {
  $("#navigation").innerHTML = NAVIGATION[currentUser.role].map(([id, name, icon]) =>
    `<button class="nav-item ${activePage === id ? "active" : ""}" data-page="${id}"><span class="nav-icon">${icon}</span><span>${name}</span></button>`
  ).join("");
}
function heading(title, description, actions = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function statusBadge(status) {
  let style = "status-waiting";
  if (["approved", "received", "active"].includes(status)) style = "status-approved";
  if (["shipped"].includes(status)) style = "status-shipping";
  if (["rejected", "inactive"].includes(status)) style = "status-rejected";
  return `<span class="status ${style}">${escapeHTML(statusName(status === "active" ? "نشط" : status === "inactive" ? "غير نشط" : status))}</span>`;
}
function pageError(error) {
  $("#page-content").innerHTML = `<div class="page-error"><strong>تعذر تحميل البيانات</strong><span>${escapeHTML(error.message)}</span><button class="button button-secondary" data-action="retry">إعادة المحاولة</button></div>`;
}
async function loadPage(page) {
  const allowedPages = new Set(NAVIGATION[currentUser.role].map(([id]) => id));
  if (!allowedPages.has(page)) {
    toast("هذه الصفحة غير متاحة لنوع حسابك.", true);
    return;
  }
  const loadId = ++pageLoadId;
  pageLoadController?.abort();
  const controller = new AbortController();
  pageLoadController = controller;
  clearTimeout(ordersRefreshTimer);
  clearTimeout(reviewRefreshTimer);
  activePage = page;
  delete $("#page-content").dataset.category;
  renderNav();
  $("#page-breadcrumb").textContent = page === "orders" && currentUser.role === "auditor"
    ? "طلبات الفروع التابعة"
    : page === "reports" && currentUser.role === "branch" ? "وارد الفرع"
    : PAGE_TITLES[page] || "نظرة عامة";
  $("#sidebar").classList.remove("open");
  $("#current-date").textContent = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  $("#page-content").innerHTML = `<div class="loading-state"><span class="loader"></span> جارٍ تحميل البيانات...</div>`;
  try {
    if (!products.length) products = await api("/api/products");
    const renderer = {
      overview: renderOverview, orders: renderOrders, stock: renderStock, transfers: renderTransfers,
      waste: renderWaste, reports: renderReports, users: renderUsers, branches: renderBranches, products: renderProducts
    }[page];
    await renderer();
    if (loadId !== pageLoadId) return;
    if (page === "orders" && currentUser.role === "admin") scheduleOrdersRefresh();
    if (currentUser.role === "auditor" && ["overview", "orders", "transfers", "waste"].includes(page)) scheduleReviewRefresh();
  } catch (error) {
    if (loadId === pageLoadId && !controller.signal.aborted) pageError(error);
  } finally {
    if (loadId === pageLoadId) pageLoadController = null;
  }
}
function scheduleReviewRefresh() {
  clearTimeout(reviewRefreshTimer);
  reviewRefreshTimer = window.setTimeout(() => {
    if (currentUser?.role !== "auditor" || !["overview", "orders", "transfers", "waste"].includes(activePage)) return;
    if ($("#modal-layer").classList.contains("open") || document.activeElement?.matches("input, select, textarea")) {
      scheduleReviewRefresh();
      return;
    }
    void loadPage(activePage);
  }, 60000);
}
function scheduleOrdersRefresh() {
  clearTimeout(ordersRefreshTimer);
  ordersRefreshTimer = setTimeout(() => {
    if (activePage !== "orders" || currentUser?.role !== "admin") return;
    if ($("#modal-layer").classList.contains("open") || document.activeElement?.matches("input, select, textarea")) {
      scheduleOrdersRefresh();
      return;
    }
    void loadPage("orders");
  }, 60000);
}
function stat(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;
}
async function renderOverview() {
  const [counts, orders, waste] = await Promise.all([api("/api/overview"), api("/api/orders"), api("/api/waste")]);
  const pendingOrders = counts.orders_pending;
  const cards = currentUser.role === "branch"
    ? stat("طلبات بانتظار التجهيز", pendingOrders, "طلبات أرسلتها للمخزن", "▤") + stat("بلاغات بانتظار المراجعة", counts.waste_pending, "الهالك والتست اليومي", "♲") + stat("تحويلات بانتظار المراجعة", counts.transfers_pending, "تحويلات الفروع", "⇄") + stat("الأصناف", products.length, "صنف بوحداته المعتمدة", "▦")
    : currentUser.role === "auditor"
      ? stat("الفروع التابعة", branches.length, "فروع مربوطة بحسابك", "⌖") + stat("بلاغات تحتاج مراجعتك", counts.waste_pending, "هالك أو تست", "♲") + stat("تحويلات تحتاج مراجعتك", counts.transfers_pending, "طلبات تحويل جديدة", "⇄") + stat("طلبات التوريد", pendingOrders, "من الفروع التابعة", "▤")
      : stat("طلبات تحتاج تجهيزًا", pendingOrders, "طلبات الفروع الواردة", "▤") + stat("تم شحنها وتنتظر الاستلام", counts.orders_shipped, "تأكيد الفرع للاستلام", "▣") + stat("بلاغات بانتظار المراجعة", counts.waste_pending, "من الفروع", "♲") + stat("الفروع النشطة", counts.branches, "مسجلة في قاعدة البيانات", "⌖");
  const primaryAction = currentUser.role === "branch" ? `<button class="button button-primary" data-action="new-order">＋ طلب توريد</button>` : currentUser.role === "admin" ? `<button class="button button-primary" data-page="stock">＋ تسجيل توريد مخزن</button>` : "";
  const list = currentUser.role === "branch" ? orders.slice(0, 5) : orders.slice(0, 7);
  const rows = list.map((order) => `<tr><td class="cell-primary">${escapeHTML(order.code)}</td><td>${escapeHTML(order.branch_name)}</td><td>${order.items.length} أصناف</td><td>${dateText(order.created_at)}</td><td>${statusBadge(order.status)}</td></tr>`).join("");
  const pending = waste.filter((item) => item.status === "pending").slice(0, 4);
  $("#page-content").innerHTML = `${heading(`أهلًا ${escapeHTML(currentUser.display_name)}`, dashboardDescription(), primaryAction)}
    <div class="stats-grid">${cards}</div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>سير العمل</h2><div class="panel-subtitle">كل خطوة واضحة للفرع والمخزن والمراقب</div></div></div>
        <div class="workflow"><div class="workflow-step"><span>١</span><div><strong>طلب الفرع</strong><small>الفرع يحدد الأصناف والكميات</small></div></div><div class="workflow-arrow">←</div><div class="workflow-step"><span>٢</span><div><strong>تجهيز المخزن</strong><small>صرف الكمية المتاحة وتأكيد الشحن</small></div></div><div class="workflow-arrow">←</div><div class="workflow-step"><span>٣</span><div><strong>تأكيد الاستلام</strong><small>الفرع يسجل الكمية الفعلية</small></div></div></div>
      </section>
      <section class="panel"><div class="panel-header"><div><h2>${currentUser.role === "auditor" ? "بلاغات للمراجعة" : "آخر البلاغات"}</h2><div class="panel-subtitle">حالة حقيقية من قاعدة البيانات</div></div><button class="text-link" data-page="waste">عرض الكل ←</button></div>
        <div class="activity-list">${pending.length ? pending.map((item) => `<div class="activity-item"><span class="activity-icon">♲</span><div><strong>${escapeHTML(categoryName(item.report_type))} · ${escapeHTML(item.product)}</strong><small>${escapeHTML(item.branch_name)} · ${item.quantity} ${escapeHTML(item.unit)}</small></div></div>`).join("") : `<div class="empty-state compact">لا توجد بلاغات معلقة</div>`}</div>
      </section>
    </div>
    <section class="table-panel"><div class="table-toolbar"><div><h2>آخر طلبات التوريد</h2><div class="panel-subtitle">تتحدّث الحالة عند الشحن والاستلام</div></div><button class="text-link" data-page="orders">عرض كل الطلبات ←</button></div>
      <div class="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>الفرع</th><th>الأصناف</th><th>تاريخ الطلب</th><th>الحالة</th></tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="empty-state">لا توجد طلبات بعد</div></td></tr>`}</tbody></table></div></section>`;
}
function dashboardDescription() {
  if (currentUser.role === "branch") return "طلبات الفرع والمخزون والهالك كلها في مكان واحد.";
  if (currentUser.role === "auditor") return "راجع بلاغات وتحويلات وطلبات الفروع المربوطة بحسابك؛ تتحدث القوائم تلقائيًا.";
  return "جهّز الطلبات، راقب أرصدة المخزن، وأدر حسابات الفروع.";
}
function dateText(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function searchToolbar(title, count) {
  return `<div class="table-toolbar"><h2>${title} <span class="inventory-badge">(${count})</span></h2><div class="search-box"><input data-search placeholder="ابحث في القائمة" aria-label="ابحث في القائمة" /></div></div>`;
}
async function renderOrders() {
  const orders = await api("/api/orders");
  const admin = currentUser.role === "admin";
  const rows = orders.map((order) => `<tr data-order-id="${order.id}" data-code="${escapeHTML(order.code)}" data-branch="${escapeHTML(order.branch_name)}" data-requester="${escapeHTML(order.requester)}" data-created-at="${escapeHTML(order.created_at)}" data-note="${escapeHTML(order.note)}" data-items="${escapeHTML(JSON.stringify(order.items))}" data-searchable="${escapeHTML(`${order.code} ${order.branch_name} ${order.requester}`)}">
    <td class="cell-primary">${escapeHTML(order.code)}<span class="cell-secondary">${escapeHTML(order.requester)}</span></td><td>${escapeHTML(order.branch_name)}</td>
    <td>${order.items.map((item) => `${escapeHTML(item.product)}: ${item.quantity} ${escapeHTML(item.unit)}`).join("، ")}</td><td>${dateText(order.created_at)}</td><td>${statusBadge(order.status)}</td>
    <td>${admin ? `<div class="inline-actions"><button class="button button-secondary button-sm" data-action="print-order" data-id="${order.id}">طباعة إذن</button>${order.status === "pending" ? `<button class="button button-primary button-sm" data-action="ship-order" data-id="${order.id}">تجهيز وشحن</button>` : ""}</div>` : currentUser.role === "branch" && order.status === "shipped" ? `<button class="button button-secondary button-sm" data-action="receive-order" data-id="${order.id}">تأكيد الاستلام</button>` : "—"}</td></tr>`).join("");
  const title = admin ? "طلبات الفروع" : currentUser.role === "auditor" ? "طلبات الفروع التابعة" : "طلباتي";
  const description = admin ? "تظهر الطلبات الجديدة تلقائيًا. اطبع إذن التجهيز قبل تحضير الشحنة." : currentUser.role === "auditor" ? "عرض للمتابعة فقط لطلبات الفروع المرتبطة بحسابك، ويتحدث تلقائيًا." : "اختر الأصناف والكميات، ثم تابع الشحن والاستلام.";
  $("#page-content").innerHTML = `${heading(title, description, currentUser.role === "branch" ? `<button class="button button-primary" data-action="new-order">＋ طلب توريد جديد</button>` : "")}
    <section class="table-panel">${searchToolbar("سجل الطلبات", orders.length)}<div class="table-wrap"><table><thead><tr><th>رقم الطلب / مقدم الطلب</th><th>الفرع</th><th>الأصناف والكميات</th><th>تاريخ الإنشاء</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="empty-state"><strong>لا توجد طلبات حتى الآن</strong>${currentUser.role === "branch" ? "ابدأ بطلب التوريد من الزر أعلى الصفحة." : "ستظهر هنا الطلبات التي يرسلها مديرو الفروع."}</div></td></tr>`}</tbody></table></div></section>`;
}
async function renderTransfers() {
  const transfers = await api("/api/transfers");
  const rows = transfers.map((item) => {
    let action = "—";
    if (currentUser.role === "auditor" && item.status === "pending") action = `<div class="inline-actions"><button class="button button-primary button-sm" data-action="review-transfer" data-decision="approve" data-id="${item.id}">اعتماد</button><button class="button button-danger button-sm" data-action="review-transfer" data-decision="reject" data-id="${item.id}">رفض</button></div>`;
    if (currentUser.role === "branch" && item.status === "approved" && item.from_branch_id === currentUser.branch_id) action = `<button class="button button-secondary button-sm" data-action="ship-transfer" data-id="${item.id}">تأكيد الإرسال</button>`;
    if (currentUser.role === "branch" && item.status === "shipped" && item.to_branch_id === currentUser.branch_id) action = `<button class="button button-secondary button-sm" data-action="receive-transfer" data-id="${item.id}">تأكيد الاستلام</button>`;
    return `<tr data-searchable="${escapeHTML(`${item.code} ${item.from_name} ${item.to_name} ${item.product}`)}"><td class="cell-primary">${escapeHTML(item.code)}</td><td>${escapeHTML(item.from_name)}</td><td>${escapeHTML(item.to_name)}</td><td>${escapeHTML(item.product)}</td><td>${item.quantity} ${escapeHTML(item.unit)}</td><td>${dateText(item.created_at)}</td><td>${statusBadge(item.status)}${item.review_note ? `<span class="cell-secondary">${escapeHTML(item.review_note)}</span>` : ""}</td><td>${action}</td></tr>`;
  }).join("");
  $("#page-content").innerHTML = `${heading("تحويلات الفروع", "طلب التحويل يمر بالمراجعة ثم تأكيد الإرسال والاستلام.", currentUser.role === "branch" ? `<button class="button button-primary" data-action="new-transfer">＋ طلب تحويل</button>` : "")}
    <section class="table-panel">${searchToolbar("سجل التحويلات", transfers.length)}<div class="table-wrap"><table><thead><tr><th>رقم التحويل</th><th>من فرع</th><th>إلى فرع</th><th>الصنف</th><th>الكمية</th><th>تاريخ الطلب</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${rows || `<tr><td colspan="8"><div class="empty-state">لا توجد تحويلات مسجلة</div></td></tr>`}</tbody></table></div></section>`;
}
async function renderWaste() {
  const reports = await api("/api/waste");
  const rows = reports.map((item) => {
    const actions = currentUser.role === "auditor" && item.status === "pending"
      ? `<div class="inline-actions"><button class="button button-primary button-sm" data-action="review-waste" data-decision="approve" data-id="${item.id}">اعتماد</button><button class="button button-danger button-sm" data-action="review-waste" data-decision="reject" data-id="${item.id}">رفض</button></div>` : "—";
    return `<tr data-searchable="${escapeHTML(`${item.code} ${item.branch_name} ${item.product}`)}"><td class="cell-primary">${escapeHTML(item.code)}</td><td>${escapeHTML(item.branch_name)}</td><td>${categoryName(item.report_type)}<span class="cell-secondary">${escapeHTML(item.product)}</span></td><td>${item.quantity} ${escapeHTML(item.unit)}</td>
      <td><a class="evidence-link" href="${escapeHTML(item.image_url)}" target="_blank" rel="noopener"><img class="evidence-thumb" src="${escapeHTML(item.image_url)}" alt="إثبات ${escapeHTML(item.code)}" />عرض الإثبات</a></td><td>${dateText(item.created_at)}</td><td>${statusBadge(item.status)}${item.review_note ? `<span class="cell-secondary">${escapeHTML(item.review_note)}</span>` : ""}</td><td>${actions}</td></tr>`;
  }).join("");
  $("#page-content").innerHTML = `${heading(currentUser.role === "auditor" ? "مراجعة الهالك والتست" : "الهالك والتست اليومي", currentUser.role === "branch" ? "سجّل البلاغ مع صورة إثبات؛ المراقب يراجعه من حسابه." : "راجع صورة الإثبات واعتمد البلاغ أو ارفضه مع كتابة السبب.", currentUser.role === "branch" ? `<button class="button button-primary" data-action="new-waste">＋ تسجيل بلاغ</button>` : "")}
    <div class="notice-banner">${currentUser.role === "branch" ? "صورة الإثبات إلزامية. عند رفض بلاغ الهالك، تُسجل الكمية كعجز على الفرع." : "الاعتماد أو الرفض يُسجل في سجل حركة المخزون. رفض الهالك يُسجل كعجز."}</div>
    <section class="table-panel">${searchToolbar("البلاغات المسجلة", reports.length)}<div class="table-wrap"><table><thead><tr><th>رقم البلاغ</th><th>الفرع</th><th>النوع / الصنف</th><th>الكمية</th><th>صورة الإثبات</th><th>التاريخ</th><th>الحالة / الملاحظة</th><th>الإجراء</th></tr></thead><tbody>${rows || `<tr><td colspan="8"><div class="empty-state">لا توجد بلاغات مسجلة</div></td></tr>`}</tbody></table></div></section>`;
}
async function renderStock() {
  const stock = await api("/api/stock");
  const auditor = currentUser.role === "auditor";
  const visibleStock = auditor && stockBranchFilter
    ? stock.filter((item) => String(item.branch_id) === stockBranchFilter)
    : stock;
  let rows;
  let actions = "";
  let description = "الرصيد محسوب من كل عمليات الاستلام والصرف والتحويل المسجلة.";
  if (currentUser.role === "admin") {
    rows = visibleStock.map((item) => `<tr data-searchable="${escapeHTML(`${item.category} ${item.name}`)}"><td>${escapeHTML(item.category)}</td><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.unit)}</td><td class="cell-primary">${item.quantity}</td></tr>`).join("");
    actions = `<button class="button button-primary" data-action="stock-entry">＋ تسجيل توريد مخزن</button>`;
    description = "الرصيد الفعلي للمخزن الرئيسي. لا يمكن شحن طلبية تتجاوز الرصيد المتاح.";
  } else if (currentUser.role === "branch") {
    rows = visibleStock.map((item) => `<tr data-searchable="${escapeHTML(`${item.category} ${item.name}`)}"><td>${escapeHTML(item.category)}</td><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.unit)}</td><td class="cell-primary">${item.quantity}</td></tr>`).join("");
    description = "كشف رصيد الفرع الحالي محسوب من الحركات المسجلة؛ يمكنك البحث والطباعة.";
  } else {
    rows = visibleStock.map((item) => `<tr data-searchable="${escapeHTML(`${item.branch_name} ${item.category} ${item.name}`)}"><td>${escapeHTML(item.branch_name)}</td><td>${escapeHTML(item.category)}</td><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.unit)}</td><td class="cell-primary">${item.quantity}</td></tr>`).join("");
    description = "أرصدة الفروع المربوطة بحسابك فقط، محسوبة من سجل حركات المخزون.";
  }
  const headers = currentUser.role === "auditor" ? "<th>الفرع</th><th>المجموعة</th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th>" : "<th>المجموعة</th><th>الصنف</th><th>الوحدة</th><th>الرصيد المتاح</th>";
  const auditorFilter = auditor
    ? `<label class="field report-filter stock-branch-filter"><span>الفرع</span><select id="stock-branch-filter"><option value="">كل الفروع التابعة</option>${branches.map((branch) => `<option value="${branch.id}" ${String(branch.id) === stockBranchFilter ? "selected" : ""}>${escapeHTML(branch.name)}</option>`).join("")}</select></label>`
    : "";
  const printButton = `<button class="button button-secondary" data-action="print-stock">طباعة كشف الرصيد</button>`;
  const emptyMessage = auditor && !stock.length ? "لا توجد أرصدة لفروع مربوطة بحسابك." : "لا توجد أصناف ضمن هذا العرض.";
  $("#page-content").innerHTML = `${heading(currentUser.role === "admin" ? "مخزون المخزن الرئيسي" : currentUser.role === "branch" ? "مخزون الفرع" : "أرصدة الفروع التابعة", description, `<div class="inline-actions stock-report-actions">${auditorFilter}${printButton}${actions}</div>`)}
    <div class="notice-banner stock-report-note">هذا كشف بالأرصدة المسجلة حتى ${escapeHTML(dateText(new Date().toISOString()))}. التقرير للعرض والمتابعة فقط ولا يغير الرصيد؛ أي فرق فعلي يحتاج مراجعة واعتمادًا منفصلًا.</div>
    <section class="table-panel">${searchToolbar(`الأرصدة الحالية (${visibleStock.length})`, visibleStock.length)}<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="empty-state">${emptyMessage}</div></td></tr>`}</tbody></table></div></section>`;
}
function printStockReport() {
  const table = $("#page-content table");
  if (!table) throw new Error("تعذر العثور على كشف الأرصدة للطباعة.");
  const headers = $$("thead th", table).map((cell) => `<th>${escapeHTML(cell.innerText)}</th>`).join("");
  const rows = $$("tbody tr", table).filter((row) => !row.hidden && !$(".empty-state", row)).map((row) =>
    `<tr>${$$("td", row).map((cell) => `<td>${escapeHTML(cell.innerText)}</td>`).join("")}</tr>`
  ).join("");
  const branchName = branches.find((branch) => String(branch.id) === String(currentUser.branch_id))?.name;
  const location = currentUser.role === "admin" ? "المخزن الرئيسي"
    : currentUser.role === "branch" ? branchName || "الفرع التابع للحساب"
      : branches.find((branch) => String(branch.id) === stockBranchFilter)?.name || "كل الفروع التابعة";
  const title = currentUser.role === "admin" ? "كشف رصيد المخزن الرئيسي"
    : currentUser.role === "branch" ? "كشف رصيد الفرع"
      : "كشف أرصدة الفروع التابعة";
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("اسمح بالنوافذ المنبثقة لطباعة كشف الرصيد.");
  printWindow.onload = () => {
    printWindow.onafterprint = () => printWindow.close();
    printWindow.print();
  };
  const logoUrl = new URL("logo.png", window.location.href).href;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#202124;margin:0;font-size:12px}
    header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #d32f2f;padding-bottom:12px}
    img{width:140px;height:auto;background:#000}.brand{text-align:left;color:#555;font-size:11px}
    h1{font-size:20px;margin:18px 0 8px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}
    .meta div{border:1px solid #bbb;padding:8px}.meta strong{display:inline-block;min-width:95px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:8px;text-align:right}
    th{background:#f2f2f2}.note{border:1px solid #e1c98d;background:#fffaf0;padding:9px;margin-top:12px;font-size:10px}
    footer{margin-top:20px;color:#666;font-size:9px;text-align:center}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body><header><img src="${escapeHTML(logoUrl)}" alt="كوفتا"><div class="brand">كوفتا<br>إدارة الفروع والمخزون</div></header>
    <h1>${escapeHTML(title)}</h1><section class="meta"><div><strong>الموقع:</strong> ${escapeHTML(location)}</div>
    <div><strong>وقت التقرير:</strong> ${escapeHTML(dateText(new Date().toISOString()))}</div><div><strong>أعدّه:</strong> ${escapeHTML(currentUser.display_name)}</div>
    <div><strong>عدد الأصناف:</strong> ${$$("tbody tr", table).filter((row) => !row.hidden && !$(".empty-state", row)).length}</div></section>
    <table><thead><tr>${headers}</tr></thead><tbody>${rows || `<tr><td colspan="${$$("thead th", table).length}">لا توجد أصناف لعرضها</td></tr>`}</tbody></table>
    <div class="note">كشف للعرض والمتابعة فقط، محسوب من حركات المخزون المسجلة حتى وقت التقرير. لا يعد جردًا فعليًا ولا يغيّر أرصدة النظام؛ راجع المسؤول عن أي اختلاف.</div>
    <footer>كوفتا لإدارة الفروع والمخزون</footer></body></html>`);
  printWindow.document.close();
}
async function renderReports() {
  const today = new Date();
  const dateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (!reportFilters) {
    reportFilters = {
      from: dateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: dateValue(today),
      branch_id: "",
      movement_type: currentUser.role === "auditor" ? "all" : "order_receipt"
    };
  }
  const reportStart = new Date(`${reportFilters.from}T00:00:00`);
  const reportEnd = new Date(`${reportFilters.to}T00:00:00`);
  reportEnd.setDate(reportEnd.getDate() + 1);
  const params = new URLSearchParams({
    from_ts: reportStart.toISOString(),
    to_ts: reportEnd.toISOString(),
    movement_type: reportFilters.movement_type
  });
  if (reportFilters.branch_id) params.set("branch_id", reportFilters.branch_id);
  const report = await api(`/api/reports?${params}`);
  const summaryRows = report.summary.map((item) => `<tr><td>${escapeHTML(item.branch_name)}</td><td>${escapeHTML(item.product)}</td><td>${escapeHTML(item.unit)}</td><td>${item.opening_balance}</td><td class="positive-quantity">${item.inbound_quantity}</td><td class="negative-quantity">${item.outbound_quantity}</td><td class="${item.quantity < 0 ? "negative-quantity" : "positive-quantity"}">${item.quantity > 0 ? "+" : ""}${item.quantity}</td><td class="${item.closing_balance < 0 ? "negative-quantity" : "positive-quantity"}">${item.closing_balance}</td><td>${item.movement_count}</td><td>${dateText(item.latest_at)}</td></tr>`).join("");
  const rows = report.movements.map((item) => `<tr data-searchable="${escapeHTML(`${item.branch_name || "المخزن"} ${item.product} ${item.reference} ${item.movement_type}`)}"><td>${dateText(item.created_at)}</td><td>${escapeHTML(item.branch_name || "المخزن الرئيسي")}</td><td>${escapeHTML(item.product)}</td><td>${escapeHTML(item.unit)}</td><td class="${item.quantity < 0 ? "negative-quantity" : "positive-quantity"}">${item.quantity > 0 ? "+" : ""}${item.quantity}</td><td>${escapeHTML(MOVEMENT_AR[item.movement_type] || item.movement_type)}</td><td>${escapeHTML(item.reference)}</td><td>${escapeHTML(item.actor)}</td></tr>`).join("");
  const branchFilter = currentUser.role === "branch" ? "" : `<label class="field report-filter"><span>الفرع</span><select name="branch_id"><option value="">كل الفروع المصرح بها</option>${branches.map((branch) => `<option value="${branch.id}" ${String(branch.id) === reportFilters.branch_id ? "selected" : ""}>${escapeHTML(branch.name)}</option>`).join("")}</select></label>`;
  const reportHeading = currentUser.role === "branch" ? "الوارد المستلَم للفرع" : "حركة المخزون";
  const reportDescription = currentUser.role === "branch"
    ? "تابع الأصناف والكميات التي أكد فرعك استلامها من بداية الشهر حتى اليوم، مع تاريخ ورقم كل طلبية."
    : currentUser.role === "auditor"
      ? "اختر فرعًا وفترة لمراجعة رصيد البداية والوارد والمنصرف والتحويلات وصافي الرصيد حتى نهاية الفترة."
      : "تابع الكميات التي استلمها كل فرع حسب الصنف والفترة، مع سجل موثق لكل حركة.";
  const backupAction = currentUser.role === "admin" && databaseType === "sqlite"
    ? `<button class="button button-secondary" data-action="backup">↓ نسخة احتياطية</button>`
    : "";
  $("#page-content").innerHTML = `${heading(reportHeading, reportDescription, backupAction)}
    <section class="panel report-filter-panel"><div class="form-grid report-filter-grid">
      <label class="field report-filter"><span>من تاريخ</span><input name="from" type="date" value="${escapeHTML(reportFilters.from)}" /></label>
      <label class="field report-filter"><span>إلى تاريخ</span><input name="to" type="date" value="${escapeHTML(reportFilters.to)}" /></label>
      ${branchFilter}
      <label class="field report-filter"><span>نوع الحركة</span><select name="movement_type"><option value="order_receipt" ${reportFilters.movement_type === "order_receipt" ? "selected" : ""}>استلام طلبية للفرع</option><option value="all" ${reportFilters.movement_type === "all" ? "selected" : ""}>كل الحركات، بما فيها التحويلات</option></select></label>
      <div class="report-filter-submit"><button class="button button-primary" data-action="apply-report-filters">عرض التقرير</button></div>
    </div></section>
    <section class="table-panel"><div class="table-toolbar"><div><h2>${currentUser.role === "auditor" ? "كشف رصيد الفرع وحركة الأصناف" : "ملخص الوارد حسب الفرع والصنف"}</h2><div class="panel-subtitle">إجمالي ${report.total} حركة مطابقة للفلاتر المحددة${report.truncated ? "؛ تفاصيل الحركات تعرض أحدث 5000 حركة" : ""}. رصيد البداية قبل الفترة، ورصيد النهاية حتى نهاية التاريخ المحدد.</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>الفرع / الموقع</th><th>الصنف</th><th>الوحدة</th><th>رصيد بداية الفترة</th><th>وارد</th><th>منصرف</th><th>صافي الحركة</th><th>الرصيد حتى نهاية الفترة</th><th>عدد الحركات</th><th>آخر حركة</th></tr></thead><tbody>${summaryRows || `<tr><td colspan="10"><div class="empty-state">لا توجد حركات مطابقة للفترة المحددة</div></td></tr>`}</tbody></table></div></section>
    <section class="table-panel"><div class="table-toolbar"><div><h2>تفاصيل سجل الحركات</h2><div class="panel-subtitle">التاريخ والوقت والفرع والصنف والكمية والمرجع واسم المستخدم الذي سجل الحركة.</div></div><div class="search-box"><input data-search placeholder="ابحث في الحركات" aria-label="ابحث في الحركات" /></div></div>
      <div class="table-wrap"><table><thead><tr><th>التاريخ والوقت</th><th>الموقع</th><th>الصنف</th><th>الوحدة</th><th>الكمية (+ / -)</th><th>نوع الحركة</th><th>المرجع</th><th>المستخدم</th></tr></thead><tbody>${rows || `<tr><td colspan="8"><div class="empty-state">لا توجد حركات مطابقة للفترة المحددة</div></td></tr>`}</tbody></table></div></section>`;
}
async function renderBranches() {
  if (currentUser.role === "auditor") {
    $("#page-content").innerHTML = `${heading("الفروع التابعة", "الفروع التي ربطتها الإدارة بحسابك.")}<div class="branch-cards">${branches.map((branch) => `<article class="branch-card"><span class="branch-code">${escapeHTML(branch.code)}</span><strong>${escapeHTML(branch.name)}</strong><small>فرع مرتبط بحسابك</small></article>`).join("") || `<div class="empty-state">لم تربط الإدارة أي فروع بحسابك بعد.</div>`}</div>`;
    return;
  }
  const addBranch = currentUser.role === "admin" ? `<button class="button button-primary" data-action="new-branch">＋ إضافة فرع</button>` : "";
  $("#page-content").innerHTML = `${heading("فروع كوفتا", `قائمة الفروع المسجلة: ${branches.length} فرعًا.`, addBranch)}
    ${currentUser.role === "admin" ? `<div class="notice-banner">بعد إضافة الفرع، أنشئ حساب مديره من صفحة إدارة المستخدمين واربط الحساب بالفرع.</div>` : ""}
    <div class="branch-cards">${branches.map((branch) => `<article class="branch-card"><span class="branch-code">${escapeHTML(branch.code)}</span><strong>${escapeHTML(branch.name)}</strong><small>كود الفرع: ${escapeHTML(branch.code)}</small></article>`).join("")}</div>`;
}
async function renderProducts() {
  const categories = ["الكل", ...new Set(products.map((item) => item.category))];
  if (!categories.includes(productCategory)) productCategory = "الكل";
  const visible = productCategory === "الكل" ? products : products.filter((item) => item.category === productCategory);
  const addProduct = currentUser.role === "admin" ? `<button class="button button-primary" data-action="new-product">＋ إضافة صنف</button>` : "";
  const cartSummary = currentUser.role === "branch" && orderCart.size
    ? `<div class="cart-summary"><div><strong>سلة الطلب</strong><span>${orderCart.size} صنف${orderCart.size === 1 ? "" : "ًا"} جاهز للمراجعة</span></div><button class="button button-primary" data-action="review-order">مراجعة الطلبية ←</button></div>`
    : "";
  $("#page-content").innerHTML = `${heading("الأصناف ووحدات القياس", `${products.length} صنفًا معتمدًا في قاعدة البيانات.`, addProduct)}
    ${cartSummary}
    <div class="category-tabs">${categories.map((name) => `<button class="filter-chip ${name === productCategory ? "active" : ""}" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join("")}</div>
    <div class="product-grid">${visible.map((item) => `<article class="product-card"><span class="product-category">${escapeHTML(item.category)}</span><strong>${escapeHTML(item.name)}</strong><span class="product-unit">الوحدة: ${escapeHTML(item.unit)}</span>${currentUser.role === "branch" ? `<button class="product-add" data-action="quick-order" data-product="${item.id}">＋ أضف للسلة</button>${orderCart.has(item.id) ? `<span class="cart-item-hint">في السلة: ${escapeHTML(orderCart.get(item.id).quantity)} ${escapeHTML(item.unit)}</span>` : ""}` : ""}</article>`).join("")}</div>`;
}
async function renderUsers() {
  const data = await api("/api/users");
  const auditors = data.users.filter((user) => user.role === "auditor");
  const assignments = new Map();
  data.assignments.forEach((item) => assignments.set(item.auditor_id, [...(assignments.get(item.auditor_id) || []), item.branch_id]));
  const rows = data.users.map((user) => `<tr data-searchable="${escapeHTML(`${user.display_name} ${user.username} ${user.branch_name || ""}`)}"><td class="cell-primary">${escapeHTML(user.display_name)}</td><td>${escapeHTML(user.username)}</td><td>${escapeHTML(ROLE_NAMES[user.role])}</td><td>${escapeHTML(user.branch_name || "—")}</td><td>${statusBadge(user.active ? "active" : "inactive")}</td><td>${user.id === currentUser.id ? "الحساب الحالي" : `<div class="inline-actions"><button class="button button-secondary button-sm" data-action="reset-user-password" data-id="${user.id}">تعيين كلمة مرور</button><button class="button ${user.active ? "button-danger" : "button-secondary"} button-sm" data-action="toggle-user" data-id="${user.id}" data-active="${user.active ? 0 : 1}">${user.active ? "تعطيل" : "تفعيل"}</button></div>`}</td></tr>`).join("");
  const auditorRows = auditors.map((auditor) => {
    const selected = new Set(assignments.get(auditor.id) || []);
    return `<article class="assignment-card"><div class="assignment-head"><strong>${escapeHTML(auditor.display_name)}</strong><small>${escapeHTML(auditor.username)}</small></div><div class="branch-check-grid">${branches.map((branch) => `<label><input type="checkbox" value="${branch.id}" ${selected.has(branch.id) ? "checked" : ""} /><span>${escapeHTML(branch.name)}</span></label>`).join("")}</div><button class="button button-secondary button-sm" data-action="save-assignment" data-id="${auditor.id}">حفظ الفروع التابعة</button></article>`;
  }).join("");
  $("#page-content").innerHTML = `${heading("إدارة المستخدمين", "أنشئ حسابات للفروع والمراقبين، واربط المراقب بالفروع المسؤولة منه.", `<button class="button button-primary" data-action="new-user">＋ إنشاء حساب</button>`)}
    <section class="table-panel">${searchToolbar("الحسابات", data.users.length)}<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الفرع</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel assignment-panel"><div class="panel-header"><div><h2>توزيع الفروع على المراقبين</h2><div class="panel-subtitle">حدد الفروع التي يستطيع كل مراقب رؤيتها ومراجعتها.</div></div></div>${auditorRows || `<div class="empty-state compact">أنشئ حساب مراقب أولًا.</div>`}</section>`;
}

function selectProducts(selectedId = "") {
  const groups = new Map();
  products.forEach((item) => groups.set(item.category, [...(groups.get(item.category) || []), item]));
  return `<option value="">اختر الصنف</option>${[...groups].map(([category, items]) => `<optgroup label="${escapeHTML(category)}">${items.map((item) => `<option value="${item.id}" ${String(item.id) === String(selectedId) ? "selected" : ""}>${escapeHTML(item.name)} — ${escapeHTML(item.unit)}</option>`).join("")}</optgroup>`).join("")}`;
}
function selectBranches(selectedId = "") {
  return `<option value="">اختر الفرع</option>${branches.map((branch) => `<option value="${branch.id}" ${String(branch.id) === String(selectedId) ? "selected" : ""}>${escapeHTML(branch.code)} — ${escapeHTML(branch.name)}</option>`).join("")}`;
}
function openModal(title, content, wide = false) {
  const layer = $("#modal-layer");
  layer.innerHTML = `<section class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-modal" data-action="close-modal" aria-label="إغلاق">×</button></header><div class="modal-body">${content}</div></section>`;
  layer.classList.add("open");
  layer.setAttribute("aria-hidden", "false");
}
function closeModal() {
  $("#modal-layer").classList.remove("open");
  $("#modal-layer").setAttribute("aria-hidden", "true");
  $("#modal-layer").innerHTML = "";
}
function printOrder(id) {
  const row = $(`tr[data-order-id="${id}"]`);
  if (!row) throw new Error("تعذر العثور على بيانات الطلب للطباعة.");
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("اسمح بالنوافذ المنبثقة لطباعة إذن تجهيز الطلبية.");
  printWindow.onload = () => {
    printWindow.onafterprint = () => printWindow.close();
    printWindow.print();
  };
  const items = JSON.parse(row.dataset.items);
  const itemRows = items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHTML(item.product)}</td><td>${escapeHTML(item.unit)}</td><td>${item.quantity}</td><td>${item.shipped_quantity ?? ""}</td><td>${item.received_quantity ?? ""}</td><td class="check-cell"></td></tr>`).join("");
  const logoUrl = new URL("logo.png", window.location.href).href;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إذن تجهيز ${escapeHTML(row.dataset.code)}</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#202124;margin:0;font-size:12px}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #222;padding-bottom:12px}
    img{width:150px;height:auto;background:#000}.brand{text-align:left;font-size:11px;color:#555}
    h1{font-size:20px;margin:18px 0 8px}.subtitle{color:#555;margin-bottom:16px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin:14px 0 18px}
    .meta div{border:1px solid #bbb;padding:8px}.meta strong{display:inline-block;min-width:105px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:8px;text-align:right}
    th{background:#eee}.check-cell{width:90px}
    .note{border:1px solid #bbb;min-height:44px;padding:8px;margin-top:12px}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px 20px;margin-top:35px}
    .signature{border-top:1px solid #333;padding-top:8px;min-height:55px}
    .notice{font-size:10px;color:#555;margin-top:20px}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body>
    <header class="head"><img src="${escapeHTML(logoUrl)}" alt="كوفتا"><div class="brand">كوفتا<br>إدارة الفروع والمخزون</div></header>
    <h1>إذن تجهيز وتسليم طلبية</h1><div class="subtitle">مستند تشغيلي لمراجعة الأصناف والكميات وتوثيق التسليم الفعلي.</div>
    <section class="meta"><div><strong>رقم الإذن:</strong> ${escapeHTML(row.dataset.code)}</div><div><strong>تاريخ الطلب:</strong> ${escapeHTML(dateText(row.dataset.createdAt))}</div>
    <div><strong>الفرع:</strong> ${escapeHTML(row.dataset.branch)}</div><div><strong>مقدم الطلب:</strong> ${escapeHTML(row.dataset.requester)}</div>
    <div><strong>تاريخ الطباعة:</strong> ${escapeHTML(dateText(new Date().toISOString()))}</div><div><strong>طبع بواسطة:</strong> ${escapeHTML(currentUser.display_name)}</div></section>
    <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية المطلوبة</th><th>الكمية المجهزة</th><th>الكمية المستلمة</th><th>مراجعة</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="note"><strong>ملاحظات الطلب:</strong> ${escapeHTML(row.dataset.note || "لا توجد")}</div>
    <section class="signatures"><div class="signature">أمين المخزن — الاسم والتوقيع</div><div class="signature">مراجعة الكميات — الاسم والتوقيع</div>
    <div class="signature">مندوب التسليم — الاسم والتوقيع</div><div class="signature">صاحب الختم المعتمد — الاسم والختم</div>
    <div class="signature">مستلم الفرع — الاسم والتوقيع</div><div class="signature">تاريخ ووقت الاستلام</div></section>
    <div class="notice">هذا إذن تجهيز؛ لا يُعد إثبات استلام نهائيًا إلا بعد تسجيل الكمية المستلمة في النظام وتوقيع ممثل الفرع وختم الجهة المسلّمة.</div>
    </body></html>`);
  printWindow.document.close();
}
function modalActions(label, secondary = "إلغاء") {
  return `<div class="modal-actions"><button class="button button-primary" type="submit">${label}</button><button class="button button-secondary" type="button" data-action="close-modal">${secondary}</button></div>`;
}
function orderModal(selectedProduct = "") {
  const selected = products.some((item) => String(item.id) === String(selectedProduct)) ? selectedProduct : "";
  openModal("سلة طلب التوريد", `<form id="order-form">
    <p class="modal-intro">اختر الصنف مرة واحدة، أضف كميته للسلة، ثم راجع الطلب قبل إرساله للمخزن.</p>
    <section class="order-import-panel">
      <div><strong>استيراد الطلبية بالذكاء الاصطناعي</strong><p>ارفع ملف Excel (.xlsx) أو CSV؛ سيحلله OpenAI ويطابق الأصناف مع كتالوج كوفتا.</p></div>
      <label class="field"><span>ملف الطلبية</span><input name="order_file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" /></label>
      <button type="button" class="button button-secondary" data-action="analyze-order-file">تحليل الملف وإضافة الأصناف للمراجعة</button>
      <small class="order-import-privacy">بالضغط على التحليل، سيرسل الملف إلى OpenAI من خلال خادم النظام. لن يُرسل طلب التوريد إلا بعد مراجعة المدير وتأكيده.</small>
    </section>
    <section id="order-import-unmatched">${orderImportUnmatchedMarkup()}</section>
    <div class="cart-add-row"><label class="field"><span>الصنف</span><select name="product_id" required>${selectProducts(selected)}</select></label>
      <label class="field"><span>الكمية</span><input name="quantity" type="number" min="0.01" max="1000000" step="0.01" placeholder="اكتب الكمية" /></label>
      <button type="button" class="button button-secondary" data-action="add-cart-item">＋ أضف للسلة</button></div>
    <section class="cart-lines" id="order-cart-list">${orderCartMarkup()}</section>
    <label class="field cart-note"><span>ملاحظة للطلب (اختياري)</span><textarea name="note" maxlength="500" placeholder="موعد أو تعليمات التسليم">${escapeHTML(orderNote)}</textarea></label>
    <div class="modal-actions"><button class="button button-primary" type="submit" ${orderCart.size ? "" : "disabled"}>مراجعة الطلبية</button><button class="button button-secondary" type="button" data-action="close-modal">متابعة الاختيار</button></div>
  </form>`, true);
}
function orderCartMarkup() {
  if (!orderCart.size) return `<div class="empty-state compact">السلة فارغة. اختر صنفًا واكتب كميته لإضافته.</div>`;
  return `<div class="table-wrap"><table class="cart-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>حذف</th></tr></thead><tbody>${[...orderCart.values()].map((item) => `<tr><td class="cell-primary">${escapeHTML(item.name)}<span class="cell-secondary">${escapeHTML(item.unit)}</span></td><td><input class="cart-quantity" data-product-id="${item.id}" type="number" min="0.01" max="1000000" step="0.01" value="${escapeHTML(item.quantity)}" aria-label="كمية ${escapeHTML(item.name)}" /></td><td><button type="button" class="remove-item" data-action="remove-cart-item" data-product="${item.id}" aria-label="حذف ${escapeHTML(item.name)}">×</button></td></tr>`).join("")}</tbody></table></div>`;
}
function orderImportUnmatchedMarkup() {
  if (!orderImportUnmatched.length) return "";
  return `<div class="notice-banner import-unmatched-notice">تعذر تأكيد مطابقة ${orderImportUnmatched.length} سطرًا. اختر الصنف الصحيح لكل سطر أو تجاهله؛ لن يُضاف غير المطابق تلقائيًا.</div>
    <div class="import-unmatched-list">${orderImportUnmatched.map((item, index) => `<div class="import-unmatched-row" data-index="${index}">
      <div><strong>${escapeHTML(item.source_name)}</strong><small>كمية مقروءة: ${escapeHTML(item.quantity)}</small></div>
      <label class="field"><span>الصنف الصحيح</span><select>${selectProducts()}</select></label>
      <button type="button" class="button button-primary button-sm" data-action="resolve-import-line">إضافة للسلة</button>
      <button type="button" class="button button-secondary button-sm" data-action="ignore-import-line">تجاهل</button>
    </div>`).join("")}</div>`;
}
function orderReviewMarkup() {
  return `<div class="table-wrap"><table class="cart-table"><thead><tr><th>الصنف</th><th>الكمية</th></tr></thead><tbody>${[...orderCart.values()].map((item) => `<tr><td class="cell-primary">${escapeHTML(item.name)}<span class="cell-secondary">${escapeHTML(item.unit)}</span></td><td>${escapeHTML(item.quantity)}</td></tr>`).join("")}</tbody></table></div>`;
}
function refreshOrderCart() {
  const list = $("#order-cart-list");
  if (list) list.innerHTML = orderCartMarkup();
  const reviewButton = $('#order-form button[type="submit"]');
  if (reviewButton) reviewButton.disabled = !orderCart.size;
}
function refreshOrderImportUnmatched() {
  const section = $("#order-import-unmatched");
  if (section) section.innerHTML = orderImportUnmatchedMarkup();
}
function encodeOrderFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذرت قراءة الملف المحدد."));
    reader.onload = () => resolve(reader.result.split(",", 2)[1]);
    reader.readAsDataURL(file);
  });
}
async function analyzeOrderFile(button) {
  const form = button.closest("#order-form");
  const file = $('input[name="order_file"]', form)?.files[0];
  if (!file) throw new Error("اختر ملف Excel أو CSV أولًا.");
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error("الصيغ المدعومة هي Excel .xlsx وCSV.");
  if (!file.size || file.size > 4 * 1024 * 1024) throw new Error("يجب أن يكون حجم الملف أقل من 4 ميجابايت.");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "جارٍ تحليل الملف...";
  try {
    const file_data = await encodeOrderFile(file);
    const result = await api("/api/order-import", jsonRequest("POST", { filename: file.name, file_data }));
    const additions = result.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.product_id);
      if (!product || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("نتيجة التحليل غير متوافقة مع كتالوج الأصناف؛ لم تُضف أي نتيجة.");
      }
      const quantity = (orderCart.get(product.id)?.quantity || 0) + item.quantity;
      if (quantity > 1000000) throw new Error(`إجمالي كمية ${product.name} يتجاوز الحد المسموح.`);
      return { product, quantity };
    });
    for (const { product, quantity } of additions) {
      orderCart.set(product.id, { id: product.id, name: product.name, unit: product.unit, quantity });
    }
    if (!form.elements.product_id.value && additions.length) {
      form.elements.product_id.value = String(additions[0].product.id);
    }
    orderImportUnmatched = result.unmatched;
    refreshOrderCart();
    refreshOrderImportUnmatched();
    const matchedCount = result.items.length;
    const unmatchedCount = orderImportUnmatched.length;
    toast(`اكتمل التحليل: ${matchedCount} صنفًا مطابقًا${unmatchedCount ? `، و${unmatchedCount} سطرًا يحتاج مطابقة يدوية` : ""}. راجع السلة قبل الإرسال.`);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}
function syncOrderDraft(form) {
  if (!form) return;
  orderNote = form.elements.note.value.trim();
  for (const input of $$(".cart-quantity", form)) {
    const item = orderCart.get(Number(input.dataset.productId));
    if (item) item.quantity = Number(input.value);
  }
}
function orderReviewModal() {
  if (!orderCart.size) throw new Error("أضف صنفًا واحدًا على الأقل للسلة.");
  openModal("مراجعة الطلبية قبل الإرسال", `<form id="order-confirm-form">
    <p class="modal-intro">تأكد من الأصناف والكميات والفرع قبل تأكيد الإرسال.</p>
    <div class="review-branch"><span>الفرع</span><strong>${escapeHTML(branches.find((branch) => branch.id === currentUser.branch_id)?.name || "فرعك")}</strong></div>
    ${orderReviewMarkup()}
    <div class="review-note"><strong>ملاحظة الطلب</strong><span>${escapeHTML(orderNote || "لا توجد ملاحظات")}</span></div>
    <div class="modal-actions"><button class="button button-primary" type="submit">تأكيد وإرسال الطلبية</button><button class="button button-secondary" type="button" data-action="edit-order">رجوع للتعديل</button></div>
  </form>`, true);
}
function transferModal() {
  openModal("طلب تحويل بين الفروع", `<form id="transfer-form"><div class="form-grid">
    <label class="field"><span>الفرع المستلم</span><select name="to_branch_id" required>${selectBranches()}</select></label>
    <label class="field"><span>الصنف</span><select name="product_id" required>${selectProducts()}</select></label>
    <label class="field"><span>الكمية</span><input name="quantity" type="number" min="0.01" step="0.01" required /></label>
    <label class="field full"><span>ملاحظة</span><textarea name="note" maxlength="500" placeholder="سبب التحويل أو تفاصيله"></textarea></label>
    </div>${modalActions("إرسال للمراجعة")}</form>`);
}
function wasteModal() {
  openModal("بلاغ هالك / تست يومي", `<form id="waste-form"><div class="form-grid">
    <label class="field"><span>نوع البلاغ</span><select name="type" required><option value="waste">هالك</option><option value="test">تست يومي</option></select></label>
    <label class="field"><span>الصنف</span><select name="product_id" required>${selectProducts()}</select></label>
    <label class="field"><span>الكمية</span><input name="quantity" type="number" min="0.01" step="0.01" required /></label>
    <label class="field"><span>صورة الإثبات (مطلوبة)</span><input name="image" type="file" accept="image/*" capture="environment" required /><small>التقط الصورة بالكاميرا أو اختر صورة من جهازك.</small></label>
    <label class="field full"><span>السبب / التفاصيل</span><textarea name="note" maxlength="1000" required placeholder="اكتب وصفًا واضحًا للبلاغ"></textarea></label>
    </div>${modalActions("إرسال للمراجعة")}</form>`);
}
async function shipModal(id) {
  const orders = await api("/api/orders");
  const order = orders.find((item) => item.id === Number(id));
  if (!order) throw new Error("الطلب غير موجود.");
  const items = order.items.map((item) => `<label class="ship-row"><span><strong>${escapeHTML(item.product)}</strong><small>مطلوب ${item.quantity} ${escapeHTML(item.unit)}</small></span><input type="number" name="item-${item.id}" data-item-id="${item.id}" min="0" max="${item.quantity}" step="0.01" value="${item.quantity}" required aria-label="كمية شحن ${escapeHTML(item.product)}" /></label>`).join("");
  openModal(`تجهيز الطلب ${escapeHTML(order.code)}`, `<form id="ship-form" data-id="${order.id}"><div class="notice-banner">لا يمكن صرف كمية أكبر من الرصيد المتاح في المخزن. استخدم صفرًا للصنف غير المتاح.</div><div class="ship-list">${items}</div>${modalActions("تأكيد الشحن")}</form>`, true);
  await loadStockAvailability(order.items);
}
async function loadStockAvailability(items) {
  const stock = await api("/api/stock");
  const availableByName = new Map(stock.map((row) => [row.name, row.quantity]));
  $$(".ship-row").forEach((row) => {
    const productName = $("strong", row).textContent;
    const input = $("input", row);
    const available = availableByName.get(productName) || 0;
    input.max = String(Math.min(Number(input.max), available));
    if (Number(input.value) > available) input.value = available;
    $("small", row).textContent += ` · متاح بالمخزن ${available}`;
  });
}
function receiveModal(id) {
  const row = $(`tr[data-order-id="${id}"]`);
  const itemData = JSON.parse(row.dataset.items);
  const lines = itemData.map((item) => `<label class="ship-row"><span><strong>${escapeHTML(item.product)}</strong><small>مشحون ${item.shipped_quantity} ${escapeHTML(item.unit)}</small></span><input type="number" name="item-${item.id}" data-item-id="${item.id}" min="0" max="${item.shipped_quantity}" step="0.01" value="${item.shipped_quantity}" required /></label>`).join("");
  openModal("تأكيد الاستلام", `<form id="receive-form" data-id="${id}"><p class="modal-intro">سجّل الكمية التي وصلت فعليًا. اكتب صفرًا لأي صنف لم يصل.</p><div class="ship-list">${lines}</div>${modalActions("تأكيد الاستلام")}</form>`, true);
}
function stockEntryModal() {
  openModal("تسجيل توريد للمخزن", `<form id="stock-form"><div class="form-grid"><label class="field"><span>الصنف</span><select name="product_id" required>${selectProducts()}</select></label><label class="field"><span>الكمية المستلمة</span><input name="quantity" type="number" min="0.01" step="0.01" required /></label><label class="field full"><span>رقم إذن التوريد / المرجع</span><input name="reference" maxlength="80" placeholder="رقم المستند أو اسم المورد" /></label></div><div class="notice-banner">هذا الإجراء يضيف الكمية إلى رصيد المخزن ويسجل حركة دائمة.</div>${modalActions("حفظ التوريد")}</form>`);
}
function productModal() {
  openModal("إضافة صنف جديد", `<form id="product-form"><div class="form-grid">
    <label class="field"><span>اسم الصنف</span><input name="name" required maxlength="100" placeholder="مثال: ويسكي" /></label>
    <label class="field"><span>وحدة القياس</span><input name="unit" required maxlength="40" placeholder="مثال: زجاجة، كرتونة، كيلو" /></label>
    <label class="field full"><span>المجموعة</span><input name="category" required maxlength="80" list="product-categories" placeholder="اختر مجموعة موجودة أو اكتب مجموعة جديدة" /><datalist id="product-categories">${[...new Set(products.map((item) => item.category))].map((name) => `<option value="${escapeHTML(name)}"></option>`).join("")}</datalist></label>
    </div><div class="notice-banner">سيظهر الصنف مباشرةً في طلبات الفروع والمخزون وحركاته.</div>${modalActions("حفظ الصنف")}</form>`);
}
function branchModal() {
  openModal("إضافة فرع جديد", `<form id="branch-form">
    <label class="field"><span>اسم الفرع أو موقعه</span><input name="name" required maxlength="100" placeholder="مثال: التجمع الخامس - مول ..." /></label>
    <div class="notice-banner">سيُنشأ كود الفرع تلقائيًا. بعد الحفظ، أنشئ حساب مدير الفرع من صفحة إدارة المستخدمين.</div>${modalActions("حفظ الفرع")}</form>`);
}
function passwordModal(userId = "") {
  const reset = Boolean(userId);
  openModal(reset ? "تعيين كلمة مرور جديدة" : "تغيير كلمة المرور", `<form id="${reset ? "reset-password-form" : "password-form"}" ${reset ? `data-id="${userId}"` : ""}>
    ${reset ? `<p class="modal-intro">سيُطلب من المستخدم تسجيل الدخول بكلمة المرور الجديدة.</p>` : `<label class="field"><span>كلمة المرور الحالية</span><input name="old_password" type="password" autocomplete="current-password" required /></label>`}
    <label class="field"><span>كلمة المرور الجديدة (12 حرفًا على الأقل)</span><input name="new_password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required /></label>
    <label class="field"><span>تأكيد كلمة المرور الجديدة</span><input name="confirm_password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required /></label>
    ${modalActions(reset ? "حفظ كلمة المرور" : "تغيير كلمة المرور")}</form>`);
}
function userModal() {
  openModal("إنشاء حساب مستخدم", `<form id="user-form"><div class="form-grid">
    <label class="field"><span>الاسم الظاهر</span><input name="display_name" required maxlength="80" /></label>
    <label class="field"><span>اسم المستخدم (إنجليزي)</span><input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._\\-]+" /></label>
    <label class="field"><span>نوع الحساب</span><select name="role" required><option value="branch">مدير فرع</option><option value="auditor">مراقب إقليمي</option><option value="admin">المخزن الرئيسي / الإدارة</option></select></label>
    <label class="field" id="user-branch-field"><span>الفرع التابع له</span><select name="branch_id">${selectBranches()}</select></label>
    <label class="field full"><span>كلمة مرور مؤقتة (12 حرفًا على الأقل)</span><input name="password" type="password" minlength="12" required autocomplete="new-password" /></label>
    <div class="field full" id="auditor-branches" hidden><span>الفروع التابعة للمراقب</span><div class="branch-check-grid">${branches.map((branch) => `<label><input type="checkbox" name="branch_ids" value="${branch.id}" /><span>${escapeHTML(branch.name)}</span></label>`).join("")}</div></div>
    </div>${modalActions("إنشاء الحساب")}</form>`);
  $("#user-form [name=role]").addEventListener("change", (event) => {
    $("#user-branch-field").hidden = event.target.value !== "branch";
    $("#auditor-branches").hidden = event.target.value !== "auditor";
    $("#user-form [name=branch_id]").required = event.target.value === "branch";
  });
}
function rejectModal(id, type) {
  openModal(type === "waste" ? "رفض بلاغ الهالك" : "رفض التحويل", `<form id="review-reject-form" data-id="${id}" data-type="${type}"><label class="field"><span>سبب الرفض</span><textarea name="note" required maxlength="500" placeholder="اكتب سببًا واضحًا للرفض"></textarea></label><div class="notice-banner">${type === "waste" ? "رفض الهالك يسجل الكمية كعجز على الفرع." : "سيتم إبلاغ الفرع بسبب رفض التحويل."}</div>${modalActions("تأكيد الرفض")}</form>`);
}
function toast(message, error = false) {
  const item = document.createElement("div");
  item.className = `toast ${error ? "toast-error" : ""}`;
  item.textContent = message;
  $("#toast-region").append(item);
  window.setTimeout(() => item.remove(), 4000);
}
async function submitForm(form, handler) {
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ..."; }
  try {
    await handler(new FormData(form));
  } catch (error) {
    toast(error.message, true);
    if (button) { button.disabled = false; button.textContent = button.dataset.label || "حاول مرة أخرى"; }
  }
}
function encodeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("اختر ملف صورة صالحًا.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذرت قراءة الصورة."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("ملف الصورة غير صالح."));
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("تعذر تجهيز الصورة.")); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("تعذر ضغط الصورة.")); return; }
          if (blob.size > 4 * 1024 * 1024) { reject(new Error("الصورة كبيرة؛ اختر صورة أصغر من 4 ميجابايت.")); return; }
          const output = new FileReader();
          output.onerror = () => reject(new Error("تعذرت معالجة الصورة."));
          output.onload = () => resolve({ image: output.result.split(",", 2)[1], image_type: blob.type || "image/jpeg", image_name: file.name });
          output.readAsDataURL(blob);
        }, "image/jpeg", 0.78);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  await submitForm(form, async (data) => {
    if (form.id === "setup-form" || form.id === "login-form") {
      const body = Object.fromEntries(data.entries());
      const session = await api(form.id === "setup-form" ? "/api/setup" : "/api/login", jsonRequest("POST", body));
      await acceptSession(session);
      return;
    }
    if (form.id === "order-form") {
      syncOrderDraft(form);
      if (orderImportUnmatched.length) {
        throw new Error("طابق الأصناف غير الواضحة يدويًا أو تجاهلها بوضوح قبل مراجعة الطلبية.");
      }
      if ([...orderCart.values()].some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000000)) {
        throw new Error("راجع كميات السلة؛ يجب أن تكون أكبر من صفر وألا تتجاوز مليونًا.");
      }
      orderReviewModal();
      return;
    }
    if (form.id === "order-confirm-form") {
      const items = [...orderCart.values()].map((item) => ({ product_id: item.id, quantity: item.quantity }));
      const result = await api("/api/orders", jsonRequest("POST", { items, note: orderNote }));
      orderCart.clear();
      orderNote = "";
      orderImportUnmatched = [];
      closeModal(); await loadPage("orders"); toast(`تم تأكيد الطلب ${result.code} وإرساله للمخزن.`);
      return;
    }
    if (form.id === "ship-form") {
      const items = $$("[data-item-id]", form).map((input) => ({ item_id: Number(input.dataset.itemId), quantity: Number(input.value) }));
      await api(`/api/orders/${form.dataset.id}/ship`, jsonRequest("PATCH", { items }));
      closeModal(); await loadPage("orders"); toast("تم تأكيد الشحن وتحديث رصيد المخزن.");
      return;
    }
    if (form.id === "receive-form") {
      const items = $$("[data-item-id]", form).map((input) => ({ item_id: Number(input.dataset.itemId), quantity: Number(input.value) }));
      await api(`/api/orders/${form.dataset.id}/receive`, jsonRequest("PATCH", { items }));
      closeModal(); await loadPage("orders"); toast("تم تسجيل الاستلام وتحديث رصيد الفرع.");
      return;
    }
    if (form.id === "transfer-form") {
      const result = await api("/api/transfers", jsonRequest("POST", {
        to_branch_id: Number(data.get("to_branch_id")), product_id: Number(data.get("product_id")),
        quantity: Number(data.get("quantity")), note: data.get("note")
      }));
      closeModal(); await loadPage("transfers"); toast(`تم إرسال التحويل ${result.code} للمراجعة.`);
      return;
    }
    if (form.id === "waste-form") {
      const file = data.get("image");
      if (!file || !file.size) throw new Error("صورة الإثبات مطلوبة.");
      const image = await encodeImage(file);
      const result = await api("/api/waste", jsonRequest("POST", {
        type: data.get("type"), product_id: Number(data.get("product_id")), quantity: Number(data.get("quantity")),
        note: data.get("note"), ...image
      }));
      closeModal(); await loadPage("waste"); toast(`تم حفظ البلاغ ${result.code} وإرساله للمراقب.`);
      return;
    }
    if (form.id === "review-reject-form") {
      const type = form.dataset.type;
      const endpoint = type === "waste" ? `/api/waste/${form.dataset.id}/reject` : `/api/transfers/${form.dataset.id}/reject`;
      await api(endpoint, jsonRequest("PATCH", { note: data.get("note") }));
      closeModal(); await loadPage(type === "waste" ? "waste" : "transfers"); toast(type === "waste" ? "تم الرفض وتسجيل العجز في حركة المخزون." : "تم رفض التحويل وإبلاغ الفرع.");
      return;
    }
    if (form.id === "stock-form") {
      await api("/api/stock", jsonRequest("POST", { product_id: Number(data.get("product_id")), quantity: Number(data.get("quantity")), reference: data.get("reference") }));
      closeModal(); await loadPage("stock"); toast("تم تسجيل التوريد وتحديث رصيد المخزن.");
      return;
    }
    if (form.id === "product-form") {
      await api("/api/products", jsonRequest("POST", {
        name: data.get("name"), unit: data.get("unit"), category: data.get("category")
      }));
      products = await api("/api/products");
      productCategory = "الكل";
      closeModal(); await loadPage("products"); toast("تمت إضافة الصنف وأصبح متاحًا للفروع.");
      return;
    }
    if (form.id === "branch-form") {
      await api("/api/branches", jsonRequest("POST", { name: data.get("name") }));
      await refreshBranches();
      closeModal(); await loadPage("branches"); toast("تمت إضافة الفرع وأصبح متاحًا لإدارة الحسابات والطلبات.");
      return;
    }
    if (form.id === "user-form") {
      const role = data.get("role");
      const body = {
        display_name: data.get("display_name"), username: data.get("username"), role, password: data.get("password"),
        branch_id: role === "branch" ? Number(data.get("branch_id")) : null,
        branch_ids: role === "auditor" ? data.getAll("branch_ids").map(Number) : []
      };
      await api("/api/users", jsonRequest("POST", body));
      closeModal(); await loadPage("users"); toast("تم إنشاء الحساب. سلّم بيانات الدخول لصاحب الحساب بأمان.");
      return;
    }
    if (form.id === "password-form" || form.id === "reset-password-form") {
      const newPassword = data.get("new_password");
      if (newPassword !== data.get("confirm_password")) throw new Error("تأكيد كلمة المرور غير مطابق.");
      if (form.id === "password-form") {
        await api("/api/password", jsonRequest("POST", { old_password: data.get("old_password"), new_password: newPassword }));
        closeModal(); toast("تم تغيير كلمة المرور.");
      } else {
        await api("/api/users", jsonRequest("PATCH", { id: Number(form.dataset.id), password: newPassword }));
        closeModal(); await loadPage("users"); toast("تم تعيين كلمة المرور وإلغاء الجلسات السابقة.");
      }
    }
  });
}
async function doAction(target) {
  const { action, id, decision, type } = target.dataset;
  if (action === "retry") return loadPage(activePage);
  if (action === "apply-report-filters") {
    const panel = target.closest(".report-filter-panel");
    const filters = {
      from: $('input[name="from"]', panel).value,
      to: $('input[name="to"]', panel).value,
      branch_id: $('select[name="branch_id"]', panel)?.value || "",
      movement_type: $('select[name="movement_type"]', panel).value
    };
    if (!filters.from || !filters.to || filters.from > filters.to) {
      throw new Error("اختر فترة زمنية صحيحة، ويجب ألا يسبق تاريخ البداية تاريخ النهاية.");
    }
    reportFilters = filters;
    return renderReports();
  }
  if (action === "analyze-order-file") return analyzeOrderFile(target);
  if (action === "resolve-import-line") {
    const row = target.closest(".import-unmatched-row");
    const item = orderImportUnmatched[Number(row.dataset.index)];
    const product = products.find((candidate) => candidate.id === Number($("select", row).value));
    if (!product) throw new Error("اختر الصنف المطابق أولًا.");
    const quantity = (orderCart.get(product.id)?.quantity || 0) + item.quantity;
    if (quantity > 1000000) throw new Error(`إجمالي كمية ${product.name} يتجاوز الحد المسموح.`);
    orderCart.set(product.id, { id: product.id, name: product.name, unit: product.unit, quantity });
    const form = target.closest("#order-form");
    if (!form.elements.product_id.value) form.elements.product_id.value = String(product.id);
    orderImportUnmatched.splice(Number(row.dataset.index), 1);
    refreshOrderCart(); refreshOrderImportUnmatched();
    return;
  }
  if (action === "ignore-import-line") {
    const row = target.closest(".import-unmatched-row");
    orderImportUnmatched.splice(Number(row.dataset.index), 1);
    refreshOrderImportUnmatched();
    return;
  }
  if (action === "print-order") return printOrder(id);
  if (action === "print-stock") return printStockReport();
  if (action === "new-order") return orderModal();
  if (action === "quick-order") return orderModal(target.dataset.product);
  if (action === "review-order") {
    syncOrderDraft($("#order-form"));
    return orderReviewModal();
  }
  if (action === "edit-order") return orderModal();
  if (action === "add-cart-item") {
    const form = target.closest("#order-form");
    const productId = Number(form.elements.product_id.value);
    const quantity = Number(form.elements.quantity.value);
    const product = products.find((item) => item.id === productId);
    if (!product) throw new Error("اختر صنفًا صالحًا قبل الإضافة.");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error("اكتب كمية أكبر من صفر ولا تتجاوز مليونًا.");
    const existing = orderCart.get(productId);
    const combined = (existing?.quantity || 0) + quantity;
    if (combined > 1000000) throw new Error("الكمية الإجمالية للصنف تتجاوز الحد المسموح.");
    orderCart.set(productId, { id: product.id, name: product.name, unit: product.unit, quantity: combined });
    form.elements.quantity.value = "";
    refreshOrderCart();
    if (activePage === "products") await renderProducts();
    toast(existing ? "تمت إضافة الكمية إلى الصنف الموجود في السلة." : "تمت إضافة الصنف إلى سلة الطلب.");
    return;
  }
  if (action === "remove-cart-item") {
    orderCart.delete(Number(target.dataset.product));
    refreshOrderCart();
    if (activePage === "products") await renderProducts();
    return;
  }
  if (action === "add-order-line" || action === "remove-line") {
    return;
  }
  if (action === "new-transfer") return transferModal();
  if (action === "new-waste") return wasteModal();
  if (action === "stock-entry") return stockEntryModal();
  if (action === "new-branch") return branchModal();
  if (action === "new-product") return productModal();
  if (action === "new-user") return userModal();
  if (action === "change-password") return passwordModal();
  if (action === "reset-user-password") return passwordModal(id);
  if (action === "backup") {
    const response = await fetch("/api/backup", { credentials: "same-origin" });
    if (!response.ok) throw new Error("تعذر تنزيل النسخة الاحتياطية.");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `kufta-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`;
    anchor.click(); URL.revokeObjectURL(url);
    toast("تم تنزيل نسخة احتياطية من قاعدة البيانات.");
    return;
  }
  if (action === "close-modal") return closeModal();
  if (action === "ship-order") return shipModal(id);
  if (action === "receive-order") return receiveModal(id);
  if (action === "review-waste") {
    if (decision === "reject") return rejectModal(id, "waste");
    await api(`/api/waste/${id}/approve`, jsonRequest("PATCH", { note: "" }));
    await loadPage("waste"); toast("تم اعتماد البلاغ وتحديث حركة المخزون.");
    return;
  }
  if (action === "review-transfer") {
    if (decision === "reject") return rejectModal(id, "transfer");
    await api(`/api/transfers/${id}/approve`, jsonRequest("PATCH", { note: "" }));
    await loadPage("transfers"); toast("تم اعتماد التحويل.");
    return;
  }
  if (action === "ship-transfer") {
    await api(`/api/transfers/${id}/ship`, jsonRequest("PATCH", {}));
    await loadPage("transfers"); toast("تم تسجيل إرسال التحويل.");
    return;
  }
  if (action === "receive-transfer") {
    await api(`/api/transfers/${id}/receive`, jsonRequest("PATCH", {}));
    await loadPage("transfers"); toast("تم تسجيل استلام التحويل.");
    return;
  }
  if (action === "toggle-user") {
    await api("/api/users", jsonRequest("PATCH", { id: Number(id), active: target.dataset.active === "1" }));
    await loadPage("users"); toast("تم تحديث حالة الحساب.");
    return;
  }
  if (action === "save-assignment") {
    const card = target.closest(".assignment-card");
    const branch_ids = $$('input[type="checkbox"]:checked', card).map((input) => Number(input.value));
    await api("/api/users", jsonRequest("PATCH", { id: Number(id), branch_ids }));
    await api("/api/branches").then((items) => { branches = items; });
    await loadPage("users"); toast("تم حفظ الفروع التابعة للمراقب.");
  }
}
function toastAction(target, error) {
  toast(error.message || "تعذر تنفيذ الإجراء.", true);
}
async function showNotifications() {
  try {
    const data = await api("/api/notifications");
    openModal("الإشعارات", `<div class="activity-list">${data.items.map((item) => `<article class="activity-item"><span class="activity-icon">♧</span><div><strong>${escapeHTML(item.message)}</strong><small>${dateText(item.created_at)}</small></div></article>`).join("") || `<div class="empty-state">لا توجد إشعارات جديدة.</div>`}</div>`);
    if (data.unread) {
      await api("/api/notifications", jsonRequest("PATCH", {}));
      $("#notification-count").hidden = true;
    }
  } catch (error) { toast(error.message, true); }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-page], [data-action], .filter-chip[data-category]");
  if (!target) {
    if (event.target === $("#modal-layer")) closeModal();
    return;
  }
  if (target.dataset.page) {
    event.preventDefault();
    await loadPage(target.dataset.page);
    return;
  }
  if (target.matches(".filter-chip[data-category]")) {
    productCategory = target.dataset.category;
    await renderProducts();
    return;
  }
  try { await doAction(target); } catch (error) { toastAction(target, error); }
});
document.addEventListener("submit", (event) => { void handleSubmit(event); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches('#order-form [name="quantity"]')) return;
  event.preventDefault();
  $('[data-action="add-cart-item"]', event.target.form)?.click();
});
document.addEventListener("input", (event) => {
  if (event.target.matches("#order-form [name=note]")) {
    orderNote = event.target.value;
    return;
  }
  if (event.target.matches("#order-form .cart-quantity")) {
    const item = orderCart.get(Number(event.target.dataset.productId));
    const quantity = Number(event.target.value);
    if (item && Number.isFinite(quantity) && quantity > 0 && quantity <= 1000000) item.quantity = quantity;
  }
  if (!event.target.matches("[data-search]")) return;
  const value = event.target.value.trim().toLocaleLowerCase();
  $$("[data-searchable]").forEach((row) => { row.hidden = !row.dataset.searchable.toLocaleLowerCase().includes(value); });
});
document.addEventListener("change", (event) => {
  if (event.target.matches("#stock-branch-filter")) {
    stockBranchFilter = event.target.value;
    void renderStock().catch((error) => toast(error.message, true));
    return;
  }
  if (!event.target.matches("#role-select")) return;
  const field = $("#user-branch-field");
  if (field) {
    const branch = event.target.value === "branch";
    $("#auditor-branches").hidden = event.target.value !== "auditor";
    field.hidden = !branch;
    $("select", field).required = branch;
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
$("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#notification-button").addEventListener("click", () => { void showNotifications(); });
$("#password-button").addEventListener("click", () => {
  if (currentUser?.role === "admin") passwordModal();
});
$("#logout-button").addEventListener("click", async () => {
  clearInterval(notificationRefreshTimer);
  pageLoadController?.abort();
  pageLoadController = null;
  pageLoadId++;
  try { await api("/api/logout", jsonRequest("POST", {})); } catch (error) { console.error(error); }
  currentUser = null; csrfToken = ""; renderAuth("login", "تم تسجيل الخروج.");
});

start();

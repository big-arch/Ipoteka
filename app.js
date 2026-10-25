// Интерфейс дашборда. Данные живут только в IndexedDB этого браузера.
(function () {
  "use strict";

  // --- хранилище: IndexedDB, запасной вариант — localStorage ---
  const DB_NAME = "ipoteka";
  const KEY = "state";
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function load() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const r = db.transaction("kv").objectStore("kv").get(KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      try { return JSON.parse(localStorage.getItem(DB_NAME) || "null"); } catch (_) { return null; }
    }
  }
  async function save() {
    const data = JSON.parse(JSON.stringify(state));
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(data, KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      try { localStorage.setItem(DB_NAME, JSON.stringify(data)); } catch (_) { toast("Не удалось сохранить"); }
    }
  }

  const blank = () => ({ version: 1, loans: [], settings: { ddDate: "", keysDate: "" } });
  let state = blank();
  const ui = { schedLoan: "all", ppLoan: null };

  // --- форматирование ---
  const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rub = (x) => nf0.format(Math.round(x)) + " ₽";
  const rub2 = (x) => nf2.format(x);
  const FMT = { rub0: (x) => nf0.format(Math.round(x)), rub2: (x) => nf2.format(x), int: (x) => String(Math.round(x)) };
  const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const dateRu = (iso, withYear = true) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]}${withYear ? " " + y : ""}`;
  };
  const dateShort = (iso) => iso.split("-").reverse().join(".");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (s) => Number(String(s).replace(/\s| /g, "").replace(",", ".")) || 0;
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const daysBetween = (a, b) => Math.round((Calc.parseDate(b) - Calc.parseDate(a)) / 86400000);
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const termText = (months) => {
    const y = Math.floor(months / 12), m = months % 12;
    return [y ? `${y} ${plural(y, "год", "года", "лет")}` : "", m ? `${m} мес.` : ""].filter(Boolean).join(" ") || "0 мес.";
  };
  const $ = (id) => document.getElementById(id);
  const color = (loan) => `var(--s${(state.loans.indexOf(loan) % 4) + 1})`;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // --- анимации: счётчики, полосы, кольца (как в ОСНОВЕ) ---
  function countUp(el, to, fmt) {
    if (reduced()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => (el.textContent = fmt(to)), dur + 80); // вкладка в фоне не крутит кадры
  }
  function animateIn(root) {
    root.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count), FMT[el.dataset.fmt || "rub0"]));
    const run = () => {
      root.querySelectorAll("circle.arc").forEach((a) => (a.style.strokeDashoffset = a.dataset.off));
      root.querySelectorAll("[data-w]").forEach((el) => (el.style.width = el.dataset.w + "%"));
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 150);
  }
  function ring(size, stroke, pct, col, center, sub, light) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, s = size / 2;
    const track = light ? "rgba(255,255,255,.12)" : "var(--surface-2)";
    const txt = light ? "#fff" : "var(--text)";
    const subc = light ? "#9fc0da" : "var(--muted)";
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${s}" cy="${s}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle class="arc" cx="${s}" cy="${s}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - Math.max(0, Math.min(1, pct)))}" transform="rotate(-90 ${s} ${s})"/>
      <text x="${s}" y="${s + (sub ? 3 : 7)}" text-anchor="middle" font-size="${size * 0.26}" font-weight="800" fill="${txt}" font-family="Inter,system-ui">${center}</text>
      ${sub ? `<text x="${s}" y="${s + size * 0.2}" text-anchor="middle" font-size="${size * 0.11}" fill="${subc}" font-family="Inter,system-ui">${sub}</text>` : ""}
    </svg>`;
  }

  // сегментный переключатель с бегущей подложкой
  function seg(box, options, value, onPick) {
    box.innerHTML = `<span class="ind"></span>` + options.map((o) => `<button type="button" data-v="${o.v}" class="${o.v === value ? "on" : ""}">${esc(o.label)}</button>`).join("");
    const move = () => {
      const on = box.querySelector("button.on");
      const ind = box.querySelector(".ind");
      if (!on) return;
      ind.style.left = on.offsetLeft + "px";
      ind.style.width = on.offsetWidth + "px";
    };
    box._move = move;
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      move();
      onPick(b.dataset.v);
    }));
    requestAnimationFrame(move);
  }

  const calcLoan = (loan) => {
    const sched = Calc.schedule(loan, loan.prepays || []);
    return { loan, sched, st: Calc.statusAt(loan, sched, todayISO()) };
  };

  // --- навигация ---
  function moveTabInd() {
    const on = document.querySelector(".tabs a.active");
    const ind = document.querySelector(".tabs .ind");
    if (!on) return;
    ind.style.left = on.offsetLeft + "px";
    ind.style.width = on.offsetWidth + "px";
  }
  function route() {
    const name = (location.hash || "#home").slice(1) || "home";
    document.querySelectorAll(".screen").forEach((s) => {
      const show = s.dataset.screen === name;
      s.hidden = !show;
      if (show) { s.classList.remove("view-in"); void s.offsetWidth; s.classList.add("view-in"); }
    });
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
    moveTabInd();
    render(name);
    window.scrollTo({ top: 0 });
  }
  function render(name) {
    if (name === "home") renderHome();
    if (name === "schedule") renderSchedule();
    if (name === "prepay") renderPrepay();
    if (name === "data") renderData();
  }

  // --- главная ---
  function renderHome() {
    const empty = state.loans.length === 0;
    $("home-empty").hidden = !empty;
    const box = $("home-content");
    box.hidden = empty;
    if (empty) return;
    const today = todayISO();
    const all = state.loans.map(calcLoan);
    let i = 0;
    let html = "";

    // ближайший платёж + следующие в ближайший месяц
    const upcoming = all.filter((x) => x.st.next).sort((a, b) => a.st.next.t - b.st.next.t);
    if (upcoming.length) {
      const first = upcoming[0];
      const nx = first.st.next;
      const days = daysBetween(today, nx.date);
      const when = days === 0 ? "сегодня" : days === 1 ? "завтра" : `через ${days} ${plural(days, "день", "дня", "дней")}`;
      const idx = first.sched.rows.indexOf(nx);
      const prevDate = idx > 0 ? first.sched.rows[idx - 1].date : first.loan.balanceDate;
      const period = Math.max(1, daysBetween(prevDate, nx.date));
      const pct = 1 - days / period;
      const later = [];
      all.forEach((x) => x.sched.rows.forEach((r) => {
        const d = daysBetween(today, r.date);
        if (r !== nx && d >= 0 && d <= 45) later.push({ x, r });
      }));
      later.sort((a, b) => a.r.t - b.r.t);
      html += `<div class="card hero st-in" style="--i:${i++}">
        <div class="hero-row">
          <div class="hero-main">
            <div class="label">Ближайший платёж</div>
            <div class="big"><span data-count="${nx.payment}" data-fmt="rub2">0</span><small>₽</small></div>
            <span class="chip ${days === 0 ? "today" : ""}"><span class="dot"></span>${when} · ${dateRu(nx.date, false)} · ${esc(first.loan.name)}</span>
          </div>
          ${ring(92, 8, pct, days === 0 ? "var(--orange)" : "var(--brand-cyan)", days === 0 ? "!" : days, days === 0 ? "сегодня" : plural(days, "день", "дня", "дней"), true)}
        </div>
        ${later.length ? `<div class="hero-list">${later.slice(0, 3).map(({ x, r }) =>
          `<div class="row"><span>${dateRu(r.date, false)} · ${esc(x.loan.name)}</span><b class="num">${rub2(r.payment)} ₽</b></div>`).join("")}</div>` : ""}
      </div>`;
    } else {
      html += `<div class="card hero st-in"><div class="label">Платежей больше нет</div><div class="big">Кредиты закрыты 🎉</div></div>`;
    }

    // показатели
    const debt = all.reduce((s, x) => s + x.st.balance, 0);
    const monthly = all.reduce((s, x) => s + (x.st.next ? x.st.regularPayment : 0), 0);
    const leftInt = all.reduce((s, x) => s + x.st.leftInterest, 0);
    const orig = all.reduce((s, x) => s + (Number(x.loan.origAmount) || x.st.balance + x.st.paidPrincipal), 0);
    const repaid = Math.max(0, orig - debt);
    const kpi = (c, label, value, sub) => `<div class="card kpi st-in" style="--c:${c};--i:${i++}"><span class="glow"></span>
      <div class="label"><i></i>${label}</div><div class="mid"><span data-count="${value}">0</span><small>₽</small></div><div class="sub">${sub}</div></div>`;
    html += `<div class="kpis">
      ${kpi("var(--s1)", "Осталось долга", debt, `${all.length} ${plural(all.length, "кредит", "кредита", "кредитов")}`)}
      ${kpi("var(--orange)", "Платёж в месяц", monthly, all.map((x) => nf0.format(Math.round(x.st.regularPayment))).join(" + "))}
      ${kpi("var(--s4)", "Проценты впереди", leftInt, "если не гасить досрочно")}
      ${kpi("var(--good)", "Уже погашено", repaid, `${orig ? Math.round((repaid / orig) * 100) : 0}% от взятых ${rub(orig)}`)}
    </div>`;

    // кредиты
    html += `<div class="card st-in" style="--i:${i++}"><h2>Кредиты</h2>` + all.map(({ loan, sched, st }) => {
      const total = Number(loan.origAmount) || st.paidPrincipal + st.balance;
      const share = total > 0 ? ((total - st.balance) / total) * 100 : 0;
      return `<div class="loan" style="--c:${color(loan)}">
        <div class="loan-head"><span class="sw"></span><strong>${esc(loan.name)}</strong><span class="rate">${String(loan.rate).replace(".", ",")}%</span></div>
        <div class="bar"><i data-w="${share.toFixed(1)}"></i></div>
        <div class="row-between sub"><span>погашено ${share.toFixed(1).replace(".", ",")}%</span><span>${loan.contractDate ? `с ${dateShort(loan.contractDate)}` : ""}</span></div>
        <div class="facts">
          <div><span>остаток</span><b>${st.balance >= 1e6 ? (st.balance / 1e6).toFixed(2).replace(".", ",") + " млн" : rub(st.balance)}</b></div>
          <div><span>платёж</span><b>${rub(st.regularPayment)}</b></div>
          <div><span>до</span><b>${MONTHS_FULL[Number(sched.lastDate.slice(5, 7)) - 1].slice(0, 3)} ${sched.lastDate.slice(0, 4)}</b></div>
        </div>
      </div>`;
    }).join("") + `</div>`;

    // ключи
    const { ddDate, keysDate } = state.settings;
    if (keysDate) {
      const left = daysBetween(today, keysDate);
      const pct = ddDate ? daysBetween(ddDate, today) / Math.max(1, daysBetween(ddDate, keysDate)) : 0;
      html += `<div class="card st-in" style="--i:${i++}"><div class="keys">
        ${ring(84, 8, pct, "var(--good)", Math.round(Math.max(0, Math.min(1, pct)) * 100) + "%", "пути")}
        <div class="info"><div class="label"><i style="background:var(--good)"></i>До ключей</div>
          <div class="mid">${left > 0 ? `<span data-count="${left}" data-fmt="int">0</span> <small>${plural(left, "день", "дня", "дней")}</small>` : "срок наступил"}</div>
          <div class="sub">ДДУ ${dateRu(ddDate)} → передача до ${dateRu(keysDate)}</div></div>
      </div></div>`;
    }

    box.innerHTML = html;
    animateIn(box);
  }

  // --- график ---
  // помесячные строки: один кредит или сумма всех
  function monthRows(loans) {
    const per = loans.map(calcLoan);
    if (per.length === 1) return { rows: per[0].sched.rows, per };
    const months = new Map();
    per.forEach(({ sched }, li) => sched.rows.forEach((r) => {
      const key = r.date.slice(0, 7);
      const m = months.get(key) || { date: key + "-01", t: Calc.parseDate(key + "-01"), payment: 0, interest: 0, principal: 0, prepays: [], bal: {} };
      m.payment += r.payment; m.interest += r.interest; m.principal += r.principal;
      m.prepays.push(...r.prepays);
      m.bal[li] = r.balance;
      m.last = Math.max(m.last || 0, r.t);
      months.set(key, m);
    }));
    const keys = [...months.keys()].sort();
    const carry = per.map(({ loan }) => Number(loan.balance));
    const rows = keys.map((k, idx) => {
      const m = months.get(k);
      Object.entries(m.bal).forEach(([li, b]) => (carry[li] = b));
      return { k: idx + 1, date: m.date, t: m.last, payment: m.payment, interest: m.interest, principal: m.principal, prepays: m.prepays, balance: carry.reduce((a, b) => a + b, 0), month: true };
    });
    return { rows, per };
  }
  function renderSchedule() {
    if (!state.loans.length) {
      $("sched-seg").innerHTML = "";
      $("sched-summary").innerHTML = `<div style="grid-column:1/-1"><span>Нет данных</span><b>Добавьте кредит во вкладке «Данные»</b></div>`;
      $("sched-chart").innerHTML = $("sched-table").innerHTML = "";
      return;
    }
    if (ui.schedLoan !== "all" && !state.loans.some((l) => l.id === ui.schedLoan)) ui.schedLoan = "all";
    const opts = (state.loans.length > 1 ? [{ v: "all", label: "Все кредиты" }] : []).concat(state.loans.map((l) => ({ v: l.id, label: l.name })));
    if (state.loans.length === 1) ui.schedLoan = state.loans[0].id;
    seg($("sched-seg"), opts, ui.schedLoan, (v) => { ui.schedLoan = v; drawSchedule(); });
    drawSchedule();
  }
  function drawSchedule() {
    const loans = ui.schedLoan === "all" ? state.loans : state.loans.filter((l) => l.id === ui.schedLoan);
    const { rows, per } = monthRows(loans);
    const totalInterest = per.reduce((s, x) => s + x.sched.totalInterest, 0);
    const paidInt = per.reduce((s, x) => s + x.st.paidInterest, 0);
    const left = per.reduce((s, x) => Math.max(s, x.st.leftCount), 0);
    const lastDate = per.map((x) => x.sched.lastDate).sort().pop();
    $("sched-summary").innerHTML = `
      <div><span>Осталось платежей</span><b>${left} · ${termText(left)}</b></div>
      <div><span>Последний платёж</span><b>${dateRu(lastDate)}</b></div>
      <div><span>Проценты впереди</span><b data-count="${totalInterest - paidInt}">0</b> ₽</div>
      <div><span>Проценты по графику</span><b>${rub(totalInterest)}</b></div>`;
    $("sched-chart").innerHTML = chartByYear(rows);
    animateIn($("sched-summary"));

    const onlyFuture = $("sched-future").checked;
    const today = Calc.parseDate(todayISO());
    const monthly = rows[0] && rows[0].month;
    let html = `<thead><tr><th>${monthly ? "Месяц" : "Дата"}</th><th>Платёж</th><th>Проценты</th><th>Долг</th><th>Остаток</th></tr></thead><tbody>`;
    let year = null;
    let nextMarked = false;
    for (const r of rows) {
      if (onlyFuture && r.t < today) continue;
      const y = r.date.slice(0, 4);
      if (y !== year) {
        year = y;
        const yr = rows.filter((x) => x.date.startsWith(y));
        html += `<tr class="year"><td>${y}</td><td>${rub(yr.reduce((s, x) => s + x.payment, 0))}</td><td>${rub(yr.reduce((s, x) => s + x.interest, 0))}</td><td>${rub(yr.reduce((s, x) => s + x.principal, 0))}</td><td></td></tr>`;
      }
      let cls = r.t < today ? "past" : "";
      if (!nextMarked && r.t >= today) { cls = "next"; nextMarked = true; }
      const label = monthly ? `${MONTHS[Number(r.date.slice(5, 7)) - 1]} ${y}` : dateShort(r.date);
      html += `<tr class="${cls}"><td>${label}</td><td>${rub2(r.payment)}</td><td>${rub2(r.interest)}</td><td>${rub2(r.principal)}</td><td>${rub2(r.balance)}</td></tr>`;
      for (const p of r.prepays) {
        html += `<tr class="pp"><td>${dateShort(p.date)}</td><td colspan="3">досрочно ${rub2(p.amount)} (${p.kind === "term" ? "срок" : "платёж"})</td><td></td></tr>`;
      }
    }
    $("sched-table").innerHTML = html + "</tbody>";
  }

  // столбики по годам (проценты + тело) и линия остатка, SVG без библиотек
  function chartByYear(rows) {
    const years = new Map();
    for (const r of rows) {
      const y = r.date.slice(0, 4);
      const v = years.get(y) || { i: 0, p: 0, bal: 0 };
      v.i += r.interest;
      v.p += r.principal + r.prepays.reduce((a, x) => a + x.amount, 0);
      v.bal = r.balance;
      years.set(y, v);
    }
    const list = [...years.entries()];
    if (!list.length) return "";
    const W = 400, H = 210, L = 38, R = 40, T = 12, B = 22;
    const cw = (W - L - R) / list.length;
    const maxBar = Math.max(...list.map(([, v]) => v.i + v.p)) * 1.1 || 1;
    const maxBal = Math.max(rows[0].balance + rows[0].principal, ...list.map(([, v]) => v.bal)) || 1;
    const yBar = (v) => T + (H - T - B) * (1 - v / maxBar);
    const yBal = (v) => T + (H - T - B) * (1 - v / maxBal);
    const k = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",") + "м" : Math.round(v / 1000) + "т");
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Платежи по годам">`;
    for (let g = 0; g <= 4; g++) {
      const y = T + ((H - T - B) * g) / 4;
      s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`;
      s += `<text x="${L - 5}" y="${y + 3}" text-anchor="end">${k(maxBar * (1 - g / 4))}</text>`;
      s += `<text x="${W - R + 5}" y="${y + 3}">${k(maxBal * (1 - g / 4))}</text>`;
    }
    const step = Math.ceil(list.length / 6);
    const curYear = todayISO().slice(0, 4);
    let path = `M${L},${yBal(rows[0].balance + rows[0].principal).toFixed(1)}`;
    list.forEach(([y, v], idx) => {
      const x = L + idx * cw + cw * 0.14, w = cw * 0.72, rx = Math.min(2, w / 3);
      s += `<rect class="bar-i" style="--i:${idx}" x="${x}" y="${yBar(v.i)}" width="${w}" height="${yBar(0) - yBar(v.i)}" rx="${rx}"><title>${y}: проценты ${rub(v.i)}</title></rect>`;
      s += `<rect class="bar-p" style="--i:${idx}" x="${x}" y="${yBar(v.i + v.p)}" width="${w}" height="${yBar(v.i) - yBar(v.i + v.p)}" rx="${rx}"><title>${y}: тело ${rub(v.p)}</title></rect>`;
      path += `L${(L + (idx + 1) * cw).toFixed(1)},${yBal(v.bal).toFixed(1)}`;
      if (idx % step === 0) s += `<text x="${L + idx * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${y}</text>`;
      if (y === curYear) s += `<line class="today-line" x1="${L + idx * cw + cw / 2}" x2="${L + idx * cw + cw / 2}" y1="${T - 6}" y2="${H - B}"/>`;
    });
    s += `<path class="bal" pathLength="1" d="${path}"/>`;
    return s + "</svg>";
  }

  // --- досрочка ---
  function renderPrepay() {
    if (!state.loans.length) { $("pp-seg").innerHTML = ""; renderPrepayList(); return; }
    if (!state.loans.some((l) => l.id === ui.ppLoan)) {
      // по умолчанию — кредит с самой высокой ставкой
      ui.ppLoan = [...state.loans].sort((a, b) => b.rate - a.rate)[0].id;
    }
    seg($("pp-seg"), state.loans.map((l) => ({ v: l.id, label: `${l.name} · ${String(l.rate).replace(".", ",")}%` })), ui.ppLoan, (v) => (ui.ppLoan = v));
    if (!$("pp-date").value) $("pp-date").value = todayISO();
    renderPrepayList();
  }
  function onPrepaySubmit(e) {
    e.preventDefault();
    const loan = state.loans.find((l) => l.id === ui.ppLoan);
    const amount = num($("pp-amount").value);
    const date = $("pp-date").value;
    if (!loan || amount <= 0 || !date) { toast("Укажите кредит, сумму и дату"); return; }
    const c = Calc.comparePrepay(loan, amount, date);
    const box = $("pp-result");
    box.hidden = false;
    box.classList.remove("view-in"); void box.offsetWidth; box.classList.add("view-in");
    const best = c.term.saving >= c.payment.saving ? "term" : "payment";
    const w = (x) => ((x / c.base.totalInterest) * 100).toFixed(1);
    box.innerHTML = `<h2>${esc(loan.name)}: ${rub(amount)} ${dateRu(date)}</h2>
      <div class="saving-bars" style="--c:${color(loan)}">
        <div><div class="lbl"><span>Проценты без досрочки</span><b>${rub(c.base.totalInterest)}</b></div><div class="bar" style="--c:var(--s4)"><i data-w="100"></i></div></div>
        <div><div class="lbl"><span>Уменьшить платёж</span><b>${rub(c.payment.totalInterest)}</b></div><div class="bar" style="--c:var(--s1)"><i data-w="${w(c.payment.totalInterest)}"></i></div></div>
        <div><div class="lbl"><span>Уменьшить срок</span><b>${rub(c.term.totalInterest)}</b></div><div class="bar" style="--c:var(--good)"><i data-w="${w(c.term.totalInterest)}"></i></div></div>
      </div>
      <div class="table-wrap"><table class="cmp">
        <thead><tr><th></th><th>Без досрочки</th><th>Меньше платёж</th><th>Меньше срок</th></tr></thead>
        <tbody>
          <tr><td>Платёж после</td><td>${rub(c.base.paymentAfter)}</td><td>${rub(c.payment.paymentAfter)}</td><td>${rub(c.term.paymentAfter)}</td></tr>
          <tr><td>Последний платёж</td><td>${dateShort(c.base.lastDate)}</td><td>${dateShort(c.payment.lastDate)}</td><td>${dateShort(c.term.lastDate)}</td></tr>
          <tr><td>Экономия</td><td>—</td><td class="${best === "payment" ? "good" : ""}">${rub(c.payment.saving)}</td><td class="${best === "term" ? "good" : ""}">${rub(c.term.saving)}</td></tr>
        </tbody>
      </table></div>
      <p class="verdict">Сокращение срока экономит на ${rub(c.term.saving - c.payment.saving)} больше и убирает ${termText(c.term.monthsCut)} платежей. Уменьшение платежа снижает нагрузку на ${rub(c.base.paymentAfter - c.payment.paymentAfter)} в месяц.</p>
      <div class="actions" style="margin-top:12px">
        <button class="btn ghost small" data-save="term">Внести в план (срок)</button>
        <button class="btn ghost small" data-save="payment">Внести в план (платёж)</button>
      </div>`;
    animateIn(box);
    box.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => {
      loan.prepays = (loan.prepays || []).concat([{ date, amount, kind: b.dataset.save }]);
      save();
      renderPrepayList();
      toast("Досрочка добавлена в график");
    }));

    // какой кредит гасить той же суммой: сравниваем по ставке. Рубли экономии
    // у длинного кредита всегда больше просто из-за срока, поэтому они только для справки.
    const where = $("pp-where");
    if (state.loans.length > 1) {
      const res = state.loans.map((l) => {
        const sched = Calc.schedule(l, l.prepays || []);
        return { l, term: Calc.comparePrepay(l, amount, date).term.saving, yearInterest: (amount * Number(l.rate)) / 100, left: Calc.statusAt(l, sched, date).leftCount };
      }).sort((a, b) => b.l.rate - a.l.rate);
      const top = res[0], low = res[res.length - 1];
      where.hidden = false;
      where.classList.remove("view-in"); void where.offsetWidth; where.classList.add("view-in");
      where.innerHTML = `<h2>Какой кредит гасить этой суммой</h2>
        <div class="table-wrap"><table class="cmp"><thead><tr><th></th><th>Ставка</th><th>Экономия в год</th><th>За весь срок</th></tr></thead><tbody>
        ${res.map((x, i) => `<tr><td>${esc(x.l.name)}</td><td class="${i === 0 ? "good" : ""}">${String(x.l.rate).replace(".", ",")}%</td><td class="${i === 0 ? "good" : ""}">${rub(x.yearInterest)}</td><td>${rub(x.term)}<br><span class="sub">${termText(x.left)}</span></td></tr>`).join("")}
        </tbody></table></div>
        <p class="verdict">${top.l.rate > low.l.rate
          ? `Первым гасите «${esc(top.l.name)}» (${String(top.l.rate).replace(".", ",")}%): каждый внесённый рубль перестаёт обходиться в ${String(top.l.rate).replace(".", ",")}% годовых, а не в ${String(low.l.rate).replace(".", ",")}%. Это ${rub(top.yearInterest - low.yearInterest)} в год разницы. Сумма «за весь срок» выше у более длинного кредита только из-за срока, и сравнивать по ней нельзя.`
          : "Ставки одинаковые, разницы почти нет."}
          Если по кредиту ещё получаете вычет по процентам, его реальная ставка на 13% ниже. Если вклад приносит больше ставки кредита, досрочка по этому кредиту ему проигрывает.</p>`;
    } else {
      where.hidden = true;
    }
  }
  function renderPrepayList() {
    const items = [];
    state.loans.forEach((l) => (l.prepays || []).forEach((p, i) => items.push({ l, p, i })));
    $("pp-list").innerHTML = `<h2>Досрочки в графике</h2>` + (items.length
      ? items.map(({ l, p, i }) => `<div class="row-between loan"><span>${dateShort(p.date)} · ${esc(l.name)} · <b>${rub(p.amount)}</b> (${p.kind === "term" ? "срок" : "платёж"})</span><button class="btn link" data-del="${l.id}:${i}">убрать</button></div>`).join("")
      : `<p class="muted" style="margin:0">Пока нет. Внесённые досрочки сразу учитываются на главной и в графике.</p>`);
    $("pp-list").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const [id, i] = b.dataset.del.split(":");
      const l = state.loans.find((x) => x.id === id);
      l.prepays.splice(Number(i), 1);
      save();
      renderPrepayList();
    }));
  }

  // --- данные ---
  let editingId = null;
  function renderData() {
    $("loan-list").innerHTML = state.loans.length
      ? state.loans.map((l) => `<div class="loan" style="--c:${color(l)}"><div class="loan-head"><span class="sw"></span><strong>${esc(l.name)}</strong><button class="btn ghost small" data-edit="${l.id}">Изменить</button></div>
          <div class="sub" style="margin-top:6px">${rub(l.balance)} на ${dateShort(l.balanceDate)} · ${String(l.rate).replace(".", ",")}% · ${l.n} плат. · платёж ${l.payment ? rub(l.payment) : "по формуле"}</div></div>`).join("")
      : `<p class="muted" style="margin:0">Добавьте оба кредита — тогда главная покажет общий платёж и сравнит досрочку между ними.</p>`;
    $("loan-list").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
    const sf = $("settings-form");
    sf.ddDate.value = state.settings.ddDate || "";
    sf.keysDate.value = state.settings.keysDate || "";
  }
  function openEditor(id) {
    editingId = id;
    const f = $("loan-form");
    const l = state.loans.find((x) => x.id === id) || { mode: "daily" };
    $("editor-title").textContent = id ? "Изменить кредит" : "Новый кредит";
    ["name", "balanceDate", "firstDate", "contractDate"].forEach((k) => (f[k].value = l[k] || ""));
    ["balance", "rate", "n", "payment", "origAmount"].forEach((k) => (f[k].value = l[k] ? String(l[k]).replace(".", ",") : ""));
    f.firstInterestOnly.checked = !!l.firstInterestOnly;
    f.mode.value = l.mode || "daily";
    $("delete-loan").hidden = !id;
    const ed = $("loan-editor");
    ed.hidden = false;
    ed.classList.remove("view-in"); void ed.offsetWidth; ed.classList.add("view-in");
    ed.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  }
  function onLoanSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value.trim(),
      balance: num(f.balance.value),
      balanceDate: f.balanceDate.value,
      rate: num(f.rate.value),
      n: Math.round(num(f.n.value)),
      firstDate: f.firstDate.value,
      payDay: Number(f.firstDate.value.slice(8, 10)),
      payment: num(f.payment.value) || 0,
      origAmount: num(f.origAmount.value) || 0,
      contractDate: f.contractDate.value,
      firstInterestOnly: f.firstInterestOnly.checked,
      mode: f.mode.value,
    };
    if (data.balance <= 0 || data.rate < 0 || data.n <= 0) { toast("Проверьте остаток, ставку и число платежей"); return; }
    if (Calc.parseDate(data.firstDate) <= Calc.parseDate(data.balanceDate)) { toast("Дата платежа должна быть позже даты остатка"); return; }
    const existing = state.loans.find((x) => x.id === editingId);
    if (existing) Object.assign(existing, data);
    else state.loans.push({ id: "l" + Date.now().toString(36), prepays: [], ...data });
    save();
    $("loan-editor").hidden = true;
    renderData();
    toast("Сохранено");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ipoteka-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.loans)) throw new Error("bad");
      state = { ...blank(), ...data, settings: { ...blank().settings, ...(data.settings || {}) } };
      await save();
      toast(`Загружено кредитов: ${state.loans.length}`);
      location.hash = "#home";
      route();
    } catch (e) {
      toast("Это не файл копии");
    }
  }

  // --- запуск ---
  async function init() {
    $("today").textContent = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const saved = await load();
    if (saved && Array.isArray(saved.loans)) state = { ...blank(), ...saved, settings: { ...blank().settings, ...(saved.settings || {}) } };

    $("theme").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.querySelector('meta[name="theme-color"]').content = next === "dark" ? "#021a2b" : "#eaf1f8";
      try { localStorage.setItem("ipoteka.theme", next); } catch (_) {}
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", () => { moveTabInd(); document.querySelectorAll(".seg").forEach((s) => s._move && s._move()); });
    $("sched-future").addEventListener("change", drawSchedule);
    $("prepay-form").addEventListener("submit", onPrepaySubmit);
    $("add-loan").addEventListener("click", () => openEditor(null));
    $("cancel-loan").addEventListener("click", () => ($("loan-editor").hidden = true));
    $("delete-loan").addEventListener("click", () => {
      if (!confirm("Удалить этот кредит со всеми досрочками?")) return;
      state.loans = state.loans.filter((x) => x.id !== editingId);
      save();
      $("loan-editor").hidden = true;
      renderData();
    });
    $("loan-form").addEventListener("submit", onLoanSubmit);
    $("settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.settings.ddDate = e.target.ddDate.value;
      state.settings.keysDate = e.target.keysDate.value;
      save();
      toast("Сохранено");
    });
    $("export").addEventListener("click", exportBackup);
    document.querySelectorAll(".import-input").forEach((inp) => inp.addEventListener("change", (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = "";
    }));
    $("wipe").addEventListener("click", () => {
      if (!confirm("Стереть все кредиты и настройки из этого браузера? Сначала лучше скачать копию.")) return;
      state = blank();
      save();
      route();
    });

    route();
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();

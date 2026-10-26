// Расчёт ипотеки: график аннуитета и досрочные погашения.
// Чистые функции без DOM — работают и в браузере, и в node (для проверки).
(function (root) {
  "use strict";

  const DAY = 86400000;

  // --- даты: строки "ГГГГ-ММ-ДД", внутри — UTC-миллисекунды ---
  function parseDate(s) {
    const [y, m, d] = String(s).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fmtISO(t) {
    return new Date(t).toISOString().slice(0, 10);
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }
  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  // дата k-го платежа: месяц первого платежа + k, число = payDay (или последний день месяца)
  function paymentDate(firstT, k, payDay) {
    const f = new Date(firstT);
    const total = f.getUTCMonth() + k;
    const y = f.getUTCFullYear() + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    return Date.UTC(y, m, Math.min(payDay, daysInMonth(y, m)));
  }

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  function annuity(balance, monthlyRate, n) {
    if (n <= 0) return balance;
    if (monthlyRate === 0) return balance / n;
    return (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
  }

  // проценты по дням за период (from; to], с учётом високосных лет — так считает Сбер
  function accrueDaily(balance, yearRate, fromT, toT) {
    let sum = 0;
    let t = fromT;
    while (t < toT) {
      const y = new Date(t).getUTCFullYear();
      const yearEnd = Date.UTC(y + 1, 0, 1);
      const segEnd = Math.min(toT, yearEnd);
      const days = Math.round((segEnd - t) / DAY);
      sum += (balance * yearRate * days) / (isLeap(y) ? 366 : 365);
      t = segEnd;
    }
    return sum;
  }

  /**
   * Полный график платежей.
   * loan: { balance, balanceDate, rate (% годовых), n (число платежей), firstDate, payDay,
   *         payment (необязательно — платёж по договору), firstInterestOnly, mode: "daily"|"monthly" }
   * prepays: [{ date, amount, kind: "payment" (уменьшить платёж) | "term" (уменьшить срок) }]
   * opts: { monthlyExtra, extraFrom, extraKind } — каждый месяц после платежа вносить ещё monthlyExtra;
   *       { keepTotal, extraFrom } — платёж уменьшается, но платить keepTotal, разницу — досрочно в платёж.
   */
  function schedule(loan, prepays, opts) {
    opts = opts || {};
    const extraFromT = opts.extraFrom ? parseDate(opts.extraFrom) : 0;
    const yearRate = Number(loan.rate) / 100;
    const r = yearRate / 12;
    const n = Math.max(1, Math.round(Number(loan.n)));
    const daily = loan.mode !== "monthly";
    const firstT = parseDate(loan.firstDate);
    const payDay = Number(loan.payDay) || new Date(firstT).getUTCDate();
    const extra = (prepays || [])
      .filter((p) => p && p.date && Number(p.amount) > 0)
      .map((p) => ({ t: parseDate(p.date), amount: Number(p.amount), kind: p.kind === "term" ? "term" : "payment", date: p.date }))
      .sort((a, b) => a.t - b.t);

    let balance = round2(Number(loan.balance));
    let A = Number(loan.payment) > 0 ? round2(Number(loan.payment)) : round2(annuity(balance, r, n));
    const startPayment = A;
    let prevT = parseDate(loan.balanceDate);
    let pending = 0; // проценты, набежавшие до досрочки внутри периода
    let ei = 0;
    const rows = [];

    for (let k = 0; k < n + 600 && balance > 0.004; k++) {
      const t = paymentDate(firstT, k, payDay);
      const applied = [];

      // досрочки между прошлым и этим платежом (в дату платежа — после него, ниже)
      while (ei < extra.length && extra[ei].t < t) {
        const p = extra[ei++];
        if (p.t <= prevT) {
          // досрочка раньше начала графика — сразу уменьшаем остаток
        } else if (daily) {
          pending += accrueDaily(balance, yearRate, prevT, p.t);
          prevT = p.t;
        }
        const amt = Math.min(p.amount, balance);
        balance = round2(balance - amt);
        applied.push({ date: p.date, amount: amt, kind: p.kind });
        if (p.kind === "payment") A = round2(annuity(balance, r, n - k));
      }

      let interest = daily ? round2(pending + accrueDaily(balance, yearRate, prevT, t)) : round2(balance * r);
      pending = 0;
      let principal;
      let pay;
      if (k === 0 && loan.firstInterestOnly) {
        principal = 0;
        pay = interest;
      } else if (k >= n - 1 || balance + interest <= A + 0.004) {
        principal = balance;
        pay = round2(balance + interest);
      } else {
        principal = round2(Math.max(0, A - interest));
        pay = round2(principal + interest);
      }
      balance = round2(balance - principal);
      prevT = t;

      // досрочки ровно в дату платежа — после регулярного платежа
      while (ei < extra.length && extra[ei].t === t && balance > 0) {
        const p = extra[ei++];
        const amt = Math.min(p.amount, balance);
        balance = round2(balance - amt);
        applied.push({ date: p.date, amount: amt, kind: p.kind });
        if (p.kind === "payment") A = round2(annuity(balance, r, n - k - 1));
      }

      // регулярная досрочка сверх платежа (не в месяц «только проценты»)
      if (t >= extraFromT && balance > 0 && principal > 0) {
        let extraAmt = 0;
        let kind = opts.extraKind === "payment" ? "payment" : "term";
        if (opts.keepTotal > 0) { extraAmt = opts.keepTotal - pay; kind = "payment"; }
        else if (opts.monthlyExtra > 0) extraAmt = opts.monthlyExtra;
        extraAmt = round2(Math.min(Math.max(0, extraAmt), balance));
        if (extraAmt > 0) {
          balance = round2(balance - extraAmt);
          applied.push({ date: fmtISO(t), amount: extraAmt, kind, auto: true });
          if (kind === "payment") A = round2(annuity(balance, r, n - k - 1));
        }
      }

      rows.push({ k: k + 1, date: fmtISO(t), t, payment: pay, interest, principal, balance, prepays: applied });
    }

    const totalInterest = round2(rows.reduce((s, x) => s + x.interest, 0));
    const totalPrepaid = round2(rows.reduce((s, x) => s + x.prepays.reduce((a, p) => a + p.amount, 0), 0));
    const totalPaid = round2(rows.reduce((s, x) => s + x.payment, 0) + totalPrepaid);
    return {
      rows,
      startPayment,
      currentPayment: A,
      totalInterest,
      totalPaid,
      totalPrepaid,
      lastDate: rows.length ? rows[rows.length - 1].date : null,
      count: rows.length,
    };
  }

  // положение «на сегодня»: уплачено всё, что строго раньше today; платёж today — ближайший
  function statusAt(loan, sched, todayISO) {
    const today = parseDate(todayISO);
    let balance = round2(Number(loan.balance));
    let paidInterest = 0;
    let paidPrincipal = 0;
    let paidCount = 0;
    let next = null;
    for (const row of sched.rows) {
      if (row.t < today) {
        balance = row.balance;
        paidInterest += row.interest;
        paidPrincipal += row.principal + row.prepays.reduce((a, p) => a + p.amount, 0);
        paidCount++;
      } else if (!next) {
        next = row;
      }
    }
    // текущий регулярный платёж — первый «полный» после ближайшего
    const regular = sched.rows.find((x) => x.t >= today && x.principal > 0) || next;
    return {
      balance,
      paidInterest: round2(paidInterest),
      paidPrincipal: round2(paidPrincipal),
      paidCount,
      leftCount: sched.rows.length - paidCount,
      leftInterest: round2(sched.totalInterest - paidInterest),
      next,
      regularPayment: regular ? regular.payment : 0,
    };
  }

  // сравнение: без досрочки / уменьшить платёж / уменьшить срок
  function comparePrepay(loan, amount, dateISO) {
    const base = loan.prepays || [];
    const s0 = schedule(loan, base);
    const sP = schedule(loan, base.concat([{ date: dateISO, amount, kind: "payment" }]));
    const sT = schedule(loan, base.concat([{ date: dateISO, amount, kind: "term" }]));
    const after = (s) => {
      const t = parseDate(dateISO);
      const row = s.rows.find((x) => x.t > t && x.principal > 0 && x.k < s.rows.length);
      return row ? row.payment : s.currentPayment;
    };
    return {
      base: { ...pick(s0), paymentAfter: after(s0) },
      payment: { ...pick(sP), paymentAfter: after(sP), saving: round2(s0.totalInterest - sP.totalInterest) },
      term: { ...pick(sT), paymentAfter: after(sT), saving: round2(s0.totalInterest - sT.totalInterest), monthsCut: s0.count - sT.count },
    };
  }
  // первый «полный» платёж после даты (для показа нового платежа)
  function paymentAfter(s, iso) {
    const t = parseDate(iso);
    const row = s.rows.find((x) => x.t > t && x.principal > 0 && x.k < s.rows.length);
    return row ? row.payment : s.currentPayment;
  }

  /**
   * Варианты досрочки по одному кредиту: разово lump (в дату from) и/или каждый месяц monthly сверх платежа.
   * term — сокращать срок; payment — уменьшать платёж; keep — уменьшать платёж, но платить как раньше.
   */
  function variants(loan, { lump = 0, monthly = 0, from }) {
    const base = loan.prepays || [];
    const withLump = (kind) => (lump > 0 ? base.concat([{ date: from, amount: lump, kind }]) : base);
    const s0 = schedule(loan, base);
    const regular = paymentAfter(s0, from);
    const out = {
      base: s0,
      term: schedule(loan, withLump("term"), { monthlyExtra: monthly, extraFrom: from, extraKind: "term" }),
      payment: schedule(loan, withLump("payment"), { monthlyExtra: monthly, extraFrom: from, extraKind: "payment" }),
      keep: schedule(loan, withLump("payment"), { keepTotal: regular + monthly, extraFrom: from }),
    };
    const res = { regular };
    const [fy, fm, fd] = from.split("-").map(Number);
    const yearLater = fmtISO(Date.UTC(fy + 1, fm - 1, fd));
    for (const [key, s] of Object.entries(out)) {
      res[key] = {
        totalInterest: s.totalInterest, lastDate: s.lastDate, count: s.count,
        paymentAfter: paymentAfter(s, from),
        paymentYear: paymentAfter(s, yearLater),
        saving: round2(s0.totalInterest - s.totalInterest),
        monthsCut: s0.count - s.count,
      };
    }
    return res;
  }

  /**
   * План «лавина»: разовая сумма и ежемесячный излишек идут в кредит с самой высокой ставкой;
   * когда он закрыт, его платёж плюс излишек переходят на следующий. loans уже отсортированы.
   */
  function avalanche(loans, { lump = 0, monthly = 0, from }) {
    let roll = monthly;
    let start = from;
    let lumpLeft = lump;
    const out = [];
    for (const loan of loans) {
      const base = loan.prepays || [];
      const s0 = schedule(loan, base);
      const prepays = lumpLeft > 0 ? base.concat([{ date: from, amount: lumpLeft, kind: "term" }]) : base;
      const s = schedule(loan, prepays, { monthlyExtra: roll, extraFrom: start, extraKind: "term" });
      const used = s.rows.reduce((a, x) => a + x.prepays.filter((p) => p.date === from && !p.auto).reduce((b, p) => b + p.amount, 0), 0);
      lumpLeft = Math.max(0, lumpLeft - used);
      out.push({ loan, base: s0, plan: s, saving: round2(s0.totalInterest - s.totalInterest), monthsCut: s0.count - s.count });
      // после закрытия этого кредита его платёж добавляется к излишку для следующего
      roll += paymentAfter(s0, from);
      start = s.lastDate;
    }
    return out;
  }

  function pick(s) {
    return { totalInterest: s.totalInterest, totalPaid: s.totalPaid, lastDate: s.lastDate, count: s.count };
  }

  const Calc = { parseDate, fmtISO, paymentDate, annuity, accrueDaily, schedule, statusAt, comparePrepay, variants, avalanche, paymentAfter, round2 };
  root.Calc = Calc;
  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
})(typeof window !== "undefined" ? window : globalThis);

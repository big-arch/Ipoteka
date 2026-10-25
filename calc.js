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
   */
  function schedule(loan, prepays) {
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
  function pick(s) {
    return { totalInterest: s.totalInterest, totalPaid: s.totalPaid, lastDate: s.lastDate, count: s.count };
  }

  const Calc = { parseDate, fmtISO, paymentDate, annuity, accrueDaily, schedule, statusAt, comparePrepay, round2 };
  root.Calc = Calc;
  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
})(typeof window !== "undefined" ? window : globalThis);

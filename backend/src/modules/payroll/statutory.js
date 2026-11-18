/*
 * Payroll arithmetic, with no database: how a salary splits, and the PF, ESI, professional tax and net pay of one payslip. Money is in paise.
 *
 *  PF   employee 12% of PF wages (basic, optionally capped at the ceiling, Rs 15,000 a month). The employer's 12% is the pension share (8.33% of wages up to the ceiling)
 *       and the rest to the provident fund; the admin charge and EDLI (0.5% each, on wages up to the ceiling) are the employer's cost on top.
 *  ESI  only while the month's gross is at most the ceiling (Rs 21,000): employee 0.75%, employer 3.25%, each rounded UP to the next rupee.
 *  PT   a slab on the month's gross; February can carry a different amount. The slabs are the business's own (a state's usual ones can be filled in).
 *  TDS  typed in per employee (the CA's monthly figure): it is not worked out here.
 */
export const PF_RATE = 12;
export const EPS_RATE = 8.33;
export const EPF_ADMIN_RATE = 0.5;
export const EDLI_RATE = 0.5;
export const ESI_EMPLOYEE_RATE = 0.75;
export const ESI_EMPLOYER_RATE = 3.25;

const pct = (paise, rate) => Math.round((Number(paise) * rate) / 100);
const upToRupee = (paise) => Math.ceil(Math.round(paise) / 100 - 1e-9) * 100;

/** The salary split: basic (the typed figure, else the default percentage of gross), HRA, and the rest as other allowances. They always add up to the gross. */
export const splitSalary = ({ grossPaise, basicPaise = null, hraPaise = 0, defaultBasicPct = 50 }) => {
  const gross = Math.max(0, Math.round(Number(grossPaise) || 0));
  const basic = Math.min(gross, basicPaise == null ? pct(gross, defaultBasicPct) : Math.round(Number(basicPaise)));
  const hra = Math.min(gross - basic, Math.max(0, Math.round(Number(hraPaise) || 0)));
  return { basic, hra, other: gross - basic - hra };
};

export const providentFund = (basicEarnedPaise, { capOnCeiling = true, ceilingPaise = 1500000 } = {}) => {
  const wages = capOnCeiling ? Math.min(basicEarnedPaise, ceilingPaise) : basicEarnedPaise;
  const limited = Math.min(wages, ceilingPaise);   // the pension share and the charges are always on wages up to the ceiling
  const employee = pct(wages, PF_RATE);
  const employerTotal = pct(wages, PF_RATE);
  const eps = pct(limited, EPS_RATE);
  return { wages, employee, employer: employerTotal, eps, epf: employerTotal - eps, admin: pct(limited, EPF_ADMIN_RATE) + pct(limited, EDLI_RATE) };
};

export const stateInsurance = (grossPaise, { ceilingPaise = 2100000 } = {}) =>
  (grossPaise > 0 && grossPaise <= ceilingPaise
    ? { wages: grossPaise, employee: upToRupee((grossPaise * ESI_EMPLOYEE_RATE) / 100), employer: upToRupee((grossPaise * ESI_EMPLOYER_RATE) / 100) }
    : { wages: grossPaise, employee: 0, employer: 0 });

/** The professional tax for a month's gross: the slab it falls in, and the February amount in February (month is 'YYYY-MM'). */
export const professionalTax = (grossPaise, slabs, month) => {
  const slab = [...slabs].sort((a, b) => Number(a.from_paise) - Number(b.from_paise)).reverse()
    .find((s) => grossPaise >= Number(s.from_paise) && (s.to_paise == null || grossPaise <= Number(s.to_paise)));
  if (!slab) return 0;
  return String(month).slice(5, 7) === '02' && slab.february_paise != null ? Number(slab.february_paise) : Number(slab.tax_paise);
};

/**
 * One payslip's statutory amounts and net pay.
 *  earned: { base, overtime, allowances } what the person earned this month (base is already prorated for attendance)
 *  salary: the full monthly pay (to prorate the basic the same way the base was)
 */
export const slipAmounts = ({ salaryPaise, payType, earned, profile, settings, slabs, month, deductionsPaise = 0, loanDuePaise = 0 }) => {
  const base = Math.round(Number(earned.base)); const overtime = Math.round(Number(earned.overtime)); const allowances = Math.round(Number(earned.allowances));
  const gross = base + overtime + allowances;
  const ratio = Number(salaryPaise) > 0 && payType !== 'DAILY' ? base / Number(salaryPaise) : 1;
  const fullGross = payType === 'DAILY' ? base : Number(salaryPaise);
  const parts = splitSalary({ grossPaise: fullGross, basicPaise: profile?.basic_paise ?? null, hraPaise: profile?.hra_paise ?? 0, defaultBasicPct: Number(settings.default_basic_pct ?? 50) });
  const basicEarned = payType === 'DAILY' ? parts.basic : Math.round(parts.basic * ratio);
  const hraEarned = payType === 'DAILY' ? parts.hra : Math.round(parts.hra * ratio);

  const pf = settings.pf_enabled && profile?.pf_applicable ? providentFund(basicEarned, { capOnCeiling: settings.pf_cap_on_ceiling !== false, ceilingPaise: Number(settings.pf_ceiling_paise ?? 1500000) }) : { wages: 0, employee: 0, employer: 0, eps: 0, epf: 0, admin: 0 };
  const esi = settings.esi_enabled && profile?.esi_applicable ? stateInsurance(gross, { ceilingPaise: Number(settings.esi_ceiling_paise ?? 2100000) }) : { wages: 0, employee: 0, employer: 0 };
  const pt = settings.pt_enabled && profile?.pt_applicable !== false ? professionalTax(gross, slabs, month) : 0;
  const tds = Number(profile?.tds_monthly_paise ?? 0);

  const before = gross - pf.employee - esi.employee - pt - tds - Number(deductionsPaise);
  const loan = Math.max(0, Math.min(Number(loanDuePaise), before));   // a loan is never recovered below zero pay
  return {
    basic_paise: basicEarned, hra_paise: hraEarned, gross_paise: gross,
    pf_employee_paise: pf.employee, pf_employer_paise: pf.employer, pf_admin_paise: pf.admin,
    esi_employee_paise: esi.employee, esi_employer_paise: esi.employer, pt_paise: pt, tds_paise: tds, loan_recovery_paise: loan,
    net_pay_paise: before - loan, pf_wages_paise: pf.wages
  };
};

/* The usual monthly professional tax slabs of some states, to start from (rupees; the owner can change every row). Check them against the state's current notification. */
const R = (n) => n * 100;
export const PT_PRESETS = {
  Karnataka: [{ from: 0, to: R(24999), tax: 0 }, { from: R(25000), to: null, tax: R(200), feb: R(300) }],
  Maharashtra: [{ from: 0, to: R(7500), tax: 0 }, { from: R(7501), to: R(10000), tax: R(175) }, { from: R(10001), to: null, tax: R(200), feb: R(300) }],
  Telangana: [{ from: 0, to: R(15000), tax: 0 }, { from: R(15001), to: R(20000), tax: R(150) }, { from: R(20001), to: null, tax: R(200) }],
  'Andhra Pradesh': [{ from: 0, to: R(15000), tax: 0 }, { from: R(15001), to: R(20000), tax: R(150) }, { from: R(20001), to: null, tax: R(200) }],
  'West Bengal': [{ from: 0, to: R(10000), tax: 0 }, { from: R(10001), to: R(15000), tax: R(110) }, { from: R(15001), to: R(25000), tax: R(130) }, { from: R(25001), to: R(40000), tax: R(150) }, { from: R(40001), to: null, tax: R(200) }],
  Gujarat: [{ from: 0, to: R(12000), tax: 0 }, { from: R(12001), to: null, tax: R(200) }]
};
export const ptPresetSlabs = (state) => {
  const key = Object.keys(PT_PRESETS).find((k) => k.toLowerCase() === String(state || '').trim().toLowerCase());
  return key ? PT_PRESETS[key].map((s) => ({ from_paise: s.from, to_paise: s.to, tax_paise: s.tax, february_paise: s.feb ?? null })) : null;
};

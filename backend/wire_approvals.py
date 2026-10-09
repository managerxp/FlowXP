import re

def edit(path, pairs):
    t = open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert a in t, (path, a[:90])
        t = t.replace(a, b, 1)
    open(path, 'w', encoding='utf-8').write(t)

# ---- the right: who may approve
edit('src/middleware/auth.js', [
    ("            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing'],\n  MANAGER:",
     "            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing', 'approvals'],\n  MANAGER:"),
    ("            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing'],\n  CASHIER:",
     "            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing', 'approvals'],\n  CASHIER:"),
    ("  SALES_MANAGER: ['billing', 'customers', 'payments', 'reports', 'refunds', 'sales_orders',", "  SALES_MANAGER: ['billing', 'customers', 'payments', 'reports', 'refunds', 'approvals', 'sales_orders',"),
    ("  DISTRIBUTOR_ADMIN: ['billing', 'products',", "  DISTRIBUTOR_ADMIN: ['approvals', 'billing', 'products',"),
    ("              b.currency, b.onboarding_step, b.gst_enabled, b.require_2fa_admins, b.upi_vpa,", "              b.currency, b.onboarding_step, b.gst_enabled, b.require_2fa_admins, b.upi_vpa, b.discount_cap_pct, b.cancel_needs_approval,"),
    ("    permissions: membership.permissions || {},\n    /* branchId:", "    permissions: membership.permissions || {},\n    // manager approval (modules/approvals.js): the biggest typed-in discount staff may give alone, and whether cancelling a bill needs a manager's PIN\n    discountCapPct: Number(membership.discount_cap_pct ?? 100),\n    cancelNeedsApproval: membership.cancel_needs_approval !== false,\n    /* branchId:"),
])
edit('src/modules/permissions.js', [
    ("  refunds:   { label: 'Refunds', description: 'Refund money on an invoice.' },",
     "  refunds:   { label: 'Refunds', description: 'Refund money on an invoice.' },\n  approvals: { label: 'Approve cancellations and large discounts', description: 'Allow a bill to be cancelled, or a discount above the business\\'s limit, by entering a PIN at the till. Set your PIN in Security.' },"),
])

# ---- errors that carry a code the till can act on
edit('src/modules/salon/common.js', [
    ("      return res.status(error.status).json({ success: false, message: error.message });\n    }\n    // a malformed id",
     "      return res.status(error.status).json({ success: false, message: error.message, ...(typeof error.code === 'string' && error.code.startsWith('APPROVAL_') ? { code: error.code, data: error.data } : {}) });\n    }\n    // a malformed id"),
])

# ---- billing: ask the policy once, with everything typed in on the bill
edit('src/modules/billing.js', [
    ("    let discountPaise = raw.discount != null ? toPaise(raw.discount) : 0;",
     "    let discountPaise = raw.discount != null ? toPaise(raw.discount) : 0;\n    if (input.discountPolicy?.lines) { typedDiscountPaise += discountPaise; typedGrossPaise += Math.round(quantity * unitPricePaise); }"),
    ("  let invoiceDiscountPaise = input.discount != null ? toPaise(input.discount) : 0;",
     "  let invoiceDiscountPaise = input.discount != null ? toPaise(input.discount) : 0;\n  if (input.discountPolicy && invoiceDiscountPaise > 0) {\n    // the bill's own discount counts against what the lines come to (before tax), together with any typed on the lines; one question, with everything typed in\n    typedDiscountPaise += invoiceDiscountPaise;\n    if (!input.discountPolicy.lines) typedGrossPaise = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPricePaise), 0);\n  }\n  if (input.discountPolicy && typedDiscountPaise > 0) await input.discountPolicy.check({ discountPaise: typedDiscountPaise, grossPaise: typedGrossPaise });"),
])
t = open('src/modules/billing.js', encoding='utf-8').read()
# declare the counters before the line loop: find where lines are built
m = re.search(r"\n(\s*)(const lines = \[\];|let lines = \[\];)", t)
print('lines decl', bool(m))
open('src/modules/billing.js', 'w', encoding='utf-8').write(t)
print('ok')

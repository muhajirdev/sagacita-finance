"""Generates dummy data for demos: python3 scripts/sample-data.py > /tmp/sample.sql

Everything it makes is easy to remove later:
  projects with code 'DEMO-%', parties with notes 'sample', transactions with source 'import',
  payroll_months with notes 'sample'. See scripts/sample-data-wipe.sql.
Assumes the seed (company 1, divisions 1-3, clients 1-11) and no other data.
"""
import random
from datetime import date, timedelta

random.seed(42)
out = []
q = lambda s: "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

VENDORS = [
    "PT Cahaya Produksi", "CV Lensa Kreatif", "PT Panggung Megah", "CV Sinar Lighting", "PT Gema Audio",
    "Studio Rekam Jaya", "PT Media Tayang", "CV Cetak Kilat", "PT Rasa Catering", "PT Talenta Bintang",
    "CV Digital Ads Pro", "PT Venue Nusantara", "CV Kurir Cepat", "PT Influencer Hub", "PT Sewa Kamera",
]
EMPLOYEES = ["Rina", "Budi", "Sari", "Dimas", "Ayu", "Fajar"]
for i, v in enumerate(VENDORS):
    out.append(f"INSERT INTO parties (id, kind, name, notes) VALUES ({101 + i}, 'vendor', {q(v)}, 'sample');")
for i, e in enumerate(EMPLOYEES):
    out.append(f"INSERT INTO parties (id, kind, name, notes) VALUES ({201 + i}, 'employee', {q(e)}, 'sample');")

LINES = [
    ("Produksi Video", 0.55), ("Talent & KOL", 0.6), ("Media Placement", 0.8), ("Event & Venue", 0.65),
    ("Creative & Design", 0.4), ("Printing & Merch", 0.6), ("Logistics", 0.7), ("PR Monitoring", 0.35),
]
PROJECTS = [
    ("Honda", 1, "Honda Brio Launch", "project"), ("Honda", 1, "Honda PR Retainer 2026", "retainer"),
    ("MG Motor", 2, "MG 4 EV Digital Campaign", "project"), ("Omoda Jaecoo", 2, "Jaecoo J7 Social", "retainer"),
    ("VinFast", 1, "VinFast Media Day", "project"), ("P&G Pantene", 3, "Pantene Ramadan", "project"),
    ("Intel", 2, "Intel AI PC Roadshow", "project"), ("Merz Aesthetics", 3, "Merz Clinic Activation", "project"),
    ("Tempo", 1, "Tempo Media Partnership", "retainer"), ("Aletra", 2, "Aletra Brand Awareness", "project"),
    ("Honest", 3, "Honest Product Launch", "project"), ("RS Royal Progress", 1, "RS Royal Health Talk", "project"),
]
CLIENT_ID = {n: i + 1 for i, n in enumerate([
    "Honda", "Aletra", "MG Motor", "Omoda Jaecoo", "Honest", "Tempo", "VinFast", "P&G Pantene", "Intel",
    "Merz Aesthetics", "RS Royal Progress"])}

today = date(2026, 11, 5)
line_id = 1
tx_id = 1
pay_id = 1

def tax(dpp, pph_type, with_ppn=True):
    ppn = round(dpp * 0.11) if with_ppn else 0
    pph = round(dpp * {"none": 0, "pph23": 0.02, "pph4_2": 0.1, "pph21": 0.025}[pph_type])
    return ppn, pph, dpp + ppn - pph

def add_tx(kind, project, line, party, dpp, issue, due, status, pph_type="none", with_ppn=True, desc=None,
           category=None, division=None, requested_by=None, number=None):
    global tx_id
    direction = "in" if kind == "client_invoice" else "out"
    ppn, pph, total = tax(dpp, pph_type, with_ppn)
    out.append(
        "INSERT INTO transactions (id, kind, direction, status, number, company_id, party_id, project_id, budget_line_id, "
        "division_id, category, description, issue_date, due_date, dpp, ppn, pph_type, pph, total, requested_by, source) VALUES "
        f"({tx_id}, {q(kind)}, {q(direction)}, {q(status)}, {q(number)}, 1, {party or 'NULL'}, {project or 'NULL'}, "
        f"{line or 'NULL'}, {division or 'NULL'}, {q(category)}, {q(desc)}, {q(issue.isoformat())}, "
        f"{q(due.isoformat() if due else None)}, {dpp}, {ppn}, {q(pph_type)}, {pph}, {total}, {q(requested_by)}, 'import');"
    )
    tx_id += 1
    return tx_id - 1, direction, total

def pay(tid, direction, amount, when):
    global pay_id
    out.append(
        f"INSERT INTO payments (id, transaction_id, direction, amount, date, company_id, method) VALUES "
        f"({pay_id}, {tid}, {q(direction)}, {amount}, {q(when.isoformat())}, 1, 'transfer');"
    )
    pay_id += 1

for pid, (client, division, name, ptype) in enumerate(PROJECTS, start=1):
    start = date(2026, random.randint(1, 9), 1)
    end = start + timedelta(days=random.choice([60, 90, 120, 180, 365 if ptype == "retainer" else 120]))
    code = f"DEMO-{client[:3].upper().replace(' ', '')}-{pid:02d}"
    out.append(
        "INSERT INTO projects (id, code, name, client_id, division_id, type, status, start_date, end_date) VALUES "
        f"({pid}, {q(code)}, {q(name)}, {CLIENT_ID[client]}, {division}, {q(ptype)}, "
        f"{q('closed' if end < today else 'active')}, {q(start.isoformat())}, {q(end.isoformat())});"
    )
    project_lines = []
    for lname, ratio in random.sample(LINES, random.randint(3, 5)):
        charge = random.randint(8, 80) * 5_000_000
        max_exp = round(charge * ratio / 1_000_000) * 1_000_000
        asf = round(charge * random.choice([0, 0, 0.05, 0.1]) / 100_000) * 100_000
        out.append(
            "INSERT INTO budget_lines (id, project_id, name, charge, max_expense, asf_amount) VALUES "
            f"({line_id}, {pid}, {q(lname)}, {charge}, {max_exp}, {asf});"
        )
        project_lines.append((line_id, lname, max_exp + asf))
        line_id += 1

    # spend on each line: most under budget, a few over
    for lid, lname, ceiling in project_lines:
        target = ceiling * random.choice([0.4, 0.6, 0.8, 0.95, 1.08, 1.2])
        spent = 0
        while spent < target:
            kind = random.choices(["vendor_bill", "cash_advance", "reimbursement"], [0.7, 0.2, 0.1])[0]
            dpp = min(random.randint(8, 60) * 1_000_000, max(1_000_000, round((target - spent) / 1_000_000) * 1_000_000))
            issue = start + timedelta(days=random.randint(0, max(1, min((today - start).days, 200))))
            if issue > today:
                issue = today - timedelta(days=random.randint(0, 20))
            if kind == "vendor_bill":
                party = random.randint(101, 100 + len(VENDORS))
                pph_type = random.choice(["pph23", "pph23", "none", "pph4_2"])
                due = issue + timedelta(days=random.choice([7, 14, 30]))
                with_ppn = random.random() > 0.2
            else:
                party = random.randint(201, 200 + len(EMPLOYEES))
                pph_type, due, with_ppn = "none", issue + timedelta(days=7), False
            status = random.choices(["approved", "draft", "void"], [0.85, 0.12, 0.03])[0]
            desc = f"{lname} - {random.choice(['DP 50%', 'pelunasan', 'termin 1', 'termin 2', 'full payment', 'sewa alat', 'fee'])}"
            tid, direction, total = add_tx(kind, pid, lid, party, dpp, issue, due, status, pph_type, with_ppn, desc,
                                           requested_by=random.choice(EMPLOYEES),
                                           number=f"INV/{issue:%y%m}/{random.randint(100, 999)}" if kind == "vendor_bill" else None)
            if status != "void":
                spent += dpp
            if status == "approved":
                r = random.random()
                if due < today and r < 0.75:
                    pay(tid, direction, total, min(today, due + timedelta(days=random.randint(-3, 5))))
                elif r < 0.85:
                    pay(tid, direction, round(total * 0.5), issue + timedelta(days=2))
                if kind == "cash_advance" and due < today and r < 0.6:
                    out.append(f"UPDATE transactions SET status = 'settled' WHERE id = {tid};")

    # client invoices: 2-4 termin
    charge_total = sum(c for _, _, c in project_lines)
    n = random.randint(2, 4)
    for k in range(n):
        issue = start + timedelta(days=30 * k + random.randint(0, 10))
        if issue > today:
            break
        dpp = round(charge_total / n / 1_000_000) * 1_000_000
        due = issue + timedelta(days=30)
        tid, direction, total = add_tx("client_invoice", pid, None, None, dpp, issue, due, "approved", "pph23",
                                       True, f"Termin {k + 1}/{n}", number=f"SGC/{issue:%Y}/{pid:02d}{k + 1}")
        if due < today - timedelta(days=10) and random.random() < 0.8:
            pay(tid, direction, total, due + timedelta(days=random.randint(-5, 15)))

# company opex, Jan-Oct
OPEX = [("Office Rental", 45_000_000, "Gedung Graha Sagacita"), ("Electricity, Internet & Communication", 8_000_000, "PLN & Biznet"),
        ("Subscriptions", 6_000_000, "Google Workspace & Adobe"), ("Transport & Travel", 5_000_000, None),
        ("Office Supplies", 3_000_000, None), ("Consultant & Professional Fees", 15_000_000, "KAP Mitra Audit")]
for m in range(1, 11):
    for cat, base, vendor in OPEX:
        issue = date(2026, m, random.randint(1, 10))
        dpp = round(base * random.uniform(0.8, 1.2) / 100_000) * 100_000
        tid, direction, total = add_tx("vendor_bill", None, None, None, dpp, issue, issue + timedelta(days=14), "approved",
                                       "pph4_2" if cat == "Office Rental" else "none", cat != "Transport & Travel",
                                       f"{cat} {issue:%B}", category=cat, division=random.choice([None, 1, 2, 3]))
        if issue + timedelta(days=14) < today:
            pay(tid, direction, total, issue + timedelta(days=12))
for cat, budget in [("Office Rental", 540_000_000), ("Electricity, Internet & Communication", 100_000_000),
                    ("Subscriptions", 70_000_000), ("Transport & Travel", 60_000_000), ("Office Supplies", 40_000_000),
                    ("Consultant & Professional Fees", 150_000_000)]:
    out.append(f"UPDATE opex_budgets SET annual_budget = {budget} WHERE category = {q(cat)} AND fiscal_year = 2026;")

# payroll totals per division, Jan-Oct
for m in range(1, 11):
    for div, base in [(1, 180_000_000), (2, 140_000_000), (3, 90_000_000)]:
        net = round(base * random.uniform(0.97, 1.05) / 100_000) * 100_000
        out.append(
            "INSERT INTO payroll_months (period, division_id, net_salary, bpjs_tk, bpjs_kes, pph21, headcount, notes) VALUES "
            f"('2026-{m:02d}', {div}, {net}, {round(net * 0.057)}, {round(net * 0.04)}, {round(net * 0.05)}, {base // 9_000_000}, 'sample');"
        )

# compact: merge consecutive single-row INSERTs into the same table into multi-row INSERTs
merged, head, rows = [], None, []
def flush():
    if head:
        for i in range(0, len(rows), 40):
            merged.append(head + " VALUES " + ",".join(rows[i:i + 40]) + ";")
for stmt in out:
    if stmt.startswith("INSERT INTO") and " VALUES " in stmt:
        h, v = stmt.split(" VALUES ", 1)
        if h != head:
            flush(); head, rows = h, []
        rows.append(v.rstrip(";"))
    else:
        flush(); head, rows = None, []
        merged.append(stmt)
flush()
print("\n".join(merged))

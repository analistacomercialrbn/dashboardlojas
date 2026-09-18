def num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def round_money(v):
    v = num(v)
    if v <= 0:
        return 0.0
    step = 1000.0 if v < 100000 else (5000.0 if v < 500000 else 10000.0)
    return round(v / step) * step


def pct(value, base):
    base = num(base)
    return (100.0 * num(value) / base) if base else 0.0


def rounded_months(total, parent_months, months):
    """Commercially round month values while preserving the exact cycle total."""
    total = round(num(total), 2)
    if not months:
        return {}
    base = sum(num(parent_months.get(str(m))) for m in months)
    if base <= 0:
        raw = {str(m): total / len(months) for m in months}
    else:
        raw = {str(m): total * num(parent_months.get(str(m))) / base for m in months}

    out = {}
    used = 0.0
    for m in months[:-1]:
        v = round_money(raw[str(m)])
        out[str(m)] = round(v, 2)
        used += out[str(m)]
    out[str(months[-1])] = round(total - used, 2)
    return out


def initialize_matrix(items, parent_total, parent_months, months, marker='round_months_v1'):
    """
    items: list of (id, rec, base_general).
    Initializes general targets and monthly R$ suggestions.
    The final item absorbs residuals so both cycle total and every month close exactly.
    Existing initialized matrices are preserved.
    """
    if not items:
        return

    # General cycle targets.
    used = 0.0
    for _, rec, base in items[:-1]:
        if 'meta_ciclo_alvo' not in rec:
            rec['meta_ciclo_alvo'] = round_money(base)
        used += num(rec.get('meta_ciclo_alvo'))

    _, last_rec, last_base = items[-1]
    if 'meta_ciclo_alvo' not in last_rec:
        residual = round(num(parent_total) - used, 2)
        last_rec['meta_ciclo_alvo'] = residual if residual >= 0 else round_money(last_base)

    # Monthly values: preserve already-initialized rows; otherwise rebuild suggestions.
    initialized = all(bool(rec.get(marker)) for _, rec, _ in items)
    if not initialized:
        for _, rec, _ in items[:-1]:
            rec['mensal'] = rounded_months(rec.get('meta_ciclo_alvo'), parent_months, months)

        # Last row closes every parent month exactly.
        last_months = {}
        for m in months:
            soma = sum(num((rec.get('mensal') or {}).get(str(m))) for _, rec, _ in items[:-1])
            last_months[str(m)] = round(num(parent_months.get(str(m))) - soma, 2)
        last_rec['mensal'] = last_months

        for _, rec, _ in items:
            rec['percentual_geral'] = pct(rec.get('meta_ciclo_alvo'), parent_total)
            rec['percentual_mensal'] = {
                str(m): pct((rec.get('mensal') or {}).get(str(m)), parent_months.get(str(m)))
                for m in months
            }
            rec[marker] = True


def sync_general_from_value(rec, value, parent_total):
    rec['meta_ciclo_alvo'] = round(num(value), 2)
    rec['percentual_geral'] = pct(rec['meta_ciclo_alvo'], parent_total)


def sync_general_from_pct(rec, percentage, parent_total):
    rec['percentual_geral'] = num(percentage)
    rec['meta_ciclo_alvo'] = round(num(parent_total) * rec['percentual_geral'] / 100.0, 2)


def sync_month_from_value(rec, month, value, parent_month_value):
    mensal = rec.setdefault('mensal', {})
    pcts = rec.setdefault('percentual_mensal', {})
    mensal[str(month)] = round(num(value), 2)
    pcts[str(month)] = pct(mensal[str(month)], parent_month_value)

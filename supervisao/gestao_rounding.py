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
    total = max(0.0, round(num(total), 2))
    if not months:
        return {}
    base = sum(max(0.0, num(parent_months.get(str(m)))) for m in months)
    raw = {}
    if base <= 0:
        raw = {str(m): total / len(months) for m in months}
    else:
        raw = {str(m): total * max(0.0, num(parent_months.get(str(m)))) / base for m in months}

    out = {}
    used = 0.0
    for m in months[:-1]:
        remaining = max(0.0, total - used)
        v = min(round_money(raw[str(m)]), remaining)
        out[str(m)] = round(max(0.0, v), 2)
        used += out[str(m)]
    out[str(months[-1])] = round(max(0.0, total - used), 2)
    return out


def _allocate_months(items, parent_months, months):
    """Allocate each parent month across items, never producing negative residuals."""
    general = [max(0.0, num(rec.get('meta_ciclo_alvo'))) for _, rec, _ in items]
    total_general = sum(general)

    for _, rec, _ in items:
        rec['mensal'] = {}

    for m in months:
        target = max(0.0, round(num(parent_months.get(str(m))), 2))
        used = 0.0
        for i, (_, rec, _) in enumerate(items):
            if i == len(items) - 1:
                value = round(max(0.0, target - used), 2)
            else:
                weight = (general[i] / total_general) if total_general > 0 else (1 / len(items))
                raw = target * weight
                value = min(round_money(raw), max(0.0, target - used))
                value = round(max(0.0, value), 2)
                used += value
            rec['mensal'][str(m)] = value


def initialize_matrix(items, parent_total, parent_months, months, marker='round_months_v1'):
    if not items:
        return

    parent_total = max(0.0, round(num(parent_total), 2))

    # General targets: preserve existing values when valid; otherwise seed rounded suggestions.
    used = 0.0
    for _, rec, base in items[:-1]:
        current = num(rec.get('meta_ciclo_alvo'))
        if current < 0:
            current = 0.0
        if 'meta_ciclo_alvo' not in rec:
            current = round_money(base)
        rec['meta_ciclo_alvo'] = round(max(0.0, current), 2)
        used += rec['meta_ciclo_alvo']

    _, last_rec, last_base = items[-1]
    if 'meta_ciclo_alvo' not in last_rec or num(last_rec.get('meta_ciclo_alvo')) < 0:
        last_rec['meta_ciclo_alvo'] = round(max(0.0, parent_total - used), 2)

    # If stale general targets exceed the parent, normalize them proportionally.
    sum_general = sum(max(0.0, num(rec.get('meta_ciclo_alvo'))) for _, rec, _ in items)
    if parent_total > 0 and sum_general > parent_total + 0.02:
        scale = parent_total / sum_general
        used = 0.0
        for i, (_, rec, _) in enumerate(items):
            if i == len(items) - 1:
                rec['meta_ciclo_alvo'] = round(max(0.0, parent_total - used), 2)
            else:
                v = round(max(0.0, num(rec.get('meta_ciclo_alvo')) * scale), 2)
                rec['meta_ciclo_alvo'] = v
                used += v

    initialized = all(bool(rec.get(marker)) for _, rec, _ in items)
    invalid = False
    if initialized:
        for m in months:
            vals = [num((rec.get('mensal') or {}).get(str(m))) for _, rec, _ in items]
            if any(v < -0.001 for v in vals):
                invalid = True
                break
            if abs(sum(vals) - num(parent_months.get(str(m)))) > 0.02:
                invalid = True
                break

    if not initialized or invalid:
        _allocate_months(items, parent_months, months)
        for _, rec, _ in items:
            rec['percentual_geral'] = pct(rec.get('meta_ciclo_alvo'), parent_total)
            rec['percentual_mensal'] = {
                str(m): pct((rec.get('mensal') or {}).get(str(m)), parent_months.get(str(m)))
                for m in months
            }
            rec[marker] = True


def sync_general_from_value(rec, value, parent_total):
    rec['meta_ciclo_alvo'] = max(0.0, round(num(value), 2))
    rec['percentual_geral'] = pct(rec['meta_ciclo_alvo'], parent_total)


def sync_general_from_pct(rec, percentage, parent_total):
    rec['percentual_geral'] = max(0.0, num(percentage))
    rec['meta_ciclo_alvo'] = max(0.0, round(num(parent_total) * rec['percentual_geral'] / 100.0, 2))


def sync_month_from_value(rec, month, value, parent_month_value):
    mensal = rec.setdefault('mensal', {})
    pcts = rec.setdefault('percentual_mensal', {})
    mensal[str(month)] = max(0.0, round(num(value), 2))
    pcts[str(month)] = pct(mensal[str(month)], parent_month_value)

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


def _normalized_columns(parent_total, parent_months, months):
    """Return monthly column targets whose sum equals the parent cycle total."""
    out = {str(m): max(0.0, round(num(parent_months.get(str(m))), 2)) for m in months}
    if not months:
        return out
    total = round(max(0.0, num(parent_total)), 2)
    current = round(sum(out.values()), 2)
    diff = round(total - current, 2)
    if abs(diff) > 0.001:
        last = str(months[-1])
        out[last] = round(max(0.0, out[last] + diff), 2)
    return out


def _allocate_one_row(row_total, col_remaining, months):
    """Allocate one row with commercial rounding while respecting remaining column capacity."""
    result = {}
    remaining = round(max(0.0, num(row_total)), 2)
    month_keys = [str(m) for m in months]

    for pos, key in enumerate(month_keys):
        cap = round(max(0.0, num(col_remaining.get(key))), 2)
        later_capacity = round(sum(max(0.0, num(col_remaining.get(k))) for k in month_keys[pos + 1:]), 2)

        if pos == len(month_keys) - 1:
            value = min(cap, remaining)
        else:
            total_cap = round(cap + later_capacity, 2)
            raw = (remaining * cap / total_cap) if total_cap > 0 else 0.0
            desired = round_money(raw)
            minimum = max(0.0, round(remaining - later_capacity, 2))
            maximum = min(cap, remaining)
            value = min(max(desired, minimum), maximum)

        value = round(max(0.0, value), 2)
        result[key] = value
        remaining = round(max(0.0, remaining - value), 2)

    # Any cent residual goes into the last month with capacity.
    if remaining > 0.001:
        for key in reversed(month_keys):
            room = round(max(0.0, num(col_remaining.get(key)) - result.get(key, 0.0)), 2)
            if room <= 0:
                continue
            add = min(room, remaining)
            result[key] = round(result.get(key, 0.0) + add, 2)
            remaining = round(remaining - add, 2)
            if remaining <= 0.001:
                break
    return result


def _allocate_months(items, parent_total, parent_months, months):
    """
    Transportation-style allocator.
    It preserves every row cycle total AND every monthly column total.
    """
    if not items:
        return

    columns = _normalized_columns(parent_total, parent_months, months)
    col_remaining = dict(columns)

    for _, rec, _ in items:
        rec['mensal'] = {}

    for i, (_, rec, _) in enumerate(items):
        row_total = round(max(0.0, num(rec.get('meta_ciclo_alvo'))), 2)

        if i == len(items) - 1:
            # Last row closes every month exactly.
            allocation = {str(m): round(max(0.0, num(col_remaining.get(str(m)))), 2) for m in months}
        else:
            allocation = _allocate_one_row(row_total, col_remaining, months)

        rec['mensal'] = allocation
        for m in months:
            k = str(m)
            col_remaining[k] = round(max(0.0, num(col_remaining.get(k)) - num(allocation.get(k))), 2)


def initialize_matrix(items, parent_total, parent_months, months, marker='round_months_v1'):
    if not items:
        return

    parent_total = max(0.0, round(num(parent_total), 2))

    # General targets.
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

    # Normalize stale general targets if they do not close the parent.
    sum_general = round(sum(max(0.0, num(rec.get('meta_ciclo_alvo'))) for _, rec, _ in items), 2)
    if parent_total > 0 and abs(sum_general - parent_total) > 0.02:
        if sum_general > 0:
            scale = parent_total / sum_general
            used = 0.0
            for i, (_, rec, _) in enumerate(items):
                if i == len(items) - 1:
                    rec['meta_ciclo_alvo'] = round(max(0.0, parent_total - used), 2)
                else:
                    v = round(max(0.0, num(rec.get('meta_ciclo_alvo')) * scale), 2)
                    rec['meta_ciclo_alvo'] = v
                    used += v

    columns = _normalized_columns(parent_total, parent_months, months)
    initialized = all(bool(rec.get(marker)) for _, rec, _ in items)
    invalid = not initialized

    if initialized:
        # Validate every row against its cycle target.
        for _, rec, _ in items:
            row_sum = round(sum(num((rec.get('mensal') or {}).get(str(m))) for m in months), 2)
            if abs(row_sum - num(rec.get('meta_ciclo_alvo'))) > 0.02:
                invalid = True
                break

        # Validate every month against the parent target.
        if not invalid:
            for m in months:
                k = str(m)
                vals = [num((rec.get('mensal') or {}).get(k)) for _, rec, _ in items]
                if any(v < -0.001 for v in vals):
                    invalid = True
                    break
                if abs(round(sum(vals), 2) - num(columns.get(k))) > 0.02:
                    invalid = True
                    break

    if invalid:
        _allocate_months(items, parent_total, columns, months)

    for _, rec, _ in items:
        rec['percentual_geral'] = pct(rec.get('meta_ciclo_alvo'), parent_total)
        rec['percentual_mensal'] = {
            str(m): pct((rec.get('mensal') or {}).get(str(m)), columns.get(str(m)))
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

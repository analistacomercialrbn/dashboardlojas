import time

try:
    import requests

    _original_get = requests.get
    _SALES_ID = '1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'

    def _fresh_get(url, *args, **kwargs):
        u = str(url)
        if 'drive.google.com/uc' in u and _SALES_ID in u:
            sep = '&' if '?' in u else '?'
            u = f"{u}{sep}cache_bust={time.time_ns()}"
            headers = dict(kwargs.pop('headers', {}) or {})
            headers.setdefault('Cache-Control', 'no-cache, no-store, max-age=0')
            headers.setdefault('Pragma', 'no-cache')
            kwargs['headers'] = headers
        return _original_get(u, *args, **kwargs)

    requests.get = _fresh_get
except Exception:
    pass

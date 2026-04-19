"""Yahoo Finance search service for ticker suggestions."""

import httpx

YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"


DEFAULT_ALLOWED_TYPES: tuple[str, ...] = ("equity", "etf")


def search_yahoo_tickers(
    query: str,
    max_results: int = 10,
    allowed_types: tuple[str, ...] = DEFAULT_ALLOWED_TYPES,
) -> list[dict]:
    """Search Yahoo Finance for ticker suggestions.

    Args:
        query: The search query (ticker symbol or company name)
        max_results: Maximum number of results to return
        allowed_types: Yahoo quoteType values to keep (e.g. ("equity", "etf")
            for tradable tickers, ("index",) for benchmark indexes).

    Returns:
        List of ticker suggestions: [{symbol, name, exchange, type}, ...]
    """
    if not query or len(query.strip()) < 1:
        return []

    params = {
        "q": query.strip(),
        "quotesCount": max_results,
        "newsCount": 0,
        "enableFuzzyQuery": False,
        "quotesQueryId": "tss_match_phrase_query",
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(YAHOO_SEARCH_URL, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, httpx.TimeoutException):
        return []

    quotes = data.get("quotes", [])
    suggestions = []

    for quote in quotes:
        quote_type = quote.get("quoteType", "").lower()
        if quote_type not in allowed_types:
            continue

        suggestions.append(
            {
                "symbol": quote.get("symbol", ""),
                "name": quote.get("shortname") or quote.get("longname"),
                "exchange": quote.get("exchange"),
                "type": quote_type,
            }
        )

    return suggestions[:max_results]

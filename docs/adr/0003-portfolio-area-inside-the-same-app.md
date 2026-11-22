# The portfolio side is an area of the same app, not a separate one

Portfolios and Baskets were first imagined as a separate app on its own subdomain. We decided they live in the same frontend under `/portfolio/*`, with their own layout and navigation, sharing auth, stores, domain code and deployment with the trading side. A separate build or subdomain would have required extracting shared code into a package and sharing auth across apps, for no user-visible gain at MVP scale; the clear `/portfolio` boundary keeps a later split possible.

## Considered Options

- **Separate frontend build served at `/portfolio`**: needs a shared domain package and cross-build auth.
- **Subdomain (`portfolio.asistrader.com`)**: all of the above plus cross-origin cookies/CORS and a second deployment.

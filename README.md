# AsisTrader

Trading operations management system migrated from Excel to a web application.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React SPA     │────▶│  Python API     │────▶│   PostgreSQL    │
│   (Vite + TS)   │     │  (FastAPI)      │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Tech Stack

- **Backend**: Python 3.12 + FastAPI + SQLAlchemy
- **Frontend**: React 18 + Vite + TypeScript
- **Database**: PostgreSQL
- **Testing**: pytest (backend), Vitest (frontend)
- **Containers**: Docker + Docker Compose

## Quick Start with Docker

```bash
# Start all services
docker-compose up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

## Development Setup

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker (for PostgreSQL)
- uv (Python package manager)

### Database

```bash
# Start PostgreSQL
docker-compose -f docker-compose.dev.yml up -d

# Wait for database to be ready
docker-compose -f docker-compose.dev.yml logs -f db
```

### Backend

```bash
cd backend

# Install dependencies with uv
uv pip install -e ".[dev]"

# Run migrations
alembic upgrade head

# Seed the database with sample data
cd .. && python scripts/seed_data.py && cd backend

# Start the development server
uvicorn asistrader.main:app --reload

# Run tests
pytest
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
asistrader/
├── docker-compose.yml          # Production compose
├── docker-compose.dev.yml      # Development compose (DB only)
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/           # Database migrations
│   ├── src/asistrader/
│   │   ├── main.py             # FastAPI app
│   │   ├── api/
│   │   │   └── trades.py       # Trade endpoints
│   │   ├── models/
│   │   │   ├── db.py           # SQLAlchemy models
│   │   │   └── schemas.py      # Pydantic schemas
│   │   ├── db/
│   │   │   └── database.py     # DB connection
│   │   └── services/
│   │       └── trade_service.py
│   └── tests/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   └── TradeTable.tsx
│   │   ├── api/
│   │   │   └── trades.ts
│   │   └── types/
│   │       └── trade.ts
│   └── tests/
└── scripts/
    └── seed_data.py            # Import sample data
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trades` | List all trades |
| GET | `/health` | Health check |

## Data Model

### Ticker
- `symbol` (PK): Stock symbol (e.g., "ASML")
- `name`: Company name
- `ai_success_probability`: AI-predicted success rate
- `trend_mean_growth`: Mean growth trend
- `trend_std_deviation`: Standard deviation

### Trade
- `id` (PK): Auto-increment ID
- `number`: Trade number (assigned on close)
- `ticker`: Foreign key to tickers
- `status`: "plan" | "open" | "close"
- `amount`: Investment amount
- `units`: Number of shares
- `entry_price`: Entry price per share
- `stop_loss`: Stop loss price
- `take_profit`: Take profit price
- `date_planned`: Planned entry date
- `date_actual`: Actual entry date
- `exit_date`: Exit date
- `exit_type`: "sl" (stop loss) | "tp" (take profit)
- `exit_price`: Actual exit price

## Testing

```bash
# Backend tests
cd backend && pytest

# Frontend tests
cd frontend && npm test

# Frontend tests with UI
cd frontend && npm run test:ui
```

## Environment Variables

### Backend
- `DATABASE_URL`: PostgreSQL connection string (default: `postgresql://asistrader:asistrader@localhost:5432/asistrader`)

### Frontend
- `VITE_API_URL`: Backend API URL (default: empty, uses proxy in development)

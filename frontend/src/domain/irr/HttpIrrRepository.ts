import type { IIrrRepository } from './IIrrRepository'
import type {
  DailyPoint,
  DailyPointDto,
  GroupIrr,
  GroupIrrDto,
  IrrAnalysis,
  IrrAnalysisDto,
  Pipeline,
  PipelineDto,
  PipelineSlice,
  PipelineSliceDto,
  ScopeBlock,
  ScopeBlockDto,
  TradeIrr,
  TradeIrrDto,
} from './types'
import { buildHeaders } from '../shared/httpHelpers'

function mapTrade(dto: TradeIrrDto): TradeIrr {
  return {
    tradeId: dto.trade_id,
    ticker: dto.ticker,
    tickerName: dto.ticker_name,
    currency: dto.currency,
    status: dto.status,
    dateOrdered: dto.date_ordered,
    exitDate: dto.exit_date,
    holdingDays: dto.holding_days,
    investmentNative: dto.investment_native,
    profitNative: dto.profit_native,
    investmentBase: dto.investment_base,
    profitBase: dto.profit_base,
    returnPct: dto.return_pct,
    tir: dto.tir,
    xirr: dto.xirr,
    isWinner: dto.is_winner,
    fxDriftBase: dto.fx_drift_base,
  }
}

function mapGroup(dto: GroupIrrDto): GroupIrr {
  return {
    label: dto.label,
    tickerName: dto.ticker_name,
    currency: dto.currency,
    tradeCount: dto.trade_count,
    investmentBase: dto.investment_base,
    profitBase: dto.profit_base,
    returnPct: dto.return_pct,
    avgHoldingDays: dto.avg_holding_days,
    tir: dto.tir,
    xirr: dto.xirr,
    fxDriftBase: dto.fx_drift_base,
  }
}

function mapScope(dto: ScopeBlockDto): ScopeBlock {
  return {
    transactions: dto.transactions.map(mapTrade),
    byTicker: dto.by_ticker.map(mapGroup),
    byTickerWinners: dto.by_ticker_winners.map(mapGroup),
    byTickerLosers: dto.by_ticker_losers.map(mapGroup),
    portfolio: dto.portfolio ? mapGroup(dto.portfolio) : null,
    portfolioWinners: dto.portfolio_winners ? mapGroup(dto.portfolio_winners) : null,
    portfolioLosers: dto.portfolio_losers ? mapGroup(dto.portfolio_losers) : null,
  }
}

function mapDaily(dto: DailyPointDto): DailyPoint {
  return {
    date: dto.date,
    tradeCount: dto.trade_count,
    investmentBase: dto.investment_base,
    profitBase: dto.profit_base,
    returnPct: dto.return_pct,
    avgHoldingDays: dto.avg_holding_days,
    tir: dto.tir,
    enhancedReturnPct: dto.enhanced_return_pct,
    enhancedTir: dto.enhanced_tir,
    idlePoolBase: dto.idle_pool_base,
    idleTradeCount: dto.idle_trade_count,
  }
}

function mapPipelineSlice(dto: PipelineSliceDto): PipelineSlice {
  return {
    label: dto.label,
    tradeCount: dto.trade_count,
    countPct: dto.count_pct,
    capitalBase: dto.capital_base,
    capitalPct: dto.capital_pct,
  }
}

function mapPipeline(dto: PipelineDto): Pipeline {
  return {
    totalCount: dto.total_count,
    totalCapitalBase: dto.total_capital_base,
    slices: dto.slices.map(mapPipelineSlice),
    orderedToOpenCount: dto.ordered_to_open_count,
    orderedToOpenCapital: dto.ordered_to_open_capital,
  }
}

function mapAnalysis(dto: IrrAnalysisDto): IrrAnalysis {
  return {
    baseCurrency: dto.base_currency,
    pipeline: mapPipeline(dto.pipeline),
    realized: mapScope(dto.realized),
    unrealized: mapScope(dto.unrealized),
    daily: {
      mixed: dto.daily.mixed.map(mapDaily),
      winners: dto.daily.winners.map(mapDaily),
      losers: dto.daily.losers.map(mapDaily),
    },
  }
}

export class HttpIrrRepository implements IIrrRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchAnalysis(): Promise<IrrAnalysis> {
    const response = await fetch(`${this.baseUrl}/api/irr/analysis`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch IRR analysis: ${response.statusText}`)
    }
    const data: IrrAnalysisDto = await response.json()
    return mapAnalysis(data)
  }
}

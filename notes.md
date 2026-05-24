- check trades one-click to action 
	-> review auto detection in one click
	-> open trade in one click 
	-> close trade in one click
- surface trades that would not trigger because of the margin

irr
	- add chart for return similar to the one for avg daily and daily TIR 

	- add chart for daily tir and average holding days but with averages (or perhaps make traces toggleable)

	- summaries need to update with the all / winner /  losers filters

	- cummulative should have a max number of days, or alternatively have a parameter of limited days to measure as tail. Perhaps also parameterize the histogram and normal distrib charts to select date ranges for them.. Perhaps all graphs should have the same date range.


SMA - improvements:
	- combinatory score (how many averages below bullish for each of the averages)
	- linear proportional indicator that displays all values aligned and at proportional distances
	- pondered average rating to measure how close the averages are to the price
		(i.e. shortest is 2 points and each furthest one has half the porints) 

radar screen with 
	- permanent list of indexes
 	- macro indicators

KPIs
	- order/open proportion
	- open unrealized  TIR winners and losers
	- closed realized  TIR winners and losers
	- 

auto trading complete version
	- final iteration: auto open, and close
	
strategies / techniques
	ability for selecting multiple strategies
==>	harmonics - paul at datadash <== this could be an easy win for radar
	francesco spinoglio, leverage positions concentration
	stochastic separation (probability bands)
	divergence
		rsi - price 
	support-resistance
	channel
	trending vs ranging

	mean reversion
	trends indicators - you
	oscillators - the dog
	
	triple screen - system
		tide
		wave
		ripple

	survival comes first - then steady returns - then if so, focus on increasing profits 
	2% max risk on any trade
		stop loss can only move in the sense of the trade
		account for slippage fees, brokerage and commissions

	the three pillars
	I - psychology
	II - market analysis and trading systems (triple screen system for instance)
	III - Money Management (2% rule)
	

////
allow to specify whether an order is executed within market hours both on open and close (is it after market?)

get schedules for most markets
	check if we can get the market out of yfinance info for a ticker
	allow to see the market a given ticker is on and its schedule
////

DONE - New status for trades: canceled alongside a cancel_reason that can be any of "INPUT_ERROR", "MARKET_CONDITIONS", "TICKER_FUNDAMENTALS" or "OTHER"

DONE - when creating a trade:
	allow to input whether it is a limit, stop or market order.
	allow to input the time in effect of the order

DONE - when opening a trade, 
	ability to edit the open price from the open trade menu.
	prevent selecting an open trade date into the future (validation)

DONE - Funds management Feature
	- based on event sourcing
	EVENTS:
		- add funds
		- retire funds
		- benefit
		- loss

DONE - consolidate SL dist and TP dist in a single column Current Position (CP)

DONE - update paper-trades to "automatic trades"

DONE - overbooking for funds management, detect when there are no funds available to make an order

DONE - update desktop layout to stop wasting vertical space on it
	- update "new trade" button to have a text and then the plus sign
	- put the three first rows in a single column

DONE - optional alphabetical ordering for trades list

DONE - autocalculate number of stocks suggestion based on risk percentage

DONE - warn before allowing to create a new trade with a ratio below 1.5x

DONE - highligh row on hover / focus / active

DONE
 - indicators for each ticker
	- mean band positions
	- 50 and 5 day average change both % and value  

DONE - max width in all modals needs to be proportional to font size, so when user zooms in it doesnt overflow
	max width 90dvw or in rem 

DONE - FIX and update moving averages to simple moving averages and add tests for them

DONE - fix trade summary not picking up data
	mark current p&l avg win loss and ratio as realized and win and loss 
	add unrealized version of all these and separate them and winning and losing

DONE * - bug - when opening seems to add layered to the trades 

DONE - dates and ages at trades table should also be visible at the radar list

DONE - fix PE dist in white instead of red when its negative

DONE - Radar - automatically pick up tickers that already have trades

DONE - tickers with open trades should be distinguishable in the radar

DONE - prefill exit price with current when closing and autocalculate whether its take profit or stop loss for the default option when closing

DONE - create trade from the radar

DONE - update price input to consider the number of decimals in the ticket and check what to do with stocks that have 4 decimals

DONE - add timeline expectations 
		- entry
		- take profit
		- stop loss
	given 50 and 5 days 
	- explore possibility of using initial point estimations as well as comparing 50 and 5 of today	
	projected vs dynamic

DONE - allow to undo a trade close

DONE = add actions to the trades on the radar

DONE - find out how to get market data for INDEXES

DONE - add regression coefficient and slope as part of the tiker card on the radar

DONE - add option to unopen trades

DONE - add name under the ticker symbol on edit open close etc... modals

DONE - Exchange rates - aggregate realized and unrealized, and update fund management to handle rate changes

DONE - fix auto trading
	DONE - disable temporarily
	DONE - build test harness
		DONE - first iteration: alerts only
			DONE - consider the first day data cannot be used to auto-trade
				the low / high might have happenned before opening the trade

DONE - find a way to automatically update the tickers data
	DONE - send request on every frontend run?

DONE - IRR extras
	- histogram for the daily
		- annualized return TIR
		- avg days
	- frequency distributions for
		- annaualized TIR
		- avg days
	- graph both TIR and avg days through time (daily)
	- graph normal distribution parameters for daily TIR and avg days on each day as well

	Realized by Ticker
		also decompose in mixed-winners-losersso it is possible to look at the winners of a ticker without cross-contamination from losers and vicecersa
	Realized by Trade
		also allow to see all-winners-losers, i say all because trades are independent
	Tables in the Drivers section
		make them multisortable by column
	Unrealized and Unrealized
		add an average of the avg_days

DONE - Radar Presets
	Ex: Flat View Clsest to TP and Drift Behing

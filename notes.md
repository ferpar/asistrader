update inputs

autocalculate number of stocks suggestion based on risk percentage

highligh row on hover / focus / active

warn before allowing to create a new trade with a ratio below 1.5x


radar screen with 
 - indicators for each ticker
	- mean band positions
	- 50 and 5 day average change both % and value  
	- 
 - macro indicators
	
check currency being used in data coming from the yfinance api

find a way to automatically update the tickers data
	- send request on every frontend run?

strategies / techniques
	ability for selecting multiple strategies
	harmonics - paul at datadash
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

Radar Presets
	Ex: Flat View Clsest to TP and Drift Behing


TIR/IRR:
	- new tab
	- two similar sections: realized and un-realized 
	- goal is to measure cash making drivers
		- so by modifying them we optimize the available cash

	- TIR of each transaction 
		measuring benefit from plan to close
			- return %: benefit over invested amount
			- return per day:  
				(return %) / number of days from ordered to close
			- annualized return:
				return per day * (days in the year = 365)
	- Daily
		- annualized daily: derive daily annualized return for each day of the calendar
			we may ponder-average the elapsed times
		- enhanced**:
			it attempts to cover for the fact that there's a lot more immobilized than what was resolved in the closed trades. So, it takes the total invested amount (the full immovilized) divides it between the number of ordered and open trades, this quantity is then multiplied by the number of closed trades in the day and added to the invested amount in those closed trades of the day.

		- it is wanted to have a view for the winners, losers and mixed for the annualized daily, not the enhanced


SMA - improvements:
	- combinatory score (how many averages below bullish for each of the averages)
	- linear proportional indicator that displays all values aligned and at proportional distances
	- pondered average rating to measure how close the averages are to the price
		(i.e. shortest is 2 points and each furthest one has half the porints) 

fix auto trading
	DONE - disable temporarily
	DONE - build test harness
		- first iteration: alerts only
			- consider the first day data cannot be used to auto-trade
				the low / high might have happenned before opening the trade
		- alert and offer one-click action
auto trading complete version
	- final iteration: auto open, and close

Exchange rates
	aggregate realized and unrealized, and update fund management to handle rate changes
	on order as we 




Una vez que una orden está "Close" podemos calcular el IRR/TIR de la siguiente forma: retorno €/Inversión € dividido entre los días entre Open y Close, multiplicado por 365... eso para cada ticker en cada operación, para un ticker con todas sus operaciones, y para toda la cartera...


radar screen with 
 macro indicators
	
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

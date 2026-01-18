objetivo basico en el sistema
	evitar errores
	escalabilidad

tiene una lista de 82 tickers,
	por cada ticker
		número asignado a cada operación cerrada en las abiertas no tiene un número
		abre una nueva línea si ha cerrado una operación
		success
		amount ( es la cantidad con la que se apuesta, normalmente aproximado a una cantidad, que en principio son 1000) es para que el nº acciones sea entero
		date plan (fecha de orden compra)
		Status - en qué fase está plan, open o closed
		Trend - este es un cálculo 
			- con los close de cada día
			- proporción desde un primer día que supone la media aritmértica de crecimiento en todos los días desde ese mismo día)
			- desviación típica de la serie de día entre el promedio de la serie (para ver la dispersión)
		date actual (fecha en la que se ejecutó la orden de compra)
		date SL / PL (fecha de salida, diferenciadas por pérdida o ganancia)
			- subpropiedad fué SL o PL
		

	cada orden puede estar planificada, abierta o cerrada (planned open or closed)
	hay una tabla con probabilidades de éxito estimadas por una ia, el ticker tiene asociada esa probabilidad
	
		
		
tienes una serie de tablas dinámicas
	



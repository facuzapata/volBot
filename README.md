# Sistema de Trading Automatizado

---

## Descripción general

Este proyecto es un sistema básico para automatizar señales de trading de criptomonedas, con las siguientes características:

- Genera señales de compra y venta (simuladas).
- Valida señales con reglas personalizadas para minimizar riesgos.
- Gestiona trades abiertos y cerrados según actualizaciones de precios.
- Actualmente no envía órdenes reales a exchanges, solo muestra las señales en consola.
- Preparado para futura integración con Binance u otros exchanges.

---

## Componentes principales

### 1. **TradingService**

Servicio principal que:

- Escucha eventos de señales de trading (`trade.buy` y `trade.sell`).
- Mantiene una lista interna de trades abiertos.
- Escucha eventos de actualización de precios (`price.update`).
- Cierra trades automáticamente si el precio toca el `stopLoss` o `takeProfit`.
- Muestra logs detallados en consola.

### 2. **Strategy**

Componente encargado de validar y generar señales seguras para enviar al `TradingService`.

- Valida señales con reglas personalizadas antes de emitirlas.
- Calcula niveles de stop loss y take profit basados en el ATR (Average True Range).
- Emite eventos para las señales de compra o venta.

### 3. **Interfaces**

Para mantener tipado estricto, se definen interfaces para:

- La estructura de una señal de trading (`TradeSignal`).
- La estructura de un trade activo o cerrado (`TradeRecord`).

---

## Flujo de trabajo

1. La estrategia recibe datos del mercado (precio actual, ATR, etc.).
2. Valida la señal con reglas personalizadas.
3. Si la señal es válida, la genera con niveles de stop loss y take profit.
4. Emite la señal como evento (`trade.buy` o `trade.sell`).
5. El `TradingService` escucha estos eventos y registra las señales como trades abiertos.
6. Cuando llega una actualización de precio (`price.update`), el `TradingService` verifica si debe cerrar trades según los niveles definidos.
7. Si se cumple alguna condición de cierre, el trade pasa a estado cerrado y se muestra en consola.

---

## Integración con Binance (Pendiente)

- Actualmente, no se envían órdenes reales para evitar pérdidas accidentales.
- Se planea integrar con la API oficial de Binance usando el paquete `@binance/connector`.
- Para habilitar operaciones reales:
  - Configurar claves API seguras.
  - Implementar llamadas a la API de Binance para crear y gestionar órdenes.
  - Manejar límites, errores y validaciones específicas de Binance.

---

## Próximos pasos recomendados

- Mejorar la función de validación de señales con análisis técnico y backtesting.
- Crear una interfaz gráfica para visualizar las señales y trades en tiempo real.
- Persistir datos de trades en base de datos para histórico y análisis.
- Agregar manejo avanzado de riesgo y tamaño de posición.
- Automatizar el envío de órdenes reales con seguridad y monitoreo.

---

## Conclusión

Este sistema modular y extensible permite comenzar con un trading automatizado seguro y controlado, mostrando señales en consola y gestionando trades simulados. Está preparado para escalar a integración con exchanges reales y funcionalidades avanzadas.

Si necesitás ayuda para expandirlo o integrarlo con Binance, avisame.

---

## Licencia

MIT License

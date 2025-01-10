import fetch from 'node-fetch';

const strategyConfig = {
    symbol: 'BTCUSDT',
    interval: '1m',
    startPrice: 69666, // Используем цену закрытия свечи как стартовую
    high: 69677.96, // Максимальная цена свечи
    low: 69666, // Минимальная цена свечи
    orderQty: 10, // Количество ордеров в сетке
    orderDollarValue: 10, // Сумма в долларах на каждый ордер
    initialAmount: 500, // Начальный баланс
    tickRound: 2, // Округление цены до 2 знаков
    qtyRound: 4, // Округление объема до 4 знаков
    comm: 0.001 // Комиссия 0.1%
};


async function fetchCandles(symbol, interval, startTime, endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.map(candle => ({
            openTime: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            closeTime: candle[6]
        }));
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

async function fetchAllCandles(symbol, interval, startDate, endDate) {
    let allCandles = [];
    let startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();

    while (startTime < endTime) {
        try {
            const candles = await fetchCandles(symbol, interval, startTime, endTime);
            if (candles.length === 0) break;

            allCandles = allCandles.concat(candles);
            console.log(`Загружено ${candles.length} свечей. Всего: ${allCandles.length}`);
            
            if (candles.length < 1000) {
                break;
            }

            startTime = candles[candles.length - 1].closeTime + 1;
        } catch (error) {
            console.error('Error fetching candles:', error);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Пауза перед повторной попыткой
        }
    }

    return allCandles;
}

function round(value, decimals) {
    return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}

function createEntryScheme(config) {
    return Array.from({ length: config.orderQty }, (_, i) => ({
        id: config.orderQty - i,
        price: round(config.low + (config.high - config.low) * i / config.orderQty, config.tickRound),
        dollarValue: config.orderDollarValue
    }));
}

function createExitScheme(config) {
    return Array.from({ length: config.orderQty }, (_, i) => ({
        id: config.orderQty - i,
        price: round(config.low + (config.high - config.low) * (i + 1) / config.orderQty, config.tickRound)
    }));
}

function runGridStrategy(candles, config) {
    const state = {
        balance: config.initialAmount,
        availableBalance: config.initialAmount,
        totalProfit: 0,
        openPositions: new Map(),
        tradesHistory: [],
        stats: {
            totalTrades: 0,
            profitableTrades: 0,
            unprofitableTrades: 0,
            totalFees: 0
        }
    };

    const entryScheme = createEntryScheme(config);
    const exitScheme = createExitScheme(config);

    console.log('Сетка входов:', entryScheme.map(e => e.price));
    console.log('Сетка выходов:', exitScheme.map(e => e.price));
    console.log(`Инициализировано ${entryScheme.length} ордеров на вход и ${exitScheme.length} на выход.`);

    candles.forEach((candle, index) => {
        const currentPrice = candle.close;

        // Покупки
        entryScheme.forEach((entry) => {
            if (!state.openPositions.has(entry.id) && 
                currentPrice <= entry.price && 
                state.availableBalance >= entry.dollarValue) {
                
                const fee = entry.dollarValue * config.comm;
                const totalCost = entry.dollarValue + fee;
                
                state.availableBalance -= totalCost;
                state.openPositions.set(entry.id, {
                    entryPrice: entry.price,
                    amount: entry.dollarValue,
                    time: candle.openTime
                });

                state.stats.totalTrades++;
                state.stats.totalFees += fee;

                state.tradesHistory.push({
                    time: candle.openTime,
                    type: 'BUY',
                    price: entry.price,
                    amount: entry.dollarValue,
                    fee: fee,
                    balance: state.availableBalance
                });
            }
        });

        // Продажи
        exitScheme.forEach((exit) => {
            const position = state.openPositions.get(exit.id);
            if (position && currentPrice >= exit.price) {
                const fee = position.amount * config.comm;
                const profit = position.amount * ((currentPrice - position.entryPrice) / position.entryPrice);
                const totalReturn = position.amount + profit - fee;

                state.availableBalance += totalReturn;
                state.totalProfit += (profit - fee);
                state.stats.totalFees += fee;

                if (profit > 0) {
                    state.stats.profitableTrades++;
                } else {
                    state.stats.unprofitableTrades++;
                }

                state.tradesHistory.push({
                    time: candle.openTime,
                    type: 'SELL',
                    price: exit.price,
                    amount: position.amount,
                    profit: profit,
                    fee: fee,
                    balance: state.availableBalance
                });

                state.openPositions.delete(exit.id);
            }
        });

        // Каждые 1000 свечей выводим промежуточный результат
        if (index % 1000 === 0) {
            console.log(`Обработано ${index} свечей, текущий баланс: $${state.availableBalance.toFixed(2)}, прибыль: $${state.totalProfit.toFixed(2)}`);
        }
    });

    state.balance = state.availableBalance + state.totalProfit;
    return state;
}

async function fetchAndRunStrategy(symbol, interval, startDate, endDate) {
    try {
        console.log(`Запуск стратегии для ${symbol} с ${startDate} по ${endDate}`);
        
        const candles = await fetchAllCandles(symbol, interval, startDate, endDate);
        console.log(`Загружено всего ${candles.length} свечей`);

        const results = runGridStrategy(candles, strategyConfig);

        console.log('\nИтоги стратегии:');
        console.log(`Начальный баланс: $${strategyConfig.initialAmount.toFixed(2)}`);
        console.log(`Конечный баланс: $${results.balance.toFixed(2)}`);
        console.log(`Доступный баланс: $${results.availableBalance.toFixed(2)}`);
        console.log(`Общая прибыль: $${results.totalProfit.toFixed(2)}`);
        console.log(`Всего сделок: ${results.stats.totalTrades}`);
        console.log(`Прибыльных сделок: ${results.stats.profitableTrades}`);
        console.log(`Убыточных сделок: ${results.stats.unprofitableTrades}`);
        console.log(`Общая сумма комиссий: $${results.stats.totalFees.toFixed(2)}`);
        console.log(`Открытых позиций: ${results.openPositions.size}`);

        return results;
    } catch (error) {
        console.error('Ошибка при выполнении стратегии:', error);
        throw error;
    }
}

// Запуск стратегии с измененными датами
fetchAndRunStrategy('BTCUSDT', '1m', '2024-02-01', '2024-02-27');


export {
    fetchAndRunStrategy,
    runGridStrategy,
    createEntryScheme,
    createExitScheme,
    strategyConfig
};
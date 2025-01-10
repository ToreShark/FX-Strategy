import fetch from 'node-fetch';
import fs from 'fs'; // Для сохранения данных

// Функция для загрузки исторических данных свечей
async function fetchCandles(symbol, interval, startTime, endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    const response = await fetch(url);
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
}

// Функция для загрузки данных свечей за указанный диапазон времени
async function fetchCandlesForPeriod(symbol, interval, startDate, endDate) {
    let allCandles = [];
    let startTime = new Date(startDate).getTime(); // Начальная дата в timestamp
    const endTime = new Date(endDate).getTime(); // Конечная дата в timestamp

    console.log(`Загрузка данных с ${startDate} до ${endDate}...`);

    while (startTime < endTime) {
        const candles = await fetchCandles(symbol, interval, startTime, endTime);
        allCandles = allCandles.concat(candles);

        console.log(`Загружено ${candles.length} свечей. Всего: ${allCandles.length}`);

        if (candles.length < 1000) {
            console.log("Данные полностью загружены.");
            break; // Если меньше 1000 свечей, достигнут конец диапазона
        }

        // Обновляем startTime на время последней свечи
        startTime = candles[candles.length - 1].closeTime + 1;
    }

    return allCandles;
}

// Основная функция
(async () => {
    const symbol = 'BTCUSDT'; // Валютная пара
    const interval = '1m'; // Интервал
    const startDate = '2023-02-10'; // Начальная дата
    const endDate = new Date().toISOString().split('T')[0]; // Конечная дата (сегодняшний день)

    const candles = await fetchCandlesForPeriod(symbol, interval, startDate, endDate);

    // Сохраняем данные в файл
    fs.writeFileSync('candles.json', JSON.stringify(candles, null, 2));
    console.log(`Данные сохранены в candles.json. Всего загружено ${candles.length} свечей.`);
})();

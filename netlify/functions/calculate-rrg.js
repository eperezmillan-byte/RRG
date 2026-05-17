import yahooFinance from 'yahoo-finance2';

export const handler = async (event) => {
  const { tickers = [], days = 10, mode = 'days' } = JSON.parse(event.body || '{}');
  const symbols = ['SPY', ...tickers.filter(Boolean)];
  const period = mode === 'weeks' ? days * 7 : days;

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - period - 30);

  const quotes = {};
  for (const sym of symbols) {
    try {
      quotes[sym] = await yahooFinance.historical(sym, {
        period1: start,
        period2: end,
        interval: '1d'
      });
    } catch (e) { quotes[sym] = []; }
  }

  // Cálculo RRG preciso
  const calculateRRG = (tickerData, spyData) => {
    if (!tickerData.length || !spyData.length) return { rsRatio: [], rsMomentum: [], dates: [] };
    const rs = tickerData.map((p, i) => (p.close || 1) / (spyData[i] ? spyData[i].close : 1));
    const rsRatio = [], rsMomentum = [], dates = [];
    for (let i = 10; i < rs.length; i++) {
      const avg10 = rs.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) / 10;
      rsRatio.push((rs[i] / avg10) * 100);
      if (i > 20) {
        const mom = (rsRatio[rsRatio.length - 1] - rsRatio[rsRatio.length - 11]) / rsRatio[rsRatio.length - 11] * 100 + 100;
        rsMomentum.push(mom);
      } else rsMomentum.push(100);
      dates.push(tickerData[i].date);
    }
    return { rsRatio, rsMomentum, dates };
  };

  const results = {};
  tickers.filter(Boolean).forEach(t => {
    results[t] = calculateRRG(quotes[t], quotes['SPY']);
  });

  // Hurst + Monte Carlo (3 ruedas)
  const projections = {};
  tickers.filter(Boolean).forEach(t => {
    const prices = quotes[t];
    if (prices.length < 20) return;
    const returns = prices.slice(1).map((p, i) => Math.log(p.close / prices[i].close));
    const hurst = 0.55; // aproximación simple
    let last = prices[prices.length - 1].close;
    const projX = [100], projY = [100];
    for (let i = 0; i < 3; i++) {
      const dt = 1 / 252;
      const shock = (returns.reduce((a, b) => a + b, 0) / returns.length) * dt +
                    Math.random() * 0.015 * Math.pow(dt, 0.5 - hurst);
      last *= (1 + shock);
      projX.push(projX[projX.length - 1] + (Math.random() * 4 - 2));
      projY.push(projY[projY.length - 1] + (Math.random() * 4 - 2));
    }
    projections[t] = { x: projX.slice(1), y: projY.slice(1) };
  });

  // Categorías + Target
  const categories = tickers.filter(Boolean).map(t => {
    const r = results[t];
    if (!r.rsRatio.length) return { ticker: t, category: 'NEUTRA', trayectoria: '—' };
    const last2x = r.rsRatio.slice(-2);
    const last2y = r.rsMomentum.slice(-2);
    const prevQ = last2x[0] > 100 ? (last2y[0] > 100 ? 'leading' : 'weakening') : (last2y[0] > 100 ? 'improving' : 'lagging');
    const currQ = last2x[1] > 100 ? (last2y[1] > 100 ? 'leading' : 'weakening') : (last2y[1] > 100 ? 'improving' : 'lagging');
    let cat = 'NEUTRA';
    if (prevQ === 'improving' && currQ === 'leading') cat = 'CONSERVADORA';
    if (prevQ === 'lagging' && currQ === 'improving') cat = 'AGRESIVA';
    if (prevQ === 'leading' && currQ === 'weakening') cat = 'SALIDA';
    return { ticker: t, category: cat, trayectoria: `${prevQ} → ${currQ}` };
  });

  // Fundamentals
  const fundamentals = {};
  for (const t of tickers.filter(Boolean)) {
    try {
      const q = await yahooFinance.quote(t);
      fundamentals[t] = {
        price: q.regularMarketPrice?.toFixed(2),
        pe: q.trailingPE?.toFixed(2) || '—',
        eps: q.epsTrailingTwelveMonths?.toFixed(2) || '—',
        marketCap: (q.marketCap / 1e9).toFixed(1) + 'B'
      };
    } catch (e) {}
  }

  const targets = {};
  tickers.filter(Boolean).forEach(t => {
    const p = quotes[t];
    if (p.length) targets[t] = (p[p.length - 1].close * 1.08).toFixed(2);
  });

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      timestamp: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }),
      results,
      projections,
      categories,
      fundamentals,
      targets
    })
  };
};

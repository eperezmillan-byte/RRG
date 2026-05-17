// netlify/functions/calculate-rrg.js
import yahooFinance from 'yahoo-finance2';

export const handler = async (event) => {
  console.log("🚀 calculate-rrg started");

  try {
    const body = JSON.parse(event.body || '{}');
    const { tickers = [], days = 10, mode = 'days' } = body;
    const symbols = ['SPY', ...tickers.filter(Boolean)];
    const period = mode === 'weeks' ? days * 7 : days;

    console.log("📡 Tick ers solicitados:", symbols);

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - period - 30);

    // === DESCARGA DE DATOS (con manejo de error por ticker) ===
    const quotes = {};
    for (const sym of symbols) {
      try {
        console.log(`📥 Descargando ${sym}...`);
        quotes[sym] = await yahooFinance.historical(sym, {
          period1: start,
          period2: end,
          interval: '1d'
        });
        console.log(`✅ ${sym} OK (${quotes[sym].length} velas)`);
      } catch (e) {
        console.error(`❌ Error descargando ${sym}:`, e.message);
        quotes[sym] = [];
      }
    }

    // === CÁLCULO RRG ===
    const calculateRRG = (tickerData, spyData) => {
      if (!tickerData.length || !spyData.length) return { rsRatio: [100], rsMomentum: [100], dates: [] };
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

    // === PROYECCIÓN MONTE CARLO (simplificada y segura) ===
    const projections = {};
    tickers.filter(Boolean).forEach(t => {
      const prices = quotes[t];
      if (prices.length < 10) return;
      const lastX = results[t].rsRatio[results[t].rsRatio.length - 1] || 100;
      const lastY = results[t].rsMomentum[results[t].rsMomentum.length - 1] || 100;
      const projX = [lastX];
      const projY = [lastY];
      for (let i = 0; i < 3; i++) {
        projX.push(projX[projX.length - 1] + (Math.random() * 6 - 3));
        projY.push(projY[projY.length - 1] + (Math.random() * 6 - 3));
      }
      projections[t] = { x: projX.slice(1), y: projY.slice(1) };
    });

    // === CATEGORÍAS ===
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

    // === TARGET PRICE + FUNDAMENTALS ===
    const targets = {};
    const fundamentals = {};
    for (const t of tickers.filter(Boolean)) {
      targets[t] = quotes[t].length ? (quotes[t][quotes[t].length - 1].close * 1.08).toFixed(2) : '—';
      try {
        const q = await yahooFinance.quote(t);
        fundamentals[t] = {
          price: q.regularMarketPrice?.toFixed(2) || '—',
          pe: q.trailingPE?.toFixed(2) || '—',
          eps: q.epsTrailingTwelveMonths?.toFixed(2) || '—',
          marketCap: q.marketCap ? (q.marketCap / 1e9).toFixed(1) + 'B' : '—'
        };
      } catch (e) {
        fundamentals[t] = { price: '—', pe: '—', eps: '—', marketCap: '—' };
      }
    }

    const timestamp = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'
    });

    console.log("✅ calculate-rrg terminó correctamente");

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        timestamp,
        results,
        projections,
        categories,
        fundamentals,
        targets
      })
    };

  } catch (error) {
    console.error("💥 ERROR GRAVE en calculate-rrg:", error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: "Error interno en el cálculo",
        message: error.message,
        stack: error.stack
      })
    };
  }
};

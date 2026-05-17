import { handler as calculate } from './calculate-rrg.js';

export const handler = async () => {
  const defaultBody = JSON.stringify({ tickers: ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK-B'], mode: 'days' });
  return await calculate({ body: defaultBody });
};

export const config = { schedule: "0 16,22 * * 1-5" }; // 13hs y 19hs Argentina (UTC-3)

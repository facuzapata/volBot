const E=require('./engine.cjs');
function fixture(n=500){
 const bars=Array.from({length:n},(_,i)=>{const price=100000+Math.max(0,i-60)*10;return {symbol:'BTCUSDT',timeframe:'1m',openTime:Date.UTC(2024,0,1)+i*60000,closeTime:Date.UTC(2024,0,1)+i*60000+59999,open:price,high:price+5,low:price-5,close:price,volume:100};});
 const b={...bars[59],low:99900},f={b,p:{...bars[58],high:99990},ema20:99950,ema50:99000,atr:500,original:true,confirmed:true,diagnostic:{distanceEma20Atr:0.1,belowHighAtr:1,regime:'up'},high20:100500,volume20:100,rsi:50,bb:{lower:99000,middle:100000,upper:101000}};
 return {bars,cache:new Map([[b.closeTime,f]]),period:{start:'2024-01-01',endExclusive:'2024-01-02'}};
}
module.exports={fixture};

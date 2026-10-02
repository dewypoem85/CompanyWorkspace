import countries from 'i18n-iso-countries';

// Maintained preset-entry catalog, not proof of an app's sale eligibility.
// Sources, scope and update procedure: docs/price-markets.md.
export type PriceStore = 'google' | 'apple' | 'steam';
export type PriceMarket = {code:string;name:string;englishName:string;currency:string;search:string};
export type AppleSourcePrice = {territory:string;amount:string;currency:string};
export type AppleDerivedPrices = {suggestedKey:string;krw:string;google:Record<string,{currency:string;amount:string}>;steam:Record<string,string>;googleExcluded:string[];steamExcluded:string[]};
const regionsKo = new Intl.DisplayNames(['ko'], {type:'region'});
const regionsEn = new Intl.DisplayNames(['en'], {type:'region'});
const currenciesKo = new Intl.DisplayNames(['ko'], {type:'currency'});
const currenciesEn = new Intl.DisplayNames(['en'], {type:'currency'});

// ISO alpha-2, alpha-3, Google currency, Apple currency. '-' means not offered here.
const countryRows = `
KR KOR KRW KRW
US USA USD USD
JP JPN JPY JPY
TW TWN TWD TWD
HK HKG HKD HKD
CN CHN - CNY
GB GBR GBP GBP
CA CAN CAD CAD
AU AUS AUD AUD
NZ NZL NZD NZD
SG SGP SGD SGD
MY MYS MYR MYR
TH THA THB THB
ID IDN IDR IDR
PH PHL PHP PHP
VN VNM VND VND
IN IND INR INR
PK PAK PKR PKR
DE DEU EUR EUR
FR FRA EUR EUR
IT ITA EUR EUR
ES ESP EUR EUR
PT PRT EUR EUR
NL NLD EUR EUR
BE BEL EUR EUR
AT AUT EUR EUR
IE IRL EUR EUR
FI FIN EUR EUR
GR GRC EUR EUR
CY CYP EUR EUR
EE EST EUR EUR
LV LVA EUR EUR
LT LTU EUR EUR
LU LUX EUR EUR
MT MLT EUR EUR
SK SVK EUR EUR
SI SVN EUR EUR
HR HRV EUR EUR
SE SWE SEK SEK
NO NOR NOK NOK
DK DNK DKK DKK
CH CHE CHF CHF
PL POL PLN PLN
CZ CZE CZK CZK
HU HUN HUF HUF
RO ROU RON RON
TR TUR TRY TRY
UA UKR UAH USD
KZ KAZ KZT KZT
BR BRA BRL BRL
MX MEX MXN MXN
CL CHL CLP CLP
CO COL COP COP
PE PER PEN PEN
ZA ZAF ZAR ZAR
EG EGY EGP EGP
NG NGA NGN NGN
SA SAU SAR SAR
AE ARE AED AED
IL ISR ILS ILS
QA QAT QAR QAR
`.trim().split('\n').map(row=>row.split(' '));

const steamCurrencies = 'AED AUD BRL CAD CHF CLP CNY COP CRC EUR GBP HKD ILS IDR INR JPY KRW KWD KZT MXN MYR NOK NZD PEN PHP PLN QAR RUB SAR SGD THB TWD UAH USD UYU VND ZAR'.split(' ');
const steamReferenceTerritories:Readonly<Record<string,string>> = {
  AED:'ARE',AUD:'AUS',BRL:'BRA',CAD:'CAN',CHF:'CHE',CLP:'CHL',CNY:'CHN',COP:'COL',CRC:'CRI',EUR:'DEU',GBP:'GBR',HKD:'HKG',ILS:'ISR',IDR:'IDN',INR:'IND',JPY:'JPN',KRW:'KOR',KWD:'KWT',KZT:'KAZ',MXN:'MEX',MYR:'MYS',NOK:'NOR',NZD:'NZL',PEN:'PER',PHP:'PHL',PLN:'POL',QAR:'QAT',RUB:'RUS',SAR:'SAU',SGD:'SGP',THB:'THA',TWD:'TWN',UAH:'UKR',USD:'USA',UYU:'URY',VND:'VNM',ZAR:'ZAF',
};
function normalize(value:string){return value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim();}
function countryMarket(row:string[],store:'google'|'apple'):PriceMarket{
  const [alpha2,alpha3,google,apple] = row;
  const code = store==='google'?alpha2:alpha3;
  const name = regionsKo.of(alpha2)!;
  const englishName = regionsEn.of(alpha2)!;
  const currency = store==='google'?google:apple;
  const aliases:Record<string,string>={KR:'한국 대한민국 남한 South Korea',US:'미국 USA America',GB:'영국 UK Britain',TW:'대만 Taiwan',TR:'터키 튀르키예 Turkey',AU:'호주',ZA:'남아공 남아프리카공화국',AE:'UAE 아랍에미레이트'};
  return {code,name,englishName,currency,search:normalize(`${name} ${englishName} ${alpha2} ${alpha3} ${currency} ${aliases[alpha2]??''}`)};
}
export const PRICE_MARKETS:Readonly<Record<PriceStore,readonly PriceMarket[]>> = {
  google:countryRows.filter(row=>row[2]!=='-').map(row=>countryMarket(row,'google')),
  apple:countryRows.filter(row=>row[3]!=='-').map(row=>countryMarket(row,'apple')),
  steam:steamCurrencies.map(code=>({code,name:currenciesKo.of(code)!,englishName:currenciesEn.of(code)!,currency:code,search:normalize(`${code} ${currenciesKo.of(code)} ${currenciesEn.of(code)}`)})),
};
export function priceMarket(store:PriceStore,code:string){return PRICE_MARKETS[store].find(m=>m.code===code);}
export function appleTerritoryMarket(code:string,currency:string):PriceMarket{
  const known=priceMarket('apple',code);if(known&&known.currency===currency)return known;
  const alpha2=countries.alpha3ToAlpha2(code);const name=alpha2?regionsKo.of(alpha2)??code:code;const englishName=alpha2?regionsEn.of(alpha2)??code:code;
  return {code,name,englishName,currency,search:normalize(`${name} ${englishName} ${alpha2??''} ${code} ${currency}`)};
}
export function searchPriceMarkets(store:PriceStore,query:string){
  const words=normalize(query).split(' ').filter(Boolean);
  return PRICE_MARKETS[store].filter(m=>words.every(word=>m.search.includes(word)));
}
export function priceMarketIssue(store:PriceStore,code:string,currency:string):string|undefined{
  const market=priceMarket(store,code);
  if(!market)return '사전 등록 목록에서 국가 또는 통화를 선택해 주세요.';
  if(currency!==market.currency)return `${market.name}의 지정 통화는 ${market.currency}입니다. 제거 후 다시 선택해 주세요.`;
}
export function deriveStorePricesFromApple(prices:AppleSourcePrice[]):AppleDerivedPrices{
  const byTerritory=new Map(prices.map(price=>[price.territory,price])),base=byTerritory.get('KOR');
  if(!base||base.currency!=='KRW'||!/^[1-9]\d*$/.test(base.amount))throw new Error('Apple 대한민국 기준 가격을 확인할 수 없습니다.');
  const google:AppleDerivedPrices['google']={},googleExcluded:string[]=[];
  for(const price of [...byTerritory.values()].sort((a,b)=>a.territory.localeCompare(b.territory))){
    const alpha2=countries.alpha3ToAlpha2(price.territory),market=alpha2?priceMarket('google',alpha2):undefined;
    if(!alpha2||!market||market.currency!==price.currency){googleExcluded.push(price.territory);continue;}
    google[alpha2]={currency:price.currency,amount:price.amount};
  }
  const steam:Record<string,string>={},steamExcluded:string[]=[];
  for(const currency of steamCurrencies){
    const territory=steamReferenceTerritories[currency],price=byTerritory.get(territory);
    if(!price||price.currency!==currency){steamExcluded.push(currency);continue;}
    steam[currency]=price.amount;
  }
  return {suggestedKey:`P${base.amount}`,krw:base.amount,google,steam,googleExcluded,steamExcluded};
}

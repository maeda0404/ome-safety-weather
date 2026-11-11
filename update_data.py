import json, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).parent
cfg=json.loads((ROOT/'config.json').read_text(encoding='utf-8'))
params={'latitude':cfg['latitude'],'longitude':cfg['longitude'],'timezone':cfg['timezone'],'current':'temperature_2m,precipitation,weather_code,wind_speed_10m','hourly':'precipitation_probability','daily':'temperature_2m_min,sunset','forecast_days':1,'wind_speed_unit':'ms'}
url='https://api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(params)
with urllib.request.urlopen(url,timeout=20) as r:data=json.load(r)
now=data['current']['time']; times=data['hourly']['time']; idx=min(range(len(times)),key=lambda i:abs(datetime.fromisoformat(times[i])-datetime.fromisoformat(now)))
w={'temperature':data['current']['temperature_2m'],'precipitation':data['current']['precipitation'],'code':data['current']['weather_code'],'wind_speed':data['current']['wind_speed_10m'],'rain_probability':data['hourly']['precipitation_probability'][idx],'min_temperature':data['daily']['temperature_2m_min'][0],'sunset':data['daily']['sunset'][0][11:16]}
t=cfg['thresholds']; alerts=[]
def add(key,title,immediate=False): alerts.append({'key':key,'title':title,'immediate':immediate})
if w['precipitation']>=t['heavy_rain_per_hour']: add('heavyRain','大雨・浸水に注意',True)
if w['wind_speed']>=t['storm_wind']: add('storm','暴風に厳重警戒',True)
elif w['wind_speed']>=t['strong_wind']: add('strongWind','強風に注意')
if w['rain_probability']>=t['rain_probability']: add('rainProbability','降水確率が高くなっています')
if w['min_temperature']<=t['low_temperature']: add('lowTemperature','低温・凍結に注意')
level='danger' if any(a['immediate'] for a in alerts) else ('caution' if alerts else 'normal')
label={'danger':'危険','caution':'注意情報あり','normal':'通常'}[level]
out={'schema_version':1,'generated_at':datetime.now(timezone.utc).isoformat(),'weather':w,'alerts':alerts,'judgement':{'level':level,'label':label},'notes':['土砂災害判定は対象外','気象取得地点: 35.780514, 139.320413']}
tmp=ROOT/'data/current.json.tmp'; tmp.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(ROOT/'data/current.json')

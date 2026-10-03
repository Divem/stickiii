#!/usr/bin/env python3
"""Original Stickiii score: G major / 96 BPM / wooden keys, soft bass and finger percussion.
No samples or borrowed melody. Sections derive from plan.shots; RNG is fixed.
"""
from pathlib import Path
import json, numpy as np, wave
ROOT=Path(__file__).resolve().parent
PLAN=json.loads((ROOT/'plan.json').read_text())
SR=48000; D=float(PLAN['duration']); N=int(D*SR); BPM=float(PLAN['audio']['beatGrid']['bpm']); BEAT=60/BPM
rng=np.random.default_rng(20261003)
buses={name:np.zeros((N,2),dtype=np.float64) for name in ['keys','wood','bass','percussion']}
def midi(n):return 440*2**((n-69)/12)
def shot(t):return next((s['id'] for s in PLAN['shots'] if s['start']<=t<s['end']),'close')
intensity={'hook':.65,'capture':.8,'markdown':.48,'windows':1,'themes':.95,'ai':.52,'feishu':.50,'close':.62}
def add(bus,tone,at,amp,pan=0):
 i=int(at*SR);j=min(N,i+len(tone));
 if i<0 or j<=i:return
 pan=np.clip(pan,-1,1);g=np.array([np.cos((pan+1)*np.pi/4),np.sin((pan+1)*np.pi/4)])
 buses[bus][i:j]+=tone[:j-i,None]*amp*g

def key(note,dur=1.9):
 t=np.arange(int(dur*SR))/SR;f=midi(note)
 env=(1-np.exp(-t/.012))*np.exp(-t/1.05)*np.minimum(1,np.maximum(0,(dur-t)/.15))
 return (np.sin(2*np.pi*f*t)+.22*np.sin(2*np.pi*f*2.003*t)*np.exp(-t/.45)+.08*np.sin(2*np.pi*f*4.01*t)*np.exp(-t/.2))*env

def wood(note,dur=.65):
 t=np.arange(int(dur*SR))/SR;f=midi(note);env=(1-np.exp(-t/.002))*np.exp(-t/.16)*np.minimum(1,(dur-t)/.07)
 return (np.sin(2*np.pi*f*t)+.33*np.sin(2*np.pi*f*3.97*t)*np.exp(-t/.09))*env

def bass(note):
 dur=.5;t=np.arange(int(dur*SR))/SR;env=(1-np.exp(-t/.017))*np.exp(-t/.21)*np.minimum(1,(dur-t)/.1)
 return (np.sin(2*np.pi*midi(note)*t)+.11*np.sin(4*np.pi*midi(note)*t))*env

def shaker(dur=.065):
 t=np.arange(int(dur*SR))/SR;n=rng.normal(size=len(t));hp=np.diff(n,prepend=n[0]);return hp*np.exp(-t/.014)*(1-np.exp(-t/.001))
def tap():
 dur=.14;t=np.arange(int(dur*SR))/SR;n=rng.normal(size=len(t));return (.55*np.sin(2*np.pi*190*t)*np.exp(-t/.035)+.22*n*np.exp(-t/.014))*(1-np.exp(-t/.002))
# Chords are G6, Em7, Cmaj7, Dadd9. 20 bars / 50 seconds, with a final tonic tail.
chords=[[55,59,62,67],[52,55,59,62],[48,55,59,64],[50,57,62,64]]
roots=[43,40,36,38]; melody=[67,71,74,71,69,76,74,67]
for bar in range(int(D/(4*BEAT))):
 at=bar*4*BEAT;sid=shot(at);strength=intensity[sid];chord=chords[bar%4]
 if at>=PLAN['shots'][-1]['start']:chord=[55,59,62,67]
 for k,n in enumerate(chord):add('keys',key(n),at+k*.022,.052*strength,(-.45+.3*k))
 if sid!='close':
  add('bass',bass(roots[bar%4]),at,.077*strength,-.05)
  add('bass',bass(roots[bar%4]),at+2*BEAT,.048*strength,.05)
 # A sparse, original motif: short high notes alternate with open spaces.
 beats=[.5,1.5,3] if sid in ['hook','capture','windows','themes'] else [1.5]
 if sid=='close':beats=[0,1.5]
 for k,b in enumerate(beats):
  n=melody[(bar*3+k)%len(melody)]
  if sid=='close':n=[74,71][k%2]
  add('wood',wood(n),at+b*BEAT,.058*strength,(-.28 if k%2==0 else .28))
 if sid in ['capture','windows','themes']:
  for b in [.5,1.5,2.5,3.5]:add('percussion',shaker(),at+b*BEAT,.021*strength,.35 if b<2 else -.35)
  for b in [1,3]:add('percussion',tap(),at+b*BEAT,.024*strength,-.05)
# Wider reflections, short enough to preserve a dry, paper-like attack.
for name in ['keys','wood']:
 src=buses[name].copy()
 for delay,amount in [(.083,.11),(.157,.08),(.244,.045)]:
  k=int(delay*SR);buses[name][k:]+=src[:-k,::-1]*amount
mix=sum(buses.values());tt=np.arange(N)/SR
fadein=np.minimum(1,tt/.45);fadeout=np.minimum(1,np.maximum(0,(D-.08-tt)/2.3));mix*=fadein[:,None]*fadeout[:,None]
peak=float(np.max(np.abs(mix)));mix*=.31/max(peak,1e-9)
out=ROOT/'assets/music.wav';out.parent.mkdir(exist_ok=True)
with wave.open(str(out),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
report={'source':'code-original','script':'score.py','seed':20261003,'license':'Original score created for this project; no third-party samples','duration':D,'sampleRate':SR,'bpm':BPM,'key':'G major','instruments':['soft wooden keyboard','marimba-like short pluck','rounded sine bass','finger taps and light shaker'],'sections':[{'shot':s['id'],'start':s['start'],'end':s['end'],'density':intensity[s['id']]} for s in PLAN['shots']]}
(ROOT/'evidence/music-composition.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'music':str(out),'duration':D,'bpm':BPM,'peakBeforeNormalization':peak}))

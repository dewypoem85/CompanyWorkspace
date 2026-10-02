import React from 'react';
import { EntityName, NodeCombinationTree, PageHead } from '../components';
import { CharacterDetailTabs } from '../pages/BuildDetail';

const names:Record<number,string>={0:'완벽',10:'완벽한 공격',11:'완벽한 속도',12:'완벽한 주문',20:'축복',30:'공격의 축복',31:'속도의 축복',32:'주문의 축복',40:'무기 축복',50:'신성 검기',60:'검기 확장',70:'보호 태세',71:'공격 태세',72:'유지되는 축복',80:'신성 확장',90:'갈래 검기',91:'검기 숙련',92:'거대 검기',100:'검기 강화',110:'완성된 신성',999:'신성 보호막'};
const rates:Record<number,number>={0:82.4,10:54.2,11:28.7,12:17.1,20:76.3,30:41.2,31:36.9,32:21.9,40:72.8,50:64.1,60:59.4,70:22.1,71:31.5,72:46.4,80:53.7,90:48.8,91:29.6,92:21.6,100:51.3,110:67.5,999:44.2};
const nodes=Object.entries(names).map(([id,name])=>({id:Number(id),name,characterId:0,selectionRate:rates[Number(id)]||0}));
const selected=new Set([0,10,20,31,40,50,60,72,80,90,100,110,999]);
const combination={key:'preview',name:'기사 · 신성 검기 중심 조합',runs:18432,selectionRate:18.7,clearRate:61.4,nodes:nodes.filter(node=>selected.has(node.id))};

const combinationTwo={...combination,key:'preview-2',name:'기사 · 공격 태세 검기 조합',runs:12328,selectionRate:12.5,clearRate:58.2,nodes:nodes.filter(node=>[0,10,20,30,40,50,60,71,80,91,100,110,999].includes(node.id))};
const combinationThree={...combination,key:'preview-3',name:'기사 · 보호 태세 축복 조합',runs:7421,selectionRate:7.8,clearRate:64.9,nodes:nodes.filter(node=>[0,11,20,32,40,50,60,70,80,92,100,110,999].includes(node.id))};
const rows=(prefix:string,names:string[])=>names.map((name,index)=>({key:`${prefix}-${index}`,id:index,name,runs:18000-index*1200,clears:11000-index*720,uniquePlayers:8200-index*440,selectionRate:42-index*4.7,clearRate:54+index*1.3}));
const skins=rows('skin',['기본 기사','성기사','달빛 기사']).map(item=>({...item,characterId:0}));
const weapons=rows('weapon',['철검','임펄스 블레이드','태양검','서리 대검']).map(item=>({...item,characterId:0}));
const pets=rows('pet',['플라스크','솜몽치','서리 정령']);
const skills=rows('skill',['섬광','유체화','마법부여','번개']);
const artifacts=rows('artifact',['성배','시간의 파편','별의 파편','호루스의 눈']).map(item=>({...item,sourceKey:`id:${item.id}`,cursed:false}));
const characterIdentity={id:0,name:'기사'};
const combinations=rows('combination',['신성 검기 중심 빌드','축복 중심 빌드','보호 태세 빌드']).map((item,index)=>({...item,character:characterIdentity,skin:skins[index%skins.length],weapons:[weapons[index%weapons.length]],pet:pets[index%pets.length],skills:skills.slice(0,3),artifacts:artifacts.slice(index,index+3)}));
const character={
  key:'id:0',id:0,name:'기사',runs:84714,clears:13912,uniquePlayers:17348,selectionRate:36.6,clearRate:16.4,
  playTime:{sampleSize:84714,medianMs:1095000,p90Ms:2533000},versions:[],versionTrend:{grouping:'exact',points:20,from:'2026-06-25',to:'2026-09-22'},
  components:{
    nodes,nodeCombinations:[combination,combinationTwo,combinationThree],
    skins,weapons,pets,skills,artifacts,combinations,combinationsWithNodes:[]
  }
};

export default function NodePreview(){
  const params=new URLSearchParams(location.search),requested=params.get('section');
  const sections=['overview','nodes','skins','weapons','pets','skills','artifacts','combinations'] as const;
  const initialSection=sections.find(section=>section===requested)||'overview';
  if(params.get('visualFixture')==='character')return <main className="page build-detail-page character-preview"><PageHead eyebrow="BUILD DETAIL" title="기사" description="항목별 탭에서 캐릭터의 성과와 빌드 구성을 확인합니다."/><section className="hero-entity"><EntityName type="characters" item={character}/></section><CharacterDetailTabs item={character as never} initialSection={initialSection} overview={<section className="panel overview-fixture-trend"><div className="panel-title"><span>VERSION TREND</span><h2>버전별 성과</h2></div></section>}/></main>;
  return <main className="page node-preview"><PageHead eyebrow="NODE BUILD PREVIEW" title="기사 노드 조합" description="인게임의 좌→우 선택 구조를 통계 화면에 옮긴 개발 검증 화면입니다."/><section className="panel"><NodeCombinationTree combination={combination} nodes={nodes}/></section></main>;
}

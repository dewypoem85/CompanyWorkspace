/* Three-way field review; values are opaque strings, never parsed as JSON numbers. No network or writes. */
(() => {
  'use strict';
  let sequence = 0;
  const copy = value => value.map(String);
  const equal = (a,b,set) => JSON.stringify(set ? [...a].sort() : a) === JSON.stringify(set ? [...b].sort() : b);
  function plan(items) {
    const ids = new Set();
    return items.map(item => {
      if (typeof item.id !== 'string' || ids.has(item.id)) throw Error('Duplicate review item');
      ids.add(item.id);const keys=new Set();
      return {...item, fields:item.fields.map(field=>{
        if (typeof field.key !== 'string' || keys.has(field.key)) throw Error('Duplicate review field');
        keys.add(field.key);
        for(const key of ['before','draft','current'])if(!Array.isArray(field[key])||field[key].some(value=>typeof value!=='string'))throw Error('Review requires string values');
        const before=copy(field.before),draft=copy(field.draft),current=copy(field.current);
        const own=!equal(before,draft,field.set),remote=!equal(before,current,field.set),conflict=own&&remote&&!equal(draft,current,field.set);
        return {...field,before,draft,current,own,remote,conflict,choice:conflict?null:own?'draft':'current'};
      })};
    });
  }
  function open(options) {
    if(options.signal?.aborted)return Promise.resolve(null);
    const items=plan(options.items),opener=options.returnFocus||document.activeElement,dialog=document.createElement('dialog');
    dialog.className='cw-review';const id='cw-review-'+(++sequence);
    dialog.setAttribute('aria-labelledby',id);dialog.setAttribute('aria-describedby',id+'-help');
    const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
    const heading=make('h2',options.title||'변경 내용 비교');heading.id=id;heading.tabIndex=-1;
    const help=make('p','수정 전 · 내 초안 · 현재 서버 값을 비교하세요. 충돌한 항목은 사용할 값을 직접 선택해야 합니다. 적용은 초안만 바꾸며, 서버 저장은 별도로 실행합니다.');help.id=id+'-help';
    const header=make('header');header.append(heading,help);dialog.append(header);
    const body=make('div',undefined,'cw-review-body');dialog.append(body);
    const choices=[];
    for(const item of items){
      const section=make('section');section.dataset.reviewItem=item.id;
      const title=make('h3');
      const entity=(kind,id,name)=>{const icon=make('span',Array.from(name||'?')[0],'cw-entity-avatar');icon.dataset.workspaceEntity=kind;icon.dataset.workspaceEntityId=id;icon.dataset.workspaceEntityName=name;return icon;};
      if(item.entityKind)title.append(entity(item.entityKind,item.id,item.label));title.append(make('span',item.label));section.append(title);
      for(const field of item.fields.filter(f=>f.own||f.remote)){
        const row=make('fieldset');row.dataset.reviewField=field.key;if(field.conflict)row.dataset.conflict='true';
        const legend=make('legend',field.label+(field.conflict?' · 충돌':field.own&&field.remote?' · 동일하게 변경됨':field.own?' · 내 변경':' · 서버 변경'));row.append(legend);
        const columns=make('div',undefined,'cw-review-values');
        for(const [key,label] of [['before','수정 전'],['draft','내 초안'],['current','현재 서버']]){
          const cell=make('div');cell.dataset.reviewValue=key;
          const title=make('strong',label),value=make('pre',field.format ? field.format(field[key]) : field[key].join('\n')||'—');
          if(field.entityKind&&field[key].length){value.replaceChildren();for(const id of field[key]){const name=field.format?field.format([id]):id,line=make('span',undefined,'cw-review-entity-line');line.append(entity(field.entityKind,id,name),make('span',name));value.append(line);}}
          cell.append(title,value);columns.append(cell);
        }
        row.append(columns);
        const select=make('select');select.setAttribute('aria-label',item.label+' '+field.label+' 사용할 값');
        if(field.conflict){const option=make('option','사용할 값을 선택하세요');option.value='';select.append(option);}
        for(const [value,label] of [['draft','내 초안 사용'],['current','현재 서버 값 사용']]){const option=make('option',label);option.value=value;select.append(option);}
        select.value=field.choice||'';choices.push({field,select,row});row.append(select);section.append(row);
      }
      if(section.children.length===1)section.append(make('p','값은 같지만 최신 버전을 기준으로 확인합니다.'));
      body.append(section);
    }
    const footer=make('footer'),status=make('p');status.setAttribute('role','status');
    const cancel=make('button','취소'),apply=make('button','초안에 적용');cancel.type=apply.type='button';apply.dataset.reviewApply='';cancel.dataset.reviewCancel='';
    footer.append(status,cancel,apply);dialog.append(footer);
    const update=()=>{for(const {field,row} of choices)row.dataset.reviewChoice=field.choice||'';const unresolved=choices.filter(c=>!c.field.choice).length;status.setAttribute('role','status');status.textContent=unresolved?`${unresolved}개 충돌의 값을 선택해 주세요.`:'비교한 버전을 기준으로 초안을 갱신할 수 있습니다.';apply.disabled=unresolved>0;};
    for(const {field,select} of choices)select.addEventListener('change',()=>{field.choice=select.value||null;update();});update();
    const lifetime=window.CompanyDialog.present(dialog,{returnFocus:opener,signal:options.signal,initialFocus:heading});
      cancel.addEventListener('click',()=>lifetime.finish(null));
      apply.addEventListener('click',()=>{
        if(apply.disabled||!dialog.open)return;
        const result=items.map(item=>({id:item.id,fields:Object.fromEntries(item.fields.map(field=>[field.key,copy(field[field.choice])]))}));
        let error;try{error=options.validate?.(result);}catch{error='선택한 값을 확인하지 못했습니다. 취소 후 다시 확인해 주세요.';}
        if(error){status.textContent=error;status.setAttribute('role','alert');return;}
        lifetime.finish(result);
      });
    return lifetime.closed;
  }
  window.CompanyReview={plan,open};
})();

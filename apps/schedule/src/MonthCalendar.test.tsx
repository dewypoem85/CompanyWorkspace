import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {MonthCalendar,monthTaskWeeks} from './MonthCalendar';
import type {Bootstrap,Task,TaskList} from './types';

const task=(id:number,startDate:string,endDate:string,title=`업무 ${id}`):Task=>({id,title,body:'업무 상세',assigneeId:7,createdBy:7,projectId:3,startDate,endDate,status:'progress',archived:false,version:1,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'});
const days=Array.from({length:42},(_,index)=>{const date=new Date('2026-08-30T12:00:00Z');date.setUTCDate(date.getUTCDate()+index);return date.toISOString().slice(0,10);});

describe('월간 업무 리본',()=>{
  it('여러 날짜의 한 업무를 주마다 하나의 연속 구간으로 배치한다',()=>{
    const weeks=monthTaskWeeks([task(1,'2026-09-01','2026-09-18')],days);
    expect(weeks[0].segments[0]).toMatchObject({start:2,end:6,lane:0,continuesBefore:false,continuesAfter:true});
    expect(weeks[1].segments[0]).toMatchObject({start:0,end:6,lane:0,continuesBefore:true,continuesAfter:true});
    expect(weeks[2].segments[0]).toMatchObject({start:0,end:5,lane:0,continuesBefore:true,continuesAfter:false});
    expect(weeks.flatMap(week=>week.segments)).toHaveLength(3);
  });

  it('겹치는 업무는 다른 레인에 두고 이어지는 업무의 레인을 다음 주에도 유지한다',()=>{
    const weeks=monthTaskWeeks([task(1,'2026-09-01','2026-09-18'),task(2,'2026-09-03','2026-09-15')],days);
    expect(weeks[0].laneCount).toBe(2);expect(weeks[1].laneCount).toBe(2);
    expect(weeks[0].segments.find(item=>item.task.id===1)?.lane).toBe(weeks[1].segments.find(item=>item.task.id===1)?.lane);
    expect(weeks[0].segments.find(item=>item.task.id===2)?.lane).toBe(weeks[1].segments.find(item=>item.task.id===2)?.lane);
  });

  it('앞 주의 낮은 레인이 끝나면 이어지는 업무를 위로 당겨 빈 레인을 남기지 않는다',()=>{
    const weeks=monthTaskWeeks([task(1,'2026-08-30','2026-09-05'),task(2,'2026-08-31','2026-09-05'),task(3,'2026-09-03','2026-09-12')],days);
    expect(weeks[0].segments.find(item=>item.task.id===3)?.lane).toBe(2);
    expect(weeks[1].segments.find(item=>item.task.id===3)?.lane).toBe(0);expect(weeks[1].laneCount).toBe(1);
  });

  it('업무명과 담당자, 프로젝트, 상태를 한 리본에 표시한다',()=>{
    const employee={id:7,name:'한눈 담당자',department:'개발',departmentId:1,projectIds:[3],role:'member',active:true,shared:false,access:true,isAdmin:false};
    const boot:Bootstrap={me:employee,csrfToken:'x',demo:false,employees:[employee],departments:[{id:1,name:'개발',archived:false}],leads:[],projects:[{id:3,name:'달력 프로젝트',color:'#5563d8',archived:false,version:1}]};
    const item=task(1,'2026-09-07','2026-09-11','가로로 이어지는 업무'),tasks:TaskList={items:[item],total:1,editableIds:[],commentCounts:[],attachmentCounts:[]};
    const html=renderToStaticMarkup(<MonthCalendar month="2026-09-01" boot={boot} tasks={tasks} milestones={[]} absences={{items:[],available:true,updatedAt:null}} open={()=>{}} create={()=>{}} detailed={false}/>);
    expect(html.match(/class="cw-button month-task progress"/g)).toHaveLength(1);
    expect(html).toContain('grid-column:2 / 7');expect(html).toContain('가로로 이어지는 업무');expect(html).toContain('한눈 담당자');expect(html).toContain('달력 프로젝트');expect(html).toContain('진행');
  });

  it('월간 주요 일정은 각 마감일 메모를 제목으로 표시한다',()=>{
    const employee={id:7,name:'담당자',department:'개발',departmentId:1,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
    const boot:Bootstrap={me:employee,csrfToken:'x',demo:false,employees:[employee],departments:[],leads:[],projects:[]};
    const tasks:TaskList={items:[],total:0,editableIds:[],commentCounts:[],attachmentCounts:[]};
    const milestones=[{id:1,title:'신캐릭터&신스킨',description:'',deadlineMemo:'신스킨 마감',date:'2026-09-02',type:'update' as const,additionalSchedules:[{type:'review' as const,date:'2026-09-15',memo:'신캐릭터 마감'}],projectId:null,version:1}];
    const html=renderToStaticMarkup(<MonthCalendar month="2026-09-01" boot={boot} tasks={tasks} milestones={milestones} absences={{items:[],available:true,updatedAt:null}} open={()=>{}} create={()=>{}} detailed={false}/>);
    expect(html).toContain('업데이트 · 신스킨 마감');expect(html).toContain('검수 · 신캐릭터 마감');expect(html).toContain('주요 일정: 신캐릭터&amp;신스킨');
  });
});

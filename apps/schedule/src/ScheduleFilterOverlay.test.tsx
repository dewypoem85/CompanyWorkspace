import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {ScheduleFilterOverlay} from './ScheduleFilterOverlay';
import type {Bootstrap} from './types';

const employee={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[1],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
const boot:Bootstrap={me:employee,employees:[employee],departments:[{id:1,name:'개발',archived:false}],projects:[{id:1,name:'프로젝트',color:'#3874c9',archived:false,version:1}],goals:[],leads:[],csrfToken:'test',demo:false};
const props={open:true,close:vi.fn(),boot,mineSchedule:false,fullTimeline:true,view:'week' as const,department:'',setDepartment:vi.fn(),project:'mine',setProject:vi.fn(),person:'',setPerson:vi.fn(),goal:'',setGoal:vi.fn(),weekend:false,setWeekend:vi.fn(),groupByEmployee:false,setGroupByEmployee:vi.fn(),onlyWeek:false,setOnlyWeek:vi.fn(),weeks:1 as const,setWeeks:vi.fn(),density:'compact' as const,setDensity:vi.fn(),rowHeight:44,setRowHeight:vi.fn(),timelineFixedWeek:false,setTimelineFixedWeek:vi.fn(),projectColumnWidth:132,setProjectColumnWidth:vi.fn(),taskColumnWidth:280,setTaskColumnWidth:vi.fn(),statusColors:{planned:'#b98552',progress:'#4d7ed0',done:'#4f8b70'},setStatusColor:vi.fn(),statusTextColors:{planned:'#ffffff',progress:'#ffffff',done:'#ffffff'},setStatusTextColor:vi.fn()};

describe('일정 설정',()=>{
  it('전체 일정의 직원별 묶기를 주말 표시와 같은 토글 영역에 놓는다',()=>{
    const html=renderToStaticMarkup(<ScheduleFilterOverlay {...props}/>);
    expect(html).toContain('주말 표시');expect(html).toContain('직원별로 묶기');expect(html).toContain('1주만 보기 고정');expect(html).toContain('프로젝트 칸 너비');expect(html).toContain('업무·담당자 칸 너비');expect(html).toContain('상태별 일정 바 색상');expect(html).toContain('진행중 일정 바 배경색');expect(html).toContain('진행중 일정 바 글자색');expect(html).toContain('role="switch"');
  });
  it('일반 주간 일정에는 전체 일정용 묶기 토글을 노출하지 않는다',()=>{
    const html=renderToStaticMarkup(<ScheduleFilterOverlay {...props} fullTimeline={false}/>);
    expect(html).not.toContain('직원별로 묶기');expect(html).not.toContain('1주만 보기 고정');expect(html).not.toContain('상태별 일정 바 색상');
  });
});

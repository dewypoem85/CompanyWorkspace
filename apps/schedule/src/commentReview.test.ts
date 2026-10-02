import {describe,it,expect} from 'vitest';
import {applyCommentReview,commentReviewItem,commentSnapshot,commentValues,currentComment,type CommentDraft} from './commentReview';
import type {Attachment,Comment,Detail,Employee} from './types';
const comment:Comment={id:7,taskId:101,authorId:1,parentId:null,body:'@[같은 이름](2) 9007199254740993',deleted:false,version:1,createdAt:'',editedAt:null};
const me={id:1,role:'admin',isAdmin:true,active:true,access:true,shared:false} as Employee;
const image:Attachment={id:'original',taskId:101,commentId:7,name:'원본.png',size:1,contentType:'image/png'};
const snapshot=()=>commentSnapshot({...comment},[{...image}]);
const detail=():Detail=>({task:{id:101,title:'업무',body:'',assigneeId:2,createdBy:2,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'',updatedAt:''},canEdit:false,comments:[{...comment}],attachments:[{...image}],history:[]});
describe('댓글 공통 변경 비교',()=>{
  it('업무 편집 권한과 별개로 작성자 댓글을 검토하고 멘션/큰 정수를 보존한다',()=>{
    const before=snapshot(),draft={...snapshot(),body:comment.body+' 내 수정'},current=currentComment(detail(),before,me);current.version=2;
    expect(commentReviewItem(before,draft,current).fields[0].draft[0]).toBe(draft.body);
    const merged=applyCommentReview({id:'7',fields:commentValues(draft)},before,draft,current);
    expect(merged.body).toBe('@[같은 이름](2) 9007199254740993 내 수정');expect(merged.version).toBe(2);expect(before.version).toBe(1);
  });
  it('삭제/보관/작성자 변경/공용/접근권한 상실/이전 버전을 거부한다',()=>{
    const before=snapshot();
    for(const changed of [ {...comment,deleted:true},{...comment,authorId:2},{...comment,taskId:102},{...comment,parentId:4},{...comment,version:0}])expect(()=>currentComment({...detail(),comments:[changed]},before,me)).toThrow();
    expect(()=>currentComment({...detail(),task:{...detail().task,archived:true}},before,me)).toThrow(/보관/);
    expect(()=>currentComment(detail(),before,{...me,shared:true})).toThrow(/권한/);
    expect(()=>currentComment(detail(),before,{...me,id:2})).toThrow(/작성자/);
    expect(()=>currentComment({...detail(),comments:[]},before,me)).toThrow(/찾을 수/);
    expect(()=>currentComment(detail(),{...before,version:2},me)).toThrow(/이전 버전/);
  });
  it('첨부 삭제와 본문 변경의 잘못된 조합을 거부하고 새 업로드는 유지한다',()=>{
    const before=snapshot(),draft:CommentDraft={...snapshot(),body:'',images:[]},current={...snapshot(),images:[{...image,id:'remote'}],version:2};
    const selected={id:'7',fields:commentValues(draft)};
    expect(()=>applyCommentReview(selected,before,draft,current)).toThrow(/댓글 또는 이미지/);
    selected.fields.attachmentIds=['remote'];expect(applyCommentReview(selected,before,draft,current).images[0].id).toBe('remote');
    draft.body='내 본문';draft.images=[image];selected.fields=commentValues(draft);expect(()=>applyCommentReview(selected,before,draft,current)).toThrow(/제거된 첨부/);
    draft.images=[{...image,id:'upload',taskId:null,commentId:null}];selected.fields=commentValues(draft);expect(applyCommentReview(selected,before,draft,current).images[0].id).toBe('upload');
  });
  it('미확인 값과 불완전한 값/응답을 거부한다',()=>{
    const before=snapshot(),draft=snapshot(),current=snapshot();
    expect(()=>applyCommentReview({id:'8',fields:commentValues(draft)},before,draft,current)).toThrow(/원래 댓글/);
    expect(()=>applyCommentReview({id:'7',fields:{body:['위조'],attachmentIds:[]}},before,draft,current)).toThrow(/확인하지 않은/);
    expect(()=>commentSnapshot({...comment,id:Number.MAX_SAFE_INTEGER+1},[])).toThrow(/식별자/);
    expect(()=>commentSnapshot({...comment,body:undefined} as unknown as Comment,[])).toThrow(/확인 정보/);
  });
});

// Only extract an ID; never fetch a URL pasted by the user.
export function spreadsheetIdFromInput(input:string):string|undefined{
  const value=input.trim();
  if(!value)return undefined;
  if(/^[a-zA-Z0-9_-]+$/.test(value))return value;
  try{
    const url=new URL(value);
    if(url.protocol==='https:'&&url.hostname==='docs.google.com'&&!url.port&&!url.username&&!url.password){
      const match=url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/(?:edit|view|preview|copy))?\/?$/);
      if(match)return match[1];
    }
  }catch{/* Show the same actionable message for malformed URLs and IDs. */}
  throw new Error('Google 시트 주소 전체 또는 문서 ID를 입력하세요. 주소의 /d/ 다음부터 /edit 앞까지가 문서 ID입니다.');
}

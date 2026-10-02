type Context = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };
export function registerScheduleTools(open: (id: number) => Promise<void>, context = (document as Document & { modelContext?: Context }).modelContext) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  void Promise.resolve(context.registerTool({ name: 'open_schedule_task', title: '업무 게시글 열기', description: 'ID로 업무 게시글과 토론을 엽니다. 업무 내용을 수정하지 않습니다.', inputSchema: { type: 'object', properties: { taskId: { type: 'integer', minimum: 1 } }, required: ['taskId'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async input => {
    const id = (input as { taskId?: unknown } | null)?.taskId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('올바른 업무 ID를 입력해 주세요.');
    await open(id); return { taskId: id, opened: true };
  } }, { signal: lifecycle.signal })).catch(() => {});
  return () => lifecycle.abort();
}

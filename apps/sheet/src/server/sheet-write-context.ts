export type SheetWriteContext = {
  actorId: string;
  requestedWith: string | undefined;
  requestedActor: string | undefined;
  requestedState: string | undefined;
  expectedState: string;
};

export function validateSheetWriteContext(value: SheetWriteContext): 'ok' | 'denied' | 'conflict' {
  if (!value.actorId || value.requestedWith !== 'XMLHttpRequest' || value.requestedActor !== value.actorId) return 'denied';
  if (!value.expectedState || value.requestedState !== value.expectedState) return 'conflict';
  return 'ok';
}

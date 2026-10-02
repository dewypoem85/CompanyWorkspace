import {useLayoutEffect, useRef, type RefObject} from 'react';

type Reason = 'request' | 'cancel' | 'close' | 'scope' | 'abort' | 'parent';
type Options = {
  scope: 'retain' | 'dismiss';
  canClose?: (reason: Reason) => boolean;
  beforeCloseRequest?: (context: {reason: Reason; signal: AbortSignal}) => Promise<(() => boolean) | null>;
  onClose: (reason: Reason) => void;
  returnFocus?: RefObject<HTMLElement | null>;
};
type Controller = {requestClose: () => boolean; requestCloseAsync: () => Promise<boolean>; dispose: () => void};

// React owns mounting and content. The shared runtime alone owns native modal
// state, nested cancellation, scope lifetime and return focus. Never render `open`.
export function useWorkspaceModal(root: RefObject<HTMLDialogElement | null>, options: Options) {
  const latest = useRef(options); latest.current = options;
  const binding = useRef<{node: HTMLDialogElement; controller: Controller} | null>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (binding.current?.node === node) return;
    binding.current?.controller.dispose(); binding.current = null;
    if (!node) return;
    const shared = (window as unknown as {CompanyDialog?: {attach: (node: HTMLDialogElement, options: object) => Controller}}).CompanyDialog;
    if (!shared) throw Error('공통 창을 불러오지 못했습니다. 페이지를 다시 열어 주세요.');
    binding.current = {node, controller: shared.attach(node, {
      scope: options.scope,
      returnFocus: options.returnFocus?.current,
      canClose: (reason: Reason) => latest.current.canClose?.(reason) ?? true,
      ...(options.beforeCloseRequest ? {beforeCloseRequest: (context: {reason: Reason; signal: AbortSignal}) => latest.current.beforeCloseRequest?.(context) ?? Promise.resolve(null)} : {}),
      onClose: (reason: Reason) => latest.current.onClose(reason),
    })};
  });
  useLayoutEffect(() => () => {binding.current?.controller.dispose(); binding.current = null;}, []);
  return {close: () => latest.current.beforeCloseRequest
    ? binding.current?.controller.requestCloseAsync() ?? Promise.resolve(false)
    : binding.current?.controller.requestClose() ?? false};
}

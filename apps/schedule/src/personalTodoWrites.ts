import {confirmTodoResult, requireTodoActor, todoActorScope, validateTodo, validateTodoList, type TodoCommand} from './personalTodoContract';
import type {Bootstrap, PersonalTodo} from './types';

export type TodoEditing = {actorId: string; stateToken: string; todos: PersonalTodo[]};
export type TodoWrite = {
  command: TodoCommand;
  actorId: string;
  actorScope: string;
  stateToken: string;
  before: PersonalTodo[];
  body: unknown;
};
export type TodoReceipt = {
  operation: TodoCommand['kind'];
  actorId: string;
  previousStateToken: string;
  stateToken: string;
  todo: PersonalTodo | null;
  todos: PersonalTodo[] | null;
  deleted: boolean;
};

const token = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireValue = (value: unknown, message = 'TODO 저장 확인 정보가 올바르지 않습니다. 최신 목록을 다시 확인해 주세요.') => { if (!value) throw Error(message); };
const fullSignature = (item: PersonalTodo) => JSON.stringify([item.id, item.ownerId, item.title, item.sortOrder, item.version, item.completedAt, item.createdAt, item.updatedAt]);
const listSignature = (items: PersonalTodo[]) => JSON.stringify(items.map(fullSignature));

export function todoEditingResponse(value: unknown, ownerId: number, expectedId?: number): TodoEditing {
  const editing = value as TodoEditing;
  requireValue(editing && editing.actorId === String(ownerId) && token(editing.stateToken));
  const todos = validateTodoList(editing.todos, ownerId);
  if (expectedId !== undefined) requireValue(todos.length === 1 && todos[0].id === expectedId);
  return {...editing, todos};
}

export function todoWriteBody(command: TodoCommand): unknown {
  if (command.kind === 'add') return {title: command.title};
  if (command.kind === 'save') return {title: command.title, version: command.item.version};
  if (command.kind === 'complete') return {completed: command.completed, version: command.item.version};
  if (command.kind === 'order') return {ids: [...command.ids], archived: command.archived};
  return {version: command.item.version};
}

export function captureTodoWrite(command: TodoCommand, boot: Bootstrap, displayed: PersonalTodo[], editing: TodoEditing): TodoWrite {
  requireTodoActor(boot.me);
  const actorId = String(boot.me.id);
  requireValue(editing.actorId === actorId && token(editing.stateToken));
  const before = validateTodoList(displayed, boot.me.id);
  if (command.kind === 'add') {
    requireValue(command.title.trim() === command.title && command.title.length > 0 && command.title.length <= 500);
    requireValue(listSignature(editing.todos) === listSignature(before), 'TODO 목록이 변경되었습니다. 최신 내용을 확인해 주세요.');
  } else if (command.kind === 'order') {
    requireValue(new Set(command.ids).size === command.ids.length && command.ids.length === before.length);
    requireValue(listSignature(editing.todos) === listSignature(before), 'TODO 목록이 변경되었습니다. 최신 내용을 확인해 주세요.');
    requireValue(command.ids.every(id => before.some(item => item.id === id)));
  } else {
    const current = before.find(item => item.id === command.item.id);
    requireValue(current && fullSignature(current) === fullSignature(command.item), 'TODO 내용이 변경되었습니다. 최신 내용을 확인해 주세요.');
    requireValue(editing.todos.length === 1 && fullSignature(editing.todos[0]) === fullSignature(command.item), 'TODO 내용이 변경되었습니다. 최신 내용을 확인해 주세요.');
    if (command.kind === 'save') requireValue(command.title.trim() === command.title && command.title.length > 0 && command.title.length <= 500);
  }
  return {command: structuredClone(command), actorId, actorScope: todoActorScope(boot.me), stateToken: editing.stateToken, before: structuredClone(before), body: todoWriteBody(command)};
}

export function confirmTodoReceipt(value: unknown, write: TodoWrite, sent: unknown): TodoReceipt {
  const receipt = value as TodoReceipt;
  requireValue(receipt && receipt.operation === write.command.kind && receipt.actorId === write.actorId
    && receipt.previousStateToken === write.stateToken && token(receipt.stateToken) && receipt.stateToken !== write.stateToken
    && JSON.stringify(sent) === JSON.stringify(write.body));
  const ownerId = Number(write.actorId);
  if (write.command.kind === 'delete') {
    const todo = validateTodo(receipt.todo, ownerId);
    const todos = validateTodoList(receipt.todos, ownerId);
    requireValue(receipt.deleted && fullSignature(todo) === fullSignature(write.command.item));
    requireValue(!todos.some(item => item.id === todo.id));
    requireValue(JSON.stringify(todos.map(item => item.id)) === JSON.stringify(write.before.filter(item => item.id !== todo.id).map(item => item.id)));
    return {...receipt, todo, todos};
  }
  if (write.command.kind === 'order') {
    const todos = validateTodoList(receipt.todos, ownerId);
    requireValue(receipt.todo === null && !receipt.deleted && JSON.stringify(todos.map(item => item.id)) === JSON.stringify(write.command.ids));
    requireValue(todos.every((item, index) => item.sortOrder === index + 1));
    return {...receipt, todos};
  }
  const todo = confirmTodoResult(receipt.todo, write.command, ownerId)!;
  requireValue(receipt.todos === null && !receipt.deleted);
  return {...receipt, todo};
}

export function todoWriteResource(command: TodoCommand, items: PersonalTodo[], actorId: number, archived: boolean) {
  if ('item' in command) return `todo:${actorId}:${command.item.id}:${command.item.version}`;
  return `todo-list:${actorId}:${archived}:${listSignature(items)}`;
}

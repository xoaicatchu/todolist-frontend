export type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TodoItem {
  id: string;
  title: string;
  priority: TodoPriority;
  dayKey: string; // yyyy-MM-dd
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export type TodoEventType = 'TODO_CREATED' | 'TODO_TOGGLED' | 'TODO_RENAMED' | 'TODO_DELETED' | 'TODO_UPSERTED_FROM_SERVER';

export interface TodoEvent {
  eventId: string;
  type: TodoEventType;
  todoId: string;
  payload?: any;
  createdAt: number;
  synced: 0 | 1;
}

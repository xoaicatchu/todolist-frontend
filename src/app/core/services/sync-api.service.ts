import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TodoEvent, TodoItem } from '../models/todo.model';

export type SyncMode = 'v1' | 'v2';

export interface ChangeEnvelope {
  changeId?: number;
  entityType?: string;
  entityId?: string;
  op?: 'upsert' | 'delete' | string;
  payload?: unknown;
}

export interface V2PullResponse {
  changes?: ChangeEnvelope[];
  todos?: TodoItem[];
  lastChangeId?: string;
  serverWatermark?: string;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface PullResult {
  mode: SyncMode;
  todos: TodoItem[];
  serverTime: number;
  serverWatermark: number | string;
  nextCursor?: string | null;
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class SyncApiService {
  private v2Url = '/api/v2/sync';

  constructor(private http: HttpClient) {}

  pushEvents(events: TodoEvent[]): Promise<{ acceptedEventIds: string[] }> {
    return firstValueFrom(this.http.post<{ acceptedEventIds: string[] }>(`${this.v2Url}/push`, { events }));
  }

  async pullIncremental(opts: {
    sinceChangeId: number | string;
    lastSyncAt: number;
    limit: number;
    cursor?: string;
  }): Promise<PullResult> {
    const v2 = await this.pullV2(String(opts.sinceChangeId), opts.limit, opts.cursor);
    return {
      mode: 'v2',
      todos: v2.todos && v2.todos.length > 0 ? v2.todos : this.extractTodosFromChanges(v2.changes ?? []),
      serverTime: Date.now(),
      serverWatermark: v2.serverWatermark ?? v2.lastChangeId ?? opts.sinceChangeId,
      nextCursor: v2.nextCursor ?? null,
      hasMore: Boolean(v2.hasMore) || Boolean(v2.nextCursor),
    };
  }

  private pullV2(sinceChangeId: string, limit: number, cursor?: string): Promise<V2PullResponse> {
    let params = new HttpParams().set('limit', String(limit));

    // Only send sinceChangeId if it looks like a valid UUID (not '0' or a numeric timestamp)
    const isValidGuid = sinceChangeId && /^[0-9a-f]{8}-/i.test(sinceChangeId);
    if (isValidGuid) {
      params = params.set('sinceChangeId', sinceChangeId);
    }

    if (cursor) params = params.set('cursor', cursor);

    return firstValueFrom(this.http.get<V2PullResponse>(`${this.v2Url}/pull`, { params }));
  }

  private extractTodosFromChanges(changes: ChangeEnvelope[]): TodoItem[] {
    const result: TodoItem[] = [];

    for (const c of changes) {
      const entityType = (c.entityType ?? 'todo').toLowerCase();
      if (entityType !== 'todo') continue;

      if ((c.op ?? '').toLowerCase() === 'delete') {
        if (c.entityId) {
          result.push({
            id: c.entityId,
            title: '',
            completed: false,
            priority: 'MEDIUM',
            dayKey: new Date().toISOString().slice(0, 10),
            sortOrder: 0,
            deleted: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
        continue;
      }

      const payload = c.payload as Partial<TodoItem> | undefined;
      if (!payload?.id && !c.entityId) continue;

      result.push({
        id: payload?.id ?? c.entityId!,
        title: payload?.title ?? '',
        completed: Boolean(payload?.completed),
        priority: payload?.priority ?? 'MEDIUM',
        dayKey: payload?.dayKey ?? new Date().toISOString().slice(0, 10),
        sortOrder: payload?.sortOrder ?? 0,
        deleted: Boolean(payload?.deleted),
        createdAt: payload?.createdAt ?? payload?.updatedAt ?? Date.now(),
        updatedAt: payload?.updatedAt ?? Date.now(),
      });
    }

    return result;
  }
}

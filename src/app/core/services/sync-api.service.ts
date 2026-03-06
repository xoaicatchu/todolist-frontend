import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TodoEvent, TodoItem } from '../models/todo.model';

@Injectable({ providedIn: 'root' })
export class SyncApiService {
  private baseUrl = 'http://localhost:3000/api/sync';

  constructor(private http: HttpClient) {}

  pushEvents(events: TodoEvent[]): Promise<{ acceptedEventIds: string[] }> {
    return firstValueFrom(this.http.post<{ acceptedEventIds: string[] }>(`${this.baseUrl}/push`, { events }));
  }

  pullTodos(since: number): Promise<{ todos: TodoItem[]; serverTime: number }> {
    return firstValueFrom(this.http.get<{ todos: TodoItem[]; serverTime: number }>(`${this.baseUrl}/pull?since=${since}`));
  }
}

import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TodoActions } from '../../state/todo.actions';

@Injectable({ providedIn: 'root' })
export class TabRealtimeService {
  private channel: BroadcastChannel | null = null;

  constructor(private store: Store) {
    // 1) BroadcastChannel cho multi-tab realtime
    try {
      this.channel = new BroadcastChannel('todo-sync-channel');
      this.channel.onmessage = () => this.store.dispatch(TodoActions.load());
    } catch {
      this.channel = null;
    }

    // 2) storage event fallback (và backup khi BroadcastChannel bị chặn)
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === 'todo-sync-ping' && e.newValue) {
        this.store.dispatch(TodoActions.load());
      }
    });
  }

  notifyChanged() {
    const stamp = Date.now();
    if (this.channel) {
      this.channel.postMessage({ type: 'TODO_CHANGED', stamp });
    }
    localStorage.setItem('todo-sync-ping', String(stamp));
  }
}

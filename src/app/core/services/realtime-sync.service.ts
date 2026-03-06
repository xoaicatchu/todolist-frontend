import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Store } from '@ngrx/store';
import { SyncService } from './sync.service';
import { TodoActions } from '../../state/todo.actions';

@Injectable({ providedIn: 'root' })
export class RealtimeSyncService {
  private connection?: signalR.HubConnection;
  private started = false;
  private retryTimer: any;

  constructor(private sync: SyncService, private store: Store) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.ensureConnected();
  }

  private async ensureConnected() {
    if (!this.connection) {
      this.connection = new signalR.HubConnectionBuilder()
        .withUrl('http://localhost:3000/hubs/sync')
        .withAutomaticReconnect([0, 1000, 3000, 5000])
        .build();

      this.connection.on('todosChanged', async () => {
        // refresh local state ngay cả khi sync call fail
        this.store.dispatch(TodoActions.load());
        await this.sync.sync();
      });

      this.connection.onreconnected(async () => {
        this.store.dispatch(TodoActions.load());
        await this.sync.sync();
      });

      this.connection.onclose(() => {
        this.scheduleRetry();
      });
    }

    if (this.connection.state === signalR.HubConnectionState.Connected ||
        this.connection.state === signalR.HubConnectionState.Connecting) {
      return;
    }

    try {
      await this.connection.start();
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      // vừa kết nối thì sync + reload luôn
      this.store.dispatch(TodoActions.load());
      await this.sync.sync();
    } catch {
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureConnected();
    }, 5000);
  }
}

import { Component, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, combineLatest, map, shareReplay } from 'rxjs';
import { Store } from '@ngrx/store';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TodoActions } from './state/todo.actions';
import { selectTodos } from './state/todo.selectors';
import { NetworkService } from './core/services/network.service';
import { RealtimeSyncService } from './core/services/realtime-sync.service';
import { EventSourcingService } from './core/services/event-sourcing.service';
import { TabRealtimeService } from './core/services/tab-realtime.service';
import { TodoItem, TodoPriority } from './core/models/todo.model';

type CalendarCell = { date: Date; dayKey: string; inMonth: boolean; count: number };

@Component({
  selector: 'app-root',
  imports: [AsyncPipe, NgFor, NgIf, FormsModule, DatePipe, DragDropModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private store = inject(Store);
  private network = inject(NetworkService);
  private realtime = inject(RealtimeSyncService);
  private eventSourcing = inject(EventSourcingService);
  private _tabRealtime = inject(TabRealtimeService);

  title = signal('Todo List Demo');
  newTitle = '';
  newPriority: TodoPriority = 'MEDIUM';

  editingId: string | null = null;
  editingTitle = '';
  editingPriority: TodoPriority = 'MEDIUM';

  readonly priorities: TodoPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
  readonly weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  private selectedDateSubject = new BehaviorSubject<Date>(new Date());
  private viewDateSubject = new BehaviorSubject<Date>(new Date());

  selectedDate$ = this.selectedDateSubject.asObservable();
  viewDate$ = this.viewDateSubject.asObservable();

  // Use ngrx store as single source of truth for UI rendering.
  // Both local changes (via effects) and server sync (via TodoActions.load())
  // flow through the store, ensuring reliable UI updates across tabs.
  todos$ = this.store.select(selectTodos).pipe(
    map(items => items.filter(x => !!x.dayKey)),
    shareReplay(1)
  );

  selectedDayKey$ = this.selectedDate$.pipe(map(d => this.toDayKey(d)), shareReplay(1));

  todoCountByDay$ = this.todos$.pipe(
    map(items => {
      const m: Record<string, number> = {};
      for (const t of items) m[t.dayKey] = (m[t.dayKey] || 0) + 1;
      return m;
    }),
    shareReplay(1)
  );

  filteredTodos$ = combineLatest([this.todos$, this.selectedDayKey$]).pipe(
    map(([items, dayKey]) => items.filter(x => x.dayKey === dayKey)),
    map(items => [...items].sort((a, b) => {
      const ao = a.sortOrder ?? 1;
      const bo = b.sortOrder ?? 1;
      if (ao !== bo) return ao - bo;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    })),
    shareReplay(1)
  );

  calendarCells$ = combineLatest([this.viewDate$, this.todoCountByDay$]).pipe(
    map(([viewDate, countMap]) => this.buildCalendar(viewDate, countMap)),
    shareReplay(1)
  );

  constructor() {
    this.store.dispatch(TodoActions.load());
    this.realtime.start();
  }

  isOnline() { return this.network.online(); }

  addTodo() {
    const title = this.newTitle.trim();
    if (!title) return;
    const dayKey = this.toDayKey(this.selectedDateSubject.value);
    this.store.dispatch(TodoActions.add({ title, priority: this.newPriority, dayKey }));
    this.newTitle = '';
    this.newPriority = 'MEDIUM';
  }

  toggle(id: string) { this.store.dispatch(TodoActions.toggle({ id })); }

  beginEdit(todo: TodoItem) {
    this.editingId = todo.id;
    this.editingTitle = todo.title;
    this.editingPriority = todo.priority;
  }

  cancelEdit() {
    this.editingId = null;
    this.editingTitle = '';
    this.editingPriority = 'MEDIUM';
  }

  saveEdit(id: string) {
    const title = this.editingTitle.trim();
    if (!title) return;
    this.store.dispatch(TodoActions.rename({ id, title, priority: this.editingPriority }));
    this.cancelEdit();
  }

  delete(id: string) { this.store.dispatch(TodoActions.delete({ id })); }

  quickCyclePriority(todo: TodoItem) {
    const order: TodoPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
    const idx = order.indexOf(todo.priority);
    const next = order[(idx + 1) % order.length] ?? 'MEDIUM';
    this.store.dispatch(TodoActions.rename({ id: todo.id, priority: next }));
  }

  reorderTasks(event: CdkDragDrop<TodoItem[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const arr = [...event.container.data];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    const dayKey = this.toDayKey(this.selectedDateSubject.value);
    this.store.dispatch(TodoActions.reorder({ dayKey, orderedIds: arr.map(x => x.id) }));
  }

  priorityClass(p: TodoPriority) { return p.toLowerCase(); }

  prevMonth() {
    const v = this.viewDateSubject.value;
    this.viewDateSubject.next(new Date(v.getFullYear(), v.getMonth() - 1, 1));
  }

  nextMonth() {
    const v = this.viewDateSubject.value;
    this.viewDateSubject.next(new Date(v.getFullYear(), v.getMonth() + 1, 1));
  }

  selectDay(d: Date) {
    const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    this.selectedDateSubject.next(nd);
    if (d.getMonth() !== this.viewDateSubject.value.getMonth() || d.getFullYear() !== this.viewDateSubject.value.getFullYear()) {
      this.viewDateSubject.next(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }

  isToday(d: Date) {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  isSelected(dayKey: string, selectedDayKey: string) {
    return dayKey === selectedDayKey;
  }

  trackByTodo = (_: number, t: TodoItem) => t.id;
  trackByCell = (_: number, c: CalendarCell) => c.dayKey;

  private buildCalendar(viewDate: Date, countMap: Record<string, number>): CalendarCell[] {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);

    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = last.getDate();

    const cells: CalendarCell[] = [];

    for (let i = 0; i < startOffset; i++) {
      const d = new Date(y, m, 1 - (startOffset - i));
      const k = this.toDayKey(d);
      cells.push({ date: d, dayKey: k, inMonth: false, count: countMap[k] || 0 });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const k = this.toDayKey(date);
      cells.push({ date, dayKey: k, inMonth: true, count: countMap[k] || 0 });
    }

    while (cells.length < 42) {
      const nextDay = cells.length - (startOffset + daysInMonth) + 1;
      const date = new Date(y, m + 1, nextDay);
      const k = this.toDayKey(date);
      cells.push({ date, dayKey: k, inMonth: false, count: countMap[k] || 0 });
    }

    return cells;
  }

  private toDayKey(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}















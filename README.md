# Todolist Frontend

Ứng dụng Todo theo hướng **offline-first**, đồng bộ realtime giữa nhiều trình duyệt/thiết bị.

## 1) Tech stack

### Frontend
- **Angular 21** (standalone components)
- **TypeScript 5.9**
- **NgRx** (`@ngrx/store`, `@ngrx/effects`) cho luồng action/effect
- **RxJS** cho stream dữ liệu UI/sync
- **Dexie (IndexedDB)** cho local database (offline-first)
- **Angular CDK DragDrop** cho kéo-thả sắp xếp task
- **SignalR client** (`@microsoft/signalr`) cho realtime sync event
- **Angular Service Worker (PWA)** cho offline cache

### Backend (repo riêng)
- **ASP.NET Core** (Minimal API)
- **SignalR Hub**
- Event store in-memory + persist file (`App_Data/state.json`)

## 2) Kiến trúc đồng bộ (rút gọn)

- Mọi thao tác tạo/sửa/xóa/reorder được ghi thành **event** vào local DB trước.
- `SyncService` định kỳ push event chưa sync lên backend và pull thay đổi mới.
- `RealtimeSyncService` nhận tín hiệu `todosChanged` để sync nền.
- UI đọc từ local IndexedDB qua `liveQuery` nên vẫn dùng được khi offline.

## 3) Cấu trúc chính

- `src/app/core/services/event-sourcing.service.ts`: append/apply event + apply dữ liệu server
- `src/app/core/services/sync.service.ts`: push/pull đồng bộ
- `src/app/core/services/realtime-sync.service.ts`: SignalR reconnect + trigger sync
- `src/app/infrastructure/db/app-db.service.ts`: schema IndexedDB
- `src/app/state/*`: NgRx actions/effects

## 4) Chạy local (dev)

### Yêu cầu
- Node.js 20+
- npm 10+

### Cài dependencies
```bash
npm install
```

### Chạy frontend
```bash
npm run start
```

Mặc định app chạy ở `http://localhost:4300`.

> `npm run start` đã cấu hình proxy (`proxy.conf.json`) để gọi backend qua cùng origin:
> - `/api/*` -> `http://localhost:3000`
> - `/hubs/*` -> `http://localhost:3000`

### Build production
```bash
npm run build
```

Output: `dist/todolist/`

## 5) Triển khai khuyến nghị (production)

### Không khuyến nghị
- Dùng `ng serve` trực tiếp cho môi trường thật (dễ lỗi ws/proxy trên mobile).

### Khuyến nghị
- Serve static từ `dist/todolist/browser`
- Reverse proxy cùng domain cho:
  - `/api/*` -> backend
  - `/hubs/*` -> backend
- Bật HTTPS

Lợi ích:
- ổn định hơn trên iPhone/Safari
- SW/PWA hoạt động đúng kiểu production
- tránh hardcode `localhost`

## 6) Biến môi trường / endpoint

Frontend đang dùng endpoint relative:
- Sync API: `/api/sync`
- SignalR Hub: `/hubs/sync`

=> thuận tiện cho reverse proxy và ngrok.

## 7) Scripts

```bash
npm run start   # ng serve (port 4300 + proxy)
npm run build   # production build
npm run watch   # build watch
npm run test    # unit test
```

## 8) Ghi chú vận hành

- Khi offline: thao tác vẫn lưu local.
- Khi online lại: app tự sync nền.
- Nếu có xung đột giữa tab/thiết bị, ưu tiên event merge theo payload field (tuỳ loại event).


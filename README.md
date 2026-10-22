# Đề 31: Hệ thống thư viện ảnh

**Sinh viên:** Lê Quốc Bình - DTC245220030 - ATTTK23<br>
**Giảng viên:** Nguyễn Anh Chuyên

## Giới thiệu

Hệ thống thư viện ảnh cho phép đăng ký, đăng nhập, tạo album, tải và phân loại ảnh, chia sẻ album/ảnh và quản lý quyền truy cập. Dự án sử dụng Node.js/Express, MySQL, Nginx reverse proxy HTTPS, Prometheus/Grafana và Loki/Promtail; toàn bộ dịch vụ chạy bằng Docker Compose.

## Chuẩn bị và chạy dự án

Cài Docker Engine và Docker Compose. Từ thư mục gốc dự án chạy:

```sh
cp .env.example .env
./nginx/generate-dev-cert.sh
docker compose up -d --build
docker compose ps
```

Mở Gallery tại `https://localhost:8443`. Các địa chỉ khác: phpMyAdmin `http://localhost:8081`, Prometheus `http://localhost:9090`, Grafana `http://localhost:3001`; mật khẩu Grafana lấy từ `GRAFANA_PASSWORD` trong `.env`.

Dừng hệ thống:

```sh
docker compose down
```

Không commit `.env` và không dùng `docker compose down -v` nếu muốn giữ dữ liệu.

## Loki + Promtail

Promtail đọc Docker container logs và gửi về Loki. Trong Grafana → **Explore**, chọn datasource **Loki** và chạy các truy vấn LogQL:

```logql
{service="app"}
```

```logql
{service="app"} | json | event="http_request"
```

```logql
{service="app"} |~ "upload|share|login|register"
```

Dashboard **Gallery Logs** được provision tự động. Cấu hình nằm trong `logging/`, datasource và dashboard Grafana nằm trong `monitoring/provisioning/`, bằng chứng nằm trong `docs/evidence/`.

## Kiểm tra

```sh
cd app && npm ci && npm test && npm run check
```

Có thể kiểm tra thêm `/health`, `/health/db`, Prometheus Targets và Grafana Explore.

## Hardening

App chạy non-root, filesystem read-only, drop capabilities và `no-new-privileges`. MySQL nằm trong network nội bộ, không publish port ra host; user ứng dụng chỉ có quyền CRUD trên database `gallery`. Nginx dùng HTTPS và security headers.

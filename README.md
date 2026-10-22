# Gallery — Đề tài 31

Website quản lý album ảnh, upload, phân loại và chia sẻ ảnh. Stack triển khai hiện tại gồm Node.js/Express, MySQL, phpMyAdmin và Nginx reverse proxy với HTTPS self-signed cùng security headers cơ bản.

## Thành phần

- `app/`: frontend và backend Node.js/Express
- `db/init/`: schema và dữ liệu khởi tạo MySQL
- `nginx/`: reverse proxy, HTTPS self-signed và security headers
- `compose.yaml`: Docker Compose cho app, MySQL, phpMyAdmin và Nginx

## Khởi chạy

Yêu cầu Docker Engine và Docker Compose plugin.

```sh
cp .env.example .env
# Đổi các mật khẩu trong .env bằng chuỗi ngẫu nhiên mạnh
./nginx/generate-dev-cert.sh
docker compose config
docker compose up -d --build
docker compose ps
```

Truy cập:

- Gallery HTTPS: https://localhost:8443
- Gallery HTTP: http://localhost:8080 (tự chuyển hướng sang HTTPS)
- phpMyAdmin: http://localhost:8081

Certificate là self-signed dùng cho môi trường demo, trình duyệt sẽ hiển thị cảnh báo. MySQL không publish cổng ra host; phpMyAdmin và các cổng web chỉ bind trên localhost theo cấu hình Compose.

Tài khoản quản trị ứng dụng demo: `admin` / `admin`. Hãy đổi thông tin này trước khi sử dụng thực tế.

## Kiểm thử

```sh
cd app
npm ci
npm test
npm run check
```

## Hardening

- App chạy bằng user non-root.
- App và Nginx dùng filesystem read-only khi phù hợp.
- Container app và Nginx drop capabilities.
- Bật `no-new-privileges`.
- Database network là internal và MySQL không expose trực tiếp.
- Mật khẩu chỉ đặt trong `.env`, không commit lên Git.
- Nginx bật TLS 1.2/1.3, redirect HTTP sang HTTPS và các security headers: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy.
- Private key/certificate phát sinh không được theo dõi bởi Git.

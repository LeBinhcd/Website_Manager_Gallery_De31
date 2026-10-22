#!/bin/sh
set -eu
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --default-character-set=utf8mb4 --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS gallery CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'gallery_app'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON gallery.* TO 'gallery_app'@'%';
CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY '$EXPORTER_DB_PASSWORD';
ALTER USER 'exporter'@'%' IDENTIFIED BY '$EXPORTER_DB_PASSWORD';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';

FLUSH PRIVILEGES;

USE gallery;
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  user_code CHAR(4) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO users (username, user_code, password_hash, role)
VALUES ('admin', '0000', 'scrypt:0077a078c6f20298b933b4566721cc6d:200103e80d635f79e59749ffaa5a610d32c57ba13474b081930aa9513deab409bcdcc93d56b3ad07db6a7864ab92ea066765a10f18a9be58b61cdf23d6cf83ab', 'admin')
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin';
CREATE TABLE IF NOT EXISTS albums (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id INT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  visibility ENUM('public','private','link') NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_albums_owner (owner_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS album_shares (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  album_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  role ENUM('viewer','editor') NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_album_share_user (album_id, user_id),
  INDEX idx_album_shares_user (user_id),
  CONSTRAINT fk_album_shares_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_album_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  album_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  visibility ENUM('public','private','link') NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_images_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_images_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_images_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS image_shares (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT UNSIGNED NOT NULL,
  share_token CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shares_image FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS image_user_shares (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_image_user_share (image_id, user_id),
  INDEX idx_image_user_shares_user (user_id),
  CONSTRAINT fk_image_user_shares_image FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  CONSTRAINT fk_image_user_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(128) PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB;

SET @add_owner_sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'albums' AND column_name = 'owner_id') = 0, 'ALTER TABLE albums ADD COLUMN owner_id INT UNSIGNED NULL', 'SELECT 1');
PREPARE add_owner_stmt FROM @add_owner_sql;
EXECUTE add_owner_stmt;
DEALLOCATE PREPARE add_owner_stmt;
SET @add_owner_index_sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'albums' AND index_name = 'idx_albums_owner') = 0, 'ALTER TABLE albums ADD INDEX idx_albums_owner (owner_id)', 'SELECT 1');
PREPARE add_owner_index_stmt FROM @add_owner_index_sql;
EXECUTE add_owner_index_stmt;
DEALLOCATE PREPARE add_owner_index_stmt;
INSERT INTO albums(name, slug, description) SELECT 'Ảnh công khai', 'anh-cong-khai', 'Album mặc định của hệ thống Gallery.' WHERE NOT EXISTS (SELECT 1 FROM albums);
INSERT INTO categories(name, slug) VALUES
  ('Chưa phân loại', 'chua-phan-loai'),
  ('Thiên nhiên', 'thien-nhien'),
  ('Con người', 'con-nguoi'),
  ('Đồ ăn', 'do-an'),
  ('Du lịch', 'du-lich'),
  ('Gia đình', 'gia-dinh'),
  ('Công việc', 'cong-viec'),
  ('Sự kiện', 'su-kien'),
  ('Khác', 'khac')
ON DUPLICATE KEY UPDATE name = VALUES(name);
SQL

CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY '$EXPORTER_DB_PASSWORD';

ALTER USER 'exporter'@'%' IDENTIFIED BY '$EXPORTER_DB_PASSWORD';

GRANT PROCESS, REPLICATION CLIENT, SELECT
ON *.* TO 'exporter'@'%';

FLUSH PRIVILEGES;

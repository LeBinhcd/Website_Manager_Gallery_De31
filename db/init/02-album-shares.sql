-- Ensure image link sharing exists on databases upgraded from earlier versions.
CREATE TABLE IF NOT EXISTS image_shares (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT UNSIGNED NOT NULL,
  share_token CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_image_shares_image FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Keep existing volumes compatible with album sharing.
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



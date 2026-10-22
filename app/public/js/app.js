




const savedTheme = localStorage.getItem('frame-theme');
if (savedTheme !== 'light') document.body.classList.add('night');

const sidebar = document.querySelector('.sidebar');
document.querySelector('.mobile-menu')?.addEventListener('click', () => sidebar?.classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => sidebar?.classList.remove('open')));
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const isNight = document.body.classList.toggle('night');
  localStorage.setItem('frame-theme', isNight ? 'dark' : 'light');
});

const uploadButton = document.querySelector('#upload-button');
const collectionsUploadButton = document.querySelector('#upload-collections-button');
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const allowedImageExtensions = /\.(jpe?g|png|gif|webp)$/i;

function validateSelectedImages(files) {
  return [...files].filter(file => !allowedImageTypes.has(file.type) || !allowedImageExtensions.test(file.name));
}

const authPanel = document.querySelector('#auth-panel');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const loginPanel = document.querySelector('#login-panel');
const registerPanel = document.querySelector('#register-panel');
const authMessage = document.querySelector('#auth-message');
const registerMessage = document.querySelector('#register-message');
const logoutButton = document.querySelector('#logout-button');
const loginButton = document.querySelector('#login-button');
const registerButton = document.querySelector('#register-button');
const usernameInput = document.querySelector('#login-username');
const toast = document.querySelector('#app-toast');
const adminNavLink = document.querySelector('.admin-nav-link');
const adminPage = document.querySelector('#admin-page');
const currentUserTag = document.querySelector('#current-user-tag');
const currentUserRole = document.querySelector('#current-user-role');
const currentUserName = document.querySelector('#current-user-name');
const userAvatars = document.querySelectorAll('.user-avatar');
const storagePercent = document.querySelector('#storage-percent');
const storageProgress = document.querySelector('#storage-progress');
const storageSummary = document.querySelector('#storage-summary');
let activeUserId = null;
let activeUserRole = 'user';

function showToast(message, type = 'info') {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function setButtonLoading(button, loading, label) {
  if (!button) return;
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  const text = button.querySelector('.button-label, .logout-label');
  if (text && label) text.textContent = label;
}

function showAuthPanel(panel) {
  const showRegister = panel === 'register';
  if (loginPanel) loginPanel.hidden = showRegister;
  if (registerPanel) registerPanel.hidden = !showRegister;
  if (showRegister) document.querySelector('#register-username')?.focus();
  else usernameInput?.focus();
}

document.querySelector('#show-register')?.addEventListener('click', () => showAuthPanel('register'));
document.querySelector('#show-login')?.addEventListener('click', () => showAuthPanel('login'));

const uploadDialog = document.querySelector('#upload-dialog');
const uploadAlbum = document.querySelector('#upload-album');
const uploadCategory = document.querySelector('#upload-category');
const uploadSubmit = document.querySelector('#upload-submit');
const uploadCancel = document.querySelector('#upload-cancel');
const uploadCancelAction = document.querySelector('#upload-cancel-action');
const uploadFileSummary = document.querySelector('#upload-file-summary');
const uploadProgress = document.querySelector('#upload-progress');
const uploadCreateAlbum = document.querySelector('#upload-create-album');
let selectedUploadFiles = [];
let categories = [];
async function loadCategories() {
  const response = await fetch('/api/categories');
  if (!response.ok) throw new Error('categories_unavailable');
  categories = (await response.json()).data || [];
  return categories;
}
let returnToUploadAfterAlbumCreation = false;

async function loadUploadAlbums() {
  const response = await fetch('/api/albums');
  if (!response.ok) throw new Error('albums_unavailable');
  const { data = [] } = await response.json();
  const albums = data;
  uploadAlbum.innerHTML = albums.map(album => `<option value="${album.id}">${album.name}</option>`).join('');
  if (!albums.length) throw new Error('no_album');
  await loadCategories();
  uploadCategory.innerHTML = categories.map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
}

function closeUploadDialog() {
  uploadDialog.hidden = true;
  selectedUploadFiles = [];
}

function uploadImages(files, albumId) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append('album_id', albumId);
    form.append('category_id', uploadCategory.value);
    files.forEach(file => form.append('images', file, file.name));
    request.open('POST', '/api/images');
    request.upload.onprogress = event => { if (event.lengthComputable) uploadProgress.textContent = `Đang tải lên ${Math.round(event.loaded / event.total * 100)}%…`; };
    request.onload = () => { let body = {}; try { body = JSON.parse(request.responseText); } catch {} if (request.status >= 200 && request.status < 300) resolve(body); else { const error = new Error(body.message || body.error || 'upload_failed'); error.code = body.error; reject(error); } };
    request.onerror = () => reject(new Error('network_error'));
    request.send(form);
  });
}

function startUpload() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp'; input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    const invalidFiles = validateSelectedImages(files);
    if (invalidFiles.length) return showToast(`File không được phép: ${invalidFiles.map(file => file.name).join(', ')}`, 'error');
    if (!files.length) return;
    if (files.length > 10) return showToast('Bạn chỉ có thể tải lên tối đa 10 ảnh mỗi lần.', 'error');
    if (files.some(file => file.size > 10 * 1024 * 1024)) return showToast('Mỗi ảnh phải có dung lượng không quá 10 MB.', 'error');
    try { await loadUploadAlbums(); selectedUploadFiles = files; uploadFileSummary.textContent = `${files.length} ảnh đã chọn: ${files.map(file => file.name).join(', ')}`; uploadProgress.textContent = ''; uploadDialog.hidden = false; }
    catch (error) { if (error.message === 'no_album') { selectedUploadFiles = files; uploadFileSummary.textContent = `${files.length} ảnh đã chọn: ${files.map(file => file.name).join(', ')}`; newCollectionForm?.reset(); newCollectionMessage.textContent = 'Hãy tạo album để tiếp tục tải ảnh.'; returnToUploadAfterAlbumCreation = true; newCollectionDialog.hidden = false; } else showToast('Không thể tải danh sách album.', 'error'); }
  });
  input.click();
}
uploadButton?.addEventListener('click', startUpload);
collectionsUploadButton?.addEventListener('click', startUpload);
uploadCreateAlbum?.addEventListener('click', () => { returnToUploadAfterAlbumCreation = true; newCollectionForm?.reset(); newCollectionMessage.textContent = ''; uploadDialog.hidden = true; newCollectionDialog.hidden = false; document.querySelector('#new-collection-name')?.focus(); });
[uploadCancel, uploadCancelAction].forEach(button => button?.addEventListener('click', closeUploadDialog));
uploadSubmit?.addEventListener('click', async () => {
  if (!selectedUploadFiles.length || !uploadAlbum.value) return;
  setButtonLoading(uploadSubmit, true, 'Đang tải lên…');
  try { await uploadImages(selectedUploadFiles, uploadAlbum.value); closeUploadDialog(); showToast('Đã tải ảnh lên thành công. Mở album để đổi tên hoặc chia sẻ từng ảnh.', 'success'); await refreshAlbums(); await refreshRecent(); await refreshOverview(); }
  catch (error) { uploadProgress.textContent = error.code === 'storage_quota_exceeded' ? 'Tài khoản đã hết hoặc không đủ dung lượng 20 GB.' : 'Tải ảnh thất bại, vui lòng thử lại.'; showToast(uploadProgress.textContent, 'error'); }
  finally { setButtonLoading(uploadSubmit, false, 'Tải ảnh lên'); }
});

function setAuthenticated(loggedIn) {
  document.body.classList.toggle('is-authenticated', loggedIn);
  if (authPanel) authPanel.hidden = loggedIn;
  if (dashboard) dashboard.hidden = !loggedIn;
  if (loggedIn) sidebar?.classList.remove('open');
}

function applyUser(user) {
  activeUserId = Number(user.id);
  activeUserRole = user.role || 'user';
  const tag = user.userTag || `${user.username}#${user.userCode}`;
  if (adminNavLink) {
    adminNavLink.hidden = user.role !== 'admin';
    adminNavLink.setAttribute('aria-hidden', user.role === 'admin' ? 'false' : 'true');
  }
  if (adminPage) adminPage.hidden = user.role !== 'admin';
  if (currentUserTag) currentUserTag.textContent = tag;
  if (currentUserRole) currentUserRole.textContent = user.role === 'admin' ? 'Quản trị viên' : 'Tài khoản khách';
  if (currentUserName) currentUserName.textContent = user.username;
  userAvatars.forEach(avatar => { avatar.textContent = user.username.slice(0, 2).toUpperCase(); });
}

async function refreshAuth() {
  const response = await fetch('/api/auth/me');
  if (!response.ok) {
    setAuthenticated(false);
    return;
  }
  const { data: user } = await response.json();
  setAuthenticated(true);
  applyUser(user);
  if (document.body.dataset.page === 'admin' && user.role !== 'admin') {
    window.location.replace('/');
    return;
  }
  if (user.role === 'admin' && document.body.dataset.page !== 'admin') {
    window.location.replace('/admin');
    return;
  }
  if (adminPage) adminPage.hidden = user.role !== 'admin';
  if (user.role === 'admin' && document.body.dataset.page === 'admin') loadAdminData();
}

loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.checkValidity()) return loginForm.reportValidity();
  setButtonLoading(loginButton, true, 'Đang đăng nhập…');
  authMessage.textContent = '';
  try {
    const form = new FormData(loginForm);
    const response = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(form)) });
    if (!response.ok) {
      authMessage.textContent = response.status === 401 ? 'Tên người dùng hoặc mật khẩu không đúng.' : 'Không thể đăng nhập lúc này.';
      return;
    }
    authMessage.textContent = '';
    const { data: user } = await response.json();
    loginForm.reset();
    window.location.replace(user.role === 'admin' ? '/admin' : '/');
    return;
  } catch {
    authMessage.textContent = 'Không thể kết nối đến máy chủ.';
  } finally {
    setButtonLoading(loginButton, false, 'Đăng nhập');
  }
});

registerForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!registerForm.checkValidity()) return registerForm.reportValidity();
  const form = new FormData(registerForm);
  if (form.get('password') !== form.get('passwordConfirm')) {
    registerMessage.textContent = 'Mật khẩu nhập lại không khớp.';
    return;
  }
  setButtonLoading(registerButton, true, 'Đang tạo tài khoản…');
  registerMessage.textContent = '';
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      registerMessage.textContent = response.status === 409
        ? 'Tên người dùng đã tồn tại.'
        : response.status === 400 ? 'Tên người dùng hoặc mật khẩu không hợp lệ.' : 'Không thể đăng ký lúc này.';
      return;
    }
    const { data: user } = await response.json();
    registerForm.reset();
    if (user.role === 'admin') {
      window.location.replace('/admin');
      return;
    }
    setAuthenticated(true);
    applyUser(user);
    await refreshAlbums();
    await refreshRecent();
    await refreshSharedAlbums();
    await refreshOverview();
    showToast(`Đăng ký thành công: ${user.userTag}`, 'success');
  } catch {
    registerMessage.textContent = 'Không thể kết nối đến máy chủ.';
  } finally {
    setButtonLoading(registerButton, false, 'Đăng ký');
  }
});

logoutButton?.addEventListener('click', async () => {
  setButtonLoading(logoutButton, true, 'Đang thoát…');
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('logout_failed');
    setAuthenticated(false);
    if (collectionsGrid) collectionsGrid.replaceChildren();
    if (overviewAlbums) overviewAlbums.replaceChildren();
    if (recentGrids) recentGrids.forEach(grid => grid.replaceChildren());
    if (sharedGrid) sharedGrid.replaceChildren();
    if (usernameInput) usernameInput.focus();
    showToast('Bạn đã đăng xuất', 'success');
  } catch {
    showToast('Không thể đăng xuất lúc này', 'error');
  } finally {
    setButtonLoading(logoutButton, false, 'Đăng xuất');
  }
});

refreshAuth().catch(() => setAuthenticated(false));

const adminUsers = document.querySelector('#admin-users');
const adminAlbums = document.querySelector('#admin-albums');
const adminUserCount = document.querySelector('#admin-user-count');
const adminAlbumCount = document.querySelector('#admin-album-count');
const adminImageCount = document.querySelector('#admin-image-count');
const adminStorage = document.querySelector('#admin-storage');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function loadAdminData() {
  const [overviewResponse, usersResponse, albumsResponse] = await Promise.all([
    fetch('/api/admin/overview'),
    fetch('/api/admin/users'),
    fetch('/api/admin/albums')
  ]);
  if (![overviewResponse, usersResponse, albumsResponse].every(response => response.ok)) {
    showToast('Không thể tải dữ liệu quản trị.', 'error');
    return;
  }
  const [{ data: overview }, { data: users }, { data: albums }] = await Promise.all([
    overviewResponse.json(), usersResponse.json(), albumsResponse.json()
  ]);
  adminUserCount.textContent = overview.users.toLocaleString('vi-VN');
  adminAlbumCount.textContent = overview.albums.total.toLocaleString('vi-VN');
  adminImageCount.textContent = overview.images.total.toLocaleString('vi-VN');
  adminStorage.textContent = formatBytes(overview.storageBytes);
  adminUsers.innerHTML = users.map(user => `<tr><td><strong>${escapeHtml(user.user_tag)}</strong><small>${escapeHtml(new Date(user.created_at).toLocaleDateString('vi-VN'))}</small></td><td>${user.album_count}</td><td>${user.upload_count}</td><td>${formatBytes(user.upload_bytes)}</td><td><span class="privacy-note">Không xem ảnh</span></td></tr>`).join('');
  adminAlbums.innerHTML = albums.map(album => `<tr><td><strong>${escapeHtml(album.name)}</strong><small>${escapeHtml(new Date(album.created_at).toLocaleDateString('vi-VN'))}</small></td><td>${escapeHtml(album.owner_tag)}</td><td>${escapeHtml(album.visibility)}</td><td>${album.image_count}</td></tr>`).join('');
}

const overviewAlbums = document.querySelector('#overview-albums');
const overviewStats = {
  images: document.querySelector('#overview-image-count'),
  albums: document.querySelector('#overview-album-count'),
  shared: document.querySelector('#overview-shared-count')
};
const collectionsGrid = document.querySelector('.collection-grid-full');
const collectionsToolbar = document.querySelector('.collection-view-toolbar strong');
const sharedGrid = document.querySelector('#shared-grid');
const sharedCount = document.querySelector('#shared-count');
const sharedImagesPanel = document.querySelector('#shared-images-panel');
const sharedAlbumsPanel = document.querySelector('#shared-albums-panel');
const sharedImagesList = document.querySelector('#shared-images-list');
const sharedImageCount = document.querySelector('#shared-image-count');
const imageShareDialog = document.querySelector('#image-share-dialog');
const imageShareName = document.querySelector('#image-share-name');
const imageShareMessage = document.querySelector('#image-share-message');
const imageShareCreate = document.querySelector('#image-share-create');
let activeShareImage;
let bulkShareImages = [];

const bulkImageShareDialog = document.querySelector('#bulk-image-share-dialog');
const bulkImageShareName = document.querySelector('#bulk-image-share-name');
const bulkImageShareList = document.querySelector('#bulk-image-share-list');
const bulkImageShareForm = document.querySelector('#bulk-image-share-form');
const bulkImageShareUsername = document.querySelector('#bulk-image-share-username');
const bulkImageShareMessage = document.querySelector('#bulk-image-share-message');

function closeBulkImageShare(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (bulkImageShareDialog) bulkImageShareDialog.hidden = true;
  bulkShareImages = [];
}
async function openBulkImageShare(albumId, albumName) { if (!bulkImageShareDialog) return; try { const response = await fetch(`/api/albums/${albumId}`); if (!response.ok) throw new Error(); const {data: album} = await response.json(); bulkShareImages = album.images || []; bulkImageShareName.textContent = albumName; bulkImageShareMessage.textContent = ''; bulkImageShareUsername.value = ''; bulkImageShareList.innerHTML = bulkShareImages.length ? bulkShareImages.map(image => `<label class="bulk-image-option"><input type="checkbox" name="imageId" value="${Number(image.id)}"><span>${escapeHtml(image.title || image.original_name)}</span></label>`).join('') : '<p class="page-copy">Album chưa có ảnh.</p>'; bulkImageShareDialog.hidden = false; } catch { showToast('Không thể tải danh sách ảnh.', 'error'); } }
async function shareSelectedImages(event) { event.preventDefault(); const selectedIds = [...bulkImageShareList.querySelectorAll('input[name="imageId"]:checked')].map(input => Number(input.value)); const username = bulkImageShareUsername.value.trim(); if (!selectedIds.length) { bulkImageShareMessage.textContent = 'Hãy chọn ít nhất một ảnh.'; return; } if (!username) return; const submit = bulkImageShareForm.querySelector('button[type="submit"]'); submit.disabled = true; bulkImageShareMessage.textContent = 'Đang chia sẻ…'; try { const results = await Promise.all(selectedIds.map(imageId => fetch(`/api/images/${imageId}/shares`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username})}))); const successCount = results.filter(response => response.ok).length; bulkImageShareMessage.textContent = successCount === selectedIds.length ? `Đã chia sẻ ${successCount} ảnh.` : `Đã chia sẻ ${successCount}/${selectedIds.length} ảnh.`; if (successCount) { [...bulkImageShareList.querySelectorAll('input[name="imageId"]:checked')].forEach(input => { input.checked = false; }); } } catch { bulkImageShareMessage.textContent = 'Không thể kết nối đến máy chủ.'; } finally { submit.disabled = false; } }

const albumDialog = document.querySelector('#album-dialog');
const albumImages = document.querySelector('#album-images');
const albumCategoryFilter = document.querySelector('#album-category-filter');
const albumDialogTitle = document.querySelector('#album-dialog-title');
const albumDialogCopy = document.querySelector('#album-dialog-copy');
const imageViewer = document.querySelector('#image-viewer');
const imageViewerImage = document.querySelector('#image-viewer-image');
const imageViewerClose = document.querySelector('#image-viewer-close');
const shareDialog = document.querySelector('#share-dialog');
const shareForm = document.querySelector('#share-form');
const shareList = document.querySelector('#share-list');
const shareMessage = document.querySelector('#share-message');
let activeShareAlbum;
const imageEditDialog = document.querySelector('#image-edit-dialog');
const imageEditForm = document.querySelector('#image-edit-form');
const imageEditName = document.querySelector('#image-edit-name');


function closeImageShare(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (imageShareDialog) imageShareDialog.hidden = true;
  activeShareImage = null;
}
function openImageShare(image) { activeShareImage = image; imageShareName.textContent = image.title || image.original_name; imageShareMessage.textContent = ''; imageShareDialog.hidden = false; loadImageShares(); }
async function createImageShare() { if (!activeShareImage) return; imageShareCreate.disabled = true; try { const response = await fetch(`/api/images/${activeShareImage.id}/share-links`, {method:'POST'}); const body = await response.json(); if (!response.ok) throw new Error(); const url = new URL(body.data.url, location.origin).href; await navigator.clipboard?.writeText(url); imageShareMessage.textContent = `Đã tạo link: ${url}`; refreshSharedImages(); } catch { imageShareMessage.textContent = 'Không thể tạo liên kết ảnh.'; } finally { imageShareCreate.disabled = false; } }
async function refreshSharedImages() { if (!sharedImagesList) return; const response = await fetch('/api/shared/images'); if (!response.ok) return; const {data=[]} = await response.json(); sharedImageCount.textContent = `${data.length} ảnh`; sharedImagesList.innerHTML = data.length ? data.map(item => `<div class="share-row"><strong>${escapeHtml(item.title || item.original_name)}</strong><small>${escapeHtml(item.album_name)} · ${item.kind === 'direct' ? `Được chia sẻ bởi ${escapeHtml(item.owner_username || 'người dùng')}` : 'Link của bạn'}</small><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Mở ảnh</a>${item.kind === 'link' ? `<button type="button" class="remove-image-share" data-image-id="${item.image_id}" data-share-id="${item.id}">Xóa</button>` : ''}</div>`).join('') : '<p class="page-copy">Chưa có ảnh được chia sẻ.</p>'; }

const imageShareForm = document.querySelector('#image-share-form');
const imageShareUsername = document.querySelector('#image-share-username');
const imageShareList = document.querySelector('#image-share-list');
async function loadImageShares() { if (!activeShareImage || !imageShareList) return; const response = await fetch(`/api/images/${activeShareImage.id}/shares`); if (!response.ok) return; const {data=[]} = await response.json(); imageShareList.innerHTML = data.length ? data.map(share => `<div class="share-row"><strong>${escapeHtml(share.user_tag)}</strong><button type="button" class="remove-image-user-share" data-user-id="${share.user_id}">Thu hồi</button></div>`).join('') : '<p class="page-copy">Chưa chia sẻ trực tiếp với ai.</p>'; }
async function shareImageWithUser(event) { event.preventDefault(); if (!activeShareImage) return; const response = await fetch(`/api/images/${activeShareImage.id}/shares`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:imageShareUsername.value})}); if (!response.ok) { imageShareMessage.textContent = response.status === 404 ? 'Không tìm thấy người dùng này.' : 'Không thể chia sẻ ảnh.'; return; } imageShareUsername.value = ''; imageShareMessage.textContent = 'Đã chia sẻ ảnh cho người dùng.'; await loadImageShares(); }





const imageEditDescription = document.querySelector('#image-edit-description');
const imageEditVisibility = document.querySelector('#image-edit-visibility');
const imageEditCategory = document.querySelector('#image-edit-category');
const imageEditMessage = document.querySelector('#image-edit-message');
const albumDialogShare = document.querySelector('#album-dialog-share');
const newCollectionDialog = document.querySelector('#new-collection-dialog');
const newCollectionForm = document.querySelector('#new-collection-form');
const newCollectionMessage = document.querySelector('#new-collection-message');
const newCollectionSubmit = document.querySelector('#new-collection-submit');
let activeImage;
let activeAlbumId;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const imageDisplayName = image => String(image?.title || image?.original_name || 'Ảnh').replace(/\.[^.]+$/, '');
const visibilityLabel = visibility => ({ public: 'Công khai', private: 'Riêng tư', link: 'Có liên kết' }[visibility] || 'Riêng tư');
const photoClasses = ['photo-summer', 'photo-travel', 'photo-family'];
function albumCard(album, shared = false) { const isOwner = activeUserRole === 'admin' || Number(album.owner_id) === activeUserId; const controls = isOwner ? `<div class="album-actions"><button class="album-share-button" data-album-id="${Number(album.id)}" data-album-name="${escapeHtml(album.name)}" type="button">Chia sẻ album</button><button class="album-images-share-button" data-album-id="${Number(album.id)}" data-album-name="${escapeHtml(album.name)}" type="button">Chia sẻ ảnh</button><button class="edit-album-button" data-album-id="${Number(album.id)}" data-album-name="${escapeHtml(album.name)}" type="button">Đổi tên</button><button class="delete-album-button" data-album-id="${Number(album.id)}" data-album-name="${escapeHtml(album.name)}" type="button">Xóa</button></div>` : ''; const theme = album.cover_theme || 'default'; const coverClass = album.cover_url ? ' album-has-cover' : ''; const coverStyle = album.cover_url ? ` style="--album-cover-image:url('${escapeHtml(album.cover_url)}')"` : ''; const badge = isOwner ? visibilityLabel(album.visibility) : (album.role === 'editor' ? 'Có thể chỉnh sửa' : 'Chỉ xem'); const description = !isOwner && shared && album.owner_username ? `Chia sẻ bởi ${album.owner_username}#${String(album.owner_user_code || '').padStart(4, '0')}` : album.description || 'Album của bạn'; return `<article class="collection-card album-card" data-album-id="${Number(album.id)}"><div class="photo album-theme-${escapeHtml(theme)}${coverClass}"${coverStyle}><span class="collection-count">${badge}</span></div><div class="collection-meta"><div><h3>${escapeHtml(album.name)}</h3><p>${escapeHtml(description)}</p></div>${controls}</div></article>`; }
async function refreshAlbums() { const response = await fetch('/api/albums'); if (!response.ok) return; const { data = [] } = await response.json(); if (collectionsGrid) collectionsGrid.innerHTML = data.length ? data.map(albumCard).join('') : '<p class="page-copy">Chưa có album nào. Hãy tạo album đầu tiên.</p>'; if (overviewAlbums) overviewAlbums.innerHTML = data.slice(0, 3).map(albumCard).join('') || '<p class="page-copy">Chưa có album nào.</p>'; if (collectionsToolbar) collectionsToolbar.textContent = `${data.length} bộ sưu tập`; }
async function refreshSharedAlbums() { if (!sharedGrid) return; const response = await fetch('/api/shared'); if (!response.ok) { sharedGrid.replaceChildren(); if (sharedCount) sharedCount.textContent = 'Chưa có album được chia sẻ'; return; } const {data = []} = await response.json(); if (sharedCount) sharedCount.textContent = `${data.length} bộ sưu tập`; sharedGrid.innerHTML = data.length ? data.map(album => albumCard(album, true)).join('') : '<p class="page-copy">Chưa có bộ sưu tập nào được chia sẻ cho bạn.</p>'; }
function renderAlbumImages(images, canEdit) { const selected = albumCategoryFilter?.value || ''; const filtered = selected ? images.filter(image => String(image.category_id) === selected) : images; albumImages.innerHTML = filtered.length ? filtered.map(image => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(imageDisplayName(image))}" loading="lazy"><figcaption><strong>${escapeHtml(imageDisplayName(image))}</strong><span class="category-badge">${escapeHtml(image.category_name || 'Chưa phân loại')}</span>${canEdit ? `<div class="image-actions"><button type="button" class="image-share-button" data-image='${escapeHtml(JSON.stringify(image))}'>Chia sẻ ảnh</button><button type="button" class="edit-image-button" data-image='${escapeHtml(JSON.stringify(image))}'>Sửa</button><button type="button" class="delete-image-button" data-image-id="${Number(image.id)}" data-image-name="${escapeHtml(imageDisplayName(image))}">Xóa</button></div>` : ''}</figcaption></figure>`).join('') : '<p class="page-copy">Không có ảnh trong danh mục này.</p>'; }
function openAlbum(id) { const response = fetch(`/api/albums/${id}`); return response.then(async result => { if (!result.ok) return showToast('Không thể mở album này.', 'error'); const { data: album } = await result.json(); activeAlbumId = id; const canEdit = album.role === 'owner' || album.role === 'editor'; albumDialogTitle.textContent = album.name; albumDialogCopy.textContent = album.description || `${album.images.length} ảnh`; if (albumDialogShare) { albumDialogShare.hidden = !canEdit; albumDialogShare.dataset.albumId = String(id); albumDialogShare.dataset.albumName = album.name; } if (albumCategoryFilter) { await loadCategories(); albumCategoryFilter.innerHTML = '<option value="">Tất cả danh mục</option>' + categories.map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join(''); albumCategoryFilter.value = ''; albumCategoryFilter.onchange = () => renderAlbumImages(album.images, canEdit); } renderAlbumImages(album.images, canEdit); albumDialog.hidden = false; }); }

async function loadShares() { const response = await fetch(`/api/albums/${activeShareAlbum}/shares`); if (!response.ok) throw new Error(); const { data = [] } = await response.json(); shareList.innerHTML = data.length ? data.map(share => `<div class="share-row"><strong>${escapeHtml(share.user_tag || share.username)}</strong><select data-user-id="${share.user_id}" class="share-role"><option value="viewer" ${share.role === 'viewer' ? 'selected' : ''}>viewer</option><option value="editor" ${share.role === 'editor' ? 'selected' : ''}>editor</option></select><button type="button" data-user-id="${share.user_id}" class="remove-share">Thu hồi</button></div>`).join('') : '<p class="page-copy">Chưa chia sẻ với ai.</p>'; }
function closeShareDialog(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (shareDialog) shareDialog.hidden = true;
  activeShareAlbum = null;
}
function openShareDialog(id, name) { activeShareAlbum = id; document.querySelector('#share-album-name').textContent = name; shareMessage.textContent = ''; shareForm.reset(); shareDialog.hidden = false; loadShares().catch(() => { shareMessage.textContent = 'Không thể tải danh sách quyền.'; }); }
[collectionsGrid, overviewAlbums, sharedGrid].forEach(grid => grid?.addEventListener('click', async event => { const share = event.target.closest('.album-share-button'); if (share) return openShareDialog(share.dataset.albumId, share.dataset.albumName); const bulkShare = event.target.closest('.album-images-share-button'); if (bulkShare) { event.stopPropagation(); return openBulkImageShare(bulkShare.dataset.albumId, bulkShare.dataset.albumName); } const edit = event.target.closest('.edit-album-button'); if (edit) { const name = prompt('Tên mới của album:', edit.dataset.albumName); if (!name?.trim() || name.trim() === edit.dataset.albumName) return; const response = await fetch(`/api/albums/${edit.dataset.albumId}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name.trim()})}); if (!response.ok) return showToast('Không thể đổi tên album.', 'error'); showToast('Đã đổi tên album.', 'success'); await refreshAlbums(); return; } const remove = event.target.closest('.delete-album-button'); if (remove) { if (!confirm(`Xóa album “${remove.dataset.albumName}” và toàn bộ ảnh bên trong?`)) return; const response = await fetch(`/api/albums/${remove.dataset.albumId}`, {method:'DELETE'}); if (!response.ok) return showToast('Không thể xóa album.', 'error'); showToast('Đã xóa album.', 'success'); await refreshAlbums(); return; } const card = event.target.closest('.album-card'); if (card) openAlbum(card.dataset.albumId); }));
document.querySelector('#bulk-image-share-form')?.addEventListener('submit', shareSelectedImages);
document.querySelector('#image-share-create')?.addEventListener('click', createImageShare);
albumDialogShare?.addEventListener('click', event => { event.preventDefault(); if (activeAlbumId) { if (albumDialog) albumDialog.hidden = true; openShareDialog(activeAlbumId, albumDialogShare.dataset.albumName); } });
document.addEventListener('click', event => {
  const closeButton = event.target.closest('#bulk-image-share-cancel, #bulk-image-share-cancel-action, #image-share-cancel, #image-share-cancel-action, #share-cancel, #album-cancel');
  if (!closeButton) return;
  if (closeButton.id.startsWith('bulk-image-share')) return closeBulkImageShare(event);
  if (closeButton.id.startsWith('image-share')) return closeImageShare(event);
  if (closeButton.id === 'share-cancel') return closeShareDialog(event);
  if (closeButton.id === 'album-cancel') {
    event.preventDefault();
    event.stopPropagation();
    if (albumDialog) albumDialog.hidden = true;
    if (newCollectionDialog) newCollectionDialog.hidden = true;
  }
});
document.querySelectorAll('.share-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.share-tab').forEach(item => item.classList.toggle('active', item === tab)); const images = tab.dataset.shareTab === 'images'; sharedAlbumsPanel.hidden = images; sharedImagesPanel.hidden = !images; if (images) refreshSharedImages(); }));
sharedImagesList?.addEventListener('click', async event => { const button = event.target.closest('.remove-image-share'); if (!button || !confirm('Xóa liên kết ảnh này?')) return; const response = await fetch(`/api/images/${button.dataset.imageId}/share-links/${button.dataset.shareId}`, {method:'DELETE'}); if (!response.ok) return showToast('Không thể xóa liên kết.', 'error'); refreshSharedImages(); });
function closeImageViewer() { imageViewer.hidden = true; imageViewerImage.removeAttribute('src'); }
albumImages?.addEventListener('click', event => { const image = event.target.closest('img'); if (!image || event.target.closest('button')) return; imageViewerImage.src = image.src; imageViewerImage.alt = image.alt; imageViewer.hidden = false; });
albumImages?.addEventListener('click', async event => { const deleteButton = event.target.closest('.delete-image-button'); if (deleteButton) { event.stopPropagation(); if (!confirm(`Xóa ảnh “${deleteButton.dataset.imageName}” khỏi album?`)) return; const response = await fetch(`/api/images/${deleteButton.dataset.imageId}`, {method:'DELETE'}); if (!response.ok) return showToast('Không thể xóa ảnh.', 'error'); showToast('Đã xóa ảnh.', 'success'); await openAlbum(activeAlbumId); await refreshOverview(); await refreshRecent(); return; } const button = event.target.closest('.edit-image-button'); if (!button) return; event.stopPropagation(); try { activeImage = JSON.parse(button.dataset.image); imageEditName.value = imageDisplayName(activeImage); imageEditName.placeholder = 'Nhập tên ảnh, không cần phần mở rộng'; imageEditDescription.value = activeImage.description || ''; imageEditVisibility.value = activeImage.visibility || 'public'; loadCategories().then(() => { imageEditCategory.innerHTML = categories.map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join(''); imageEditCategory.value = String(activeImage.category_id || categories[0]?.id || ''); }); imageEditMessage.textContent = ''; imageEditDialog.hidden = false; } catch { showToast('Không thể mở thông tin ảnh.', 'error'); } });

albumImages?.addEventListener('click', event => { const button = event.target.closest('.image-share-button'); if (!button) return; event.stopPropagation(); try { openImageShare(JSON.parse(button.dataset.image)); } catch { showToast('Không thể chia sẻ ảnh này.', 'error'); } });
function closeImageEdit(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (imageEditDialog) imageEditDialog.hidden = true;
  activeImage = null;
}
document.addEventListener('click', event => {
  const closeButton = event.target.closest('#image-edit-cancel, #image-edit-cancel-action');
  if (closeButton) closeImageEdit(event);
});
imageEditDialog?.addEventListener('click', event => { if (event.target === imageEditDialog) closeImageEdit(); });
imageEditForm?.addEventListener('submit', async event => { event.preventDefault(); if (!activeImage) return; const submitButton = imageEditForm.querySelector('button[type="submit"]'); setButtonLoading(submitButton, true, 'Đang lưu…'); imageEditMessage.textContent = ''; try { const response = await fetch(`/api/images/${activeImage.id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: imageEditName.value, description: imageEditDescription.value, visibility: imageEditVisibility.value, category_id: imageEditCategory.value}) }); let body = {}; try { body = await response.json(); } catch {} if (!response.ok) { imageEditMessage.textContent = body.message || (body.error === 'forbidden' ? 'Bạn không có quyền sửa ảnh này.' : 'Không thể lưu thông tin ảnh.'); return; } closeImageEdit(); showToast('Đã cập nhật thông tin ảnh.', 'success'); await openAlbum(activeAlbumId); } catch { imageEditMessage.textContent = 'Không thể kết nối đến máy chủ.'; } finally { setButtonLoading(submitButton, false, 'Lưu thay đổi'); } });
imageViewerClose?.addEventListener('click', closeImageViewer);
imageShareForm?.addEventListener('submit', shareImageWithUser); document.querySelector('#image-share-cancel')?.addEventListener('click', closeImageShare); imageShareList?.addEventListener('click', async event => { const button = event.target.closest('.remove-image-user-share'); if (!button || !confirm('Thu hồi quyền xem ảnh?')) return; const response = await fetch(`/api/images/${activeShareImage.id}/shares/${button.dataset.userId}`, {method:'DELETE'}); if (!response.ok) return showToast('Không thể thu hồi quyền.', 'error'); await loadImageShares(); });


imageViewer?.addEventListener('click', event => { if (event.target === imageViewer) closeImageViewer(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (imageEditDialog && !imageEditDialog.hidden) return closeImageEdit(event);
  if (imageShareDialog && !imageShareDialog.hidden) return closeImageShare(event);
  if (bulkImageShareDialog && !bulkImageShareDialog.hidden) return closeBulkImageShare(event);
  if (shareDialog && !shareDialog.hidden) return closeShareDialog(event);
  if (newCollectionDialog && !newCollectionDialog.hidden) { newCollectionDialog.hidden = true; return; }
  if (!imageViewer.hidden) return closeImageViewer();
  if (!albumDialog.hidden) albumDialog.hidden = true;
});
shareForm?.addEventListener('submit', async event => { event.preventDefault(); const response = await fetch(`/api/albums/${activeShareAlbum}/shares`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(shareForm))) }); if (!response.ok) { shareMessage.textContent = response.status === 404 ? 'Không tìm thấy username này.' : 'Không thể chia sẻ album.'; return; } shareForm.reset(); shareMessage.textContent = 'Đã chia sẻ album.'; await loadShares(); });
shareList?.addEventListener('change', async event => { if (!event.target.matches('.share-role')) return; const response = await fetch(`/api/albums/${activeShareAlbum}/shares/${event.target.dataset.userId}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({role:event.target.value})}); showToast(response.ok ? 'Đã cập nhật quyền.' : 'Không thể cập nhật quyền.', response.ok ? 'success' : 'error'); });
shareList?.addEventListener('click', async event => { const button = event.target.closest('.remove-share'); if (!button || !confirm('Thu hồi quyền truy cập?')) return; const response = await fetch(`/api/albums/${activeShareAlbum}/shares/${button.dataset.userId}`, {method:'DELETE'}); if (!response.ok) return showToast('Không thể thu hồi quyền.', 'error'); await loadShares(); });
document.querySelector('#new-collection-button')?.addEventListener('click', () => { returnToUploadAfterAlbumCreation = false; newCollectionForm?.reset(); if (newCollectionMessage) newCollectionMessage.textContent = ''; if (newCollectionDialog) newCollectionDialog.hidden = false; document.querySelector('#new-collection-name')?.focus(); });
['#new-collection-cancel', '#new-collection-cancel-action'].forEach(selector => document.querySelector(selector)?.addEventListener('click', () => { if (newCollectionDialog) newCollectionDialog.hidden = true; }));
newCollectionForm?.addEventListener('submit', async event => { event.preventDefault(); if (!newCollectionForm.checkValidity()) return newCollectionForm.reportValidity(); setButtonLoading(newCollectionSubmit, true, 'Đang tạo…'); newCollectionMessage.textContent = ''; try { const form = new FormData(newCollectionForm); const response = await fetch('/api/albums', {method:'POST', body:form}); const body = await response.json().catch(() => ({})); if (!response.ok) { newCollectionMessage.textContent = response.status === 400 ? (body.message || 'Tên album không hợp lệ.') : 'Không thể tạo album.'; return; } newCollectionDialog.hidden = true; await refreshAlbums(); if (returnToUploadAfterAlbumCreation && body.data?.id) { await loadUploadAlbums(); uploadAlbum.value = String(body.data.id); uploadDialog.hidden = false; returnToUploadAfterAlbumCreation = false; showToast('Đã tạo album. Bạn có thể tải ảnh lên.', 'success'); } else showToast('Đã tạo album.', 'success'); } catch { newCollectionMessage.textContent = 'Không thể kết nối đến máy chủ.'; } finally { setButtonLoading(newCollectionSubmit, false, 'Tạo album'); } });
async function refreshOverview() { const response = await fetch('/api/overview'); if (!response.ok) return; const {data} = await response.json();
  if (overviewStats.images) overviewStats.images.textContent = data.imageCount.toLocaleString('vi-VN');
  if (overviewStats.albums) overviewStats.albums.textContent = data.albumCount.toLocaleString('vi-VN');
  if (overviewStats.shared) overviewStats.shared.textContent = data.sharedImageCount.toLocaleString('vi-VN');
  const percent = Math.min(100, data.storageBytes / data.storageQuotaBytes * 100); const displayedPercent = percent > 0 && percent < 0.01 ? '<0.01' : percent.toFixed(2).replace(/\.?0+$/, ''); if (storagePercent) storagePercent.textContent = `${displayedPercent}%`; if (storageProgress) storageProgress.style.width = `${percent}%`; if (storageSummary) storageSummary.textContent = `${formatBytes(data.storageBytes)} trong ${formatBytes(data.storageQuotaBytes)}`; }

refreshAlbums();
refreshOverview();
refreshSharedImages();
refreshSharedAlbums();
const recentGrids = document.querySelectorAll('#recent-grid, #recent-grid-overview');
const recentCount = document.querySelector('#recent-count');
async function refreshRecent() { const response = await fetch('/api/recent'); if (!response.ok) throw new Error(); const {data=[]} = await response.json(); if (recentCount) recentCount.textContent = `${data.length} ảnh`; recentGrids.forEach(grid => { grid.innerHTML = data.length ? data.map((image,index) => `<article class="recent-item" data-album-id="${Number(image.album_id || 0)}"><div class="recent-photo ${['photo-coffee','photo-lake','photo-flower','photo-city'][index % 4]}"><span>${escapeHtml(new Date(image.created_at).toLocaleString('vi-VN'))}</span></div><div class="recent-item-meta"><strong>${escapeHtml(imageDisplayName(image))}</strong><span class="recent-album-label">Album: ${escapeHtml(image.album_name || 'Chưa xác định')}</span><small>${escapeHtml(new Date(image.created_at).toLocaleString('vi-VN'))}</small></div></article>`).join('') : '<p class="page-copy">Chưa có ảnh nào trong thư viện.</p>'; }); }
recentGrids.forEach(grid => grid.addEventListener('click', event => { const item = event.target.closest('.recent-item'); if (item?.dataset.albumId && item.dataset.albumId !== '0') openAlbum(item.dataset.albumId); }));
if (recentGrids.length) refreshRecent().catch(() => { if (recentCount) recentCount.textContent = 'Không thể tải dữ liệu'; });
document.querySelectorAll('.view-controls').forEach(control => control.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; control.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); control.closest('.recent-section')?.querySelector('.recent-grid')?.classList.toggle('list-view', button.getAttribute('aria-label')?.includes('danh sách')); }));
document.querySelector('.notification')?.addEventListener('click', () => showToast('Hiện chưa có thông báo mới.', 'info'));
document.querySelector('.user-card')?.addEventListener('click', event => { event.preventDefault(); showToast('Thông tin tài khoản đang được cập nhật.', 'info'); });

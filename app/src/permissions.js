export function canEditAlbum({ ownerId, userId, userRole, shareRole }) {
  return userRole === 'admin' || ownerId === userId || shareRole === 'editor';
}

export function canDeleteAlbum({ ownerId, userId, userRole }) {
  return userRole === 'admin' || ownerId === userId;
}

export function canViewAlbum({ ownerId, userId, userRole, shareRole, visibility }) {
  return userRole === 'admin' || ownerId === userId || Boolean(shareRole) || visibility === 'public';
}

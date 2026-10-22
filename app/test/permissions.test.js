import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteAlbum, canEditAlbum, canViewAlbum } from '../src/permissions.js';

test('owner and admin can edit an album', () => {
  assert.equal(canEditAlbum({ ownerId: 1, userId: 1, userRole: 'user' }), true);
  assert.equal(canEditAlbum({ ownerId: 1, userId: 9, userRole: 'admin' }), true);
});

test('editor can edit, viewer and outside user cannot', () => {
  assert.equal(canEditAlbum({ ownerId: 1, userId: 2, userRole: 'user', shareRole: 'editor' }), true);
  assert.equal(canEditAlbum({ ownerId: 1, userId: 2, userRole: 'user', shareRole: 'viewer' }), false);
  assert.equal(canEditAlbum({ ownerId: 1, userId: 9, userRole: 'user' }), false);
});

test('album visibility allows public viewing but not editing', () => {
  assert.equal(canViewAlbum({ ownerId: 1, userId: 9, userRole: 'user', visibility: 'public' }), true);
  assert.equal(canViewAlbum({ ownerId: 1, userId: 9, userRole: 'user', visibility: 'private' }), false);
});

test('album owner can delete private album, outside user cannot', () => {
  assert.equal(canDeleteAlbum({ ownerId: 1, userId: 1, userRole: 'user' }), true);
  assert.equal(canDeleteAlbum({ ownerId: 1, userId: 2, userRole: 'user' }), false);
  assert.equal(canDeleteAlbum({ ownerId: 1, userId: 2, userRole: 'admin' }), true);
});

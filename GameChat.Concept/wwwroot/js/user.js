// ============================================
// user.js — persisted user identity (localStorage)
// ============================================

const STORAGE_KEY = 'gchat_username';

export const getUserName  = ()     => localStorage.getItem(STORAGE_KEY) || '';
export const setUserName  = name   => localStorage.setItem(STORAGE_KEY, name.trim());
export const clearUserName = ()    => localStorage.removeItem(STORAGE_KEY);
export const hasUserName  = ()     => getUserName().length > 0;

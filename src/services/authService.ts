import type { SessionResponse, SessionUser } from '../types';
import { ApiError, apiGet, apiSend } from './apiClient';

/** The signed-in user, or null when signed out. */
export async function fetchSession(): Promise<SessionUser | null> {
  try {
    return (await apiGet<SessionResponse>('/api/auth', 20000)).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const signIn = async (username: string, password: string) =>
  (await apiSend<SessionResponse>('POST', '/api/auth?action=login', { username, password })).user;

export const signOut = () => apiSend<{ ok: boolean }>('POST', '/api/auth?action=logout');

export const changePassword = async (currentPassword: string, newPassword: string) =>
  (await apiSend<SessionResponse>('POST', '/api/auth?action=change-password', { currentPassword, newPassword })).user;

export const requestPasswordReset = async (identifier: string) =>
  (await apiSend<{ message: string }>('POST', '/api/auth?action=forgot-password', { identifier })).message;

export const completeEmailLink = async (tokenHash: string, type: 'invite' | 'recovery', newPassword: string) =>
  (await apiSend<SessionResponse>('POST', '/api/auth?action=complete', { tokenHash, type, newPassword })).user;

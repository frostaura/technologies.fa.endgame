import type { ApiError, Book, PagedResult } from './types';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly error: ApiError) {
    super(error.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ code: 'unknown', message: res.statusText }))) as ApiError;
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

export function listBooks(page = 1, pageSize = 20): Promise<PagedResult<Book>> {
  return request<PagedResult<Book>>(`/api/books?page=${page}&pageSize=${pageSize}`);
}

export function createBook(input: Omit<Book, 'id'>): Promise<Book> {
  return request<Book>('/api/books', { method: 'POST', body: JSON.stringify(input) });
}

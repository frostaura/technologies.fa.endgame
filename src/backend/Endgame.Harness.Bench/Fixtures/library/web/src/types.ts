export interface Book {
  id: number;
  title: string;
  author: string;
  year: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** The API's one error body: a snake_case code and a human-readable message. */
export interface ApiError {
  code: string;
  message: string;
}

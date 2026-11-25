/** A problem-details body, as every Endgame app's API returns on failure. */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
  signInUrl?: string;
  [key: string]: unknown;
}

/**
 * A failed API call. Branch on the subclass (or `status`), never on the message:
 * `NotSignedInError` 401 · `ForbiddenError` 403 · `NotFoundError` 404 · `ValidationError` 400 ·
 * `BudgetExhaustedError` 402 · `NetworkError` when the request never got an answer.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem, message?: string) {
    super(message ?? problem.detail ?? problem.title ?? `The request failed with ${status}.`);
    this.name = new.target.name;
    this.status = status;
    this.problem = problem;
  }
}

/** 401: nobody is signed in. `signInUrl` is where to send them. */
export class NotSignedInError extends ApiError {
  get signInUrl(): string | undefined {
    return this.problem.signInUrl;
  }
}

/** 403: signed in, but not allowed. */
export class ForbiddenError extends ApiError {}

/** 404: the thing does not exist (or is not yours to see). */
export class NotFoundError extends ApiError {}

/** 400: the input was refused. `errors` maps each field to what is wrong with it. */
export class ValidationError extends ApiError {
  get errors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

/**
 * 402: this feature is paused until the organisation tops up: a credit budget is spent
 * (`problem.code` `budget_exhausted`) or the organisation is at its overdraft limit (`overdraft_limit`).
 */
export class BudgetExhaustedError extends ApiError {}

/** The request never got an answer: offline, or the app is restarting. */
export class NetworkError extends ApiError {
  constructor(cause: unknown) {
    super(0, { title: "No answer" }, "The app could not be reached. Check the connection and try again.");
    this.cause = cause;
  }
}

/** Turns a failed response into the matching error. */
export function errorFor(status: number, problem: Problem): ApiError {
  switch (status) {
    case 400:
      return new ValidationError(status, problem);
    case 401:
      return new NotSignedInError(status, problem);
    case 402:
      return new BudgetExhaustedError(status, problem);
    case 403:
      return new ForbiddenError(status, problem);
    case 404:
      return new NotFoundError(status, problem);
    default:
      return new ApiError(status, problem);
  }
}

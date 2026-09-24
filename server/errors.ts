export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** A rejected action: bad input (400), missing object (404), or wrong state (409). */
export class ActionError extends HttpError {
  constructor(message: string, status = 400) {
    super(message, status);
    this.name = "ActionError";
  }
}

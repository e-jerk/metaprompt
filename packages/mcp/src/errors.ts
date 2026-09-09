export class PlaneError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PlaneError";
    this.status = status;
  }
}

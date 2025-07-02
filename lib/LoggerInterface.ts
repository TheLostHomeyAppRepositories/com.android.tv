export interface LoggerInterface {
  log(...args: unknown[]): void;

  debug(...args: unknown[]): void;

  error(...args: unknown[]): void;
}

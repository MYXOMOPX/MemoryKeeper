export function isAuthorized(fromId: number | undefined, allowedTelegramId: number): boolean {
  return fromId === allowedTelegramId;
}

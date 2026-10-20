// Only known product destinations may survive the round trip, never arbitrary URLs.
export function authReturnTo(value) {
  return ['/', '/?page=changes'].includes(value) ? value : '/';
}

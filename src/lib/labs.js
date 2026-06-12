// Labs — per-device beta feature flag (admin-only surfaces).
// Stored in localStorage so it never affects other users/devices.
export const labsEnabled = () => localStorage.getItem('ff_labs') === '1'
export const setLabs = (on) => localStorage.setItem('ff_labs', on ? '1' : '0')

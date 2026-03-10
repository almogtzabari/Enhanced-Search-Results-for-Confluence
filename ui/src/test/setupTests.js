import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

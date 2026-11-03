import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, readStoredTheme, useTheme } from './useTheme';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useTheme', () => {
  it('defaults to light and persists the toggle', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('asphalt');
    expect(localStorage.getItem(THEME_KEY)).toBe('asphalt');
  });

  it('reads a stored theme', () => {
    localStorage.setItem(THEME_KEY, 'asphalt');
    expect(readStoredTheme()).toBe('asphalt');
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('asphalt');
  });
});

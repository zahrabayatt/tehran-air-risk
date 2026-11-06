import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, readStoredTheme, useTheme } from './useTheme';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useTheme', () => {
  it('defaults to dark and persists the toggle', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('reads a stored theme, and treats the old name "asphalt" as dark', () => {
    localStorage.setItem(THEME_KEY, 'light');
    expect(readStoredTheme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'asphalt');
    expect(readStoredTheme()).toBe('dark');
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
  });
});

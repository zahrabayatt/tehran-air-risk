import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no scrolling; the Lab scrolls to the top when a step opens.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
});

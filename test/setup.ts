import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only cleans up by itself when test globals are on.
afterEach(cleanup);

// Runs before every apps/web test file (vitest.config.ts, project "web").
import { configure } from '@testing-library/dom';

// How long findBy* and waitFor wait for the page before they fail. Testing Library's default is
// 1 s. A page here mounts the whole app in jsdom: under load (other test runs on the same machine)
// the first render of a page took 1 to 8 s, so findBy* failed on pages that were correct. 10 s
// keeps a missing element a failure, only a slower one. A test that waits for a timer of its own
// (the pairing poll) needs no timeout of its own either.
configure({ asyncUtilTimeout: 10_000 });

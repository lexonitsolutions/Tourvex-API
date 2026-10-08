import 'reflect-metadata';
import { validateEnvironment } from '../config/env.validation';
import { acceptsDevAuth, DEV_AUTH_TOKEN, isDevAuthAvailable } from './dev-auth';

const on = { nodeEnv: 'development', enabled: 'true' };

describe('dev auth (local development only)', () => {
  it('is accepted only in development, with the flag, the dev token and a loopback address', () => {
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, '127.0.0.1')).toBe(true);
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, '::1')).toBe(true);
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, '::ffff:127.0.0.1')).toBe(true);
  });

  it.each(['production', 'test', undefined, 'staging'])('is never available when NODE_ENV is %s', (nodeEnv) => {
    expect(isDevAuthAvailable({ nodeEnv, enabled: 'true' })).toBe(false);
    expect(acceptsDevAuth({ nodeEnv, enabled: 'true' }, DEV_AUTH_TOKEN, '127.0.0.1')).toBe(false);
  });

  it('stays off unless explicitly enabled', () => {
    expect(acceptsDevAuth({ nodeEnv: 'development' }, DEV_AUTH_TOKEN, '127.0.0.1')).toBe(false);
    expect(acceptsDevAuth({ nodeEnv: 'development', enabled: 'false' }, DEV_AUTH_TOKEN, '127.0.0.1')).toBe(false);
  });

  it('rejects other machines, a missing address and any other token', () => {
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, '192.168.1.20')).toBe(false);
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, '10.0.0.5')).toBe(false);
    expect(acceptsDevAuth(on, DEV_AUTH_TOKEN, undefined)).toBe(false);
    expect(acceptsDevAuth(on, 'something-else', '127.0.0.1')).toBe(false);
    expect(acceptsDevAuth(on, '', '127.0.0.1')).toBe(false);
  });

  it('the API refuses to start in production with the flag on, and allows it in development', () => {
    const base = { MONGODB_URI: 'mongodb://localhost/x', CLERK_SECRET_KEY: 'sk_test_x' };
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true' })).toThrow(/DEV_AUTH_ENABLED/);
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'false' })).not.toThrow();
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production' })).not.toThrow();
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'development', DEV_AUTH_ENABLED: 'true' })).not.toThrow();
  });
});

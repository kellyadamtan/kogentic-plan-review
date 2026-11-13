# Refactor login

Move the session handling out of the login handler.

## Files to modify
- `src/auth/login.ts`
- `src/auth/session.ts`

## Steps
1. Extract `createSession` into `src/auth/session.ts`.
2. Update the login handler to call it.
3. Add unit tests in `src/auth/session.test.ts`.

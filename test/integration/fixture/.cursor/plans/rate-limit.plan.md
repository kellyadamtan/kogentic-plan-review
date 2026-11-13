---
name: Add rate limiting
overview: Limit login attempts per IP address.
todos:
  - id: middleware
    content: Add `src/middleware/rateLimit.ts`
    status: pending
  - id: tests
    content: Add tests for the limiter
    status: pending
---

# Rate limiting

Add a small in-memory limiter for the login route in `src/server.ts`.

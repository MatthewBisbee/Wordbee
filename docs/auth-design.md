# Auth Design

- Guest mode requires no login.
- Wordbee private mode will use a shared password checked server-side.
- Wordbee private mode will use display names for trusted-circle identification.
- Sessions will eventually use HttpOnly cookies.
- Passwords should never be exposed to frontend code.

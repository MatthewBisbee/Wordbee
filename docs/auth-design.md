# Auth Design

- Guest mode requires no login.
- Friends-and-family mode uses one or more shared access codes checked server-side.
- A valid access code unlocks first name and last initial fields.
- The client stores only a signed identity token after login; access codes stay out of frontend code and committed files.
- Sessions will eventually use HttpOnly cookies.
- Private values should never be exposed to frontend code.
- Friends-and-family result notifications use only verified identity tokens and private ntfy environment values. Private topics, notification titles, tokens, and access codes must not be committed.

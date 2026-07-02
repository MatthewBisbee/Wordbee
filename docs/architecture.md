# Architecture

Intended high-level request path:

Browser -> Cloudflare Tunnel -> nginx -> Flask backend -> SQLite

nginx will eventually serve the frontend and reverse-proxy `/api` requests to Flask.

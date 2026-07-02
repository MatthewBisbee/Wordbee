# Architecture

Intended high-level request path:

Browser -> Cloudflare Tunnel -> nginx -> Flask backend -> SQLite

nginx will eventually serve the frontend and reverse-proxy `/api` requests to Flask.

During local development, Vite proxies `/api` requests to the Flask backend on port `5001`.

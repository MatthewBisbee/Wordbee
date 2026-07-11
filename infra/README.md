# Infrastructure

Deployment templates for the Raspberry Pi production install.

- `systemd/wordbee.service` runs the Flask API through Gunicorn.
- `nginx/wordbee.conf` serves `frontend/dist` and proxies `/api` to the local API.
- `cloudflared/config.example.yml` shows the Wordbee ingress entry for the Matthew tunnel.

Copy these into the matching system locations on the Pi only when changing
runtime infrastructure. Normal app deploys should replace app code while
preserving `/home/chungy/apps/wordbee/data`.

